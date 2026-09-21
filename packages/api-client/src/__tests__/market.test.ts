import { marketCandidateSchema, marketSearchResultSchema } from '@musefold/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  CloudDesignSchemeUnavailableError,
  createCloudDesignSchemesGateway,
} from '../design-schemes';
import { ApiHttp, ApiRequestError } from '../http';

const FETCHED_AT = '2026-09-07T06:00:00.000Z';
const candidate = marketCandidateSchema.parse({
  candidateId: 'github_example_poster',
  repositoryUrl: 'https://github.com/example/poster-skill',
  fullName: 'example/poster-skill',
  description: 'Editorial poster references',
  license: 'MIT',
  ref: 'main',
  commit: null,
  updatedAt: '2026-09-06T05:00:00.000Z',
  stars: 12,
  topics: ['design', 'poster'],
  matchReason: 'Matches poster query',
  riskSummary: null,
});

function result(fromCache = false) {
  return marketSearchResultSchema.parse({
    query: '海报 + editorial',
    fromCache,
    fetchedAt: FETCHED_AT,
    candidates: [candidate],
    nextCursor: 'next-page:2+/=',
  });
}

function transport(body: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const gateway = createCloudDesignSchemesGateway(
    new ApiHttp({ baseUrl: 'https://api.test/', fetch }),
  );
  return { fetch, gateway };
}

function expectSingleRead(fetch: ReturnType<typeof transport>['fetch']) {
  expect(fetch).toHaveBeenCalledOnce();
  const [target, init] = fetch.mock.calls[0];
  expect(new URL(String(target)).pathname).toBe('/api/v1/design-schemes/market');
  expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
  expect(init?.body).toBeUndefined();
  expect(new Headers(init?.headers).has('content-type')).toBe(false);
  return new URL(String(target));
}

describe('GitHub market HTTP adapter', () => {
  it.each([false, true])(
    'retains candidate/cache/pagination fields with fromCache=%s and sends only a GET',
    async (fromCache) => {
      const expected = result(fromCache);
      const { fetch, gateway } = transport(expected);
      const cursor = 'opaque-page:1+/=';
      const received = await gateway.searchMarket({ query: expected.query, limit: 12, cursor });
      expect(received).toEqual(expected);
      expect(received.fetchedAt).toBe(FETCHED_AT);
      expect(received.candidates[0].commit).toBeNull();
      const url = expectSingleRead(fetch);
      expect([...url.searchParams.entries()]).toEqual([
        ['query', '海报 + editorial'],
        ['limit', '12'],
        ['cursor', cursor],
      ]);
    },
  );

  it('keeps an empty final page empty and omits an absent cursor', async () => {
    const expected = { ...result(), candidates: [], nextCursor: null };
    const { fetch, gateway } = transport(expected);
    expect(await gateway.searchMarket({ query: expected.query, limit: 20 })).toEqual(expected);
    expect(expectSingleRead(fetch).searchParams.has('cursor')).toBe(false);
  });

  it.each([
    [
      'insecure URL',
      {
        ...result(),
        candidates: [{ ...candidate, repositoryUrl: 'http://github.com/example/poster' }],
      },
    ],
    [
      'credential URL',
      {
        ...result(),
        candidates: [{ ...candidate, repositoryUrl: 'https://secret@github.com/example/poster' }],
      },
    ],
    [
      'unknown candidate field',
      { ...result(), candidates: [{ ...candidate, localPath: '/tmp/private-repository' }] },
    ],
    ['missing timestamp', { ...result(), fetchedAt: undefined }],
    ['invalid cache flag', { ...result(), fromCache: 'true' }],
    [
      'invalid candidate count',
      { ...result(), candidates: Array.from({ length: 101 }, () => candidate) },
    ],
  ])('rejects malformed successful payload: %s', async (_name, payload) => {
    const { fetch, gateway } = transport(payload);
    await expect(gateway.searchMarket({ query: 'poster', limit: 20 })).rejects.toMatchObject({
      name: 'ZodError',
    });
    expectSingleRead(fetch);
  });

  it.each([
    {
      status: 400,
      code: 'VALIDATION_FAILED',
      marketError: 'MARKET_INVALID_CURSOR',
      message: '分页标识已失效，请重新搜索',
      retryable: false,
    },
    {
      status: 429,
      code: 'RATE_LIMITED',
      marketError: 'MARKET_RATE_LIMITED',
      message: '搜索过于频繁，请稍后重试',
      retryable: true,
    },
    {
      status: 502,
      code: 'INTERNAL_ERROR',
      marketError: 'MARKET_UPSTREAM_ERROR',
      message: 'GitHub 搜索服务暂时不可用',
      retryable: true,
    },
    {
      status: 502,
      code: 'INTERNAL_ERROR',
      marketError: 'MARKET_INVALID_RESPONSE',
      message: 'GitHub 返回了无效搜索结果',
      retryable: false,
    },
    {
      status: 503,
      code: 'INTERNAL_ERROR',
      marketError: 'MARKET_TIMEOUT',
      message: '搜索超时，请稍后重试',
      retryable: true,
    },
    {
      status: 401,
      code: 'AUTH_REQUIRED',
      marketError: undefined,
      message: '请先登录',
      retryable: false,
    },
  ] as const)(
    'preserves HTTP $status / $marketError as an API error without writes or retries',
    async ({ status, code, marketError, message, retryable }) => {
      const details = marketError
        ? {
            operation: 'searchMarket',
            marketError,
            ...(status === 429 ? { retryAfterSeconds: 30 } : {}),
          }
        : {};
      const { fetch, gateway } = transport(
        { error: { code, message, retryable, requestId: 'market-request-1', details } },
        status,
      );
      const error = await gateway
        .searchMarket({ query: 'poster', limit: 20 })
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).not.toBeInstanceOf(CloudDesignSchemeUnavailableError);
      expect(error).toMatchObject({
        status,
        code,
        message,
        retryable,
        requestId: 'market-request-1',
        details,
      });
      expectSingleRead(fetch);
    },
  );

  it.each([502, 503])(
    'uses a readable fallback for non-envelope HTTP %i without claiming 501',
    async (status) => {
      const { fetch, gateway } = transport({ unexpected: 'proxy unavailable' }, status);
      const error = await gateway
        .searchMarket({ query: 'poster', limit: 20 })
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).not.toBeInstanceOf(CloudDesignSchemeUnavailableError);
      expect(error).toMatchObject({
        status,
        code: 'INTERNAL_ERROR',
        message: `请求失败(HTTP ${status})`,
        retryable: true,
        details: {},
      });
      expectSingleRead(fetch);
    },
  );
});
