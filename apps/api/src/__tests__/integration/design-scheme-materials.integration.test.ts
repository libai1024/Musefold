import sharp from 'sharp';
import { designSchemeAgentMaterialsSchema } from '@musefold/contracts';
import { randomUUID } from 'node:crypto';
import {
  designSchemeAgentSessionSchema,
  designSchemeRevisionDocumentSchema,
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

describeDb('cloud Agent immutable uploads (real auth, PG, model HTTP and S3)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let model: Awaited<ReturnType<typeof textModelFixture>>;
  let env: ReturnType<typeof loadEnv>;
  let auth: ReturnType<typeof createAuth>;
  let account: AccountService;
  let github: Awaited<ReturnType<typeof sourceGithubFixture>>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let service: DesignSchemeAgentService;
  let assets: DesignSchemeAssetService;
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
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 18);
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
      (
        await database.pool.query(
          "SELECT materials FROM design_scheme_agent_sessions WHERE execution_id='legacy-agent'",
        )
      ).rows[0].materials,
    ).toBeNull();
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
    await database.pool.query('DELETE FROM generation_runs');
    await database.pool.query('DELETE FROM design_schemes');
    await database.pool.query('DELETE FROM generation_reference_uploads');
    await database.pool.query('DELETE FROM object_cleanup_queue');
    github = await sourceGithubFixture();
    s3 = await startS3Fixture();
    assets = new DesignSchemeAssetService(database.db, s3.storage);
    service = new DesignSchemeAgentService(
      database.db,
      new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader),
      env,
      assets,
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
  async function _waitStatus(id: string, status: string) {
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

  async function upload(color = '#ff0000', userId = owner) {
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: color } })
      .png()
      .toBuffer();
    return { bytes, stage: await assets.stage(userId, { name: 'reference.png', bytes }) };
  }
  async function frozen(id: string) {
    return designSchemeAgentMaterialsSchema.parse(
      (
        await database.pool.query(
          'SELECT materials FROM design_scheme_agent_sessions WHERE execution_id=$1',
          [id],
        )
      ).rows[0].materials,
    );
  }
  async function begin(ids: string[], uris: string[] = []) {
    const input = { ...(await authorized(uris)) };
    const request = { ...input, input: { ...input.input, sourceAssetIds: ids } };
    expect((await post('/executions', request)).status).toBe(202);
    return request;
  }
  async function copies(id: string) {
    const items = (await frozen(id)).uploads;
    return (
      await database.pool.query(
        'SELECT * FROM generation_reference_uploads WHERE id=ANY($1::text[])',
        [items.map((item) => item.asset.id)],
      )
    ).rows;
  }
  it('copies ordered uploads, preserves originals, exposes exact assets and prepares a real run', async () => {
    const first = await upload('#ff0000');
    const second = await upload('#0000ff');
    const input = await begin([second.stage.id, first.stage.id]);
    const id = input.input.executionId;
    const material = await frozen(id);
    expect(material.uploads.map((item) => item.sourceAssetId)).toEqual([
      second.stage.id,
      first.stage.id,
    ]);
    expect(material.uploads.map((item) => item.asset.contentHash)).toEqual([
      second.stage.contentHash,
      first.stage.contentHash,
    ]);
    expect(material.uploads.every((item) => item.asset.id !== item.sourceAssetId)).toBe(true);
    await assets.discard(owner, first.stage.id);
    await assets.discard(owner, second.stage.id);
    // Original object deletion cannot affect task copies.
    for (const row of (
      await database.pool.query(
        'SELECT object_key FROM generation_reference_uploads WHERE id=ANY($1::text[])',
        [[first.stage.id, second.stage.id]],
      )
    ).rows)
      s3.objects.delete(row.object_key);
    await service.process(owner, id);
    const done = await state(id);
    expect(done.status).toBe('completed');
    const document = designSchemeRevisionDocumentSchema.parse(done.result?.document);
    expect(document.assetIds).toEqual(material.uploads.map((item) => item.asset.id));
    expect(document.inputs).toHaveLength(1);
    expect(document.inputs[0].kind).toBe('text');
    expect(document.fidelity).toBe('adapted');
    expect(document.compilation.warnings.join(' ')).toContain('未做图片视觉解析');
    const details = await new DesignSchemeService(database.db, assets).get(owner, {
      id: document.schemeId,
    });
    expect(details.assets.map((item) => item.id).sort()).toEqual([...document.assetIds].sort());
    expect(Buffer.from((await assets.content(owner, document.assetIds[0])).bytes)).toEqual(
      second.bytes,
    );
    expect(await copies(id)).toHaveLength(0);
    expect(model.posts).toHaveLength(1);
    expect(model.posts[0].messages[1].content).toContain('已保存 2 张图片');
    expect(JSON.stringify(model.posts)).not.toContain('image_url');
    expect(JSON.stringify(done)).not.toContain('object_key');
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
        schemeId: document.schemeId,
        revisionId: document.revisionId,
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
  it('rejects foreign stages before model discovery or paid calls', async () => {
    const foreign = await upload('#ffffff', secondOwner);
    const input = await authorized();
    model.gets.length = 0;
    const response = await post('/executions', {
      ...input,
      input: { ...input.input, sourceAssetIds: [foreign.stage.id] },
    });
    expect(response.status).toBe(404);
    expect(model.gets).toHaveLength(0);
    expect(model.posts).toHaveLength(0);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_agent_sessions'))
        .rows[0].n,
    ).toBe(0);
  });
  it('checks claimed hash/origin/role and exact selection, including duplicates', async () => {
    const item = await upload();
    const { id, mimeType, width, height, byteSize, contentHash, createdAt } = item.stage;
    const metadata = {
      id,
      origin: 'uploaded',
      role: 'reference',
      license: null,
      mimeType,
      width,
      height,
      byteSize,
      contentHash,
      createdAt,
    };
    const authorizedInput = await authorized();
    for (const inputPatch of [
      { sourceAssetIds: [id, id] },
      { sourceAssetIds: [id], sourceAssets: [{ ...metadata, contentHash: 'a'.repeat(64) }] },
      { sourceAssetIds: [id], sourceAssets: [{ ...metadata, origin: 'cloud-run' }] },
      { sourceAssetIds: [id], sourceAssets: [{ ...metadata, role: 'cover' }] },
      { sourceAssetIds: [], sourceAssets: [metadata] },
    ]) {
      const input = {
        ...authorizedInput,
        input: { ...authorizedInput.input, executionId: randomUUID() },
      };
      model.gets.length = 0;
      expect(
        (await post('/executions', { ...input, input: { ...input.input, ...inputPatch } })).status,
      ).toBe(409);
      expect(model.gets).toHaveLength(0);
    }
    const valid = {
      ...authorizedInput,
      input: { ...authorizedInput.input, executionId: randomUUID() },
    };
    expect(
      (
        await post('/executions', {
          ...valid,
          input: { ...valid.input, sourceAssetIds: [id], sourceAssets: [metadata] },
        })
      ).status,
    ).toBe(202);
    await service.process(owner, valid.input.executionId);
    expect((await state(valid.input.executionId)).status).toBe('completed');
    expect(model.posts).toHaveLength(1);
  });
  it('replays the frozen selection without recopying, refetching a deleted original or rediscovering a model', async () => {
    const item = await upload();
    const input = await begin([item.stage.id]);
    const before = await frozen(input.input.executionId);
    await assets.discard(owner, item.stage.id);
    const writes = s3.writes.length;
    model.gets.length = 0;
    expect((await post('/executions', input)).status).toBe(202);
    expect(await frozen(input.input.executionId)).toEqual(before);
    expect(s3.writes).toHaveLength(writes);
    expect(model.gets).toHaveLength(0);
    await service.process(owner, input.input.executionId);
    await service.process(owner, input.input.executionId);
    expect(model.posts).toHaveLength(1);
  });
  it.each(['bytes', 'expiry', 'missing'] as const)(
    'blocks %s changes to task copies before spending',
    async (kind) => {
      const item = await upload();
      const input = await begin([item.stage.id]);
      const id = input.input.executionId;
      const [copy] = await copies(id);
      if (kind === 'bytes') s3.objects.set(copy.object_key, (await upload('#00ff00')).bytes);
      if (kind === 'missing') s3.objects.delete(copy.object_key);
      if (kind === 'expiry')
        await database.pool.query(
          "UPDATE generation_reference_uploads SET expires_at=now()-interval '1 second' WHERE id=$1",
          [copy.id],
        );
      await service.process(owner, id);
      expect(await state(id)).toMatchObject({
        status: 'blocked',
        blocker: 'AGENT_MATERIALS_INVALID',
      });
      expect(model.posts).toHaveLength(0);
    },
  );
  it('does not publish or resend a completed call when its copy is changed during the paid request', async () => {
    const item = await upload();
    const input = await begin([item.stage.id]);
    model.state.mode = 'hold';
    const pending = service.process(owner, input.input.executionId);
    await expect.poll(() => model.posts.length).toBe(1);
    const [copy] = await copies(input.input.executionId);
    s3.objects.delete(copy.object_key);
    model.release();
    await pending;
    await service.process(owner, input.input.executionId);
    expect(await state(input.input.executionId)).toMatchObject({
      status: 'blocked',
      blocker: 'AGENT_MATERIALS_INVALID',
      text: { callsCompleted: 1 },
    });
    expect(model.posts).toHaveLength(1);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_schemes')).rows[0].n,
    ).toBe(0);
  });
  it('cancel-before-start makes no copies and cancellation during POST never publishes a draft', async () => {
    const item = await upload();
    const input = await authorized();
    const request = { ...input, input: { ...input.input, sourceAssetIds: [item.stage.id] } };
    await service.cancel(owner, request.input.executionId);
    const writes = s3.writes.length;
    expect((await post('/executions', request)).status).toBe(202);
    expect(s3.writes).toHaveLength(writes);
    const running = await begin([item.stage.id]);
    model.state.mode = 'hold';
    const pending = service.process(owner, running.input.executionId);
    await expect.poll(() => model.posts.length).toBe(1);
    await service.cancel(owner, running.input.executionId);
    model.release();
    await pending;
    expect((await state(running.input.executionId)).status).toBe('cancelled');
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_schemes')).rows[0].n,
    ).toBe(0);
    expect(await copies(running.input.executionId)).toHaveLength(1);
  });
  it('retains unknown paid outcomes without resending or promoting uploads', async () => {
    const input = await begin([(await upload()).stage.id]);
    model.state.mode = 'drop';
    await service.process(owner, input.input.executionId);
    await service.process(owner, input.input.executionId);
    expect(await state(input.input.executionId)).toMatchObject({
      status: 'blocked',
      blocker: 'AGENT_TEXT_RESULT_UNKNOWN',
    });
    expect(model.posts).toHaveLength(1);
    expect(await copies(input.input.executionId)).toHaveLength(1);
  });
  it('keeps ambiguous copy PUTs discoverable without accepting or charging an Agent', async () => {
    const item = await upload();
    s3.state.failPutAfterWrite = true;
    const input = await authorized();
    expect(
      (
        await post('/executions', {
          ...input,
          input: { ...input.input, sourceAssetIds: [item.stage.id] },
        })
      ).status,
    ).toBe(503);
    expect(model.posts).toHaveLength(0);
    const cleanup = (
      await database.pool.query(
        "SELECT object_key FROM object_cleanup_queue WHERE reason='reference_upload_failed'",
      )
    ).rows;
    expect(cleanup).toHaveLength(1);
    expect(s3.objects.has(cleanup[0].object_key)).toBe(true);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_agent_sessions'))
        .rows[0].n,
    ).toBe(0);
  });
  it('combines confirmed repository evidence and uploaded copies without treating image paths as visual input', async () => {
    const input = await begin([(await upload()).stage.id], [repo]);
    await service.process(owner, input.input.executionId);
    const waiting = await state(input.input.executionId);
    expect(waiting.status).toBe('confirmation-required');
    expect(model.posts).toHaveLength(0);
    expect(
      (
        await post('/confirm-source', {
          executionId: input.input.executionId,
          confirmationId: waiting.pendingSource?.confirmationId,
          decision: 'install',
        })
      ).status,
    ).toBe(200);
    await service.process(owner, input.input.executionId);
    const done = await state(input.input.executionId);
    expect(done.status).toBe('completed');
    expect(done.result?.document?.sourceSnapshotIds).toHaveLength(1);
    expect(done.result?.document?.assetIds).toHaveLength(1);
    expect(model.posts).toHaveLength(2);
    expect(model.posts[1].messages[1].content).toContain('仓库分析报告');
    expect(model.posts[1].messages[1].content).toContain('已保存 1 张图片');
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

  it('reuses the completed model result in a new PID after the asset insertion transaction rolls back', async () => {
    const item = await upload();
    const input = await begin([item.stage.id]);
    const id = input.input.executionId;
    const expected = await frozen(id);
    await database.pool.query(
      "CREATE FUNCTION material_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture material insert failure'; END $$; CREATE TRIGGER material_failure AFTER INSERT ON design_scheme_assets FOR EACH ROW EXECUTE FUNCTION material_failure()",
    );
    try {
      await expect(service.process(owner, id)).rejects.toThrow('temporarily unavailable');
      expect((await state(id)).status).toBe('compiling');
      expect(await copies(id)).toHaveLength(1);
      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_assets')).rows[0]
          .n,
      ).toBe(0);
      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM design_schemes')).rows[0].n,
      ).toBe(0);
    } finally {
      await database.pool.query(
        'DROP TRIGGER material_failure ON design_scheme_assets; DROP FUNCTION material_failure()',
      );
    }
    await assets.discard(owner, item.stage.id);
    const resumed = await oneProcess(id);
    expect(resumed.pid).not.toBe(process.pid);
    expect(resumed.session.status).toBe('completed');
    expect(resumed.session.result.document.assetIds).toEqual(
      expected.uploads.map((item) => item.asset.id),
    );
    expect(Buffer.from((await assets.content(owner, expected.uploads[0].asset.id)).bytes)).toEqual(
      item.bytes,
    );
    expect(model.posts).toHaveLength(1);
    expect(await copies(id)).toHaveLength(0);
  });
  it('duplicate concurrent starts choose one frozen context and publish only one draft', async () => {
    const input = await authorized();
    const request = {
      ...input,
      input: { ...input.input, sourceAssetIds: [(await upload()).stage.id] },
    };
    const responses = await Promise.all([
      post('/executions', request),
      post('/executions', request),
    ]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    const material = await frozen(request.input.executionId);
    await Promise.all([
      service.process(owner, request.input.executionId),
      service.process(owner, request.input.executionId),
    ]);
    expect((await state(request.input.executionId)).result?.document?.assetIds).toEqual(
      material.uploads.map((item) => item.asset.id),
    );
    expect(model.posts).toHaveLength(1);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_schemes')).rows[0].n,
    ).toBe(1);
    // Losing copies are intentionally retained by the existing 24h cleanup registry, never untracked objects.
    for (const key of s3.objects.keys()) {
      const n = (
        await database.pool.query(
          'SELECT count(*)::int AS n FROM (SELECT object_key FROM generation_reference_uploads UNION ALL SELECT object_key FROM design_scheme_assets) objects WHERE object_key=$1',
          [key],
        )
      ).rows[0].n;
      expect(n).toBe(1);
    }
  });
  it('rejects unavailable history without accepting empty assets', async () => {
    const input = await authorized();
    const request = {
      ...input,
      input: {
        ...input.input,
        historySources: [{ runId: 'history', assetId: 'image', includePrompt: true }],
      },
    };
    expect((await post('/executions', request)).status).toBe(409);
    expect(s3.writes).toHaveLength(0);
    expect(model.posts).toHaveLength(0);
  });

  async function callRows(id: string) {
    return (
      await database.pool.query(
        'SELECT * FROM design_scheme_text_calls WHERE execution_id=$1 ORDER BY ordinal',
        [id],
      )
    ).rows;
  }
  it('actual process death after POST leaves a durable claim; cancellation and stale maintenance never resend', async () => {
    const input = await begin([(await upload()).stage.id]);
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
      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM design_schemes')).rows[0].n,
      ).toBe(0);
      expect(await copies(input.input.executionId)).toHaveLength(1);
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

  it('uses a preserved copy as an actual required-image run reference without creating a generation', async () => {
    const item = await upload();
    const input = await begin([item.stage.id]);
    model.state.compiler.inputs.push(
      Object.assign(
        { label: '主体图', kind: 'image', required: true, variable: '' },
        { imageRole: 'subject-reference' },
      ),
    );
    await service.process(owner, input.input.executionId);
    const done = await state(input.input.executionId);
    expect(done.status).toBe('completed');
    const document = designSchemeRevisionDocumentSchema.parse(done.result?.document);
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
        schemeId: document.schemeId,
        revisionId: document.revisionId,
        mode: 'trial',
        brief: '',
        inputValues: { topic: '城市' },
        executionSettings: {
          providerId: 'cloud-default',
          size: '1024x1024',
          quality: 'high',
          outputCount: 1,
          referenceAssetIds: document.assetIds,
          promptReferenceSelections: [],
        },
      }),
      owner,
    );
    expect(trial.executionBinding?.model).toBe('musefold-image-pro');
    expect(trial.plan.steps).toHaveLength(4);

    expect(JSON.stringify(trial.plan)).toContain(document.assetIds[0]);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM generation_runs')).rows[0].n,
    ).toBe(0);
    expect(Buffer.from((await assets.content(owner, document.assetIds[0])).bytes)).toEqual(
      item.bytes,
    );
  });
  it('expiry cancels pending work and does not extend copies or send a model request', async () => {
    const input = await begin([(await upload()).stage.id]);
    const before = await copies(input.input.executionId);
    await database.pool.query(
      "UPDATE design_scheme_agent_sessions SET expires_at=now()-interval '1 second' WHERE execution_id=$1",
      [input.input.executionId],
    );
    await service.process(owner, input.input.executionId);
    expect((await state(input.input.executionId)).status).toBe('expired');
    expect((await copies(input.input.executionId))[0].expires_at).toEqual(before[0].expires_at);
    expect(model.posts).toHaveLength(0);
  });
});
