import { randomUUID } from 'node:crypto';
import {
  designSchemeAgentSessionSchema,
  createDesignSchemeInputSchema,
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

describeDb('cloud async modify against frozen PG revisions', () => {
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
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 16);
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
      await database.pool.query(
        `INSERT INTO design_scheme_text_executions(user_id,execution_id,auth_session_id,auth_revision,"authorization") VALUES('agent-legacy','legacy-agent','legacy-session',1,'{}')`,
      );
      await database.pool.query(
        `INSERT INTO design_scheme_text_calls(user_id,execution_id,ordinal,role,request_hash,prompt,status,lease_until) VALUES('agent-legacy','legacy-agent',0,'compiler',repeat('b',64),'{}','unknown',now())`,
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
      (
        await database.pool.query(
          "SELECT revision_base FROM design_scheme_text_executions WHERE execution_id='legacy-agent'",
        )
      ).rows[0].revision_base,
    ).toBeNull();
    expect(
      (
        await database.pool.query(
          "SELECT role,status FROM design_scheme_text_calls WHERE execution_id='legacy-agent'",
        )
      ).rows[0],
    ).toEqual({ role: 'compiler', status: 'unknown' });
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
    await database.pool.query('DELETE FROM design_scheme_runs');
    await database.pool.query('DELETE FROM design_schemes');
    github = await sourceGithubFixture();
    s3 = await startS3Fixture();
    service = new DesignSchemeAgentService(
      database.db,
      new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader),
      env,
      new DesignSchemeAssetService(database.db, s3.storage),
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

  async function base(sources: string[] = []) {
    const input = await start(sources);
    const session = await compile(input);
    if (!session.result) throw new Error('Missing base draft');
    model.posts.length = 0;
    model.gets.length = 0;
    return session.result;
  }
  async function modification(
    original: Awaited<ReturnType<typeof base>>,
    patch: Record<string, unknown> = {},
  ) {
    const scope = await authorized();
    return {
      operation: 'modify' as const,
      text: scope.text,
      input: {
        executionId: randomUUID(),
        schemeId: original.scheme.id,
        baseRevisionId: original.document.revisionId,
        expectedVersion: original.scheme.version,
        instruction: '改成红色',
        ...patch,
      },
    };
  }
  async function enqueueModify(original: Awaited<ReturnType<typeof base>>) {
    const input = await modification(original);
    expect((await post('/executions', input)).status).toBe(202);
    return input;
  }
  async function revise(input: Awaited<ReturnType<typeof enqueueModify>>) {
    model.state.compiler.promptProgram[1].template = '红色海报';
    await service.process(owner, input.input.executionId);
    return state(input.input.executionId);
  }
  async function storedRevision(id: string) {
    return (
      await database.pool.query(
        'SELECT document FROM design_scheme_revisions WHERE revision_id=$1',
        [id],
      )
    ).rows[0].document;
  }
  const schemes = () =>
    new DesignSchemeService(database.db, new DesignSchemeAssetService(database.db, s3.storage));

  it('revises the exact draft with one Reviser call, a child revision and atomic completion', async () => {
    const original = await base();
    const input = await enqueueModify(original);
    const result = await revise(input);
    expect(result).toMatchObject({
      operation: 'modify',
      status: 'completed',
      text: { callsSent: 1, callsCompleted: 1, cost: 'unknown' },
    });
    expect(model.posts).toHaveLength(1);
    expect(model.posts[0].messages[0].content).toContain('Scheme Reviser');
    expect(model.posts[0].messages[1].content).toContain(original.document.summary);
    expect(result.result?.document).toMatchObject({
      schemeId: original.scheme.id,
      parentRevisionId: original.document.revisionId,
    });
    expect(result.result?.scheme.currentRevisionId).toBe(result.result?.document.revisionId);
    expect(result.result?.scheme.version).toBe(original.scheme.version + 1);
    expect(result.result?.document.promptProgram[1].template).toBe('红色海报');
    expect(await storedRevision(original.document.revisionId)).toEqual(original.document);
    const detail = await schemes().get(owner, { id: original.scheme.id });
    expect(detail.document).toEqual(result.result?.document);
    const events = designSchemeAgentEventPageSchema.parse(
      await (await get(input.input.executionId, token, '/events')).json(),
    );
    expect(events.events.at(-1)?.session).toEqual(result);
    const discovery = model.gets.length;
    expect(await (await post('/executions', input)).json()).toEqual(result);
    await service.process(owner, input.input.executionId);
    expect(model.posts).toHaveLength(1);
    expect(model.gets).toHaveLength(discovery);
    expect((await get(input.input.executionId, otherToken)).status).toBe(404);
    expect(
      (
        await post('/executions', {
          ...input,
          input: { ...input.input, instruction: '另一个意图' },
        })
      ).status,
    ).toBe(409);
  });

  it('keeps a seeded formal revision live and chains later modifications from the precise working draft', async () => {
    const initial = await base();
    // Synthetic successful-trial/cover/formal state tests protection, not trial or formalization execution.
    await database.pool.query(
      "INSERT INTO design_scheme_runs(run_id,user_id,scheme_id,revision_id,mode,status,policy) VALUES($1,$2,$3,$4,'trial','completed','{}')",
      [randomUUID(), owner, initial.scheme.id, initial.document.revisionId],
    );
    await database.pool.query(
      "UPDATE design_schemes SET status='formal',cover_asset_id='seeded-cover' WHERE id=$1",
      [initial.scheme.id],
    );
    const original = {
      ...initial,
      scheme: (await schemes().get(owner, { id: initial.scheme.id })).summary,
    };
    const first = await revise(await enqueueModify(original));
    if (!first.result) throw new Error('No working draft');
    expect(first.result.scheme.currentRevisionId).toBe(original.document.revisionId);
    expect(first.result.scheme.workingDraftRevisionId).toBe(first.result.document.revisionId);
    expect((await schemes().get(owner, { id: original.scheme.id })).document).toEqual(
      original.document,
    );
    const working = await schemes().get(owner, {
      id: original.scheme.id,
      revision: { kind: 'working-draft', revisionId: first.result.document.revisionId },
    });
    expect(working.document).toEqual(first.result.document);
    const second = await revise(await enqueueModify(first.result));
    expect(second.result?.document.parentRevisionId).toBe(first.result.document.revisionId);
    expect(second.result?.scheme.currentRevisionId).toBe(original.document.revisionId);
    expect(await storedRevision(first.result.document.revisionId)).toEqual(first.result.document);
  });

  it('inherits confirmed frozen sources after preparation expiry without GitHub IO or another Analyst call', async () => {
    const original = await base([repo]);
    const before = github.requests.length;
    await database.pool.query(
      "UPDATE design_scheme_source_preparations SET expires_at=now()-interval '1 day'",
    );
    const result = await revise(await enqueueModify(original));
    expect(result.status).toBe('completed');
    expect(result.result?.document.sources).toEqual(original.document.sources);
    expect(result.result?.document.sourceSnapshotIds).toEqual(original.document.sourceSnapshotIds);
    expect(model.posts).toHaveLength(1);
    expect(github.requests).toHaveLength(before);
    expect((await schemes().get(owner, { id: original.scheme.id })).sourceSnapshots).toHaveLength(
      1,
    );
  });

  it('retains a real staged image through modification and can prepare the revised draft without image IO', async () => {
    const template = await base();
    const { default: sharp } = await import('sharp');
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    const assets = new DesignSchemeAssetService(database.db, s3.storage);
    const image = await assets.stage(owner, { name: 'reference.png', bytes });
    const document = {
      ...template.document,
      schemeId: randomUUID(),
      revisionId: randomUUID(),
      assetIds: [image.id],
    };
    const original = await schemes().create(
      owner,
      createDesignSchemeInputSchema.parse({
        executionId: randomUUID(),
        brief: 'image base',
        sourceUris: [],
        sourceBindings: [],
        sourceAssetIds: [image.id],
        document,
      }),
    );
    const result = await revise(await enqueueModify(original));
    expect(result.status).toBe('completed');
    const detail = await schemes().get(owner, { id: original.scheme.id });
    expect(detail.document.assetIds).toEqual([image.id]);
    expect((await assets.content(owner, image.id)).bytes).toEqual(bytes);
    const generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        async sign() {
          throw new Error('No image signing');
        },
        async readObject() {
          throw new Error('No image read');
        },
        async putObject() {
          throw new Error('No image write');
        },
        async removeObjects() {
          throw new Error('No image deletion');
        },
      },
      { apiIssuer: env.PUBLIC_BASE_URL, upstreamIssuer: env.NEW_API_BASE_URL },
    );
    const runtime = new DesignSchemeRunService(database.db, assets, generation);
    const trial = await runtime.prepare(
      owner,
      prepareDesignSchemeRunInputSchema.parse({
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
      }),
      owner,
    );
    expect(trial.executionBinding?.model).toBe('musefold-image-pro');
    expect(trial.plan.steps).toHaveLength(4);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM generation_runs')).rows[0].n,
    ).toBe(0);
  });

  it('rejects an invented base, stale version, foreign owner and tampered comparison document before discovery', async () => {
    const original = await base();
    const input = await modification(original);
    const discoveries = model.gets.length;
    for (const patch of [
      { baseRevisionId: 'nonexistent' },
      { expectedVersion: original.scheme.version + 1 },
      { baseDocument: { ...original.document, summary: 'tampered' } },
    ])
      expect(
        (await post('/executions', { ...input, input: { ...input.input, ...patch } })).status,
      ).toBe(409);
    expect((await post('/executions', input, otherToken)).status).toBe(409);
    expect(model.gets).toHaveLength(discoveries);
    expect(model.posts).toHaveLength(0);
  });

  it.each(['rename', 'delete', 'credential', 'revision'])(
    'rechecks %s at dispatch and does not call the model on an invalid base or identity',
    async (mode) => {
      const original = await base();
      const input = await enqueueModify(original);
      if (mode === 'rename')
        await schemes().rename(owner, {
          schemeId: original.scheme.id,
          name: 'changed',
          expectedVersion: original.scheme.version,
        });
      if (mode === 'delete')
        await schemes().remove(owner, {
          schemeId: original.scheme.id,
          expectedVersion: original.scheme.version,
        });
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
      await service.process(owner, input.input.executionId);
      expect((await state(input.input.executionId)).blocker).toBe(
        mode === 'rename' || mode === 'delete'
          ? 'AGENT_BASE_REVISION_CHANGED'
          : 'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE',
      );
      expect(model.posts).toHaveLength(0);
    },
  );

  it('allows only one of two independently authorized concurrent revisions to publish', async () => {
    const original = await base();
    const first = await enqueueModify(original);
    const second = await enqueueModify(original);
    model.state.mode = 'hold';
    const a = service.process(owner, first.input.executionId);
    const b = service.process(owner, second.input.executionId);
    try {
      await expect.poll(() => model.posts.length).toBe(2);
      model.release();
      await Promise.all([a, b]);
      const views = await Promise.all([
        state(first.input.executionId),
        state(second.input.executionId),
      ]);
      expect(views.map((v) => v.status).sort()).toEqual(['blocked', 'completed']);
      expect(views.find((v) => v.status === 'blocked')?.blocker).toBe(
        'AGENT_BASE_REVISION_CHANGED',
      );
      expect((await schemes().get(owner, { id: original.scheme.id })).summary.version).toBe(
        original.scheme.version + 1,
      );
      expect(await storedRevision(original.document.revisionId)).toEqual(original.document);
    } finally {
      model.release();
      await Promise.all([a, b]);
    }
  });

  it.each(['cancel', 'delete', 'rename', 'revoke'])(
    'preserves the base when %s wins during the model request',
    async (mode) => {
      const original = await base();
      const input = await enqueueModify(original);
      model.state.mode = 'hold';
      const work = service.process(owner, input.input.executionId);
      try {
        await expect.poll(() => model.posts.length).toBe(1);
        if (mode === 'cancel')
          await post('/cancel', { executionId: input.input.executionId, operation: 'modify' });
        if (mode === 'delete')
          await schemes().remove(owner, {
            schemeId: original.scheme.id,
            expectedVersion: original.scheme.version,
          });
        if (mode === 'rename')
          await schemes().rename(owner, {
            schemeId: original.scheme.id,
            name: 'changed',
            expectedVersion: original.scheme.version,
          });
        if (mode === 'revoke')
          await database.pool.query(
            "UPDATE account_credentials SET status='revoked' WHERE user_id=$1",
            [owner],
          );
        model.release();
        await work;
        const view = await state(input.input.executionId);
        expect(view.status).toBe(mode === 'cancel' ? 'cancelled' : 'blocked');
        expect(view.result).toBeNull();
        expect(view.text?.callsCompleted).toBe(1);
        expect(await storedRevision(original.document.revisionId)).toEqual(original.document);
        expect(model.posts).toHaveLength(1);
      } finally {
        model.release();
        await work;
      }
    },
  );

  it.each(['drop', '503', 'template', 'fidelity'])(
    'keeps %s terminal without retrying or replacing the base',
    async (mode) => {
      const original = await base();
      const input = await enqueueModify(original);
      if (mode === 'drop' || mode === '503') model.state.mode = mode;
      if (mode === 'template') model.state.compiler.promptProgram[0].template = '{{missing}}';
      if (mode === 'fidelity') model.state.compiler.fidelity = 'verified';
      await service.process(owner, input.input.executionId);
      const first = await state(input.input.executionId);
      expect(first.blocker).toBe(
        mode === 'drop' || mode === '503'
          ? 'AGENT_TEXT_RESULT_UNKNOWN'
          : 'AGENT_TEXT_OUTPUT_INVALID',
      );
      await service.reconcile();
      await service.process(owner, input.input.executionId);
      await post('/executions', input);
      expect(model.posts).toHaveLength(1);
      expect((await schemes().get(owner, { id: original.scheme.id })).document).toEqual(
        original.document,
      );
    },
  );

  it('preserves a modify cancellation tombstone before validating its nonexistent base or discovering a model', async () => {
    const original = await base();
    const input = await modification(original, { baseRevisionId: 'never-created' });
    const before = model.gets.length;
    await post('/cancel', { executionId: input.input.executionId, operation: 'modify' });
    expect(await (await post('/executions', input)).json()).toMatchObject({
      operation: 'modify',
      status: 'cancelled',
    });
    expect(model.gets).toHaveLength(before);
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
  it('a new actual PID publishes the stored Reviser result after an atomic revision failure with no second POST', async () => {
    const original = await base();
    const input = await enqueueModify(original);
    await database.pool.query(
      "CREATE FUNCTION modify_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture revision failure'; END $$; CREATE TRIGGER modify_failure BEFORE INSERT ON design_scheme_revisions FOR EACH ROW EXECUTE FUNCTION modify_failure()",
    );
    try {
      await expect(service.process(owner, input.input.executionId)).rejects.toThrow(
        'temporarily unavailable',
      );
      expect((await state(input.input.executionId)).status).toBe('compiling');
      expect((await callRows(input.input.executionId))[0].status).toBe('completed');
      expect((await schemes().get(owner, { id: original.scheme.id })).document).toEqual(
        original.document,
      );
    } finally {
      await database.pool.query(
        'DROP TRIGGER modify_failure ON design_scheme_revisions; DROP FUNCTION modify_failure()',
      );
    }
    const { stdout } = await promisify(execFile)(
      'pnpm',
      ['exec', 'tsx', 'src/__tests__/fixtures/text-agent-process.ts', input.input.executionId],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: childEnvironment(),
        timeout: 30000,
      },
    );
    const resumed = JSON.parse(stdout.split('TEXT_RESULT=')[1]);
    expect(resumed.pid).not.toBe(process.pid);
    expect(resumed.session).toMatchObject({ operation: 'modify', status: 'completed' });
    expect(model.posts).toHaveLength(1);
  });
  async function oneProcess(executionId: string) {
    const { stdout } = await promisify(execFile)(
      'pnpm',
      ['exec', 'tsx', 'src/__tests__/fixtures/text-agent-process.ts', executionId],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        env: childEnvironment(),
        timeout: 30000,
      },
    );
    const result = JSON.parse(stdout.split('TEXT_RESULT=')[1]);
    return {
      pid: Number(result.pid),
      session: designSchemeAgentSessionSchema.parse(result.session),
    };
  }
  it('actual process death after POST leaves a durable claim; cancellation and stale maintenance never resend', async () => {
    const original = await base();
    const input = await enqueueModify(original);
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
      expect((await schemes().get(owner, { id: original.scheme.id })).document).toEqual(
        original.document,
      );
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

  it('the production Graphile Agent bin consumes an exact-base modification and drains on SIGTERM', async () => {
    const original = await base();
    const input = await enqueueModify(original);
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
      expect(
        (await schemes().get(owner, { id: original.scheme.id })).document.parentRevisionId,
      ).toBe(original.document.revisionId);
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
