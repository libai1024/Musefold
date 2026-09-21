import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { loginCapacityReviewSchema, loginSessionPageSchema } from '@musefold/contracts';
import { createNewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAuth } from '../../auth/index.js';
import { requireSession, type AuthedEnv } from '../../auth/middleware.js';
import { loadEnv } from '../../env.js';
import { AccountService } from '../../modules/account/service.js';
import { accountRoutes } from '../../modules/account/routes.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { AppError, toErrorBody } from '../../lib/errors.js';

// Start the locally built extension image with a disposable PG database,
// synthetic sessionroot account and USER_SESSION_ACTIVE_LIMIT=2. No mock relay.
const url = process.env.MUSEFOLD_SESSION_IMAGE_URL;
const enabled = !!url && process.env.RUN_DATABASE_TESTS === 'true';
(enabled ? describe : describe.skip)('complete Musefold + New API image lifecycle', () => {
  it('full authentication, capacity recovery, replay, owner-scoped revoke and durable logout', async () => {
    if (!url || new URL(url).hostname !== '127.0.0.1')
      throw new Error('Disposable local image required');
    const pg = await new PostgreSqlContainer('postgres:17-alpine').start();
    const database = createDatabase(pg.getConnectionUri());
    await migrateDatabase(database.db).catch(async (error: unknown) => {
      await database.pool.end();
      await pg.stop();
      throw error;
    });
    const upstream = createNewApiClient(url);
    const api = 'http://127.0.0.1:8787';
    const binding = 'synthetic-cross-service-main-only-binding-123456';
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: pg.getConnectionUri(),
      PUBLIC_BASE_URL: api,
      BETTER_AUTH_SECRET: 'synthetic-cross-service-auth-key',
      NEW_API_BASE_URL: url,
      CREDENTIAL_ENCRYPTION_KEY: 'synthetic-cross-service-encryption-key',
    });
    const account = new AccountService({
      db: database.db,
      newApi: upstream,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      apiIssuer: api,
      upstreamIssuer: url,
    });
    const auth = createAuth({
      env,
      db: database.db,
      newApi: upstream,
      hooks: {
        loginSessions: account.loginSessions,
        prepareLogin: (input) => account.prepareLogin(input),
        commitLogin: (input) => account.commitLogin(input),
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    const app = new OpenAPIHono<AuthedEnv>();
    app.onError((error, c) => {
      const safe =
        error instanceof AppError
          ? error
          : new AppError('INTERNAL_ERROR', 'Cross-service test error');
      return c.json(toErrorBody(safe, 'test'), safe.status as 400);
    });
    app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
    const authed = new OpenAPIHono<AuthedEnv>();
    authed.use('*', requireSession(auth, [api], account));
    authed.route('/', accountRoutes(account, new RateLimiter(database.db, 'synthetic-rate-key')));
    app.route('/api/v1', authed);
    const request = (path: string, body?: unknown, token?: string) =>
      app.request(`${api}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin: api,
          'content-type': 'application/json',
          'x-musefold-login-binding': binding,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const credentials = { email: 'sessionroot', password: 'synthetic-session-password' };
    const delivery = z.object({ token: z.string().min(1) });
    try {
      expect(
        (await request('/api/auth/sign-in/new-api', { ...credentials, password: 'wrong' })).status,
      ).toBe(401);
      const tokens: string[] = [];
      for (let index = 0; index < 2; index++) {
        const response = await request('/api/auth/sign-in/new-api', credentials);
        expect(response.status).toBe(200);
        const { token } = delivery.parse(await response.json());
        expect(typeof token).toBe('string');
        tokens.push(token);
        expect(
          (await request('/api/v1/account/login-sessions/touch', { acknowledge: true }, token))
            .status,
        ).toBe(200);
      }
      const full = await request('/api/auth/sign-in/new-api', credentials);
      expect(full.status).toBe(409);
      const {
        details: { review },
      } = z
        .object({ details: z.object({ review: loginCapacityReviewSchema }) })
        .parse(await full.json());
      expect(review.sessions).toMatchObject({ total: 2, required: 1, limit: 2 });
      const input = {
        flowRef: review.flowRef,
        operationId: randomUUID(),
        selected: review.sessions.items
          .slice(0, 1)
          .map(({ sessionRef, version }) => ({ sessionRef, version })),
      };
      const completed = await request('/api/auth/login-capacity/complete', input);
      expect(completed.status).toBe(200);
      const { token } = delivery.parse(await completed.json());
      // The evicted device's BA row must be gone before success, not only after
      // its next status request, so queued-but-unsent work loses authorization.
      expect((await database.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n).toBe(
        2,
      );
      const replay = await request('/api/auth/login-capacity/complete', input);
      expect(delivery.parse(await replay.json()).token === token).toBe(true);
      expect(
        (await request('/api/v1/account/login-sessions/touch', { acknowledge: true }, token))
          .status,
      ).toBe(200);
      const oldStatuses = await Promise.all(
        tokens.map(async (old) => (await request('/api/v1/account/status', undefined, old)).status),
      );
      expect(oldStatuses.sort()).toEqual([200, 401]);
      const page = loginSessionPageSchema.parse(
        await (await request('/api/v1/account/login-sessions', undefined, token)).json(),
      );
      expect(page.total).toBe(2);
      const selected = page.items
        .filter((item) => !item.current)
        .map(({ sessionRef, version }) => ({ sessionRef, version }));
      const revoked = await request(
        '/api/v1/account/login-sessions/revoke',
        { operationId: randomUUID(), selected },
        token,
      );
      expect(revoked.status).toBe(200);
      expect(await revoked.json()).toEqual({ released: 1 });
      expect((await request('/api/auth/sign-out', {}, token)).status).toBe(200);
      await account.loginSessions.sweep();
      expect((await database.pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n).toBe(
        0,
      );
      const final = await upstream.managedSessions?.begin({
        username: credentials.email,
        password: credentials.password,
      });
      expect(final?.sessions.total).toBe(0);
      if (final) await upstream.managedSessions?.cancel(final.flow_token);
    } finally {
      // Scope cleanup to this isolated Musefold database's exact tracked SIDs.
      await database.pool.query('DELETE FROM session').catch(() => undefined);
      await account.loginSessions.sweep().catch(() => undefined);
      await database.pool.end();
      await pg.stop();
    }
  }, 120_000);
});
