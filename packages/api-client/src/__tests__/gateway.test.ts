import { describe, expect, it } from 'vitest';
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
