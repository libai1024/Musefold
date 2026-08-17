import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  loadApiKey: vi.fn(() => 'sk-edit-unit-test'),
  readLocalImage: vi.fn(async (reference: { path: string; name?: string }) => ({
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    image: {
      ...reference,
      source: 'upload' as const,
      mimeType: 'image/png' as const,
      sizeBytes: 8,
    },
  })),
}));

vi.mock('fs/promises', () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile }));
vi.mock('../local-image', () => ({
  LocalImageError: class MockLocalImageError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  readLocalImage: mocks.readLocalImage,
}));

import { configureTestCoreRuntime } from '../../testing';
import { OpenAICompatibleProvider } from '../openai-compatible';

configureTestCoreRuntime('/tmp/musefold-provider-test', { loadApiKey: mocks.loadApiKey });

const REQUEST = {
  jobId: 'image-edit-unit-test',
  providerId: 'provider-1',
  prompt: '把背景改成浅灰色',
  size: '1536x1024' as const,
  aspectRatio: '16:9',
  quality: 'high' as const,
  n: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenAICompatibleProvider image edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a multipart edit request without exposing a local path', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      expect(_url).toBe('https://images.test/v1/images/edits');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-edit-unit-test');
      expect(new Headers(init?.headers).has('content-type')).toBe(false);

      const form = init?.body as FormData;
      expect(form.get('model')).toBe('gpt-image-2');
      expect(form.get('prompt')).toBe(REQUEST.prompt);
      expect(form.get('n')).toBe('1');
      expect(form.get('size')).toBe('1536x1024');
      const images = form.getAll('image[]') as File[];
      expect(images.map((image) => image.name)).toEqual(['reference-1.png', 'reference-2.png']);
      expect(images.every((image) => image.type === 'image/png')).toBe(true);
      expect(await images[0].arrayBuffer()).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer);

      return jsonResponse({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString('base64') }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider('provider-1', 'https://images.test/v1', 'gpt-image-2', 'Images');
    const result = await provider.generateImage({
      ...REQUEST,
      referenceImages: [
        { source: 'upload', path: '/tmp/previews/uploads/reference-1.png', name: 'reference-1.png' },
        { source: 'upload', path: '/tmp/previews/uploads/reference-2.png', name: 'reference-2.png' },
      ],
    });

    expect(result).toMatchObject({ historyId: REQUEST.jobId, status: 'success' });
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    expect(mocks.writeFile.mock.calls[0][1]).toEqual(Buffer.from([1, 2, 3]));
  });

  it('maps edit authentication failures to AUTH without retrying', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: { message: 'invalid api key' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider('provider-1', 'https://images.test/v1', 'gpt-image-2', 'Images');

    await expect(provider.generateImage({
      ...REQUEST,
      referenceImages: [{ source: 'upload', path: '/tmp/previews/uploads/reference.png' }],
    })).rejects.toMatchObject({ code: 'AUTH', status: 401 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
