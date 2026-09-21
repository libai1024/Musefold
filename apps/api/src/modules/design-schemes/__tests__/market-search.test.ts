import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, toErrorBody } from '../../../lib/errors.js';
import { DesignSchemeMarketSearchService, MARKET_SEARCH_LIMITS } from '../market-search.js';

const START = Date.parse('2026-09-07T00:00:00Z');
const query = { query: 'poster', limit: 20 };

function item(id = 1, overrides: Record<string, unknown> = {}) {
  return {
    id,
    full_name: `acme/poster-${id}`,
    html_url: `https://github.com/acme/poster-${id}`,
    private: false,
    visibility: 'public',
    fork: false,
    description: 'Poster illustration templates',
    license: { spdx_id: 'MIT', key: 'mit' },
    default_branch: 'main',
    pushed_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    stargazers_count: 12,
    topics: ['poster', 'illustration'],
    ...overrides,
  };
}

function payload(items = [item()], total = items.length) {
  return { total_count: total, incomplete_results: false, items };
}

function cursor(limit: number, page: number, search = 'poster') {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      q: createHash('sha256').update(search).digest('hex'),
      limit,
      page,
    }),
  ).toString('base64url');
}

function setup(
  options: ConstructorParameters<typeof DesignSchemeMarketSearchService>[0]['limits'] = {},
) {
  let now = START;
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(payload()));
  const assertAllowed = vi.fn(
    async (_namespace: string, _subject: string, _policy: unknown) => undefined,
  );
  const service = new DesignSchemeMarketSearchService({
    fetchImpl,
    now: () => now,
    rateLimiter: { assertAllowed },
    limits: options,
  });
  return {
    service,
    fetchImpl,
    assertAllowed,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('public GitHub market discovery', () => {
  it('sends only the fixed anonymous GET and returns canonical, independently owned metadata', async () => {
    const ctx = setup();
    ctx.fetchImpl.mockResolvedValueOnce(
      Response.json(
        payload([
          item(1, {
            token: 'synthetic-ignored-upstream-field',
            owner: { secret: 'ignored' },
          }),
        ]),
      ),
    );
    const result = await ctx.service.search('owner-a', {
      query: '  poster   illustration  ',
      limit: 20,
    });
    expect(result).toMatchObject({
      query: 'poster illustration',
      fromCache: false,
      fetchedAt: START,
      nextCursor: null,
    });
    expect(result.candidates[0]).toMatchObject({
      candidateId: 'mc_1',
      repositoryUrl: 'https://github.com/acme/poster-1',
      license: 'MIT',
      commit: null,
      ref: 'main',
      matchReason: '名称、描述、主题标签命中搜索词',
      riskSummary: null,
    });
    expect(result.candidates[0]).not.toHaveProperty('token');
    expect(result.candidates[0]).not.toHaveProperty('owner');
    const [input, init] = ctx.fetchImpl.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://api.github.com/search/repositories');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'poster illustration is:public fork:false',
      page: '1',
      per_page: '20',
    });
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(1);
    expect(ctx.assertAllowed.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['market-user', 'owner-a'],
      ['market-github-public', 'anonymous'],
    ]);
  });

  it('filters private, internal and fork repositories while preserving the upstream page position', async () => {
    const ctx = setup();
    ctx.fetchImpl.mockResolvedValueOnce(
      Response.json(
        payload(
          [
            item(1, { private: true }),
            item(2, { visibility: 'internal' }),
            item(3, { fork: true }),
            item(4, { license: { spdx_id: 'NOASSERTION' }, stargazers_count: 2, pushed_at: null }),
          ],
          8,
        ),
      ),
    );
    const result = await ctx.service.search('owner', { ...query, limit: 4 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      candidateId: 'mc_4',
      license: null,
      updatedAt: '2026-09-02T00:00:00Z',
    });
    expect(result.candidates[0]?.riskSummary).toContain('未声明开源许可证');
    expect(result.candidates[0]?.riskSummary).toContain('社区使用较少');
    expect(result.nextCursor).toBe(cursor(4, 2));
  });

  it.each([
    ['host spoof', { html_url: 'https://github.com.evil/acme/poster-1' }],
    ['different repository', { html_url: 'https://github.com/acme/other' }],
    ['credentials', { html_url: 'https://secret@github.com/acme/poster-1' }],
    ['explicit port', { html_url: 'https://github.com:443/acme/poster-1' }],
    ['query', { html_url: 'https://github.com/acme/poster-1?token=synthetic' }],
    ['fragment', { html_url: 'https://github.com/acme/poster-1#readme' }],
    ['escaped slash', { html_url: 'https://github.com/acme%2Fposter-1' }],
    ['dot repo', { full_name: 'acme/..', html_url: 'https://github.com/acme/..' }],
    ['long description', { description: 'a'.repeat(1001) }],
    ['local path', { description: '/Users/synthetic/private' }],
    ['unsafe ref', { default_branch: '../main' }],
    ['bad date', { pushed_at: 'yesterday' }],
    ['unsafe id', { id: Number.MAX_SAFE_INTEGER + 1 }],
    ['missing privacy', { private: undefined }],
    ['bad license', { license: { spdx_id: 123 } }],
  ])('rejects %s without reflecting upstream data', async (_name, overrides) => {
    const ctx = setup();
    ctx.fetchImpl.mockResolvedValueOnce(Response.json(payload([item(1, overrides)])));
    await expect(ctx.service.search('owner', query)).rejects.toMatchObject({
      status: 502,
      details: { marketError: 'MARKET_INVALID_RESPONSE' },
    });
  });

  it.each([
    {},
    { items: [] },
    { total_count: -1, incomplete_results: false, items: [] },
    { total_count: 0, incomplete_results: false, items: [item()] },
    payload(Array.from({ length: 21 }, (_, i) => item(i + 1))),
    payload([item(), item()]),
  ])('rejects malformed envelope or ambiguous duplicate identities', async (body) => {
    const ctx = setup();
    ctx.fetchImpl.mockResolvedValueOnce(Response.json(body));
    await expect(ctx.service.search('owner', query)).rejects.toMatchObject({
      details: { marketError: 'MARKET_INVALID_RESPONSE' },
    });
  });

  it.each([
    { query: '', limit: 20 },
    { query: 'x'.repeat(201), limit: 20 },
    { query: 'poster\0', limit: 20 },
    { query: 'poster', limit: 0 },
    { query: 'poster', limit: 101 },
    { ...query, cursor: 'https://evil.example/next' },
    { ...query, cursor: cursor(20, 2, 'other') },
    { ...query, cursor: cursor(10, 2) },
    { ...query, cursor: cursor(20, 51) },
    { ...query, cursor: `${cursor(20, 2)}=` },
  ])('rejects invalid query/cursor before limiter or HTTP', async (input) => {
    const ctx = setup();
    await expect(ctx.service.search('owner', input)).rejects.toMatchObject({ status: 400 });
    expect(ctx.assertAllowed).not.toHaveBeenCalled();
    expect(ctx.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [60, 17, 1000, 40],
    [67, 15, 1000, 62],
    [67, 15, 970, 32],
    [100, 10, 2000, 100],
  ])(
    'bounds the last logical page limit=%i/page=%i/total=%i to %i without changing offsets',
    async (limit, page, total, expected) => {
      const ctx = setup();
      ctx.fetchImpl.mockResolvedValueOnce(
        Response.json(
          payload(
            Array.from({ length: Math.min(100, total - 900) }, (_, i) => item(901 + i)),
            total,
          ),
        ),
      );
      const result = await ctx.service.search('owner', {
        ...query,
        limit,
        cursor: cursor(limit, page),
      });
      expect(result.candidates).toHaveLength(expected);
      expect(result.candidates[0]?.candidateId).toBe(`mc_${(page - 1) * limit + 1}`);
      expect(result.nextCursor).toBeNull();
      const url = new URL(String(ctx.fetchImpl.mock.calls[0]?.[0]));
      expect(url.searchParams.get('per_page')).toBe('100');
      expect(url.searchParams.get('page')).toBe('10');
    },
  );

  it('isolates cache by query/limit/page and does not follow upstream Link', async () => {
    const ctx = setup();
    ctx.fetchImpl.mockImplementation(async (input) => {
      const url = new URL(String(input));
      const count = Number(url.searchParams.get('per_page'));
      const page = Number(url.searchParams.get('page'));
      return Response.json(
        payload(
          Array.from({ length: count }, (_, i) => item((page - 1) * count + i + 1)),
          100,
        ),
        {
          headers: { link: '<https://evil.example/next>; rel="next"' },
        },
      );
    });
    const first = await ctx.service.search('owner', { ...query, limit: 2 });
    const second = await ctx.service.search('owner', {
      ...query,
      limit: 2,
      cursor: first.nextCursor ?? '',
    });
    expect(second.candidates[0]?.candidateId).toBe('mc_3');
    await ctx.service.search('owner', { ...query, limit: 3 });
    await ctx.service.search('owner', { query: 'layout', limit: 2 });
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(4);
    expect((await ctx.service.search('other-owner', { ...query, limit: 2 })).fromCache).toBe(true);
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(4);
    for (const [url] of ctx.fetchImpl.mock.calls)
      expect(new URL(String(url)).host).toBe('api.github.com');
  });
});

