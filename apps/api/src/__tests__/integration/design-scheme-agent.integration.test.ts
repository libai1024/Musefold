import { createHmac, randomUUID } from 'node:crypto';
import {
  designSchemeAgentSessionSchema,
  designSchemeAgentEventPageSchema,
  designSchemeAgentHistoryPageSchema,
} from '@musefold/contracts';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { makeWorkerUtils } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '../../auth/index.js';
import { type AuthedEnv, requireSession } from '../../auth/middleware.js';
import { loadEnv } from '../../env.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { AccountService } from '../../modules/account/service.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { DesignSchemeSourcePreparationService } from '../../modules/design-schemes/source-preparation.js';
import { DesignSchemeAgentService } from '../../modules/design-scheme-agent/service.js';
import { designSchemeAgentRoutes } from '../../modules/design-scheme-agent/routes.js';
import { startDesignSchemeAgentWorker } from '../../modules/design-scheme-agent/worker.js';
import { sourceGithubFixture } from '../fixtures/source-github.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const owner = 'agent-owner';
const secondOwner = 'agent-other';
const token = randomUUID();
const otherToken = randomUUID();
const prefix = '/design-schemes/agent';
const repo = 'https://github.com/example/design';
function request(sources: string[] = [repo]) {
  return {
    operation: 'create' as const,
    input: {
      executionId: randomUUID(),
      brief: 'Synthetic design brief',
      sourceUris: sources,
      sourceBindings: [],
      sourceAssetIds: [],
    },
  };
}

