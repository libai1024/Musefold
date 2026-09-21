import { randomUUID } from 'node:crypto';
import { accountSummarySchema } from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { openJsonFromString } from '@musefold/server-crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_PROCESS_KEY,
  IdentityApiProcess,
  startIdentityProxy,
} from '../fixtures/account-identity-process.js';
import { startNewApiIdentityFixture } from '../fixtures/new-api-identity-fixture.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb(
  'account identity: actual API processes, lost login responses and refresh leases',
  () => {
    let container: StartedPostgreSqlContainer;
    let database: ReturnType<typeof createDatabase>;
    let fixture: Awaited<ReturnType<typeof startNewApiIdentityFixture>>;
    let proxy: Awaited<ReturnType<typeof startIdentityProxy>>;
    let one: IdentityApiProcess;
    let two: IdentityApiProcess;
    let secrets: string[];
    let setupComplete = false;
    const processes: IdentityApiProcess[] = [];
    const cleanup: Array<() => Promise<void>> = [];
    const clientEnds: Promise<void>[] = [];

    beforeAll(async () => {
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      database = createDatabase(container.getConnectionUri(), { max: 5 });
      database.pool.on('connect', (client) => {
        clientEnds.push(new Promise<void>((resolve) => client.once('end', () => resolve())));
      });
      await migrateDatabase(database.db);
    }, 120_000);

    beforeEach(async () => {
      setupComplete = false;
      secrets = [
        IDENTITY_PROCESS_KEY,
        'fixture-password',
        'fixture-jwt-',
        'fixture-refresh-',
        'sk-fixture-',
      ];
      await database.pool.query('TRUNCATE "user" CASCADE');
      await database.pool.query('DELETE FROM rate_limit_buckets');
      fixture = await startNewApiIdentityFixture();
      const currentFixture = fixture;
      cleanup.push(() => currentFixture.close());
      fixture.addOwner({ id: 42, username: 'alice' });
      fixture.mapUsername('alice', 42);
      proxy = await startIdentityProxy();
      const currentProxy = proxy;
      cleanup.push(() => currentProxy.close());
      one = await start('one');
      two = await start('two');
      expect(one.pid).not.toBe(two.pid);
      expect(one.pid).not.toBe(process.pid);
      expect(two.pid).not.toBe(process.pid);
      expect(one.url).not.toBe(two.url);
      expect(one.url).not.toBe(proxy.url);
      expect(two.url).not.toBe(proxy.url);
      setupComplete = true;
    }, 60_000);

    afterEach(async () => {
      const running = processes.splice(0);
      // Each closure captures this iteration's resource. Partial setup and an
      // individual close failure must not skip stopping any started API process.
      const results = await Promise.allSettled([
        ...cleanup.splice(0).map((close) => close()),
        ...running.map((api) => api.stop()),
      ]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      for (const api of running) {
        expect(api.outputWasTruncated).toBe(false);
        for (const secret of secrets) expect(api.containsOutput(secret)).toBe(false);
      }
      // The account fixtures never execute image or other unknown upstream operations.
      if (setupComplete) {
        expect(fixture.count({ operation: 'unknown' })).toBe(0);
        expect(
          (await database.pool.query('SELECT count(*)::int AS n FROM generation_runs')).rows[0].n,
        ).toBe(0);
      }
    }, 30_000);

    afterAll(async () => {
      await database?.pool.end();
      // pg-pool can resolve end() before the individual sockets finish closing.
      await Promise.all(clientEnds);
      await container?.stop();
    });

    async function start(name: string) {
      const api = await IdentityApiProcess.start({
        databaseUrl: container.getConnectionUri(),
        apiIssuer: proxy.url,
        upstreamIssuer: fixture.baseUrl,
        name: `identity-process-${name}`,
      });
      processes.push(api);
      return api;
    }

    function request(api: IdentityApiProcess, path: string, token?: string, body?: unknown) {
      proxy.select(api);
      return fetch(`${proxy.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          origin: proxy.url,
          // This fixture models a main-process client, so bearer delivery is explicit.
          'x-musefold-login-binding': 'synthetic-identity-main-process-binding-123456',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    }

    function loginRequest(api: IdentityApiProcess) {
      return request(api, '/api/auth/sign-in/new-api', undefined, {
        email: 'alice',
        password: 'fixture-password',
      });
    }

    async function login(api: IdentityApiProcess) {
      const response = await loginRequest(api);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { token: string; user: { id: string } };
      expect(typeof body.token).toBe('string');
      expect(body.token.length > 0).toBe(true);
      secrets.push(body.token);
      expect(
        (
          await request(api, '/api/v1/account/login-sessions/touch', body.token, {
            acknowledge: true,
          })
        ).status,
      ).toBe(200);
      return body;
    }

    async function status(api: IdentityApiProcess, token: string) {
      const response = await request(api, '/api/v1/account/status', token);
      expect(response.status).toBe(200);
      return accountSummarySchema.parse(await response.json());
    }

    async function expireRelay(token: string) {
      const current = (
        await database.pool.query(
          'SELECT r.* FROM relay_sessions r JOIN session s ON s.id=r.session_id WHERE s.token=$1',
          [token],
        )
      ).rows[0];
      expect(current).toBeDefined();
      const envelope = openJsonFromString<{ jwt: string; refreshToken: string }>(
        current.ciphertext,
        IDENTITY_PROCESS_KEY,
      );
      secrets.push(envelope.jwt, envelope.refreshToken);
      await database.pool.query(
        "UPDATE relay_sessions SET access_expires_at=now()-interval '1 second' WHERE session_id=$1",
        [current.session_id],
      );
      return current as { session_id: string; revision: number; ciphertext: string };
    }

    async function assertIndependentPools() {
      const rows = await database.pool.query(
        "SELECT DISTINCT application_name FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'identity-process-%' ORDER BY application_name",
      );
      expect(rows.rows.map((row) => row.application_name)).toEqual([
        'identity-process-one',
        'identity-process-two',
      ]);
    }

    it('lost normal login output keeps the committed principal and retries without another key supply', async () => {
      proxy.dropNextLoginResponse();
      await expect(loginRequest(one)).rejects.toMatchObject({ name: 'TypeError' });
      expect(proxy.observations.filter((row) => row.dropped)).toEqual([
        {
          method: 'POST',
          path: '/api/auth/sign-in/new-api',
          pid: one.pid,
          status: 200,
          dropped: true,
          forwardedResponseBytes: 0,
        },
      ]);
      const before = (
        await database.pool.query(
          'SELECT i.user_id,i.identity_version,c.credential_ref,c.credential_version,c.ciphertext FROM account_identities i JOIN account_credentials c ON c.user_id=i.user_id',
        )
      ).rows;
      expect(before).toHaveLength(1);
      const key = openJsonFromString<{ apiKey: string }>(
        before[0].ciphertext,
        IDENTITY_PROCESS_KEY,
      ).apiKey;
      secrets.push(key);
      expect(fixture.isTokenKeyActive(42, key)).toBe(true);
      expect(fixture.count({ operation: 'createToken' })).toBe(1);
      // Losing the response cannot tell the API to roll back an already committed login.
      const lost = (await database.pool.query('SELECT id,token FROM session')).rows;
      expect(lost).toHaveLength(1);
      secrets.push(lost[0].token);
      const signed = await login(two);
      expect(signed.user.id).toBe(before[0].user_id);
      const after = (
        await database.pool.query(
          'SELECT credential_ref,credential_version FROM account_credentials',
        )
      ).rows;
      expect(after).toEqual([
        {
          credential_ref: before[0].credential_ref,
          credential_version: before[0].credential_version,
        },
      ]);
      expect((await status(two, signed.token)).identity).toMatchObject({
        apiIssuer: proxy.url,
        principalId: signed.user.id,
        status: 'active',
      });
      expect(fixture.count({ operation: 'login' })).toBe(2);
      expect(fixture.count({ operation: 'createToken' })).toBe(1);
      expect(proxy.dropped).toBe(1);
      await assertIndependentPools();
    });

    it('lost recovery login output cannot become evidence for a later login on the other process', async () => {
      const principalId = randomUUID();
      await database.pool.query(
        'INSERT INTO "user" (id,name,email,new_api_user_id) VALUES ($1,$2,$2,42)',
        [principalId, 'alice'],
      );
      await database.pool.query(
        'INSERT INTO account_identities (user_id,evidence) VALUES ($1,$2)',
        [principalId, { kind: 'legacy_unverified' }],
      );
      await database.pool.query(
        'INSERT INTO prompts (id,user_id,title,content) VALUES ($1,$2,$3,$4)',
        [randomUUID(), principalId, 'Retained history', 'Isolated legacy content'],
      );
      proxy.dropNextLoginResponse();
      await expect(loginRequest(one)).rejects.toMatchObject({ name: 'TypeError' });
      const lost = (await database.pool.query('SELECT id,token FROM session')).rows;
      expect(lost).toHaveLength(1);
      secrets.push(lost[0].token);
      expect(
        (await database.pool.query('SELECT mode FROM account_session_authorizations')).rows,
      ).toEqual([{ mode: 'recovery_only' }]);
      const firstRequest = (await database.pool.query('SELECT id FROM account_recovery_requests'))
        .rows[0].id;

      const signed = await login(two);
      const summary = await status(two, signed.token);
      expect(signed.user.id).toBe(principalId);
      expect(summary.canGenerate).toBe(false);
      expect(summary.identity?.status).not.toBe('active');
      expect(summary.identity?.apiIssuer).toBe(proxy.url);
      expect(summary.recovery?.reason).toBe('legacy_evidence_missing');
      expect(summary.recovery?.requestId).not.toBe(firstRequest);
      expect((await request(one, '/api/v1/prompts', lost[0].token)).status).toBe(403);
      expect((await request(two, '/api/v1/prompts', signed.token)).status).toBe(403);
      expect(
        (await database.pool.query('SELECT mode FROM account_session_authorizations')).rows,
      ).toEqual([{ mode: 'recovery_only' }, { mode: 'recovery_only' }]);
      expect(
        (await database.pool.query('SELECT id FROM account_recovery_requests')).rows,
      ).toHaveLength(2);
      expect(
        (await database.pool.query('SELECT session_id FROM relay_sessions')).rows,
      ).toHaveLength(0);
      expect(
        (await database.pool.query('SELECT user_id FROM account_credentials')).rows,
      ).toHaveLength(0);
      expect((await database.pool.query('SELECT title FROM prompts')).rows).toEqual([
        { title: 'Retained history' },
      ]);
      expect(fixture.count({ operation: 'createToken' })).toBe(0);
      expect(fixture.count({ operation: 'login' })).toBe(2);
      expect(proxy.observations.filter((row) => row.dropped)).toMatchObject([
        { pid: one.pid, status: 200, forwardedResponseBytes: 0 },
      ]);
      await assertIndependentPools();
    });

    it('two production API PIDs share the PG refresh lease and retry the committed result', async () => {
      const signed = await login(one);
      const prior = await expireRelay(signed.token);
      const paused = fixture.pauseNext({ operation: 'refresh' }, { phase: 'after' });
      const pending = request(one, '/api/v1/account/status', signed.token);
      await paused.reached;
      try {
        const busy = await request(two, '/api/v1/account/status', signed.token);
        expect(busy.status).toBe(503);
        expect(await busy.json()).toMatchObject({
          error: { code: 'ACCOUNT_IDENTITY_UNVERIFIED', retryable: true },
        });
        expect(fixture.count({ operation: 'refresh' })).toBe(1);
        const claimed = (
          await database.pool.query('SELECT revision,refresh_lease_id FROM relay_sessions')
        ).rows[0];
        expect(claimed.revision).toBe(prior.revision + 1);
        expect(claimed.refresh_lease_id).not.toBeNull();
        await assertIndependentPools();
      } finally {
        paused.release();
      }
      const completed = await pending;
      expect(completed.status).toBe(200);
      expect(accountSummarySchema.parse(await completed.json()).identity?.status).toBe('active');
      const after = (
        await database.pool.query(
          'SELECT revision,refresh_lease_id,refresh_lease_until FROM relay_sessions',
        )
      ).rows[0];
      expect(after).toEqual({
        revision: prior.revision + 2,
        refresh_lease_id: null,
        refresh_lease_until: null,
      });
      expect((await status(two, signed.token)).identity?.apiIssuer).toBe(proxy.url);
      expect(fixture.count({ operation: 'refresh' })).toBe(1);
    });

    it('SIGKILL after refresh verification but before PG save requires explicit reauthentication on a new API PID', async () => {
      const signed = await login(one);
      const prior = await expireRelay(signed.token);
      const oldSecrets = openJsonFromString<{ jwt: string; refreshToken: string }>(
        prior.ciphertext,
        IDENTITY_PROCESS_KEY,
      );
      fixture.invalidateJwt(oldSecrets.jwt);

      async function readAuthority() {
        const [identity, credential] = await Promise.all([
          database.pool.query('SELECT * FROM account_identities WHERE user_id=$1', [
            signed.user.id,
          ]),
          database.pool.query('SELECT * FROM account_credentials WHERE user_id=$1', [
            signed.user.id,
          ]),
        ]);
        expect(identity.rows).toHaveLength(1);
        expect(credential.rows).toHaveLength(1);
        return { identity: identity.rows[0], credential: credential.rows[0] };
      }
      async function readRelay() {
        const result = await database.pool.query(
          'SELECT * FROM relay_sessions WHERE session_id=$1',
          [prior.session_id],
        );
        expect(result.rows).toHaveLength(1);
        return result.rows[0];
      }
      const authorityBefore = await readAuthority();
      const keyBefore = openJsonFromString<{ apiKey: string }>(
        authorityBefore.credential.ciphertext,
        IDENTITY_PROCESS_KEY,
      ).apiKey;
      secrets.push(keyBefore);
      const originalSelf = fixture.requests.find((entry) => entry.operation === 'getSelf');
      expect(originalSelf?.sessionNumber).toBeTypeOf('number');

      const paused = fixture.pauseNext({ operation: 'getSelf', ownerId: 42 }, { phase: 'after' });
      const pending = request(one, '/api/v1/account/status', signed.token);
      const blocker = await database.pool.connect();
      try {
        const verified = await paused.reached;
        expect(verified.status).toBe(200);
        expect(verified.sessionNumber).not.toBe(originalSelf?.sessionNumber);
        expect(fixture.requests.filter((entry) => entry.operation === 'refresh')).toMatchObject([
          { status: 200, completed: true },
        ]);
        // The HTTP reply is frozen after refresh consumed the old token. Lock
        // only after that claim committed, so the next waiter is the SAVE, not
        // the earlier lease claim. No production hook or guessed sleep is used.
        await blocker.query('BEGIN');
        const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await blocker.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [signed.user.id]);
        const claimed = await readRelay();
        expect(claimed.revision).toBe(prior.revision + 1);
        expect(claimed.ciphertext).toBe(prior.ciphertext);
        expect(claimed.refresh_lease_id).not.toBeNull();
        paused.release();

        await expect
          .poll(
            async () =>
              (
                await database.pool.query(
                  `SELECT count(*)::int AS n FROM pg_stat_activity
                   WHERE datname=current_database() AND application_name='identity-process-one'
                     AND state='active' AND wait_event_type='Lock'
                     AND query LIKE '%"user"%for update%'
                     AND $1::int = ANY(pg_blocking_pids(pid))`,
                  [blockerPid],
                )
              ).rows[0].n,
            { timeout: 10_000, interval: 25 },
          )
          .toBe(1);
        expect(await one.crash()).toEqual({ code: null, signal: 'SIGKILL' });
        expect((await pending).status).toBe(502);
        expect(await readRelay()).toEqual(claimed);
        expect(await readAuthority()).toEqual(authorityBefore);
      } finally {
        paused.release();
        await blocker.query('ROLLBACK');
        blocker.release();
      }

      const replacement = await start('replacement');
      expect([one.pid, two.pid, process.pid]).not.toContain(replacement.pid);
      const busy = await request(replacement, '/api/v1/account/status', signed.token);
      expect(busy.status).toBe(503);
      expect(await busy.json()).toMatchObject({
        error: { code: 'ACCOUNT_IDENTITY_UNVERIFIED', retryable: true },
      });
      expect(fixture.count({ operation: 'refresh' })).toBe(1);
      // Wait for the actual persisted 30-second lease to expire. Do not change
      // the clock or lease row, and do not send repeated status/refresh requests.
      await expect
        .poll(
          async () =>
            (
              await database.pool.query(
                'SELECT refresh_lease_until <= clock_timestamp() AS expired FROM relay_sessions WHERE session_id=$1',
                [prior.session_id],
              )
            ).rows[0].expired,
          { timeout: 35_000, interval: 100 },
        )
        .toBe(true);
      const expired = await request(replacement, '/api/v1/account/status', signed.token);
      expect(expired.status).toBe(401);
      expect(await expired.json()).toMatchObject({
        error: { code: 'AUTH_SESSION_EXPIRED', retryable: false },
      });
      expect(fixture.requests.filter((entry) => entry.operation === 'refresh')).toMatchObject([
        { status: 200, completed: true },
        { status: 401, completed: true },
      ]);
      // Managed expiry retires local execution authority immediately; its
      // encrypted release obligation survives the session/relay cascade.
      const assertRetired = async () => {
        for (const [table, column] of [
          ['session', 'id'],
          ['relay_sessions', 'session_id'],
          ['account_session_authorizations', 'session_id'],
        ]) {
          expect(
            (
              await database.pool.query(`SELECT ${column} FROM ${table} WHERE ${column}=$1`, [
                prior.session_id,
              ])
            ).rows,
          ).toHaveLength(0);
        }
        const obligations = await database.pool.query(
          'SELECT state FROM login_session_releases WHERE session_id=$1',
          [prior.session_id],
        );
        expect(obligations.rows).toHaveLength(1);
        expect(['pending', 'released']).toContain(obligations.rows[0].state);
      };
      await assertRetired();
      expect(await readAuthority()).toEqual(authorityBefore);

      const fresh = await login(replacement);
      expect(fresh.user.id).toBe(signed.user.id);
      const recovered = await status(replacement, fresh.token);
      expect(recovered.identity).toMatchObject({
        apiIssuer: proxy.url,
        principalId: signed.user.id,
        status: 'active',
      });
      expect(recovered.canGenerate).toBe(true);
      const authorityAfter = await readAuthority();
      expect(authorityAfter.credential).toMatchObject({
        credential_ref: authorityBefore.credential.credential_ref,
        credential_version: authorityBefore.credential.credential_version,
        upstream_issuer: fixture.baseUrl,
        upstream_owner_id: '42',
      });
      expect(
        openJsonFromString<{ apiKey: string }>(
          authorityAfter.credential.ciphertext,
          IDENTITY_PROCESS_KEY,
        ).apiKey === keyBefore,
      ).toBe(true);
      expect(fixture.isTokenKeyActive(42, keyBefore)).toBe(true);
      expect(fixture.count({ operation: 'createToken' })).toBe(1);
      await assertRetired();

      // A dead managed session cannot obtain even metadata authorization,
      // and retrying it must not refresh or resurrect its consumed credential.
      const oldBinding = await request(
        replacement,
        '/api/v1/account/execution-binding',
        signed.token,
      );
      expect(oldBinding.status).toBe(401);
      expect(await oldBinding.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
      const oldStatus = await request(replacement, '/api/v1/account/status', signed.token);
      expect(oldStatus.status).toBe(401);
      expect(await oldStatus.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
      expect(fixture.count({ operation: 'refresh' })).toBe(2);
      await assertRetired();

      const logout = await request(replacement, '/api/auth/sign-out', signed.token, {});
      expect(logout.status).toBe(200);
      for (const [table, column] of [
        ['session', 'id'],
        ['relay_sessions', 'session_id'],
        ['account_session_authorizations', 'session_id'],
      ]) {
        expect(
          (
            await database.pool.query(`SELECT ${column} FROM ${table} WHERE ${column}=$1`, [
              prior.session_id,
            ])
          ).rows,
        ).toHaveLength(0);
      }
      expect((await request(replacement, '/api/v1/account/status', signed.token)).status).toBe(401);
      expect((await status(replacement, fresh.token)).identity?.principalId).toBe(signed.user.id);
      expect(fixture.count({ operation: 'refresh' })).toBe(2);
    }, 90_000);

    it('logout on a second production API PID wins against a late refreshed JWT', async () => {
      const signed = await login(one);
      await expireRelay(signed.token);
      const paused = fixture.pauseNext({ operation: 'refresh' }, { phase: 'after' });
      const pending = request(one, '/api/v1/account/status', signed.token);
      await paused.reached;
      try {
        const loggedOut = await request(two, '/api/auth/sign-out', signed.token, {});
        expect(loggedOut.status).toBe(200);
        expect((await database.pool.query('SELECT id FROM session')).rows).toHaveLength(0);
        expect(
          (await database.pool.query('SELECT session_id FROM relay_sessions')).rows,
        ).toHaveLength(0);
        await assertIndependentPools();
      } finally {
        paused.release();
      }
      const late = await pending;
      expect(late.status).toBe(401);
      expect(await late.json()).toMatchObject({ error: { code: 'AUTH_SESSION_EXPIRED' } });
      for (const api of [one, two]) {
        expect((await request(api, '/api/v1/account/status', signed.token)).status).toBe(401);
      }
      expect((await database.pool.query('SELECT id FROM session')).rows).toHaveLength(0);
      expect(
        (await database.pool.query('SELECT session_id FROM relay_sessions')).rows,
      ).toHaveLength(0);
      expect(
        (await database.pool.query('SELECT session_id FROM account_session_authorizations')).rows,
      ).toHaveLength(0);
      expect(fixture.count({ operation: 'refresh' })).toBe(1);
    });
  },
);
