import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import { marketSearchResultSchema } from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { type AuthedEnv, requireSession } from '../../auth/middleware.js';
import { loadEnv } from '../../env.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { AccountService } from '../../modules/account/service.js';
import { DesignSchemeMarketSearchService } from '../../modules/design-schemes/market-search.js';
import { designSchemeRoutes } from '../../modules/design-schemes/routes.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

function repository(index: number) {
  const fullName = `market-fixture/repository-${index}`;
  return {
    id: index + 1,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: 'Public design reference',
    stargazers_count: 25,
    topics: ['design', 'prompt'],
    updated_at: '2026-09-01T00:00:00.000Z',
    pushed_at: '2026-09-01T00:00:00.000Z',
    default_branch: 'main',
    private: false,
    fork: false,
    archived: false,
    license: { spdx_id: 'MIT', name: 'MIT License' },
  };
}

describeDb('market discovery (real Better Auth session + PostgreSQL rate limits)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let auth: ReturnType<typeof createAuth>;
  let account: AccountService;
  const clientEnds: Promise<void>[] = [];
  const tokenA = randomUUID();
  const tokenB = randomUUID();
  const expiredToken = randomUUID();
  const relayFetch = vi.fn<typeof fetch>(async () => {
    throw new Error('Market discovery must not contact the account/provider server');
  });
  const upstream = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.github.com');
    expect(url.pathname).toBe('/search/repositories');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(init?.redirect).toBe('error');
    const limit = Number(url.searchParams.get('per_page'));
    const offset = (Number(url.searchParams.get('page')) - 1) * limit;
    return Response.json({
      total_count: 3,
      incomplete_results: false,
      items: Array.from({ length: Math.max(0, Math.min(limit, 3 - offset)) }, (_, i) =>
        repository(offset + i),
      ),
    });
  });

  function appFor() {
    // Each app gets an independent process-style cache but shares the PG quota ledger.
    const limiter = new RateLimiter(database.db, 'market-integration-rate-secret');
    const market = new DesignSchemeMarketSearchService({
      rateLimiter: limiter,
      fetchImpl: upstream,
    });
    const app = new OpenAPIHono<AuthedEnv>();
    app.use('*', requireSession(auth, ['http://localhost:8787'], account));
    app.onError((error, c) => {
      if (error instanceof AppError)
        return c.json(toErrorBody(error, 'market-integration-request'), error.status as 400);
      throw error;
    });
    app.route(
      '/',
      designSchemeRoutes(new DesignSchemeService(database.db, undefined, undefined, market)),
    );
    return app;
  }

  function search(app: ReturnType<typeof appFor>, query: string, token: string | null = tokenA) {
    return app.request(`/design-schemes/market?${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 12 });
    database.pool.on('connect', (client) => {
      clientEnds.push(new Promise<void>((resolve) => client.once('end', () => resolve())));
    });
    await migrateDatabase(database.db);
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      BETTER_AUTH_SECRET: 'market-integration-auth-secret',
      NEW_API_BASE_URL: 'https://account.invalid',
      CREDENTIAL_ENCRYPTION_KEY: 'market-integration-encryption-key',
    });
    account = new AccountService({
      db: database.db,
      newApi: createNewApiClient(env.NEW_API_BASE_URL, { fetchImpl: relayFetch }),
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      apiIssuer: env.PUBLIC_BASE_URL,
      upstreamIssuer: env.NEW_API_BASE_URL,
    });
    auth = createAuth({
      env,
      db: database.db,
      newApi: createNewApiClient(env.NEW_API_BASE_URL, { fetchImpl: relayFetch }),
      hooks: {
        async prepareLogin() {
          throw new Error('This suite uses seeded real sessions, never login');
        },
        async commitLogin() {
          throw new Error('This suite never establishes sessions');
        },
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    await database.pool.query(
      'INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2), ($3, $3, $4)',
      ['market-owner-a', 'market-a@example.test', 'market-owner-b', 'market-b@example.test'],
    );
    for (const owner of ['market-owner-a', 'market-owner-b'])
      await database.pool.query(
        "INSERT INTO account_identities(user_id,api_issuer,upstream_issuer,upstream_owner_id,status,verified_at) VALUES($1,$2,$3,$1,'active',now())",
        [owner, env.PUBLIC_BASE_URL, env.NEW_API_BASE_URL],
      );
    for (const [id, token, owner, valid] of [
      ['market-session-a', tokenA, 'market-owner-a', true],
      ['market-session-b', tokenB, 'market-owner-b', true],
      ['market-session-expired', expiredToken, 'market-owner-a', false],
    ] as const) {
      await database.pool.query(
        'INSERT INTO session (id, token, user_id, expires_at) VALUES ($1, $2, $3, $4)',
        [id, token, owner, new Date(Date.now() + (valid ? 3_600_000 : -60_000))],
      );
      await database.pool.query(
        "INSERT INTO account_session_authorizations(session_id,user_id,mode) VALUES($1,$2,'normal')",
        [id, owner],
      );
    }
  }, 120_000);

  beforeEach(async () => {
    await database.pool.query('DELETE FROM rate_limit_buckets');
    upstream.mockClear();
    relayFetch.mockClear();
  });

  afterAll(async () => {
    await database?.pool.end();
    // pg-pool can empty its client list before the sockets finish closing.
    await Promise.all(clientEnds);
    await container?.stop();
  });

  it('rejects absent, forged, and expired sessions before any search or quota write', async () => {
    const app = appFor();
    for (const token of [null, 'not-a-session', expiredToken]) {
      const response = await search(app, 'query=poster', token);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(relayFetch).not.toHaveBeenCalled();
    const buckets = await database.pool.query(
      'SELECT count(*)::int AS count FROM rate_limit_buckets',
    );
    expect(buckets.rows[0].count).toBe(0);
  });

  it('validates query/cursor and shares only public candidates across authenticated owners', async () => {
    const app = appFor();
    for (const query of ['query=&limit=2', 'query=poster&limit=0', 'query=poster&cursor=forged']) {
      expect((await search(app, query)).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
    const firstResponse = await search(app, 'query=poster&limit=2');
    expect(firstResponse.status).toBe(200);
    const first = marketSearchResultSchema.parse(await firstResponse.json());
    expect(first.fromCache).toBe(false);
    expect(first.candidates).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const cached = marketSearchResultSchema.parse(
      await (await search(app, 'query=poster&limit=2', tokenB)).json(),
    );
    expect(cached).toEqual({ ...first, fromCache: true });
    expect(upstream).toHaveBeenCalledTimes(1);
    const next = marketSearchResultSchema.parse(
      await (
        await search(
          app,
          `query=poster&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
        )
      ).json(),
    );
    expect(next.candidates).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    expect(
      new Set([...first.candidates, ...next.candidates].map((row) => row.candidateId)).size,
    ).toBe(3);
    expect(relayFetch).not.toHaveBeenCalled();
    for (const table of [
      'design_schemes',
      'design_scheme_runs',
      'generation_runs',
      'account_credentials',
    ]) {
      const count = await database.pool.query(`SELECT count(*)::int AS count FROM ${table}`);
      expect(count.rows[0].count, table).toBe(0);
    }
  });

  it('enforces per-user quotas atomically across app instances, including cached hits', async () => {
    const apps = [appFor(), appFor()];
    for (const app of apps) expect((await search(app, 'query=poster')).status).toBe(200);
    const responses = await Promise.all(
      Array.from({ length: 33 }, (_, i) => search(apps[i % 2], 'query=poster')),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(28);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
    const rejected = responses.find((response) => response.status === 429);
    expect(await rejected?.json()).toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        retryable: true,
        details: { operation: 'searchMarket', retryAfterSeconds: expect.any(Number) },
      },
    });
    expect(upstream).toHaveBeenCalledTimes(2);
    // A different owner may still use the public cache under its own per-user quota.
    expect((await search(apps[0], 'query=poster', tokenB)).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('shares upstream quotas across users/app instances and resumes after the PG window expires', async () => {
    const apps = [appFor(), appFor()];
    for (let i = 0; i < 8; i += 1) {
      expect((await search(apps[i % 2], `query=seed-${i}`, i % 2 ? tokenA : tokenB)).status).toBe(
        200,
      );
    }
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        search(apps[i % 2], `query=unique-${i}`, i % 2 ? tokenA : tokenB),
      ),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(2);
    expect(upstream).toHaveBeenCalledTimes(10);
    await database.pool.query(
      "UPDATE rate_limit_buckets SET window_started_at = now() - interval '2 minutes'",
    );
    expect((await search(apps[0], 'query=after-window')).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(11);
    const buckets = await database.pool.query('SELECT bucket_key FROM rate_limit_buckets');
    expect(buckets.rows.length).toBe(3);
    expect(
      buckets.rows.every((row: { bucket_key: string }) => /^[a-f0-9]{64}$/.test(row.bucket_key)),
    ).toBe(true);
    expect(JSON.stringify(buckets.rows)).not.toContain('market-owner');
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it('revoked sessions cannot read an already populated public cache', async () => {
    const app = appFor();
    expect((await search(app, 'query=poster', tokenB)).status).toBe(200);
    await database.pool.query('DELETE FROM session WHERE token = $1', [tokenB]);
    const denied = await search(app, 'query=poster', tokenB);
    expect(denied.status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(relayFetch).not.toHaveBeenCalled();
  });
});
