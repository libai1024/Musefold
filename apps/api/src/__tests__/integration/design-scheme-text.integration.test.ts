import { randomUUID } from 'node:crypto';
import {
  designSchemeAgentSessionSchema,
  designSchemeAgentEventPageSchema,
  designSchemeTextModelOfferSchema,
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
import { sealJsonToString } from '@musefold/server-crypto';
import { textModelFixture } from '../fixtures/text-model.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { DesignSchemeRunService } from '../../modules/design-scheme-runs/service.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { GenerationService } from '../../modules/generation/service.js';
import { prepareDesignSchemeRunInputSchema } from '@musefold/contracts';
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
import type { startDesignSchemeAgentWorker } from '../../modules/design-scheme-agent/worker.js';
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

describeDb('authorized cloud text execution (real auth, PG, model HTTP and S3)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let model: Awaited<ReturnType<typeof textModelFixture>>;
  let env: ReturnType<typeof loadEnv>;
  let auth: ReturnType<typeof createAuth>;
  let account: AccountService;
  let github: Awaited<ReturnType<typeof sourceGithubFixture>>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let service: DesignSchemeAgentService;
  let app: OpenAPIHono<AuthedEnv>;
  let runner: Awaited<ReturnType<typeof startDesignSchemeAgentWorker>> | undefined;
  const root = fileURLToPath(new URL('../../../../..', import.meta.url));

  beforeAll(async () => {
    model = await textModelFixture();
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 12 });
    const migrationFolder = await mkdtemp(join(tmpdir(), 'musefold-agent-upgrade-'));
    try {
      await cp(join(root, 'packages/db/migrations'), migrationFolder, { recursive: true });
      const journalPath = join(migrationFolder, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8'));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 15);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(database.db, { migrationsFolder: migrationFolder });
      await database.pool.query(
        "INSERT INTO \"user\" (id,name,email) VALUES('agent-legacy','legacy','agent-legacy@example.test')",
      );
      await database.pool.query(
        "INSERT INTO design_scheme_source_preparations(user_id,execution_id,confirmation_id,request_hash,request,status,expires_at) VALUES('agent-legacy','old-source','old-confirm',repeat('a',64),'{}','failed',now())",
      );
      await database.pool.query(
        `INSERT INTO design_scheme_agent_sessions(user_id,execution_id,request_hash,request,source_execution_ids,view,expires_at) VALUES('agent-legacy','legacy-agent',null,null,'[]',$1,now())`,
        [
          JSON.stringify({
            executionId: 'legacy-agent',
            operation: 'create',
            status: 'cancelled',
            version: 0,
            sourceCount: 0,
            confirmedSources: 0,
            pendingSource: null,
            blocker: null,
            result: null,
            createdAt: new Date().toISOString(),
            expiresAt: new Date().toISOString(),
          }),
        ],
      );
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
    } finally {
      await rm(migrationFolder, { recursive: true, force: true });
    }
    expect(
      (
        await database.pool.query(
          "SELECT view FROM design_scheme_agent_sessions WHERE execution_id='legacy-agent'",
        )
      ).rows[0].view,
    ).toMatchObject({ status: 'cancelled' });
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_text_executions'))
        .rows[0].n,
    ).toBe(0);
    const utils = await makeWorkerUtils({ pgPool: database.pool });
    await utils.migrate();
    await utils.release();
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      BETTER_AUTH_SECRET: 'agent-auth-fixture-secret',
      NEW_API_BASE_URL: model.endpoint,
      SCHEME_AGENT_TEXT_MODEL: 'fixture-text',
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
        "INSERT INTO account_credentials(user_id,ciphertext,upstream_issuer,upstream_owner_id,credential_ref,credential_version,status,verified_at) VALUES($1,$2,$3,$1,$4,1,'active',now())",
        [
          userId,
          sealJsonToString({ apiKey: 'synthetic-text-key' }, env.CREDENTIAL_ENCRYPTION_KEY),
          model.endpoint,
          `credential-${userId}`,
        ],
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
    model.posts.length = 0;
    model.gets.length = 0;
    model.state.mode = 'normal';
    const { textModelOutput, textAnalystOutput } = await import('../fixtures/text-model.js');
    model.state.compiler = textModelOutput();
    model.state.analyst = textAnalystOutput();
    await database.pool.query(
      "UPDATE account_credentials SET status='active',credential_version=1",
    );
    await database.pool.query("UPDATE account_session_authorizations SET mode='normal',revision=1");
    await database.pool.query("UPDATE session SET expires_at=now()+interval '1 hour'");
    await database.pool.query('DELETE FROM design_schemes');
    github = await sourceGithubFixture();
    s3 = await startS3Fixture();
    service = new DesignSchemeAgentService(
      database.db,
      new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader),
      env,
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
    await model?.close();
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
  async function waitStatus(id: string, status: string) {
    await expect.poll(async () => (await state(id)).status, { timeout: 20_000 }).toBe(status);
    return state(id);
  }

  async function authorized(uris: string[] = []) {
    const offer = designSchemeTextModelOfferSchema.parse(
      await (
        await app.request(`${prefix}/text-model`, { headers: { authorization: `Bearer ${token}` } })
      ).json(),
    );
    return {
      ...request(uris),
      text: {
        binding: offer.binding,
        maxModelCalls: uris.length + 1,
        maxOutputTokens: 8192 as const,
        acceptUnknownCost: true as const,
      },
    };
  }
  async function start(uris: string[] = []) {
    const input = await authorized(uris);
    const response = await post('/executions', input);
    expect(response.status).toBe(202);
    return input;
  }
  async function compile(input: Awaited<ReturnType<typeof start>>) {
    for (let i = 0; i < input.input.sourceUris.length; i++) {
      await service.process(owner, input.input.executionId);
      const waiting = await state(input.input.executionId);
      expect(waiting.status).toBe('confirmation-required');
      expect(model.posts).toHaveLength(0);
      const confirmation = await post('/confirm-source', {
        executionId: input.input.executionId,
        confirmationId: waiting.pendingSource?.confirmationId,
        decision: 'install',
      });
      expect(confirmation.status).toBe(200);
    }
    await service.process(owner, input.input.executionId);
    return state(input.input.executionId);
  }
  async function callRows(id: string) {
    return (
      await database.pool.query(
        'SELECT ordinal,status,output,usage FROM design_scheme_text_calls WHERE execution_id=$1 ORDER BY ordinal',
        [id],
      )
    ).rows;
  }
  async function draftCount() {
    return (await database.pool.query('SELECT count(*)::int AS n FROM design_schemes')).rows[0].n;
  }

  it('commits a real draft, event and source-free trial plan after one bounded model POST', async () => {
    const input = await start();
    const result = await compile(input);
    expect(result.status).toBe('completed');
    expect(result.text).toMatchObject({
      callsSent: 1,
      callsCompleted: 1,
      cost: 'unknown',
      maxModelCalls: 1,
    });
    expect(result.result?.creationSummary).toBe('提供主题，先试运行');
    expect(model.posts).toHaveLength(1);
    expect(model.posts[0]).toMatchObject({
      model: 'fixture-text',
      max_tokens: 8192,
      stream: false,
    });
    const detail = await new DesignSchemeService(database.db).get(owner, {
      id: result.result?.scheme.id ?? 'missing-result',
    });
    expect(detail.document).toEqual(result.result?.document);
    expect((await get(input.input.executionId, otherToken)).status).toBe(404);
    const generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        async sign() {
          throw new Error('Unexpected image signing during text draft preparation');
        },
        async readObject() {
          throw new Error('Unexpected image read');
        },
        async putObject() {
          throw new Error('Unexpected image write');
        },
        async removeObjects() {
          throw new Error('Unexpected image deletion');
        },
      },
      { apiIssuer: env.PUBLIC_BASE_URL, upstreamIssuer: env.NEW_API_BASE_URL },
    );
    const runs = new DesignSchemeRunService(
      database.db,
      new DesignSchemeAssetService(database.db, s3.storage),
      generation,
    );
    const trialInput = prepareDesignSchemeRunInputSchema.parse({
      executionId: randomUUID(),
      schemeId: detail.summary.id,
      revisionId: detail.document.revisionId,
      mode: 'trial',
      brief: '',
      inputValues: { topic: '城市' },
      executionSettings: {
        providerId: 'cloud-default',
        size: '1024x1024',
        quality: 'high',
        outputCount: 1,
        referenceAssetIds: [],
        promptReferenceSelections: [],
      },
    });
    const trial = await runs.prepare(owner, trialInput, owner);
    expect(trial.executionBinding).toMatchObject({
      providerId: 'cloud-default',
      model: 'musefold-image-pro',
      capabilities: { image: true, text: false },
    });
    expect(await runs.prepare(owner, trialInput, owner)).toEqual(trial);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM generation_runs')).rows[0].n,
    ).toBe(0);
    expect(trial.plan.steps).toHaveLength(4);
    expect(await draftCount()).toBe(1);
    expect((await callRows(input.input.executionId))[0]).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 30, outputTokens: 60 },
    });
    const eventPage = designSchemeAgentEventPageSchema.parse(
      await (await get(input.input.executionId, token, '/events')).json(),
    );
    expect(eventPage.events.at(-1)?.session).toEqual(result);
    expect(JSON.stringify(eventPage)).not.toContain('synthetic-text-key');
    const getCount = model.gets.length;
    expect((await post('/executions', input)).status).toBe(202);
    await service.process(owner, input.input.executionId);
    expect(model.gets).toHaveLength(getCount);
    expect(model.posts).toHaveLength(1);
    expect(
      (await post('/executions', { ...input, input: { ...input.input, brief: 'changed' } })).status,
    ).toBe(409);
  });

  it('requires both exact source confirmations, analyzes fixed bytes, and binds their snapshots atomically', async () => {
    const input = await start([repo, repo]);
    const result = await compile(input);
    expect(result.status).toBe('completed');
    expect(model.posts).toHaveLength(3);
    expect(model.posts[0].messages[1].content).toContain('Frozen instructions');
    expect(model.posts[1].messages[1].content).toContain('a'.repeat(40));
    expect(result.result?.document.sourceSnapshotIds).toHaveLength(2);
    const detail = await new DesignSchemeService(database.db).get(owner, {
      id: result.result?.scheme.id ?? 'missing-result',
    });
    expect(detail.sourceSnapshots).toHaveLength(2);
    expect(github.requests).toHaveLength(6);
    expect(await callRows(input.input.executionId)).toHaveLength(3);
  });

  it('keeps old source-only sessions blocked and cancel-before-start tombstones free of model discovery and POSTs', async () => {
    const old = request([]);
    await post('/executions', old);
    await service.process(owner, old.input.executionId);
    expect((await state(old.input.executionId)).blocker).toBe('AGENT_COMPILER_UNAVAILABLE');
    expect(model.gets).toHaveLength(0);
    expect(model.posts).toHaveLength(0);
    const input = await authorized();
    const discoveries = model.gets.length;
    await post('/cancel', { executionId: input.input.executionId });
    expect(await (await post('/executions', input)).json()).toMatchObject({ status: 'cancelled' });
    expect(model.gets).toHaveLength(discoveries);
    expect(model.posts).toHaveLength(0);
  });

  it('rejects missing scope, forged payer/model, wrong bounds, unavailable models and cross-owner credentials before POST', async () => {
    const input = await authorized();
    for (const text of [
      { ...input.text, maxModelCalls: 2 },
      { ...input.text, binding: { ...input.text.binding, model: 'other-model' } },
      {
        ...input.text,
        binding: {
          ...input.text.binding,
          payer: { ...input.text.binding.payer, ownerId: 'other' },
        },
      },
    ])
      expect((await post('/executions', { ...input, text })).status).toBeGreaterThanOrEqual(400);
    expect((await post('/executions', input, otherToken)).status).toBe(409);
    expect((await post('/executions', input, null)).status).toBe(401);
    model.state.mode = 'no-model';
    expect((await post('/executions', input)).status).toBe(409);
    expect(model.posts).toHaveLength(0);
  });

  it.each(['credential', 'revision', 'session', 'model'])(
    'rechecks %s immediately before dispatch without charging or publishing a draft',
    async (mode) => {
      const input = await start();
      if (mode === 'credential')
        await database.pool.query(
          'UPDATE account_credentials SET credential_version=2 WHERE user_id=$1',
          [owner],
        );
      if (mode === 'revision')
        await database.pool.query(
          'UPDATE account_session_authorizations SET revision=2 WHERE user_id=$1',
          [owner],
        );
      if (mode === 'session')
        await database.pool.query(
          "UPDATE session SET expires_at=now()-interval '1 second' WHERE user_id=$1",
          [owner],
        );
      const active =
        mode === 'model'
          ? new DesignSchemeAgentService(
              database.db,
              new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader),
              { ...env, SCHEME_AGENT_TEXT_MODEL: 'rotated-model' },
            )
          : service;
      await active.process(owner, input.input.executionId);
      expect((await service.get(owner, input.input.executionId)).blocker).toBe(
        'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE',
      );
      expect(model.posts).toHaveLength(0);
      expect(await draftCount()).toBe(0);
    },
  );

  it('concurrent consumers claim one POST and cancellation during HTTP never publishes its late result', async () => {
    const input = await start();
    model.state.mode = 'hold';
    const work = service.process(owner, input.input.executionId);
    try {
      await expect.poll(() => model.posts.length).toBe(1);
      await service.process(owner, input.input.executionId);
      await post('/cancel', { executionId: input.input.executionId });
      model.release();
      await work;
      const view = await state(input.input.executionId);
      expect(view).toMatchObject({
        status: 'cancelled',
        result: null,
        text: { callsSent: 1, callsCompleted: 1, cost: 'unknown' },
      });
      expect(await draftCount()).toBe(0);
      expect(model.posts).toHaveLength(1);
    } finally {
      model.release();
      await work;
    }
  });

  it('revocation after POST retains completed cost evidence but refuses draft publication', async () => {
    const input = await start();
    model.state.mode = 'hold';
    const work = service.process(owner, input.input.executionId);
    try {
      await expect.poll(() => model.posts.length).toBe(1);
      await database.pool.query(
        "UPDATE account_credentials SET status='revoked' WHERE user_id=$1",
        [owner],
      );
      model.release();
      await work;
      expect(await state(input.input.executionId)).toMatchObject({
        status: 'blocked',
        blocker: 'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE',
        text: { callsCompleted: 1, cost: 'unknown' },
      });
      expect(await draftCount()).toBe(0);
      expect(model.posts).toHaveLength(1);
    } finally {
      model.release();
      await work;
    }
  });

  it.each(['drop', '503', 'redirect'])(
    'persists %s as unknown and never resends when the queue or client retries',
    async (mode) => {
      const input = await start();
      model.state.mode = mode;
      await service.process(owner, input.input.executionId);
      expect(await state(input.input.executionId)).toMatchObject({
        status: 'blocked',
        blocker: 'AGENT_TEXT_RESULT_UNKNOWN',
      });
      await post('/executions', input);
      await service.reconcile();
      await service.process(owner, input.input.executionId);
      expect(model.posts).toHaveLength(1);
      expect(await draftCount()).toBe(0);
      expect((await callRows(input.input.executionId))[0]).toMatchObject({
        status: 'unknown',
        output: null,
      });
    },
  );

  it.each(['template', 'fidelity', 'evidence'])(
    'rejects invalid %s with a durable invalid result, no draft and no repair retry',
    async (mode) => {
      const input = await start(mode === 'evidence' ? [repo] : []);
      if (mode === 'template') model.state.compiler.promptProgram[0].template = '{{invented}}';
      if (mode === 'fidelity') model.state.compiler.fidelity = 'verified';
      if (mode === 'evidence') model.state.analyst.rules[0].evidencePaths = ['not-in-snapshot.txt'];
      const view = await compile(input);
      expect(view).toMatchObject({ status: 'failed', blocker: 'AGENT_TEXT_OUTPUT_INVALID' });
      await service.process(owner, input.input.executionId);
      expect(model.posts).toHaveLength(1);
      expect(await draftCount()).toBe(0);
    },
  );

  it('expiry and corrupt source bytes prevent dispatch', async () => {
    const input = await start([repo]);
    await service.process(owner, input.input.executionId);
    const waiting = await state(input.input.executionId);
    await post('/confirm-source', {
      executionId: input.input.executionId,
      confirmationId: waiting.pendingSource?.confirmationId,
      decision: 'install',
    });
    s3.objects.clear();
    await service.process(owner, input.input.executionId);
    expect((await state(input.input.executionId)).blocker).toBe('AGENT_TEXT_SOURCE_INVALID');
    const expired = await start();
    await database.pool.query(
      "UPDATE design_scheme_agent_sessions SET expires_at=now()-interval '1 second' WHERE execution_id=$1",
      [expired.input.executionId],
    );
    await service.process(owner, expired.input.executionId);
    expect((await state(expired.input.executionId)).status).toBe('expired');
    expect(model.posts).toHaveLength(0);
  });

  function childEnvironment() {
    return {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
      NEW_API_BASE_URL: model.endpoint,
      SCHEME_AGENT_TEXT_MODEL: 'fixture-text',
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      CREDENTIAL_ENCRYPTION_KEY: env.CREDENTIAL_ENCRYPTION_KEY,
      S3_ENDPOINT: s3.endpoint,
      S3_BUCKET: 'test-scheme-assets',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'fixture-key',
      S3_SECRET_ACCESS_KEY: 'fixture-secret',
    };
  }
  async function oneProcess(id: string) {
    const { stdout } = await promisify(execFile)(
      'pnpm',
      ['exec', 'tsx', 'src/__tests__/fixtures/text-agent-process.ts', id],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: childEnvironment(),
        timeout: 30_000,
      },
    );
    return JSON.parse(stdout.split('TEXT_RESULT=')[1]);
  }

  it('a new actual PID publishes a persisted compiler result after atomic draft failure without another POST', async () => {
    const input = await start();
    await database.pool.query(
      "CREATE FUNCTION text_draft_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture draft commit failure'; END $$; CREATE TRIGGER text_draft_failure BEFORE INSERT ON design_schemes FOR EACH ROW EXECUTE FUNCTION text_draft_failure()",
    );
    try {
      await expect(service.process(owner, input.input.executionId)).rejects.toThrow(
        'temporarily unavailable',
      );
      expect((await state(input.input.executionId)).status).toBe('compiling');
      expect(await draftCount()).toBe(0);
      expect((await callRows(input.input.executionId))[0].status).toBe('completed');
    } finally {
      await database.pool.query(
        'DROP TRIGGER text_draft_failure ON design_schemes; DROP FUNCTION text_draft_failure()',
      );
    }
    const resumed = await oneProcess(input.input.executionId);
    expect(resumed.pid).not.toBe(process.pid);
    expect(resumed.session.status).toBe('completed');
    expect(await draftCount()).toBe(1);
    expect(model.posts).toHaveLength(1);
  });

  it('actual process death after POST leaves a durable claim; cancellation and stale maintenance never resend', async () => {
    const input = await start();
    model.state.mode = 'hold';
    const child = spawn(
      'pnpm',
      ['exec', 'tsx', 'src/__tests__/fixtures/text-agent-process.ts', input.input.executionId],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: childEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => resolve());
    });
    let pid = 0;
    try {
      await expect.poll(() => model.posts.length, { timeout: 20_000 }).toBe(1);
      pid = Number(stdout.match(/TEXT_PID=(\d+)/)?.[1]);
      expect(pid).toBeGreaterThan(0);
      process.kill(pid, 'SIGKILL');
      await exited;
      expect((await callRows(input.input.executionId))[0].status).toBe('sent');
      const resumed = await oneProcess(input.input.executionId);
      expect(resumed.pid).not.toBe(pid);
      expect(resumed.session.status).toBe('compiling');
      await post('/cancel', { executionId: input.input.executionId });
      // Clock boundary injection is explicit; PID death and HTTP acceptance above are real.
      await database.pool.query(
        "UPDATE design_scheme_text_calls SET lease_until=now()-interval '1 second' WHERE execution_id=$1",
        [input.input.executionId],
      );
      await service.reconcile();
      expect((await callRows(input.input.executionId))[0].status).toBe('unknown');
      expect((await state(input.input.executionId)).status).toBe('cancelled');
      expect(model.posts).toHaveLength(1);
      expect(await draftCount()).toBe(0);
    } finally {
      model.release();
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
      child.kill('SIGTERM');
      await exited;
    }
  }, 45_000);

  it('the production Graphile Agent bin consumes a text-authorized brief and drains on SIGTERM', async () => {
    const input = await start();
    const child = spawn('pnpm', ['exec', 'tsx', 'src/agent-worker-bin.ts'], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      env: childEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    let pid = 0;
    try {
      await expect
        .poll(() => stdout.match(/worker started pid=(\d+)/)?.[1], { timeout: 20_000 })
        .toBeTruthy();
      pid = Number(stdout.match(/worker started pid=(\d+)/)?.[1]);
      expect((await waitStatus(input.input.executionId, 'completed')).text?.callsCompleted).toBe(1);
      process.kill(pid, 'SIGTERM');
      expect(await exited).toBe(0);
      expect(model.posts).toHaveLength(1);
      expect(await draftCount()).toBe(1);
    } finally {
      if (pid) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          /* gone */
        }
      }
      child.kill('SIGTERM');
      await exited;
    }
  }, 45_000);
});
