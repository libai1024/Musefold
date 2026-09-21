import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
import { configureTestCoreRuntime } from '../../testing';
import { getPaths } from '../../runtime';
import { OpenAICompatibleProvider } from '../openai-compatible';
import type { GenerationExecution } from '../execution';

// Preserve this suite's real disposable file writes while isolating its dispatch/fee contract.
// Generation integration tests exercise the production precreation intent and lifetime scope.
vi.mock('../../services/local-asset-writes', async () => ({
  assertLocalAssetWriteScope: () => undefined,
  writeLocalGeneratedImage: (await import('node:fs/promises')).writeFile,
}));

let root: string;
const readLiveKey = vi.fn(() => 'live-key-must-not-be-read');
const estimate = vi.fn(() => 2.5);
const request: GenerateImageRequest = {
  jobId: 'durable-image',
  providerId: 'provider-1',
  prompt: 'frozen final prompt',
  size: '1024x1024',
  quality: 'medium',
  n: 1,
};
function png(shade = 0): Buffer {
  const bytes = Buffer.alloc(33, shade);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(1024, 16);
  bytes.writeUInt32BE(1024, 20);
  return bytes;
}
function response(status = 200): Response {
  return new Response(
    JSON.stringify(
      status === 200
        ? { data: [{ b64_json: png().toString('base64') }] }
        : { error: { message: 'rate limited' } },
    ),
    { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } },
  );
}
function provider() {
  return new OpenAICompatibleProvider('provider-1', 'https://images.test/v1', 'model-1', 'Images');
}
function execution(): GenerationExecution {
  return {
    apiKey: 'frozen-process-key',
    binding: {
      providerId: 'provider-1',
      providerType: 'openai-compatible',
      model: 'model-1',
      baseUrl: 'https://images.test/v1',
      credentialEpoch: 'key-epoch-1',
      payerKind: 'external',
      ownerId: null,
      issuer: null,
      policy: 'external',
    },
    beforeDispatch: vi.fn(),
    onCost: vi.fn(),
  };
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'musefold-durable-provider-'));
  vi.clearAllMocks();
  configureTestCoreRuntime(root, { loadApiKey: readLiveKey, estimateProviderCost: estimate });
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe('durable image dispatch', () => {
  it('claims the final request immediately before HTTP with a frozen key and estimate provenance', async () => {
    const port = execution();
    const events: string[] = [];
    port.beforeDispatch = vi.fn((info) => {
      events.push('claim');
      expect(info.referenceHashes).toEqual([]);
      expect(info.request).toMatchObject({ ...request, model: 'model-1' });
      info.request.prompt = 'attempted hook mutation';
      port.apiKey = 'rotated-key-after-snapshot';
    });
    port.onCost = vi.fn((evidence) => {
      events.push('cost');
      expect(evidence).toEqual({
        reportedPoints: 2.5,
        source: 'local_price_estimate',
        evidenceRef: null,
      });
      expect(existsSync(join(getPaths().pictures, `${request.jobId}.png`))).toBe(false);
    });
    const network = vi.fn<typeof fetch>(async (url, init) => {
      events.push('http');
      expect(events).toEqual(['claim', 'http']);
      expect(url).toBe('https://images.test/v1/images/generations');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer frozen-process-key');
      expect(JSON.parse(String(init?.body)).prompt).toBe(request.prompt);
      return response();
    });
    vi.stubGlobal('fetch', network);
    const result = await provider().generateImage(request, undefined, undefined, port);
    expect(result.status).toBe('success');
    expect(result.cost).toBe(2.5);
    expect(events).toEqual(['claim', 'http', 'cost']);
    expect(readLiveKey).not.toHaveBeenCalled();
    expect(estimate).toHaveBeenCalledOnce();
  });

  it('hashes ordered reference bytes once and sends those bytes after the host claim', async () => {
    const paths = [join(root, 'one.png'), join(root, 'two.png')];
    const bytes = [png(1), png(2)];
    paths.forEach((path, i) => {
      writeFileSync(path, bytes[i]);
    });
    const port = execution();
    port.beforeDispatch = vi.fn(({ referenceHashes }) => {
      expect(referenceHashes).toEqual(
        bytes.map((data) => createHash('sha256').update(data).digest('hex')),
      );
      writeFileSync(paths[0], png(3));
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_url, init) => {
        expect(port.beforeDispatch).toHaveBeenCalledOnce();
        const form = init?.body as FormData;
        const sent = form.getAll('image[]') as File[];
        expect(
          await Promise.all(sent.map(async (file) => Buffer.from(await file.arrayBuffer()))),
        ).toEqual(bytes);
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer frozen-process-key');
        return response();
      }),
    );
    await provider().generateImage(
      {
        ...request,
        referenceImages: paths.map((path) => ({ path, source: 'upload' })),
      },
      undefined,
      undefined,
      port,
    );
    expect(readFileSync(paths[0])).toEqual(png(3));
    expect(readLiveKey).not.toHaveBeenCalled();
  });

  it('sends nothing and records no cost when the host rejects an epoch or durable claim', async () => {
    const port = execution();
    port.beforeDispatch = vi.fn(() => {
      throw Object.assign(new Error('The payer epoch changed'), { code: 'SPEND_BINDING_CHANGED' });
    });
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', network);
    await expect(
      provider().generateImage(request, undefined, undefined, port),
    ).rejects.toMatchObject({ code: 'SPEND_BINDING_CHANGED' });
    expect(network).not.toHaveBeenCalled();
    expect(port.onCost).not.toHaveBeenCalled();
  });

  it('fails an accidentally async claim port before sending HTTP', async () => {
    const port = execution();
    port.beforeDispatch = async () => undefined;
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', network);
    await expect(
      provider().generateImage(request, undefined, undefined, port),
    ).rejects.toMatchObject({ code: 'AUTOMATION_DISPATCH_ASYNC' });
    expect(network).not.toHaveBeenCalled();
    expect(port.onCost).not.toHaveBeenCalled();
  });

  it.each(['generation', 'edit'])(
    'never retries an ambiguous %s HTTP call and reports unknown cost',
    async (mode) => {
      const port = execution();
      const network = vi.fn<typeof fetch>(async () => response(429));
      const progress = vi.fn();
      vi.stubGlobal('fetch', network);
      const path = join(root, 'reference.png');
      writeFileSync(path, png());
      await expect(
        provider().generateImage(
          {
            ...request,
            ...(mode === 'edit' ? { referenceImages: [{ path, source: 'upload' as const }] } : {}),
          },
          undefined,
          progress,
          port,
        ),
      ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
      expect(network).toHaveBeenCalledOnce();
      expect(port.beforeDispatch).toHaveBeenCalledOnce();
      expect(progress).not.toHaveBeenCalled();
      expect(port.onCost).toHaveBeenCalledExactlyOnceWith({
        reportedPoints: null,
        source: 'unknown',
        evidenceRef: null,
      });
    },
  );

  it('does not retry a network exception after a claim', async () => {
    const port = execution();
    const network = vi.fn<typeof fetch>(async () => {
      throw new Error('fetch failed');
    });
    vi.stubGlobal('fetch', network);
    await expect(
      provider().generateImage(request, undefined, undefined, port),
    ).rejects.toMatchObject({ code: 'NETWORK' });
    expect(network).toHaveBeenCalledOnce();
    expect(port.onCost).toHaveBeenCalledExactlyOnceWith({
      reportedPoints: null,
      source: 'unknown',
      evidenceRef: null,
    });
  });

  it.each(['generation', 'edit'])(
    'refuses a real HTTP redirect instead of repeating a claimed %s POST',
    async (mode) => {
      const received: string[] = [];
      const server = createServer((incoming, outgoing) => {
        incoming.resume();
        incoming.on('end', () => {
          received.push(incoming.url ?? '');
          if (incoming.url === '/redirected') {
            outgoing.writeHead(200, { 'content-type': 'application/json' });
            outgoing.end(JSON.stringify({ data: [{ b64_json: png().toString('base64') }] }));
          } else {
            outgoing.writeHead(307, { location: '/redirected' });
            outgoing.end();
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Fixture listener missing');
        const baseUrl = `http://127.0.0.1:${address.port}/v1`;
        const port = execution();
        port.binding.baseUrl = baseUrl;
        const path = join(root, 'redirect-reference.png');
        writeFileSync(path, png());
        const imageProvider = new OpenAICompatibleProvider(
          'provider-1',
          baseUrl,
          'model-1',
          'Images',
        );
        await expect(
          imageProvider.generateImage(
            {
              ...request,
              ...(mode === 'edit'
                ? { referenceImages: [{ path, source: 'upload' as const }] }
                : {}),
            },
            undefined,
            undefined,
            port,
          ),
        ).rejects.toMatchObject({ code: 'NETWORK' });
        expect(received).toEqual([`/v1/images/${mode === 'edit' ? 'edits' : 'generations'}`]);
        expect(port.beforeDispatch).toHaveBeenCalledOnce();
        expect(port.onCost).toHaveBeenCalledExactlyOnceWith({
          reportedPoints: null,
          source: 'unknown',
          evidenceRef: null,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it('rejects a mismatched payer snapshot before claiming or accessing a live key', async () => {
    const port = execution();
    port.binding.model = 'another-model';
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      provider().generateImage(request, undefined, undefined, port),
    ).rejects.toMatchObject({ code: 'AUTOMATION_BINDING_CHANGED' });
    expect(port.beforeDispatch).not.toHaveBeenCalled();
    expect(readLiveKey).not.toHaveBeenCalled();
  });
});
