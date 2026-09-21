import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
import { closeDb, getDb, initDb } from '../../db';
import { configureTestCoreRuntime } from '../../testing';
import type { GenerationExecution } from '../../providers/execution';
import { generate } from '../generation';

let root: string;
let apiKey: string;
let logs: unknown[][];
const browserGenerate = vi.fn();
const loadLiveKey = vi.fn();
const request: GenerateImageRequest = {
  jobId: 'durable-service',
  providerId: 'provider-1',
  prompt: 'service final prompt',
  size: '1024x1024',
  quality: 'medium',
  n: 1,
};
function execution(): GenerationExecution {
  return {
    apiKey,
    binding: {
      providerId: 'provider-1',
      providerType: 'openai-compatible',
      model: 'model-1',
      baseUrl: 'https://images.test/v1',
      credentialEpoch: 'epoch-1',
      payerKind: 'external',
      ownerId: null,
      issuer: null,
      policy: 'external',
    },
    beforeDispatch: vi.fn(),
    onCost: vi.fn(),
  };
}
function pngResponse(): Response {
  return new Response(
    JSON.stringify({ data: [{ b64_json: Buffer.from('synthetic-result').toString('base64') }] }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'musefold-generation-execution-'));
  apiKey = `sk-${randomBytes(30).toString('hex')}`;
  logs = [];
  vi.clearAllMocks();
  const log = (...args: unknown[]) => {
    logs.push(args);
  };
  configureTestCoreRuntime(root, {
    loadApiKey: loadLiveKey,
    estimateProviderCost: () => 3,
    createLogger: () => ({ debug: log, info: log, warn: log, error: log }),
    doubaoWeb: { validate: vi.fn(), generateImage: browserGenerate },
  });
  initDb();
  getDb()
    .prepare(`INSERT INTO providers
    (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
    VALUES ('provider-1', 'Images', 'openai-compatible', 'https://images.test/v1', 'model-1', 1, 1, 1, 1)`)
    .run();
});
afterEach(() => {
  closeDb();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});
function expectNoKeyExposure(result: unknown): void {
  expect(getDb().serialize().includes(Buffer.from(apiKey))).toBe(false);
  expect(JSON.stringify(logs)).not.toContain(apiKey);
  expect(JSON.stringify(result)).not.toContain(apiKey);
  expect(loadLiveKey).not.toHaveBeenCalled();
}

it('sends the process-only key but never persists it in generation SQLite, logs or result', async () => {
  const port = execution();
  let finalPrompt: string | undefined;
  port.beforeDispatch = vi.fn(({ request: sent }) => {
    finalPrompt = sent.prompt;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${apiKey}`);
      expect(JSON.parse(String(init?.body)).prompt).toBe(finalPrompt);
      return pngResponse();
    }),
  );
  const result = await generate(request, undefined, { execution: port });
  expect(result.status).toBe('success');
  expect(port.onCost).toHaveBeenCalledExactlyOnceWith({
    reportedPoints: 3,
    source: 'local_price_estimate',
    evidenceRef: null,
  });
  expectNoKeyExposure(result);
});

it('keeps executor cost evidence when cancellation discards a late successful image', async () => {
  const port = execution();
  const controller = new AbortController();
  port.onCost = vi.fn(() => {
    controller.abort();
  });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => pngResponse()),
  );
  const result = await generate(request, undefined, { execution: port, signal: controller.signal });
  expect(result.status).toBe('cancelled');
  expect(port.onCost).toHaveBeenCalledExactlyOnceWith({
    reportedPoints: 3,
    source: 'local_price_estimate',
    evidenceRef: null,
  });
  expect(
    getDb().prepare('SELECT status FROM generation_runs WHERE id = ?').get(request.jobId),
  ).toEqual({ status: 'cancelled' });
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
  expectNoKeyExposure(result);
});

it('sanitizes upstream echoes of the execution key while retaining an unknown dispatch cost', async () => {
  const port = execution();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: `invalid api key Bearer ${apiKey}` } }), {
          status: 401,
        }),
    ),
  );
  const result = await generate(request, undefined, { execution: port });
  expect(result.status).toBe('failed');
  expect(result.error?.code).toBe('AUTH');
  expect(port.onCost).toHaveBeenCalledExactlyOnceWith({
    reportedPoints: null,
    source: 'unknown',
    evidenceRef: null,
  });
  expectNoKeyExposure(result);
});

it('rejects durable dispatch for the frozen browser provider without invoking its runtime', async () => {
  getDb().prepare("UPDATE providers SET type = 'doubao-web' WHERE id = 'provider-1'").run();
  const port = execution();
  port.binding.providerType = 'doubao-web';
  const result = await generate(request, undefined, { execution: port });
  expect(result.status).toBe('failed');
  expect(result.error?.code).toBe('AUTOMATION_DURABLE_UNSUPPORTED');
  expect(browserGenerate).not.toHaveBeenCalled();
  expect(port.beforeDispatch).not.toHaveBeenCalled();
  expect(port.onCost).not.toHaveBeenCalled();
  expectNoKeyExposure(result);
});

it('uses a host transport without constructing a Provider or composing its raw request twice', async () => {
  const transport = {
    providerId: request.providerId,
    assertCurrent: vi.fn(),
    generate: vi.fn(async (raw: GenerateImageRequest) => {
      expect(raw.prompt).toBe(request.prompt);
      expect(raw.jobId).toBe(request.jobId);
      return {
        historyId: raw.jobId ?? '',
        status: 'failed' as const,
        error: { code: 'MANAGED_SUBMISSION_UNCERTAIN', message: '请核对原任务' },
      };
    }),
  };
  vi.stubGlobal('fetch', vi.fn());
  const result = await generate(request, undefined, { transport });
  expect(result.error?.code).toBe('MANAGED_SUBMISSION_UNCERTAIN');
  expect(transport.generate).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expectNoKeyExposure(result);
});

it('rejects mismatched or local-retry transport capabilities before creating a new run', async () => {
  const transport = { providerId: 'other-provider', assertCurrent: vi.fn(), generate: vi.fn() };
  expect((await generate(request, undefined, { transport })).error?.code).toBe(
    'GENERATION_TRANSPORT_MISMATCH',
  );
  transport.providerId = request.providerId;
  expect(
    (await generate(request, undefined, { transport, execution: execution() })).error?.code,
  ).toBe('GENERATION_TRANSPORT_MISMATCH');
  expect(
    (await generate(request, undefined, { transport, retryOfRunId: 'old-run' })).error?.code,
  ).toBe('GENERATION_TRANSPORT_MISMATCH');
  expect(transport.generate).not.toHaveBeenCalled();
  expect(getDb().prepare('SELECT count(*) AS n FROM generation_runs').get()).toEqual({ n: 0 });
});

it('does not write a late transport result after the captured host context becomes stale', async () => {
  let active = true;
  const transport = {
    providerId: request.providerId,
    assertCurrent() {
      if (!active) throw new Error('STALE_HOST_CONTEXT');
    },
    generate: vi.fn(async () => {
      active = false;
      return { historyId: request.jobId ?? '', status: 'success' as const, cost: 3 };
    }),
  };
  await expect(generate(request, undefined, { transport })).rejects.toThrow('STALE_HOST_CONTEXT');
  expect(
    getDb().prepare('SELECT status FROM generation_runs WHERE id = ?').get(request.jobId),
  ).toEqual({ status: 'running' });
  expect(getDb().prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
  expectNoKeyExposure({});
});