describe('bounded public cache, concurrency and failures', () => {
  it.each([false, true])(
    'keeps real fetchedAt for populated/empty=%s stale cache, without extending expiry',
    async (empty) => {
      const ctx = setup({ cacheTtlMs: 10, staleMs: 20, failureCooldownMs: 1 });
      if (empty) ctx.fetchImpl.mockResolvedValueOnce(Response.json(payload([])));
      const first = await ctx.service.search('owner', query);
      first.candidates.length = 0;
      ctx.advance(9);
      const fresh = await ctx.service.search('other', query);
      expect(fresh).toMatchObject({ fromCache: true, fetchedAt: START });
      expect(fresh.candidates.length).toBe(empty ? 0 : 1);
      ctx.advance(2);
      ctx.fetchImpl.mockRejectedValue(new Error('synthetic-sensitive-network-detail'));
      expect(await ctx.service.search('owner', query)).toMatchObject({
        fromCache: true,
        fetchedAt: START,
      });
      ctx.advance(18);
      expect(await ctx.service.search('owner', query)).toMatchObject({
        fromCache: true,
        fetchedAt: START,
      });
      ctx.advance(2);
      await expect(ctx.service.search('owner', query)).rejects.toMatchObject({
        details: { marketError: 'MARKET_UPSTREAM_ERROR' },
      });
    },
  );

  it('checks stale age again after the failed network wait and never masks malformed data', async () => {
    const ctx = setup({ cacheTtlMs: 10, staleMs: 20 });
    await ctx.service.search('owner', query);
    ctx.advance(11);
    ctx.fetchImpl.mockImplementationOnce(async () => {
      ctx.advance(20);
      throw new Error('offline');
    });
    await expect(ctx.service.search('owner', query)).rejects.toMatchObject({ status: 502 });
    const other = setup({ cacheTtlMs: 1 });
    await other.service.search('owner', query);
    other.advance(2);
    other.fetchImpl.mockResolvedValueOnce(Response.json({ invalid: 'synthetic' }));
    await expect(other.service.search('owner', query)).rejects.toMatchObject({
      details: { marketError: 'MARKET_INVALID_RESPONSE' },
    });
  });

  it('coalesces calls before fetch, clones each result and releases pending after completion', async () => {
    const ctx = setup();
    const gate = deferred<Response>();
    ctx.fetchImpl.mockReturnValueOnce(gate.promise);
    const a = ctx.service.search('owner-a', query);
    const b = ctx.service.search('owner-b', query);
    await vi.waitFor(() => expect(ctx.fetchImpl).toHaveBeenCalledTimes(1));
    gate.resolve(Response.json(payload()));
    const [first, second] = await Promise.all([a, b]);
    const candidate = first.candidates[0];
    if (!candidate) throw new Error('Missing expected candidate');
    candidate.fullName = 'edited/local';
    expect(second.candidates[0]?.fullName).toBe('acme/poster-1');
    expect((await ctx.service.search('owner-c', query)).candidates[0]?.fullName).toBe(
      'acme/poster-1',
    );
    expect(ctx.assertAllowed.mock.calls.filter(([ns]) => ns === 'market-user')).toHaveLength(3);
    expect(
      ctx.assertAllowed.mock.calls.filter(([ns]) => ns === 'market-github-public'),
    ).toHaveLength(1);
  });

  it('bounds different in-flight requests and permits work again after failure cooldown', async () => {
    const ctx = setup({ concurrentRequests: 1, failureCooldownMs: 1 });
    const gate = deferred<Response>();
    ctx.fetchImpl.mockReturnValueOnce(gate.promise);
    const first = ctx.service.search('owner', query);
    await vi.waitFor(() => expect(ctx.fetchImpl).toHaveBeenCalledTimes(1));
    await expect(ctx.service.search('other', { query: 'layout', limit: 20 })).rejects.toMatchObject(
      { status: 429, retryable: true },
    );
    gate.resolve(new Response(null, { status: 503 }));
    await expect(first).rejects.toMatchObject({ status: 502 });
    await expect(ctx.service.search('owner', query)).rejects.toMatchObject({ status: 502 });
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(1);
    ctx.advance(2);
    expect((await ctx.service.search('owner', query)).fromCache).toBe(false);
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('enforces LRU entry and serialized byte budgets', async () => {
    const ctx = setup({ cacheEntries: 2 });
    await ctx.service.search('owner', query);
    await ctx.service.search('owner', { query: 'layout', limit: 20 });
    await ctx.service.search('owner', query);
    await ctx.service.search('owner', { query: 'editorial', limit: 20 });
    await ctx.service.search('owner', { query: 'layout', limit: 20 });
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(4);
    const tiny = setup({ cacheBytes: 1 });
    await tiny.service.search('owner', query);
    await tiny.service.search('owner', query);
    expect(tiny.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not let stale cache bypass per-user admission and marks 429 retryable independently', async () => {
    const ctx = setup({ cacheTtlMs: 1 });
    await ctx.service.search('owner', query);
    ctx.advance(2);
    ctx.assertAllowed.mockRejectedValueOnce(
      new AppError('RATE_LIMITED', 'internal', 429, true, { retryAfterSeconds: 3 }),
    );
    await expect(ctx.service.search('owner', query)).rejects.toMatchObject({
      status: 429,
      retryable: true,
      details: { retryAfterSeconds: 3 },
    });
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, { 'retry-after': '60' }, 'MARKET_RATE_LIMITED', 429, true],
    [403, { 'x-ratelimit-remaining': '0' }, 'MARKET_RATE_LIMITED', 429, true],
    [403, {}, 'MARKET_UPSTREAM_ERROR', 502, false],
    [422, {}, 'MARKET_QUERY_REJECTED', 400, false],
    [503, {}, 'MARKET_UPSTREAM_ERROR', 502, true],
    [302, { location: 'https://evil.example/' }, 'MARKET_UPSTREAM_ERROR', 502, false],
  ] as const)(
    'maps upstream %i using fixed messages and cancels the unused body',
    async (status, headers, code, expectedStatus, retryable) => {
      const ctx = setup();
      const cancel = vi.fn();
      const canary = 'synthetic-upstream-sensitive-message';
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      ctx.fetchImpl.mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }), { status, headers }),
      );
      const error = await ctx.service.search('owner', query).catch((error: AppError) => error);
      expect(error).toMatchObject({
        status: expectedStatus,
        retryable,
        details: { marketError: code },
      });
      expect(JSON.stringify(error)).not.toContain(canary);
      expect(consoleError).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(ctx.fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('maps incomplete results separately, preserving real cache when available', async () => {
    const ctx = setup();
    ctx.fetchImpl.mockResolvedValueOnce(
      Response.json({ ...payload([]), incomplete_results: true }),
    );
    await expect(ctx.service.search('owner', query)).rejects.toMatchObject({
      status: 503,
      details: { marketError: 'MARKET_INCOMPLETE_RESULTS' },
    });
  });

  it.each([
    ['9999999999', 86400],
    ['malicious-value', 60],
    ['0', 1],
  ])('clamps Retry-After=%s to %i seconds', async (raw, expected) => {
    const ctx = setup();
    ctx.fetchImpl.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { 'retry-after': raw } }),
    );
    await expect(ctx.service.search('owner', query)).rejects.toMatchObject({
      details: { retryAfterSeconds: expected },
    });
    await expect(ctx.service.search('other', { ...query, query: 'other' })).rejects.toMatchObject({
      status: 429,
    });
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never shortens global cooldown when concurrent 429 responses disagree', async () => {
    const ctx = setup();
    const first = deferred<Response>();
    const second = deferred<Response>();
    ctx.fetchImpl.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = ctx.service.search('a', query).catch((error: AppError) => error);
    const b = ctx.service
      .search('b', { ...query, query: 'layout' })
      .catch((error: AppError) => error);
    await vi.waitFor(() => expect(ctx.fetchImpl).toHaveBeenCalledTimes(2));
    first.resolve(new Response(null, { status: 429, headers: { 'retry-after': '60' } }));
    await a;
    second.resolve(new Response(null, { status: 429, headers: { 'retry-after': '1' } }));
    await b;
    ctx.advance(2000);
    await expect(ctx.service.search('c', { ...query, query: 'editorial' })).rejects.toMatchObject({
      details: { retryAfterSeconds: 58 },
    });
    expect(ctx.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(['length', 'stream', 'utf8', 'json', 'type'])(
    'rejects bounded response violation: %s',
    async (kind) => {
      const ctx = setup({ responseBytes: 100 });
      const cancel = vi.fn();
      const bytes =
        kind === 'utf8'
          ? new Uint8Array([0xff])
          : Buffer.from(kind === 'json' ? '{oops' : 'x'.repeat(101));
      const headers = new Headers({
        'content-type': kind === 'type' ? 'text/html' : 'application/json',
      });
      if (kind === 'length') headers.set('content-length', '101');
      ctx.fetchImpl.mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              if (kind === 'utf8' || kind === 'json') controller.close();
            },
            cancel,
          }),
          { headers },
        ),
      );
      await expect(ctx.service.search('owner', query)).rejects.toMatchObject({
        details: { marketError: 'MARKET_INVALID_RESPONSE' },
      });
      if (kind !== 'utf8' && kind !== 'json') expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects attempts to enlarge production resource limits', () => {
    expect(() => setup({ responseBytes: MARKET_SEARCH_LIMITS.responseBytes + 1 })).toThrow(
      'Invalid market search resource limit',
    );
  });
});

