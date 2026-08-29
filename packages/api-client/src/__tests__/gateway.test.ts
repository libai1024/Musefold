import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudDataGateway } from '../gateway';
import { ApiRequestError } from '../http';

function fetchStub(handler: (url: URL, init: RequestInit | undefined) => Response) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createCloudDataGateway', () => {
  it('serializes list queries: root-folder filter and repeated tagIds', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse({ items: [], nextCursor: null }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test/', fetch: impl });

    await gateway.prompts.list({ folderId: null, tagIds: ['t1', 't2'], q: 'cat' });

    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/api/v1/prompts');
    expect(url?.searchParams.get('folderId')).toBe('null');
    expect(url?.searchParams.getAll('tagIds')).toEqual(['t1', 't2']);
    expect(url?.searchParams.get('q')).toBe('cat');
    expect(calls[0]?.init?.credentials).toBe('include');
  });

  it('parses the account status response through the contract schema', async () => {
    const { impl } = fetchStub(() =>
      jsonResponse({
        id: 'u1',
        username: 'tester',
        displayName: null,
        quota: 100,
        quotaUnit: 'points',
        canGenerate: true,
      }),
    );
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    const status = await gateway.account.getStatus();
    expect(status.username).toBe('tester');
    expect(status.canGenerate).toBe(true);
  });

  it('normalizes contract error bodies into ApiRequestError', async () => {
    const { impl } = fetchStub(() =>
      jsonResponse(
        {
          error: {
            code: 'PROMPT_NOT_FOUND',
            message: '提示词不存在',
            requestId: 'req-1',
            retryable: false,
            details: {},
          },
        },
        404,
      ),
    );
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    const error = await gateway.prompts.get('missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe('PROMPT_NOT_FOUND');
    expect((error as ApiRequestError).status).toBe(404);
  });

  it('falls back to INTERNAL_ERROR for non-contract failures', async () => {
    const { impl } = fetchStub(() => new Response('gateway timeout', { status: 504 }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    const error = await gateway.account.getStatus().catch((e: unknown) => e);
    expect((error as ApiRequestError).code).toBe('INTERNAL_ERROR');
    expect((error as ApiRequestError).retryable).toBe(true);
  });

  it('purge posts to /prompts/{id}/purge and resolves void', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse({ ok: true }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.prompts.purge('p1')).resolves.toBeUndefined();
    expect(calls[0]?.url.pathname).toBe('/api/v1/prompts/p1/purge');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('generation purge posts to /generations/{id}/purge and resolves void', async () => {
    const { impl, calls } = fetchStub(() => jsonResponse({ ok: true }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(gateway.generation.purge('g1')).resolves.toBeUndefined();
    expect(calls[0]?.url.pathname).toBe('/api/v1/generations/g1/purge');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('uploads reference images as multipart form data', async () => {
    const { impl, calls } = fetchStub(() =>
      jsonResponse(
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          url: '/api/v1/reference-images/01ARZ3NDEKTSV4RRFFQ69G5FAV/url',
          name: 'ref.png',
          mimeType: 'image/png',
          byteSize: 4,
        },
        201,
      ),
    );
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    const uploaded = await gateway.generation.uploadReferenceImage({
      name: 'ref.png',
      bytes: new Uint8Array([1, 2, 3, 4]),
    });

    expect(uploaded.id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(calls[0]?.url.pathname).toBe('/api/v1/reference-images');
    expect(calls[0]?.init?.method).toBe('POST');
    // multipart 边界由 fetch 生成,不能手写 JSON content-type。
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
    const body = calls[0]?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    const file = (body as FormData).get('file');
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('ref.png');
  });

  it('sends JSON bodies for mutations', async () => {
    const { impl, calls } = fetchStub(() =>
      jsonResponse({
        id: 't1',
        name: '风格',
        group: null,
        color: null,
        version: 1,
        createdAt: '2026-08-28T00:00:00.000+00:00',
        updatedAt: '2026-08-28T00:00:00.000+00:00',
        deletedAt: null,
      }),
    );
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });
    await gateway.prompts.createTag({ name: '风格', group: null, color: null });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: '风格',
      group: null,
      color: null,
    });
  });
});

describe('generation.saveAsset(Web 浏览器下载)', () => {
  const anchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() };
  const bodyAppend = vi.fn();
  const windowOpen = vi.fn();
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    anchor.href = '';
    anchor.download = '';
    // node 环境无 DOM:替身仅覆盖 triggerDownload 用到的最小面。
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append: bodyAppend },
    });
    vi.stubGlobal('window', { open: windowOpen });
    URL.createObjectURL = vi.fn(() => 'blob:musefold-test') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('fetch 成功:blob 转 a[download] 触发下载并回收 object URL', async () => {
    const { impl, calls } = fetchStub(
      () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(
      gateway.generation.saveAsset({ url: 'https://cdn.test/a.png', name: 'musefold-a.png' }),
    ).resolves.toBe('saved');

    expect(calls[0]?.url.href).toBe('https://cdn.test/a.png');
    expect(anchor.href).toBe('blob:musefold-test');
    expect(anchor.download).toBe('musefold-a.png');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:musefold-test');
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('fetch 失败(跨域未开 CORS / 非 2xx):降级新窗口打开', async () => {
    const { impl } = fetchStub(() => new Response('forbidden', { status: 403 }));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.test', fetch: impl });

    await expect(
      gateway.generation.saveAsset({ url: 'https://cdn.test/b.png', name: 'b.png' }),
    ).resolves.toBe('saved');

    expect(anchor.click).not.toHaveBeenCalled();
    expect(windowOpen).toHaveBeenCalledWith('https://cdn.test/b.png', '_blank', 'noopener');
  });
});
