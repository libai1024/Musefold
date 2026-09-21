import { OpenAPIHono } from '@hono/zod-openapi';
import { accountNoticesSchema } from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient, noticeId } from '@musefold/new-api-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { requireSession, type AuthedEnv } from '../../auth/middleware.js';
import { loadEnv } from '../../env.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { AccountService } from '../../modules/account/service.js';
import { accountRoutes } from '../../modules/account/routes.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { startNewApiIdentityFixture } from '../fixtures/new-api-identity-fixture.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const API = 'http://127.0.0.1:8787';
describeDb('independent notices with real PG, Better Auth and HTTP upstream', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let fixture: Awaited<ReturnType<typeof startNewApiIdentityFixture>>;
  let app: OpenAPIHono<AuthedEnv>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
  }, 120_000);
  beforeEach(async () => {
    await database.pool.query('TRUNCATE "user" CASCADE');
    fixture = await startNewApiIdentityFixture();
    fixture.addOwner({ id: 42, username: 'notice-reader' });
    fixture.mapUsername('notice-reader', 42);
    fixture.setNotices({
      announcements: [{ content: '<b>维护公告</b>', publishDate: '2026-09-21T00:00:00Z' }],
      notice: '欢迎使用',
    });
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      PUBLIC_BASE_URL: API,
      BETTER_AUTH_SECRET: 'synthetic-notices-auth-secret',
      NEW_API_BASE_URL: fixture.baseUrl,
      CREDENTIAL_ENCRYPTION_KEY: 'synthetic-notices-encryption',
    });
    const newApi = createNewApiClient(fixture.baseUrl);
    const service = new AccountService({
      db: database.db,
      newApi,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      apiIssuer: API,
      upstreamIssuer: fixture.baseUrl,
    });
    const auth = createAuth({
      env,
      db: database.db,
      newApi,
      hooks: {
        prepareLogin: (input) => service.prepareLogin(input),
        commitLogin: (input) => service.commitLogin(input),
        assertSessionAuthorization: (...input) => service.assertSessionAuthorization(...input),
      },
    });
    await auth.$context;
    app = new OpenAPIHono<AuthedEnv>();
    app.onError((error, c) => {
      const safe =
        error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'Test failure', 500);
      return c.json(toErrorBody(safe, 'notice-test'), safe.status as 400);
    });
    app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
    const api = new OpenAPIHono<AuthedEnv>();
    api.use('*', requireSession(auth, [API], service));
    api.route(
      '/',
      accountRoutes(service, new RateLimiter(database.db, 'synthetic-notices-rate-key')),
    );
    app.route('/api/v1', api);
  });
  afterEach(async () => {
    await fixture?.close();
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  async function login() {
    const response = await app.request(`${API}/api/auth/sign-in/new-api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'notice-reader', password: 'fixture-password' }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { token: string; user: { id: string } };
  }
  const read = (token: string, path = '/notices') =>
    app.request(`${API}/api/v1/account${path}`, { headers: { authorization: `Bearer ${token}` } });
  it('returns validated public text with no extra login, profile, token creation or charge work', async () => {
    const { token } = await login();
    const before = fixture.requests;
    const response = await read(token);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(accountNoticesSchema.parse(await response.json())).toEqual({
      apiIssuer: API,
      issuer: fixture.baseUrl,
      items: [
        {
          id: noticeId('<b>维护公告</b>'),
          content: '<b>维护公告</b>',
          publishedAt: Date.parse('2026-09-21T00:00:00Z'),
        },
        { id: noticeId('欢迎使用'), content: '欢迎使用', publishedAt: null },
      ],
    });
    expect(fixture.requests.slice(before.length).map((row) => row.operation)).toEqual([
      'notices',
      'notices',
    ]);
    expect(
      (
        await database.pool.query(
          'SELECT count(*)::int AS count FROM generation_execution_receipts',
        )
      ).rows[0]?.count,
    ).toBe(0);
  });
  it('does not block login or account status when notices fail, and a later explicit read recovers', async () => {
    fixture.failNext(
      { operation: 'notices' },
      { status: 503, message: 'private-upstream-diagnostic' },
    );
    const { token } = await login();
    expect(fixture.count({ operation: 'notices' })).toBe(0);
    expect((await read(token, '/status')).status).toBe(200);
    const failed = await read(token);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('private-upstream-diagnostic');
    expect((await read(token)).status).toBe(200);
  });
  it('rejects anonymous and restricted sessions before contacting the notice service', async () => {
    expect((await read('not-a-session')).status).toBe(401);
    const { token, user } = await login();
    await database.pool.query(
      "UPDATE account_session_authorizations SET mode = 'recovery_only' WHERE user_id = $1",
      [user.id],
    );
    expect((await read(token)).status).toBe(403);
    expect(fixture.count({ operation: 'notices' })).toBe(0);
  });
  it('rejects a response that completes after the local session has been revoked', async () => {
    const { token, user } = await login();
    const barrier = fixture.pauseNext({ operation: 'notices' });
    const pending = read(token);
    try {
      await barrier.reached;
      await database.pool.query('DELETE FROM session WHERE user_id = $1', [user.id]);
    } finally {
      barrier.release();
    }
    expect((await pending).status).toBe(401);
  });
});