describe('native HTTP transport boundaries (loopback fixture, no GitHub traffic)', () => {
  async function fixture(mode: 'success' | 'redirect' | 'slow' | 'failure') {
    const calls: string[] = [];
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      calls.push(request.url ?? '');
      authorization = request.headers.authorization;
      if (request.url?.startsWith('/redirect-target')) {
        response.end('unexpected');
        return;
      }
      if (mode === 'redirect') {
        response.writeHead(307, { location: '/redirect-target' });
        response.end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      if (mode === 'slow') {
        response.write('{');
        return;
      }
      if (mode === 'failure') {
        response.writeHead(503);
        response.end('{"message":"synthetic-private-detail-canary"}');
        return;
      }
      response.end(JSON.stringify(payload()));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const service = new DesignSchemeMarketSearchService({
      rateLimiter: { assertAllowed: async () => undefined },
      // Only transport is redirected by the test; production still constructs a fixed GitHub URL.
      fetchImpl: (input, init) => {
        const upstream = new URL(String(input));
        expect(upstream.origin).toBe('https://api.github.com');
        return fetch(`${origin}${upstream.pathname}${upstream.search}`, init);
      },
      limits: { timeoutMs: mode === 'slow' ? 100 : MARKET_SEARCH_LIMITS.timeoutMs },
    });
    return {
      service,
      calls,
      authorization: () => authorization,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      },
    };
  }

  it.each(['success', 'redirect', 'slow', 'failure'] as const)(
    'uses one real HTTP GET for %s and never follows/downloads/retries',
    async (mode) => {
      const ctx = await fixture(mode);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        if (mode === 'success')
          expect((await ctx.service.search('owner', query)).candidates).toHaveLength(1);
        else {
          const error = await ctx.service.search('owner', query).catch((error: AppError) => error);
          expect(error).toMatchObject({ status: mode === 'slow' ? 504 : 502 });
          expect(JSON.stringify(toErrorBody(error as AppError, 'synthetic-request'))).not.toContain(
            'synthetic-private-detail-canary',
          );
        }
        expect(ctx.calls).toHaveLength(1);
        expect(ctx.calls[0]).toMatch(/^\/search\/repositories\?/);
        expect(ctx.authorization()).toBeUndefined();
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        await ctx.close();
      }
    },
  );
});
