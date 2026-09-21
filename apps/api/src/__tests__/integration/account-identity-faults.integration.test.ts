import { createHash } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import { openJsonFromString } from '@musefold/server-crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { loadEnv } from '../../env.js';
import { AccountService } from '../../modules/account/service.js';
import { startNewApiIdentityFixture } from '../fixtures/new-api-identity-fixture.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const API = 'http://127.0.0.1:8787';
const KEY = 'synthetic-identity-fault-encryption';
const COMMIT_CANARY = 'synthetic-sensitive-commit-canary';
const COOKIE_CANARY = 'synthetic-sensitive-cookie-path-canary';
type CommitInput = Parameters<AccountService['commitLogin']>[0];

describeDb('account identity commit and cookie faults (real HTTP + PG + BA)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let fixture: Awaited<ReturnType<typeof startNewApiIdentityFixture>>;
  let logCalls: unknown[][];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 8 });
    await migrateDatabase(database.db);
  }, 120_000);
  beforeEach(async () => {
    await database.pool.query('TRUNCATE "user" CASCADE');
    fixture = await startNewApiIdentityFixture();
    fixture.addOwner({ id: 42, username: 'alice' });
    fixture.mapUsername('alice', 42);
    logCalls = [];
    for (const method of ['error', 'warn', 'log'] as const)
      vi.spyOn(console, method).mockImplementation((...args) => {
        logCalls.push(args);
      });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await database.pool.query(`
      DROP TRIGGER IF EXISTS identity_commit_fault ON account_session_authorizations;
      DROP FUNCTION IF EXISTS identity_commit_fault();
      DROP TABLE IF EXISTS identity_fault_target;
      DROP SEQUENCE IF EXISTS identity_commit_fault_hits;
    `);
    await fixture.close();
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  function system(
    observers: {
      beforeCommit?: (input: CommitInput) => Promise<void>;
      afterCommit?: (input: CommitInput) => Promise<void>;
    } = {},
  ) {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      PUBLIC_BASE_URL: API,
      BETTER_AUTH_SECRET: 'synthetic-identity-fault-auth-secret',
      NEW_API_BASE_URL: fixture.baseUrl,
      CREDENTIAL_ENCRYPTION_KEY: KEY,
    });
    const account = new AccountService({
      db: database.db,
      newApi: createNewApiClient(fixture.baseUrl),
      encryptionKey: KEY,
      apiIssuer: API,
      upstreamIssuer: fixture.baseUrl,
      legacyTrustedIssuer: fixture.baseUrl,
    });
    const attempts: { input: CommitInput; token: string; committed: boolean }[] = [];
    const auth = createAuth({
      env,
      db: database.db,
      newApi: createNewApiClient(fixture.baseUrl),
      hooks: {
        prepareLogin: (input) => account.prepareLogin(input),
        async commitLogin(input) {
          const row = await database.pool.query('SELECT token FROM session WHERE id = $1', [
            input.sessionId,
          ]);
          const attempt = { input, token: row.rows[0].token as string, committed: false };
          attempts.push(attempt);
          await observers.beforeCommit?.(input);
          // The observers only record/install a fault. The actual service and transaction run.
          await account.commitLogin(input);
          attempt.committed = true;
          await observers.afterCommit?.(input);
        },
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    return { auth, account, attempts };
  }

  async function login(sys: ReturnType<typeof system>) {
    const response = await sys.auth.handler(
      new Request(`${API}/api/auth/sign-in/new-api`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'alice', password: 'fixture-password' }),
      }),
    );
    const text = await response.text();
    const body = JSON.parse(text) as { token?: string; user?: { id: string }; code?: string };
    return { response, body, wire: `${JSON.stringify([...response.headers])}\n${text}` };
  }

  async function snapshot(userId: string) {
    const tables = [
      'account_identities',
      'account_credentials',
      'relay_sessions',
      'account_session_authorizations',
      'session',
    ] as const;
    const entries = await Promise.all(
      tables.map(async (table) => {
        // Table names are fixed above, never supplied by a request.
        const rows = await database.pool.query(
          `SELECT to_jsonb(t) AS row FROM ${table} t WHERE user_id = $1 ORDER BY to_jsonb(t)::text`,
          [userId],
        );
        return [table, rows.rows.map((row) => row.row)] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  function fingerprint(value: unknown) {
    // A failed equality assertion must not print bearer tokens or encrypted envelopes.
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  function assertRedacted(
    result: Awaited<ReturnType<typeof login>>,
    attempt: ReturnType<typeof system>['attempts'][number],
    extraSecrets: string[] = [],
  ) {
    const output = `${result.wire}\n${JSON.stringify(logCalls)}`;
    for (const secret of [
      COMMIT_CANARY,
      COOKIE_CANARY,
      attempt.token,
      attempt.input.prepared.relay.jwt,
      attempt.input.prepared.relay.refreshToken,
      attempt.input.prepared.key?.key,
      ...extraSecrets,
    ]) {
      if (secret) expect(output.includes(secret)).toBe(false);
    }
    expect(result.body.token).toBeUndefined();
    expect(result.response.headers.get('set-cookie')).toBeNull();
  }

  async function installCommitFault(input: CommitInput) {
    await database.pool.query(`
      CREATE TABLE identity_fault_target (
        user_id text NOT NULL, session_id text NOT NULL,
        identity_version integer NOT NULL, credential_version integer NOT NULL
      );
      CREATE SEQUENCE identity_commit_fault_hits;
      CREATE FUNCTION identity_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM identity_fault_target f
          WHERE f.user_id = NEW.user_id AND f.session_id = NEW.session_id
        ) THEN
          -- A nontransactional sequence records that COMMIT saw every pending write.
          -- No hook throws and no immediate INSERT/UPDATE failure can satisfy this witness.
          IF lower(trim(current_query())) <> 'commit' OR NOT EXISTS (
            SELECT 1 FROM identity_fault_target f
            JOIN account_identities i ON i.user_id = f.user_id
            JOIN account_credentials c ON c.user_id = f.user_id AND c.provider = 'new-api'
            JOIN relay_sessions r ON r.session_id = f.session_id AND r.user_id = f.user_id
            JOIN account_session_authorizations a
              ON a.session_id = f.session_id AND a.user_id = f.user_id
            WHERE f.session_id = NEW.session_id
              AND i.status = 'active' AND i.identity_version = f.identity_version
              AND c.status = 'active' AND c.credential_version = f.credential_version
              AND r.upstream_owner_id = '42' AND a.mode = 'normal'
          ) THEN
            RAISE EXCEPTION 'Commit fault reached an unexpected phase or incomplete state';
          END IF;
          PERFORM nextval('identity_commit_fault_hits');
          RAISE EXCEPTION '${COMMIT_CANARY}';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE CONSTRAINT TRIGGER identity_commit_fault
        AFTER INSERT OR UPDATE ON account_session_authorizations
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION identity_commit_fault();
    `);
    await database.pool.query('INSERT INTO identity_fault_target VALUES ($1,$2,$3,$4)', [
      input.prepared.userId,
      input.sessionId,
      input.prepared.identity.identityVersion + 1,
      (input.prepared.credential?.credentialVersion ?? 0) + 1,
    ]);
    const trigger = await database.pool.query(
      "SELECT tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = 'identity_commit_fault'",
    );
    expect(trigger.rows).toEqual([{ tgdeferrable: true, tginitdeferred: true }]);
  }

  async function expectCommitWitness() {
    const witness = await database.pool.query(
      'SELECT last_value::int, is_called FROM identity_commit_fault_hits',
    );
    expect(witness.rows).toEqual([{ last_value: 1, is_called: true }]);
  }

  it('real deferred COMMIT failure rolls back activation and compensates only the new session', async () => {
    const healthy = system();
    const original = await login(healthy);
    expect(original.response.status).toBe(200);
    const originalAttempt = healthy.attempts[0];
    const userId = originalAttempt.input.prepared.userId;
    const before = await snapshot(userId);
    const priorKey = openJsonFromString<{ apiKey: string }>(
      before.account_credentials[0].ciphertext,
      KEY,
    ).apiKey;
    const rotated = fixture.rotateToken(
      42,
      Number(before.account_credentials[0].external_token_id),
    );
    const failing = system({ beforeCommit: installCommitFault });
    const result = await login(failing);
    expect(result.response.status).toBe(502);
    expect(failing.attempts[0].committed).toBe(false);
    await expectCommitWitness();
    expect(fingerprint(await snapshot(userId))).toBe(fingerprint(before));
    await expect(
      healthy.account.assertSessionAuthorization(originalAttempt.input.sessionId, userId),
    ).resolves.toBeUndefined();
    expect(
      (await healthy.account.getStatus(originalAttempt.input.sessionId)).identity?.status,
    ).toBe('active');
    assertRedacted(result, failing.attempts[0], [priorKey, original.body.token ?? '']);
    // Local rollback cannot undo an upstream token rotation or supply operation.
    expect(fixture.isTokenKeyActive(42, rotated.key)).toBe(true);
    expect(fixture.count({ operation: 'createToken', ownerId: 42 })).toBe(1);
  });

  it('fresh-principal COMMIT failure leaves only the separately prepared pending shell', async () => {
    let preparedState: Awaited<ReturnType<typeof snapshot>> | undefined;
    const failing = system({
      async beforeCommit(input) {
        preparedState = await snapshot(input.prepared.userId);
        await installCommitFault(input);
      },
    });
    const result = await login(failing);
    expect(result.response.status).toBe(502);
    const attempt = failing.attempts[0];
    expect(attempt.committed).toBe(false);
    await expectCommitWitness();
    const state = await snapshot(attempt.input.prepared.userId);
    expect(state.account_identities).toHaveLength(1);
    expect(state.account_identities[0]).toMatchObject({
      status: 'verification_pending',
      identity_version: 0,
      api_issuer: API,
      upstream_issuer: fixture.baseUrl,
      upstream_owner_id: '42',
      evidence: { kind: 'fresh_principal' },
    });
    expect(fingerprint(state.account_identities)).toBe(
      fingerprint(preparedState?.account_identities),
    );
    for (const table of [
      'account_credentials',
      'relay_sessions',
      'account_session_authorizations',
      'session',
    ])
      expect(state[table]).toHaveLength(0);
    const users = await database.pool.query('SELECT id FROM "user"');
    expect(users.rows).toEqual([{ id: attempt.input.prepared.userId }]);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM account_recovery_requests')).rows,
    ).toEqual([{ n: 0 }]);
    expect(fixture.count({ operation: 'createToken', ownerId: 42 })).toBe(1);
    expect(fixture.isTokenKeyActive(42, attempt.input.prepared.key?.key ?? '')).toBe(true);
    assertRedacted(result, attempt);
  });

  it('real cookie header construction failure compensates its committed session without changing other auth instances', async () => {
    const healthy = system();
    const original = await login(healthy);
    expect(original.response.status).toBe(200);
    const originalAttempt = healthy.attempts[0];
    const userId = originalAttempt.input.prepared.userId;
    const before = await snapshot(userId);
    let committedState: Awaited<ReturnType<typeof snapshot>> | undefined;
    const failing = system({
      async afterCommit(input) {
        // A separate pool query sees only committed rows, before setSessionCookie runs.
        committedState = await snapshot(input.prepared.userId);
      },
    });
    const healthyContext = await healthy.auth.$context;
    const failingContext = await failing.auth.$context;
    const attributes = failingContext.authCookies.sessionToken.attributes;
    const originalPath = attributes.path;
    expect(attributes).not.toBe(healthyContext.authCookies.sessionToken.attributes);
    try {
      // Instance-local malformed server config reaches real signed-cookie serialization and
      // native Headers.append rejection. No cookie-module or Headers prototype replacement.
      attributes.path = `/\n${COOKIE_CANARY}`;
      const result = await login(failing);
      expect(result.response.status).toBe(502);
      const attempt = failing.attempts[0];
      expect(attempt.committed).toBe(true);
      expect(committedState?.session).toHaveLength(2);
      expect(committedState?.relay_sessions).toHaveLength(2);
      expect(committedState?.account_session_authorizations).toHaveLength(2);
      expect(committedState?.account_identities[0].identity_version).toBe(
        before.account_identities[0].identity_version + 1,
      );
      const after = await snapshot(userId);
      for (const table of ['session', 'relay_sessions', 'account_session_authorizations'])
        expect(fingerprint(after[table])).toBe(fingerprint(before[table]));
      // Cookie failure happens after COMMIT: identity/credential writes remain committed.
      for (const table of ['account_identities', 'account_credentials'])
        expect(fingerprint(after[table])).toBe(fingerprint(committedState?.[table]));
      expect(after.account_credentials[0]).toMatchObject({
        credential_ref: before.account_credentials[0].credential_ref,
        credential_version: before.account_credentials[0].credential_version,
        external_token_id: before.account_credentials[0].external_token_id,
      });
      const oldKey = openJsonFromString<{ apiKey: string }>(
        before.account_credentials[0].ciphertext,
        KEY,
      ).apiKey;
      const currentKey = openJsonFromString<{ apiKey: string }>(
        after.account_credentials[0].ciphertext,
        KEY,
      ).apiKey;
      expect(currentKey === oldKey).toBe(true);
      expect(fixture.isTokenKeyActive(42, oldKey)).toBe(true);
      assertRedacted(result, attempt, [oldKey, original.body.token ?? '']);
      await expect(
        healthy.account.assertSessionAuthorization(originalAttempt.input.sessionId, userId),
      ).resolves.toBeUndefined();
      const unaffected = await login(healthy);
      expect(unaffected.response.status).toBe(200);
      expect(unaffected.body.user?.id).toBe(userId);
      expect(unaffected.response.headers.has('set-cookie')).toBe(true);
      expect(healthyContext.authCookies.sessionToken.attributes.path).toBe(originalPath);
    } finally {
      attributes.path = originalPath;
    }
    const retried = await login(failing);
    expect(retried.response.status).toBe(200);
    expect(retried.body.user?.id).toBe(userId);
    expect(retried.response.headers.has('set-cookie')).toBe(true);
    expect(fixture.count({ operation: 'createToken', ownerId: 42 })).toBe(1);
  });
});