describeDb('cloud Agent sessions (real auth, PG, Graphile and source HTTP/S3)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let auth: ReturnType<typeof createAuth>;
  let account: AccountService;
  let github: Awaited<ReturnType<typeof sourceGithubFixture>>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let service: DesignSchemeAgentService;
  let app: OpenAPIHono<AuthedEnv>;
  let runner: Awaited<ReturnType<typeof startDesignSchemeAgentWorker>> | undefined;
  const root = fileURLToPath(new URL('../../../../..', import.meta.url));
  // Better Auth deletes an expired session on read, cascading its authorization row.
  async function restoreOwnerSession() {
    await database.pool.query(
      `INSERT INTO session(id,token,user_id,expires_at) VALUES($1,$2,$1,now()+interval '1 hour')
       ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at`,
      [owner, token],
    );
    await database.pool.query(
      `INSERT INTO account_session_authorizations(session_id,user_id,mode) VALUES($1,$1,'normal')
       ON CONFLICT(session_id) DO UPDATE SET mode='normal'`,
      [owner],
    );
    await database.pool.query("UPDATE account_identities SET status='active' WHERE user_id=$1", [
      owner,
    ]);
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 12 });
    const migrationFolder = await mkdtemp(join(tmpdir(), 'musefold-agent-upgrade-'));
    try {
      await cp(join(root, 'packages/db/migrations'), migrationFolder, { recursive: true });
      const journalPath = join(migrationFolder, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8'));
      const entries = [...journal.entries];
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 14);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(database.db, { migrationsFolder: migrationFolder });
      await database.pool.query(
        "INSERT INTO \"user\" (id,name,email) VALUES('agent-legacy','legacy','agent-legacy@example.test')",
      );
      await database.pool.query(
        "INSERT INTO design_scheme_source_preparations(user_id,execution_id,confirmation_id,request_hash,request,status,expires_at) VALUES('agent-legacy','old-source','old-confirm',repeat('a',64),'{}','failed',now())",
      );
      journal.entries = entries.filter((entry: { idx: number }) => entry.idx < 22);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(database.db, { migrationsFolder: migrationFolder });
      for (const [id, view] of [
        ['original-time', { status: 'cancelled', createdAt: '2026-09-01T00:00:00.000Z' }],
        ['legacy-time', { status: 'cancelled' }],
      ]) {
        await database.pool.query(
          `INSERT INTO design_scheme_agent_sessions
           (user_id,execution_id,source_execution_ids,view,expires_at,updated_at)
           VALUES('agent-legacy',$1,'[]',$2,now(),'2026-09-02T00:00:00Z')`,
          [id, JSON.stringify(view)],
        );
      }
      await promisify(execFile)('pnpm', ['run', 'db:migrate'], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      });
      expect(
        (
          await database.pool.query(
            "SELECT status FROM design_scheme_source_preparations WHERE execution_id='old-source'",
          )
        ).rows[0].status,
      ).toBe('failed');
      const migrated = await database.pool.query(
        "SELECT execution_id,created_at,updated_at,view FROM design_scheme_agent_sessions WHERE user_id='agent-legacy' ORDER BY execution_id",
      );
      expect(migrated.rows.map((row) => row.created_at.toISOString())).toEqual([
        '2026-09-02T00:00:00.000Z',
        '2026-09-01T00:00:00.000Z',
      ]);
      expect(migrated.rows.map((row) => row.view)).toEqual([
        { status: 'cancelled' },
        { status: 'cancelled', createdAt: '2026-09-01T00:00:00.000Z' },
      ]);
      expect(
        (
          await database.pool.query(
            "SELECT indexname FROM pg_indexes WHERE indexname='scheme_agent_history_idx'",
          )
        ).rowCount,
      ).toBe(1);
      await promisify(execFile)('pnpm', ['run', 'db:migrate'], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      });
      expect(
        (
          await database.pool.query(
            "SELECT execution_id,created_at,updated_at,view FROM design_scheme_agent_sessions WHERE user_id='agent-legacy' ORDER BY execution_id",
          )
        ).rows,
      ).toEqual(migrated.rows);
    } finally {
      await rm(migrationFolder, { recursive: true, force: true });
    }
    const utils = await makeWorkerUtils({ pgPool: database.pool });
    await utils.migrate();
    await utils.release();
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      BETTER_AUTH_SECRET: 'agent-auth-fixture-secret',
      NEW_API_BASE_URL: 'https://account.invalid',
      CREDENTIAL_ENCRYPTION_KEY: 'agent-fixture-encryption-key',
    });
    const newApi = createNewApiClient(env.NEW_API_BASE_URL, {
      fetchImpl: async () => {
        throw new Error('Unexpected upstream account request');
      },
    });
    account = new AccountService({
      db: database.db,
      newApi,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      apiIssuer: env.PUBLIC_BASE_URL,
      upstreamIssuer: env.NEW_API_BASE_URL,
    });
    auth = createAuth({
      env,
      db: database.db,
      newApi,
      hooks: {
        async prepareLogin() {
          throw new Error('No login fixture');
        },
        async commitLogin() {
          throw new Error('No login fixture');
        },
        assertSessionAuthorization: (...input) => account.assertSessionAuthorization(...input),
      },
    });
    for (const [userId, bearer] of [
      [owner, token],
      [secondOwner, otherToken],
    ]) {
      await database.pool.query('INSERT INTO "user" (id,name,email) VALUES($1,$1,$2)', [
        userId,
        `${userId}@example.test`,
      ]);
      await database.pool.query(
        "INSERT INTO account_identities(user_id,api_issuer,upstream_issuer,upstream_owner_id,status,verified_at) VALUES($1,$2,$3,$1,'active',now())",
        [userId, env.PUBLIC_BASE_URL, env.NEW_API_BASE_URL],
      );
      await database.pool.query(
        "INSERT INTO session(id,token,user_id,expires_at) VALUES($1,$2,$1,now()+interval '1 hour')",
        [userId, bearer],
      );
      await database.pool.query(
        "INSERT INTO account_session_authorizations(session_id,user_id,mode) VALUES($1,$1,'normal')",
        [userId],
      );
    }
  }, 120_000);
  beforeEach(async () => {
    await restoreOwnerSession();
    github = await sourceGithubFixture();
    s3 = await startS3Fixture();
    service = new DesignSchemeAgentService(
      database.db,
      new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader),
    );
    await database.pool.query('DELETE FROM design_scheme_agent_sessions');
    await database.pool.query('DELETE FROM rate_limit_buckets');
    await database.pool.query('DELETE FROM graphile_worker._private_jobs');
    app = new OpenAPIHono<AuthedEnv>();
    app.use('*', requireSession(auth, ['http://localhost:8787'], account));
    app.onError((error, c) => {
      if (error instanceof AppError)
        return c.json(toErrorBody(error, 'agent-test'), error.status as 400);
      throw error;
    });
    app.route(
      '/',
      designSchemeAgentRoutes(service, new RateLimiter(database.db, 'agent-fixture-rate-secret')),
    );
  });
  afterEach(async () => {
    await runner?.stop();
    runner = undefined;
    s3.storage.destroy();
    await github.close();
    await s3.close();
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  const post = (path: string, body: unknown, bearer: string | null = token) =>
    app.request(`${prefix}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const get = (id: string, bearer = token, suffix = '') =>
    app.request(`${prefix}/executions/${id}${suffix}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
  const state = async (id: string) =>
    designSchemeAgentSessionSchema.parse(await (await get(id)).json());
  const history = (query = '', bearer: string | null = token) =>
    app.request(`${prefix}/executions${query}`, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });
  async function waitStatus(id: string, status: string) {
    await expect.poll(async () => (await state(id)).status, { timeout: 20_000 }).toBe(status);
    return state(id);
  }

  it('discovers an accepted start after its reply is lost, without creating a second execution or job', async () => {
    const input = request([]);
    expect((await post('/executions', input)).status).toBe(202);
    const response = await history();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const page = designSchemeAgentHistoryPageSchema.parse(await response.json());
    expect(page).toMatchObject({
      items: [
        {
          executionId: input.input.executionId,
          status: 'queued',
          version: 1,
          schemeId: null,
          schemeName: null,
        },
      ],
      nextCursor: null,
    });
    expect(page.items).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain(input.input.brief);
    const original = await state(page.items[0].executionId);
    expect(await (await post('/executions', input)).json()).toEqual(original);
    for (const table of [
      'design_scheme_agent_sessions',
      'design_scheme_agent_events',
      'graphile_worker._private_jobs',
    ]) {
      expect((await database.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(
        1,
      );
    }
    expect(github.requests).toHaveLength(0);
    expect(s3.writes).toHaveLength(0);
  });

  it('paginates immutable creation time with microsecond ties despite updates and new executions', async () => {
    for (const [id, micros] of [
      ['history-z', '3'],
      ['history-y', '2'],
      ['history-x', '2'],
      ['history-w', '1'],
    ]) {
      expect((await post('/cancel', { executionId: id })).status).toBe(200);
      await database.pool.query(
        'UPDATE design_scheme_agent_sessions SET created_at=$1 WHERE user_id=$2 AND execution_id=$3',
        [`2026-09-01T00:00:00.00000${micros}Z`, owner, id],
      );
    }
    await post('/cancel', { executionId: 'foreign-history' }, otherToken);
    let page = designSchemeAgentHistoryPageSchema.parse(await (await history('?limit=1')).json());
    expect(page.items.map((item) => item.executionId)).toEqual(['history-z']);
    await database.pool.query(
      "UPDATE design_scheme_agent_sessions SET updated_at=now(),view=jsonb_set(view,'{version}','2') WHERE user_id=$1 AND execution_id='history-w'",
      [owner],
    );
    await post('/cancel', { executionId: 'new-history' });
    const seen = page.items.map((item) => item.executionId);
    while (page.nextCursor) {
      page = designSchemeAgentHistoryPageSchema.parse(
        await (await history(`?limit=1&cursor=${page.nextCursor}`)).json(),
      );
      seen.push(...page.items.map((item) => item.executionId));
      expect(seen.length).toBeLessThanOrEqual(4);
    }
    expect(seen).toEqual(['history-z', 'history-y', 'history-x', 'history-w']);
    expect(page.items[0].version).toBe(2);
    for (const cursor of ['foreign-history', 'missing-history']) {
      expect((await history(`?cursor=${cursor}`)).status).toBe(400);
    }
    expect((await history('?limit=51')).status).toBe(400);
    await database.pool.query(
      "DELETE FROM design_scheme_agent_sessions WHERE execution_id='history-z'",
    );
    expect((await history('?cursor=history-z')).status).toBe(400);
  });

  it('lists persisted expired candidates without mutating state, events, jobs, or source IO', async () => {
    const input = request([]);
    await post('/executions', input);
    await database.pool.query(
      "UPDATE design_scheme_agent_sessions SET expires_at=now()-interval '1 minute' WHERE execution_id=$1",
      [input.input.executionId],
    );
    const snapshot = async () =>
      Promise.all([
        database.pool.query('SELECT * FROM design_scheme_agent_sessions'),
        database.pool.query('SELECT * FROM design_scheme_agent_events'),
        database.pool.query('SELECT * FROM graphile_worker._private_jobs'),
      ]).then((results) => results.map((result) => result.rows));
    const before = await snapshot();
    const page = designSchemeAgentHistoryPageSchema.parse(await (await history()).json());
    expect(page.items[0]).toMatchObject({ status: 'queued', version: 1 });
    expect(Date.parse(page.items[0].expiresAt)).toBeLessThan(Date.now());
    expect(await snapshot()).toEqual(before);
    expect(github.requests).toHaveLength(0);
    expect(s3.writes).toHaveLength(0);
    expect(await state(input.input.executionId)).toMatchObject({ status: 'expired', version: 2 });
  });

  it('requires a current normal owner session again inside history transactions', async () => {
    await post('/cancel', { executionId: 'private-history' });
    expect((await history('', null)).status).toBe(401);
    expect(
      designSchemeAgentHistoryPageSchema.parse(await (await history('', otherToken)).json()).items,
    ).toEqual([]);
    await expect(service.list(owner, secondOwner, { limit: 20 })).rejects.toMatchObject({
      status: 401,
    });
    for (const mutate of [
      "UPDATE account_session_authorizations SET mode='recovery_only' WHERE user_id=$1",
      "UPDATE session SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      "UPDATE account_identities SET status='unverified' WHERE user_id=$1",
    ]) {
      try {
        await database.pool.query(mutate, [owner]);
        await expect(service.list(owner, owner, { limit: 20 })).rejects.toMatchObject({
          status: 401,
        });
        expect((await history()).status).toBeGreaterThanOrEqual(400);
      } finally {
        await restoreOwnerSession();
      }
    }
    expect((await history()).status).toBe(200);
  });

  it('allows a new normal session to discover the original execution without restoring spend authority', async () => {
    const input = request([]);
    await post('/executions', input);
    const newSession = randomUUID();
    const newToken = randomUUID();
    await database.pool.query(
      "INSERT INTO session(id,token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [newSession, newToken, owner],
    );
    await database.pool.query(
      "INSERT INTO account_session_authorizations(session_id,user_id,mode) VALUES($1,$2,'normal')",
      [newSession, owner],
    );
    try {
      await database.pool.query(
        "UPDATE session SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [owner],
      );
      expect((await history()).status).toBe(401);
      const page = designSchemeAgentHistoryPageSchema.parse(
        await (await history('', newToken)).json(),
      );
      expect(page.items.map((item) => item.executionId)).toEqual([input.input.executionId]);
      expect(Object.keys(page.items[0]).sort()).toEqual([
        'createdAt',
        'executionId',
        'expiresAt',
        'operation',
        'schemeId',
        'schemeName',
        'status',
        'version',
      ]);
      expect(github.requests).toHaveLength(0);
      expect(s3.writes).toHaveLength(0);
    } finally {
      await database.pool.query('DELETE FROM session WHERE id=$1', [newSession]);
      await restoreOwnerSession();
    }
  });

  it('projects only owner-visible current names and never private request or foreign scheme content', async () => {
    const localScheme = randomUUID();
    const foreignScheme = randomUUID();
    for (const [id, userId, name] of [
      [localScheme, owner, 'Owner current name'],
      [foreignScheme, secondOwner, 'Foreign secret name'],
    ]) {
      await database.pool.query(
        `INSERT INTO design_schemes(id,user_id,name,source_presentation,current_revision_id,fidelity)
         VALUES($1,$2,$3,'musefold-created',$4,'adapted')`,
        [id, userId, name, randomUUID()],
      );
    }
    try {
      // Projection fixtures intentionally seed private storage; this does not claim a model-created draft.
      for (const [id, target] of [
        ['own-target', localScheme],
        ['foreign-target', foreignScheme],
      ]) {
        await post('/cancel', { executionId: id, operation: 'modify' });
        await database.pool.query(
          `UPDATE design_scheme_agent_sessions SET request_hash=repeat('a',64),request=$1,
           materials='{"private":"private material fixture"}',update_context='{"private":"private update fixture"}'
           WHERE user_id=$2 AND execution_id=$3`,
          [
            JSON.stringify({
              operation: 'modify',
              input: { schemeId: target, brief: 'Private request fixture' },
            }),
            owner,
            id,
          ],
        );
      }
      const page = designSchemeAgentHistoryPageSchema.parse(await (await history()).json());
      expect(page.items.find((item) => item.executionId === 'own-target')).toMatchObject({
        schemeId: localScheme,
        schemeName: 'Owner current name',
      });
      expect(page.items.find((item) => item.executionId === 'foreign-target')).toMatchObject({
        schemeId: foreignScheme,
        schemeName: null,
      });
      expect(JSON.stringify(page)).not.toMatch(
        /Foreign secret|Private request|private material|private update/,
      );
      await database.pool.query('UPDATE design_schemes SET deleted_at=now() WHERE id=$1', [
        localScheme,
      ]);
      const deleted = designSchemeAgentHistoryPageSchema.parse(await (await history()).json());
      expect(deleted.items.find((item) => item.executionId === 'own-target')).toMatchObject({
        schemeId: localScheme,
        schemeName: null,
      });
      expect(github.requests).toHaveLength(0);
      expect(s3.writes).toHaveLength(0);
    } finally {
      await database.pool.query('DELETE FROM design_schemes WHERE id=ANY($1::text[])', [
        [localScheme, foreignScheme],
      ]);
    }
  });

  it('commits queued children and job with the accepted session; duplicate/conflicting start is durable', async () => {
    const input = request();
    const responses = await Promise.all([post('/executions', input), post('/executions', input)]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    const views = await Promise.all(responses.map((r) => r.json()));
    expect(views[0]).toEqual(views[1]);
    expect(views[0]).toMatchObject({ status: 'queued', version: 1, result: null });
    expect(github.requests).toHaveLength(0);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM graphile_worker._private_jobs'))
        .rows[0].n,
    ).toBe(1);
    const rows = (
      await database.pool.query(
        'SELECT source_execution_ids FROM design_scheme_agent_sessions WHERE execution_id=$1',
        [input.input.executionId],
      )
    ).rows;
    expect(
      (
        await database.pool.query(
          'SELECT status FROM design_scheme_source_preparations WHERE execution_id=$1',
          [rows[0].source_execution_ids[0]],
        )
      ).rows[0].status,
    ).toBe('queued');
    expect(
      (await post('/executions', { ...input, input: { ...input.input, brief: 'changed' } })).status,
    ).toBe(409);
  });

  it('rolls back session, child identity and event if enqueue fails', async () => {
    const input = request();
    await database.pool.query(
      "CREATE FUNCTION reject_agent_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic enqueue failure'; END $$",
    );
    await database.pool.query(
      'CREATE TRIGGER reject_agent_job BEFORE INSERT ON graphile_worker._private_jobs FOR EACH ROW EXECUTE FUNCTION reject_agent_job()',
    );
    try {
      const before = (
        await database.pool.query(
          'SELECT count(*)::int AS n FROM design_scheme_source_preparations',
        )
      ).rows[0].n;
      await expect(service.start(owner, input)).rejects.toThrow();
      const failed = await post('/executions', input);
      expect(failed.status).toBe(503);
      const errorBody = await failed.text();
      expect(errorBody).not.toContain(input.input.brief);
      expect(errorBody).not.toContain('synthetic enqueue failure');

      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_agent_sessions'))
          .rows[0].n,
      ).toBe(0);
      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_agent_events'))
          .rows[0].n,
      ).toBe(0);
      expect(
        (
          await database.pool.query(
            'SELECT count(*)::int AS n FROM design_scheme_source_preparations',
          )
        ).rows[0].n,
      ).toBe(before);
    } finally {
      await database.pool.query('DROP TRIGGER reject_agent_job ON graphile_worker._private_jobs');
      await database.pool.query('DROP FUNCTION reject_agent_job()');
    }
  });

  it('cancel-before-start and cancel-before-worker never read a source or create a generation tombstone', async () => {
    const first = request();
    expect((await post('/cancel', { executionId: first.input.executionId })).status).toBe(200);
    expect(await (await post('/executions', first)).json()).toMatchObject({ status: 'cancelled' });
    const second = request();
    await post('/executions', second);
    await post('/cancel', { executionId: second.input.executionId });
    runner = await startDesignSchemeAgentWorker(database.pool, service);
    await service.process(owner, second.input.executionId);
    expect(github.requests).toHaveLength(0);
    expect(s3.writes).toHaveLength(0);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_run_executions'))
        .rows[0].n,
    ).toBe(0);
  });

  it('queue drives sequential sources; old confirmation replay cannot approve the next source', async () => {
    const input = request([repo, repo]);
    await post('/executions', input);
    runner = await startDesignSchemeAgentWorker(database.pool, service);
    const first = await waitStatus(input.input.executionId, 'confirmation-required');
    expect(github.requests).toHaveLength(3);
    const decision = {
      executionId: input.input.executionId,
      confirmationId: first.pendingSource?.confirmationId,
      decision: 'install',
    };
    expect(
      (await post('/confirm-source', { ...decision, confirmationId: randomUUID() })).status,
    ).toBe(409);
    await post('/confirm-source', decision);
    const second = await waitStatus(input.input.executionId, 'confirmation-required');
    expect(second.confirmedSources).toBe(1);
    expect(second.pendingSource?.confirmationId).not.toBe(decision.confirmationId);
    const replay = await (await post('/confirm-source', decision)).json();
    expect(replay).toEqual(second);
    expect((await post('/confirm-source', { ...decision, decision: 'cancel' })).status).toBe(409);
    await post('/confirm-source', {
      ...decision,
      confirmationId: second.pendingSource?.confirmationId,
    });
    const blocked = await waitStatus(input.input.executionId, 'blocked');
    expect(blocked).toMatchObject({
      confirmedSources: 2,
      blocker: 'AGENT_COMPILER_UNAVAILABLE',
      result: null,
    });
    expect(github.requests).toHaveLength(6);
    expect(s3.writes).toHaveLength(4);
    const page = designSchemeAgentEventPageSchema.parse(
      await (await get(input.input.executionId, token, '/events?afterSeq=0')).json(),
    );
    expect(page.events.map((e: { seq: number }) => e.seq)).toEqual(
      Array.from({ length: blocked.version }, (_, i) => i + 1),
    );
    expect(page.events.at(-1)?.session).toEqual(blocked);
    expect(JSON.stringify(page)).not.toContain('objectKey');
    expect(
      await (
        await get(input.input.executionId, token, `/events?afterSeq=${blocked.version}`)
      ).json(),
    ).toEqual({ events: [], nextSeq: blocked.version });
    expect((await get(input.input.executionId, token, '/events?afterSeq=999')).status).toBe(409);
  });

  it('rejecting a source cancels later queued sources and replays without extra IO', async () => {
    const input = request([repo, repo]);
    await post('/executions', input);
    runner = await startDesignSchemeAgentWorker(database.pool, service);
    const current = await waitStatus(input.input.executionId, 'confirmation-required');
    const decision = {
      executionId: input.input.executionId,
      confirmationId: current.pendingSource?.confirmationId,
      decision: 'cancel',
    };
    expect(await (await post('/confirm-source', decision)).json()).toMatchObject({
      status: 'cancelled',
    });
    expect(await (await post('/confirm-source', decision)).json()).toMatchObject({
      status: 'cancelled',
    });
    await service.process(owner, input.input.executionId);
    expect(github.requests).toHaveLength(3);
    expect(
      (
        await database.pool.query(
          'SELECT count(*)::int AS n FROM object_cleanup_queue WHERE object_key=ANY($1::text[])',
          [Array.from(s3.objects.keys())],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it('unauthenticated, cross-owner, revoked session and CSRF requests cannot access or advance the session', async () => {
    const input = request();
    expect((await post('/executions', input, null)).status).toBe(401);
    await post('/executions', input);
    expect((await get(input.input.executionId, otherToken)).status).toBe(404);
    expect((await get(input.input.executionId, otherToken, '/events')).status).toBe(404);
    expect(
      (
        await post(
          '/confirm-source',
          {
            executionId: input.input.executionId,
            confirmationId: randomUUID(),
            decision: 'install',
          },
          otherToken,
        )
      ).status,
    ).toBe(404);
    // Cancellation identity is owner-scoped even if another owner guessed the same executionId.
    await post('/cancel', { executionId: input.input.executionId }, otherToken);
    expect((await state(input.input.executionId)).status).toBe('queued');
    const csrf = await app.request(`${prefix}/cancel`, {
      method: 'POST',
      headers: {
        cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac('sha256', 'agent-auth-fixture-secret').update(token).digest('base64')}`)}`,
        origin: 'https://evil.invalid',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ executionId: input.input.executionId }),
    });
    expect(csrf.status).toBe(403);
    await database.pool.query('DELETE FROM account_session_authorizations WHERE session_id=$1', [
      owner,
    ]);
    try {
      expect((await get(input.input.executionId)).status).toBe(403);
    } finally {
      await database.pool.query(
        "INSERT INTO account_session_authorizations(session_id,user_id,mode) VALUES($1,$1,'normal')",
        [owner],
      );
    }
    expect(github.requests).toHaveLength(0);
  });

  it('expires queued sessions durably and refuses late confirmation without source IO', async () => {
    const input = request();
    await post('/executions', input);
    await database.pool.query(
      "UPDATE design_scheme_agent_sessions SET expires_at=now()-interval '1 second' WHERE execution_id=$1",
      [input.input.executionId],
    );
    await service.reconcile();
    expect((await state(input.input.executionId)).status).toBe('expired');
    await service.process(owner, input.input.executionId);
    expect(github.requests).toHaveLength(0);
    expect(
      (
        await post('/confirm-source', {
          executionId: input.input.executionId,
          confirmationId: randomUUID(),
          decision: 'install',
        })
      ).status,
    ).toBe(409);
  });

  it('concurrent consumers claim registered source IO exactly once', async () => {
    const input = request();
    await post('/executions', input);
    const other = new DesignSchemeAgentService(
      database.db,
      new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader),
    );
    await Promise.all([
      service.process(owner, input.input.executionId),
      other.process(owner, input.input.executionId),
    ]);
    expect((await state(input.input.executionId)).status).toBe('confirmation-required');
    expect(github.requests).toHaveLength(3);
    expect(s3.writes).toHaveLength(2);
  });

  it('opposing concurrent source decisions have only one winner', async () => {
    const input = request();
    await post('/executions', input);
    await service.process(owner, input.input.executionId);
    const waiting = await state(input.input.executionId);
    const choice = {
      executionId: input.input.executionId,
      confirmationId: waiting.pendingSource?.confirmationId,
    };
    const decisions = await Promise.all([
      post('/confirm-source', { ...choice, decision: 'install' }),
      post('/confirm-source', { ...choice, decision: 'cancel' }),
    ]);
    expect(decisions.map((value) => value.status).sort()).toEqual([200, 409]);
    expect(github.requests).toHaveLength(3);
  });

  it('cancels during source PUT without publishing a late confirmation or reading the next source', async () => {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const workerService = new DesignSchemeAgentService(
      database.db,
      new DesignSchemeSourcePreparationService(
        database.db,
        {
          read: (key) => s3.storage.read(key),
          put: async (...args) => {
            entered();
            await held;
            await s3.storage.put(...args);
          },
        },
        github.reader,
      ),
    );
    const input = request([repo, repo]);
    await post('/executions', input);
    const work = workerService.process(owner, input.input.executionId);
    try {
      await started;
      const cancelled = await (
        await post('/cancel', { executionId: input.input.executionId })
      ).json();
      expect(cancelled).toMatchObject({ status: 'cancelled', pendingSource: null });
      release();
      await work;
      expect(await state(input.input.executionId)).toEqual(cancelled);
      expect(github.requests).toHaveLength(3);
      expect(s3.writes).toHaveLength(1);
      expect(
        (
          await database.pool.query(
            'SELECT count(*)::int AS n FROM object_cleanup_queue WHERE object_key=ANY($1::text[])',
            [Array.from(s3.objects.keys())],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      release();
      await work;
    }
  });

  it('production Agent bin consumes a queued brief and exits cleanly on SIGTERM', async () => {
    const input = request([]);
    await post('/executions', input);
    const child = spawn('pnpm', ['exec', 'tsx', 'src/agent-worker-bin.ts'], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: container.getConnectionUri(),
        S3_ENDPOINT: s3.endpoint,
        S3_BUCKET: 'test-scheme-assets',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'fixture-key',
        S3_SECRET_ACCESS_KEY: 'fixture-secret',
        BETTER_AUTH_SECRET: 'agent-auth-fixture-secret',
        NEW_API_BASE_URL: 'http://127.0.0.1:1',
        CREDENTIAL_ENCRYPTION_KEY: 'agent-fixture-encryption-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code));
    });
    let pid: number | undefined;
    try {
      await expect
        .poll(() => stdout.match(/worker started pid=(\d+)/)?.[1], { timeout: 15_000 })
        .toBeTruthy();
      pid = Number(stdout.match(/worker started pid=(\d+)/)?.[1]);
      expect((await waitStatus(input.input.executionId, 'blocked')).blocker).toBe(
        'AGENT_COMPILER_UNAVAILABLE',
      );
      process.kill(pid, 'SIGTERM');
      expect(await exited).toBe(0);
      expect(stderr).not.toContain('shutdown failed');
      expect(github.requests).toHaveLength(0);
    } finally {
      if (pid) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          /* already exited */
        }
      }
      child.kill('SIGTERM');
      await exited;
    }
  });

  it('two actual worker PIDs consume persisted source phases after the earlier process exits', async () => {
    const input = request([repo, repo]);
    await post('/executions', input);
    const invoke = async () => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          '--import',
          'tsx',
          'src/__tests__/fixtures/agent-worker-process.ts',
          input.input.executionId,
        ],
        {
          cwd: fileURLToPath(new URL('../../..', import.meta.url)),
          timeout: 30_000,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_URL: container.getConnectionUri(),
            SOURCE_GITHUB_FIXTURE_URL: github.endpoint,
            S3_ENDPOINT: s3.endpoint,
            S3_BUCKET: 'test-scheme-assets',
            S3_REGION: 'us-east-1',
            S3_ACCESS_KEY_ID: 'fixture-key',
            S3_SECRET_ACCESS_KEY: 'fixture-secret',
            BETTER_AUTH_SECRET: 'agent-auth-fixture-secret',
            NEW_API_BASE_URL: 'http://127.0.0.1:1',
            CREDENTIAL_ENCRYPTION_KEY: 'agent-fixture-encryption-key',
          },
        },
      );
      const line = stdout.split('\n').find((value) => value.startsWith('AGENT_RESULT='));
      if (!line) throw new Error('Missing worker process result');
      return JSON.parse(line.slice('AGENT_RESULT='.length));
    };
    const first = await invoke();
    const decision = {
      executionId: input.input.executionId,
      confirmationId: first.session.pendingSource.confirmationId,
      decision: 'install',
    };
    await post('/confirm-source', decision);
    const second = await invoke();
    expect(second.pid).not.toBe(first.pid);
    expect(second.session).toMatchObject({ status: 'confirmation-required', confirmedSources: 1 });
    expect(second.session.pendingSource.confirmationId).not.toBe(decision.confirmationId);
    expect(github.received).toHaveLength(6);
    expect(s3.writes).toHaveLength(4);
    expect(await (await post('/confirm-source', decision)).json()).toEqual(second.session);
    // Two real TS worker processes plus PG/HTTP/S3 IO need a bounded process-test
    // budget under the full integration suite, not the default 5s unit budget.
  }, 30_000);

  it('stale queue delivery after preparation never repeats source IO and can repair a missed job', async () => {
    const input = request();
    await post('/executions', input);
    await database.pool.query('DELETE FROM graphile_worker._private_jobs');
    await service.reconcile();
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM graphile_worker._private_jobs'))
        .rows[0].n,
    ).toBe(1);
    runner = await startDesignSchemeAgentWorker(database.pool, service);
    const waiting = await waitStatus(input.input.executionId, 'confirmation-required');
    const reconstructed = new DesignSchemeAgentService(
      database.db,
      new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader),
    );
    await Promise.all([
      reconstructed.process(owner, input.input.executionId),
      service.process(owner, input.input.executionId),
    ]);
    expect(await reconstructed.get(owner, input.input.executionId)).toEqual(waiting);
    expect(github.requests).toHaveLength(3);
  });

  it('enforces per-owner outstanding limit and rejects unsupported assets with an honest blocker', async () => {
    for (let i = 0; i < 4; i++) expect((await post('/executions', request())).status).toBe(202);
    expect((await post('/executions', request())).status).toBe(429);
    const unsupported = request();
    unsupported.input.sourceAssetIds = [randomUUID()] as never[];
    const response = await post('/executions', unsupported, otherToken);
    expect(await response.json()).toMatchObject({
      status: 'blocked',
      blocker: 'AGENT_ASSETS_UNAVAILABLE',
      result: null,
    });
    expect(github.requests).toHaveLength(0);
  });
});
