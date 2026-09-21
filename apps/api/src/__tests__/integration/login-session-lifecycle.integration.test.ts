import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@musefold/db';
import {
  createNewApiClient,
  NewApiClientError,
  type NewApiClient,
  type RelayAuthSession,
} from '@musefold/new-api-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { OpenAPIHono } from '@hono/zod-openapi';
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { requireSession, type AuthedEnv } from '../../auth/middleware.js';
import { loadEnv } from '../../env.js';
import { AccountService } from '../../modules/account/service.js';
import { accountRoutes } from '../../modules/account/routes.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { startNewApiIdentityFixture } from '../fixtures/new-api-identity-fixture.js';
import { LoginCapacityService } from '../../modules/account/login-capacity.js';
import { loginCapacityReviewSchema } from '@musefold/contracts';
import { z } from 'zod';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const API = 'http://127.0.0.1:8787';
const KEY = 'synthetic-login-session-test-key';
const BINDING = 'synthetic-main-process-only-binding-1234567890';
const GRANT = 'synthetic-upstream-only-capacity-grant-1234567890';
const oldSid = '77230c99-8788-4798-94ad-4992a1fcaa35';

describeDb('login lifecycle through real Better Auth, HTTP and PostgreSQL', () => {
  let pg: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let fixture: Awaited<ReturnType<typeof startNewApiIdentityFixture>>;
  let upstream: NewApiClient;
  let account: AccountService;
  let app: OpenAPIHono<AuthedEnv>;
  let complete: ReturnType<typeof vi.fn<NonNullable<NewApiClient['managedSessions']>['complete']>>;
  let release: ReturnType<typeof vi.fn<NonNullable<NewApiClient['managedSessions']>['release']>>;
  let lastRelay: RelayAuthSession | undefined;
  let failPrepare = false;
  let loseCommitReply = false;
  let pauseCommit: (() => Promise<void>) | undefined;
  let required = 1;
  const selections = new Map<string, { sessionRef: string; version: number }[]>();
  const loginResult = z.object({ token: z.string(), managed: z.boolean().optional() });
  const page = () => ({
    total: 1,
    limit: 1,
    required,
    items: [
      {
        sid: oldSid,
        version: 1,
        current: false,
        user_agent: 'Firefox/128 Linux <script>not markup</script>',
        ip: '192.168.1.99',
        created_at: 1789000000,
        last_seen_at: 1789880000,
        last_interactive_at: null,
        expires_at: 1791000000,
      },
    ],
  });
  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(pg.getConnectionUri(), { max: 12 });
    await migrateDatabase(database.db);
  }, 120_000);
  beforeEach(async () => {
    await database.pool.query(
      'TRUNCATE login_capacity_flows, login_session_releases, "user" CASCADE',
    );
    fixture = await startNewApiIdentityFixture();
    fixture.addOwner({ id: 42, username: 'alice' });
    fixture.mapUsername('alice', 42);
    required = 1;
    failPrepare = false;
    lastRelay = undefined;
    loseCommitReply = false;
    pauseCommit = undefined;
    selections.clear();
    const base = createNewApiClient(fixture.baseUrl);
    const results = new Map<string, RelayAuthSession>();
    const bySid = new Map<string, RelayAuthSession>();
    complete = vi.fn(async (_token, operation) => {
      const previous = results.get(operation);
      if (previous) return previous;
      const relay = await base.login({ username: 'alice', password: 'fixture-password' });
      relay.cleanup = { sid: randomUUID(), token: 'f'.repeat(64) };
      bySid.set(relay.cleanup.sid, relay);
      results.set(operation, relay);
      lastRelay = relay;
      return relay;
    });
    release = vi.fn(async (proof) => {
      const target = bySid.get(proof.sid);
      if (!target?.cleanup || proof.token !== target.cleanup.token)
        throw new Error('Wrong release target');
      await base.logout?.(target);
    });
    upstream = {
      ...base,
      managedSessions: {
        begin: vi.fn(async () => ({
          flow_token: GRANT,
          expires_at: Math.floor(Date.now() / 1000) + 300,
          sessions: page(),
        })),
        review: vi.fn(async () => ({
          expires_at: Math.floor(Date.now() / 1000) + 300,
          sessions: page(),
        })),
        complete,
        release,
        cancel: vi.fn(async () => {}),
        list: vi.fn(async () => page()),
        touch: vi.fn(async () => {}),
        revoke: vi.fn(async () => 1),
      },
    };
    account = new AccountService(deps());
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: pg.getConnectionUri(),
      PUBLIC_BASE_URL: API,
      BETTER_AUTH_SECRET: 'synthetic-login-session-better-auth-key',
      NEW_API_BASE_URL: fixture.baseUrl,
      CREDENTIAL_ENCRYPTION_KEY: KEY,
    });
    const auth = createAuth({
      env,
      db: database.db,
      newApi: upstream,
      hooks: {
        loginSessions: account.loginSessions,
        prepareLogin: (input) => {
          if (failPrepare) throw new Error('synthetic prepare failure');
          return account.prepareLogin(input);
        },
        commitLogin: async (input) => {
          const pause = pauseCommit;
          pauseCommit = undefined;
          await pause?.();
          await account.commitLogin(input);
          if (loseCommitReply) {
            loseCommitReply = false;
            throw new Error('lost commit reply');
          }
        },
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    app = new OpenAPIHono<AuthedEnv>();
    app.onError((error, c) => {
      const safe =
        error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'Internal test error');
      return c.json(toErrorBody(safe, 'test'), safe.status as 400);
    });
    app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
    const authed = new OpenAPIHono<AuthedEnv>();
    authed.use('*', requireSession(auth, [API], account));
    authed.route('/', accountRoutes(account, new RateLimiter(database.db, 'synthetic-rate-key')));
    app.route('/api/v1', authed);
  });
  afterEach(async () => {
    await fixture.close();
  });
  afterAll(async () => {
    await database?.pool.end();
    await pg?.stop();
  });
  function deps() {
    return {
      db: database.db,
      newApi: upstream,
      encryptionKey: KEY,
      apiIssuer: API,
      upstreamIssuer: fixture.baseUrl,
    };
  }
  function post(path: string, body: unknown, binding = BINDING, token?: string, origin = API) {
    return app.request(`${API}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        ...(binding ? { 'x-musefold-login-binding': binding } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }
  async function begin() {
    const response = await post('/api/auth/sign-in/new-api', {
      email: 'alice',
      password: 'fixture-password',
    });
    expect(response.status).toBe(409);
    const body = z
      .object({ details: z.object({ review: loginCapacityReviewSchema }) })
      .parse(await response.json());
    const review = body.details.review;
    selections.set(
      review.flowRef,
      review.sessions.items.map(({ sessionRef, version }) => ({ sessionRef, version })),
    );
    expect(JSON.stringify(review)).not.toContain(oldSid);
    expect(JSON.stringify(body)).not.toMatch(
      /synthetic-upstream|fixture-password|cleanup_token|access_token|refresh_token/,
    );
    return review;
  }
  async function finish(flowRef: string, operationId = randomUUID()) {
    const input = { flowRef, operationId, selected: selections.get(flowRef)! };
    const response = await post('/api/auth/login-capacity/complete', input);
    expect(response.status).toBe(200);
    const result = loginResult.parse(await response.json());
    return { input, token: result.token as string };
  }
  it.each([
    { upstreamStatus: 429, expectedStatus: 429, code: 'RATE_LIMITED' },
    { upstreamStatus: 503, expectedStatus: 502, code: 'INTERNAL_ERROR' },
    { upstreamStatus: null, expectedStatus: 502, code: 'INTERNAL_ERROR' },
  ])(
    'preserves login throttling without exposing upstream details ($upstreamStatus)',
    async ({ upstreamStatus, expectedStatus, code }) => {
      vi.mocked(upstream.managedSessions!.begin).mockRejectedValueOnce(
        new NewApiClientError('network', 'private upstream diagnostics', upstreamStatus),
      );
      const response = await post('/api/auth/sign-in/new-api', {
        email: 'alice',
        password: 'fixture-password',
      });
      expect(response.status).toBe(expectedStatus);
      const body = await response.json();
      expect(body).toMatchObject({ code });
      expect(JSON.stringify(body)).not.toContain('private upstream diagnostics');
      if (upstreamStatus === 429)
        expect(body).toMatchObject({ message: '登录操作过于频繁，请稍后再试' });
      expect(complete).not.toHaveBeenCalled();
      expect((await database.pool.query('SELECT count(*) FROM session')).rows[0].count).toBe('0');
    },
  );
  it('keeps the exact login operation after upstream throttles completion', async () => {
    const review = await begin();
    complete.mockRejectedValueOnce(new NewApiClientError('network', 'rate limited', 429));
    const input = {
      flowRef: review.flowRef,
      operationId: randomUUID(),
      selected: selections.get(review.flowRef)!,
    };
    const response = await post('/api/auth/login-capacity/complete', input);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(
      (await post('/api/auth/login-capacity/review', { flowRef: review.flowRef })).status,
    ).toBe(409);
    expect(release).not.toHaveBeenCalled();
    expect((await database.pool.query('SELECT count(*) FROM session')).rows[0].count).toBe('0');
    const replacement = await post('/api/auth/login-capacity/complete', {
      ...input,
      operationId: randomUUID(),
    });
    expect(replacement.status).toBe(409);
    expect(complete).toHaveBeenCalledTimes(1);
    const resumed = await post('/api/auth/login-capacity/complete', input);
    expect(resumed.status).toBe(200);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]).toEqual(complete.mock.calls[0]);
  });
  it('binds the public ref separately, masks devices and cancels without revoking', async () => {
    const review = await begin();
    expect(review.sessions.items[0]?.maskedIp).toBe('192.168.*.*');
    expect(JSON.stringify(review)).not.toContain('<script>');
    expect(
      (await post('/api/auth/login-capacity/review', { flowRef: review.flowRef }, '')).status,
    ).toBe(401);
    expect(
      (
        await post(
          '/api/auth/login-capacity/review',
          { flowRef: review.flowRef },
          'wrong-but-long-enough-binding-123456789',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          '/api/auth/login-capacity/review',
          { flowRef: review.flowRef },
          BINDING,
          undefined,
          'https://foreign.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (await post('/api/auth/login-capacity/cancel', { flowRef: review.flowRef })).status,
    ).toBe(200);
    expect(complete).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(
      (await post('/api/auth/login-capacity/review', { flowRef: review.flowRef })).status,
    ).toBe(401);
  });
  it('replays one completion without a second BA session and releases after logout/restart', async () => {
    const review = await begin();
    const result = await finish(review.flowRef);
    const replay = await post('/api/auth/login-capacity/complete', result.input);
    expect(loginResult.parse(await replay.json()).token).toBe(result.token);
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await database.pool.query('SELECT count(*) FROM session')).rows[0].count).toBe('1');
    expect(
      (
        await post(
          '/api/v1/account/login-sessions/touch',
          { acknowledge: true },
          BINDING,
          result.token,
        )
      ).status,
    ).toBe(200);
    expect((await post('/api/auth/sign-out', {}, BINDING, result.token)).status).toBe(200);
    const queued = (await database.pool.query('SELECT * FROM login_session_releases')).rows[0];
    expect(queued.state).toBe('pending');
    expect(queued.ciphertext).not.toContain('f'.repeat(64));
    release.mockRejectedValueOnce(new Error('offline'));
    expect((await account.loginSessions.sweep()).released).toBe(0);
    const retry = (await database.pool.query('SELECT * FROM login_session_releases')).rows[0];
    expect(retry.attempts).toBe(1);
    expect(retry.ciphertext).not.toBe('');
    expect(await account.loginSessions.releases.backlog()).toBe(0);
    await database.pool.query('UPDATE login_session_releases SET attempts = 3');
    expect(await account.loginSessions.releases.backlog()).toBe(1);
    await database.pool.query(
      "UPDATE login_session_releases SET next_attempt_at = now() - interval '1 second'",
    );
    expect((await new LoginCapacityService(deps()).sweep()).released).toBe(1);
    const cleared = (await database.pool.query('SELECT * FROM login_session_releases')).rows[0];
    expect(cleared.state).toBe('released');
    expect(cleared.ciphertext).toBe('');
    await expect(upstream.getSelf(lastRelay?.jwt ?? '')).rejects.toMatchObject({ code: 'auth' });
  });
  it('reopens review after capacity contention without retrying a different selection silently', async () => {
    const review = await begin();
    complete.mockRejectedValueOnce(
      new NewApiClientError('AUTH_SESSION_REVIEW_CHANGED', 'changed', 409),
    );
    const input = {
      flowRef: review.flowRef,
      operationId: randomUUID(),
      selected: selections.get(review.flowRef)!,
    };
    expect((await post('/api/auth/login-capacity/complete', input)).status).toBe(409);
    expect(
      (await post('/api/auth/login-capacity/review', { flowRef: review.flowRef })).status,
    ).toBe(200);
    await finish(review.flowRef);
  });
  it('retains the original operation after an unknown upstream response and rejects replacement', async () => {
    const review = await begin();
    complete.mockRejectedValueOnce(new NewApiClientError('network', 'lost response'));
    const input = {
      flowRef: review.flowRef,
      operationId: randomUUID(),
      selected: selections.get(review.flowRef)!,
    };
    expect((await post('/api/auth/login-capacity/complete', input)).status).toBe(502);
    expect(
      (await post('/api/auth/login-capacity/complete', { ...input, operationId: randomUUID() }))
        .status,
    ).toBe(409);
    expect((await post('/api/auth/login-capacity/complete', input)).status).toBe(200);
  });
  it('retains cleanup responsibility when local identity preparation fails', async () => {
    const review = await begin();
    failPrepare = true;
    const response = await post('/api/auth/login-capacity/complete', {
      flowRef: review.flowRef,
      operationId: randomUUID(),
      selected: selections.get(review.flowRef)!,
    });
    expect(response.status).toBe(502);
    expect((await database.pool.query('SELECT count(*) FROM session')).rows[0].count).toBe('0');
    expect(
      (await database.pool.query('SELECT state FROM login_session_releases')).rows[0].state,
    ).toBe('pending');
    expect((await account.loginSessions.sweep()).released).toBe(1);
  });
  it('expires lost candidates and refuses to send proofs to a changed issuer', async () => {
    const review = await begin();
    await finish(review.flowRef);
    await database.pool.query(
      "UPDATE login_session_releases SET next_attempt_at = now() - interval '1 second', upstream_issuer = 'https://foreign.example'",
    );
    await account.loginSessions.sweep();
    expect(release).not.toHaveBeenCalled();
    await database.pool.query(
      'UPDATE login_session_releases SET upstream_issuer = $1, next_attempt_at = now()',
      [fixture.baseUrl],
    );
    expect((await account.loginSessions.sweep()).released).toBe(1);
    expect((await database.pool.query('SELECT count(*) FROM session')).rows[0].count).toBe('0');
  });
  it('auto-completes a free slot but leaves activation to the receiving client', async () => {
    required = 0;
    const response = await post('/api/auth/sign-in/new-api', {
      email: 'alice',
      password: 'fixture-password',
    });
    expect(response.status).toBe(200);
    expect(loginResult.parse(await response.json()).managed).toBe(true);
    expect(
      (await database.pool.query('SELECT state FROM login_session_releases')).rows[0].state,
    ).toBe('candidate');
    expect(upstream.managedSessions?.touch).not.toHaveBeenCalled();
  });
  it('does not compensate a successfully committed login when its DB response was lost', async () => {
    const review = await begin();
    loseCommitReply = true;
    const { token } = await finish(review.flowRef);
    expect(
      (await database.pool.query('SELECT count(*) FROM session WHERE token = $1', [token])).rows[0]
        .count,
    ).toBe('1');
    expect(
      (await database.pool.query('SELECT state FROM login_capacity_flows')).rows[0].state,
    ).toBe('completed');
    expect(
      (await database.pool.query('SELECT state FROM login_session_releases')).rows[0].state,
    ).toBe('candidate');
    expect(release).not.toHaveBeenCalled();
  });
  it('replaces only the caller login after commit; failed replacement preserves it', async () => {
    const previous = await finish((await begin()).flowRef);
    const oldRelay = lastRelay;
    const oldId = (
      await database.pool.query('SELECT id FROM session WHERE token = $1', [previous.token])
    ).rows[0].id;
    failPrepare = true;
    const rejected = await begin();
    expect(
      (
        await post(
          '/api/auth/login-capacity/complete',
          {
            flowRef: rejected.flowRef,
            operationId: randomUUID(),
            selected: selections.get(rejected.flowRef),
          },
          BINDING,
          previous.token,
        )
      ).status,
    ).toBe(502);
    expect(
      (await database.pool.query('SELECT count(*) FROM session WHERE id = $1', [oldId])).rows[0]
        .count,
    ).toBe('1');
    failPrepare = false;
    const replacement = await begin();
    const response = await post(
      '/api/auth/login-capacity/complete',
      {
        flowRef: replacement.flowRef,
        operationId: randomUUID(),
        selected: selections.get(replacement.flowRef),
      },
      BINDING,
      previous.token,
    );
    expect(response.status).toBe(200);
    expect(
      (await database.pool.query('SELECT count(*) FROM session WHERE id = $1', [oldId])).rows[0]
        .count,
    ).toBe('0');
    expect(
      (
        await database.pool.query(
          'SELECT state FROM login_session_releases WHERE session_id = $1',
          [oldId],
        )
      ).rows[0].state,
    ).toBe('pending');
    const currentRelay = lastRelay;
    await account.loginSessions.sweep();
    await expect(upstream.getSelf(oldRelay?.jwt ?? '')).rejects.toMatchObject({ code: 'auth' });
    await expect(upstream.getSelf(currentRelay?.jwt ?? '')).resolves.toMatchObject({ id: 42 });
  });
  it('resumes the same BA candidate after lease loss and fences late compensation', async () => {
    const review = await begin();
    let resume = () => {};
    let reached = () => {};
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    pauseCommit = async () => {
      reached();
      await held;
    };
    const input = {
      flowRef: review.flowRef,
      operationId: randomUUID(),
      selected: selections.get(review.flowRef),
    };
    const stale = post('/api/auth/login-capacity/complete', input);
    try {
      await entered;
      await database.pool.query(
        "UPDATE login_capacity_flows SET lease_until = now() - interval '1 second' WHERE id = $1",
        [review.flowRef],
      );
      const resumed = await post('/api/auth/login-capacity/complete', input);
      expect(resumed.status).toBe(200);
      const saved = loginResult.parse(await resumed.json());
      resume();
      const late = await stale;
      expect(late.status).toBe(200);
      expect(loginResult.parse(await late.json()).token).toBe(saved.token);
      expect((await database.pool.query('SELECT count(*) FROM session')).rows[0].count).toBe('1');
      expect(
        (await database.pool.query('SELECT state FROM login_session_releases')).rows[0].state,
      ).toBe('candidate');
      expect(release).not.toHaveBeenCalled();
    } finally {
      resume();
      await stale;
    }
  });
  it('Web completion uses the HttpOnly binding cookie and does not deliver bearer credentials in JSON', async () => {
    const initial = await post(
      '/api/auth/sign-in/new-api',
      { email: 'alice', password: 'fixture-password' },
      '',
    );
    expect(initial.status).toBe(409);
    const {
      details: { review },
    } = z
      .object({ details: z.object({ review: loginCapacityReviewSchema }) })
      .parse(await initial.json());
    const cookies = initial.headers.getSetCookie();
    const bindingCookie = cookies.find((value) =>
      value.startsWith(`musefold.login-flow.${review.flowRef}=`),
    );
    expect(bindingCookie).toContain('HttpOnly');
    expect(bindingCookie).toContain('SameSite=Strict');
    const input = {
      flowRef: review.flowRef,
      operationId: randomUUID(),
      selected: review.sessions.items.map(({ sessionRef, version }) => ({ sessionRef, version })),
    };
    const completed = await app.request(`${API}/api/auth/login-capacity/complete`, {
      method: 'POST',
      headers: {
        origin: API,
        'content-type': 'application/json',
        cookie: bindingCookie!.split(';')[0]!,
      },
      body: JSON.stringify(input),
    });
    expect(completed.status).toBe(200);
    const body = await completed.json();
    expect(body).toMatchObject({ managed: true });
    expect(JSON.stringify(body)).not.toMatch(/token|password|cleanup|refresh|synthetic-upstream/i);
    expect(
      completed.headers
        .getSetCookie()
        .some((value) => value.includes('session_token=') && value.includes('HttpOnly')),
    ).toBe(true);
  });
});
