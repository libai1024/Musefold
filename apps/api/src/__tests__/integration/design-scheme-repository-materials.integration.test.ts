import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { designSchemeAgentMaterialsSchema } from '@musefold/contracts';
import { randomUUID } from 'node:crypto';
import {
  designSchemeAgentSessionSchema,
  designSchemeRevisionDocumentSchema,
  sourceSnapshotSchema,
  referenceAssetMetadataSchema,
  sourceFileMetadataSchema,
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

describeDb('confirmed repository image adoption and revision assets (real PG and HTTP)', () => {
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
    await database.pool.query('DELETE FROM design_scheme_run_steps');
    await database.pool.query('DELETE FROM design_scheme_evaluations');
    await database.pool.query('DELETE FROM design_scheme_runs');
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
  async function _begin(ids: string[], uris: string[] = []) {
    const input = { ...(await authorized(uris)) };
    const request = { ...input, input: { ...input.input, sourceAssetIds: ids } };
    expect((await post('/executions', request)).status).toBe(202);
    return request;
  }
  async function copies(id: string) {
    const material = await frozen(id);
    const items = [
      ...material.uploads,
      ...(material.repositories?.flatMap((source) => source.images) ?? []),
      ...(material.history?.assets.map((asset) => ({ asset })) ?? []),
    ];
    return (
      await database.pool.query(
        'SELECT * FROM generation_reference_uploads WHERE id=ANY($1::text[])',
        [items.map((item) => item.asset.id)],
      )
    ).rows;
  }
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

  async function history(prompt = 'Clean typography at 20% contrast', userId = owner) {
    const bytes = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#22aabb' },
    })
      .png()
      .toBuffer();
    const runId = randomUUID();
    const assetId = randomUUID();
    const key = `users/${userId}/generations/${runId}/${assetId}`;
    const hash = createHash('sha256').update(bytes).digest('hex');
    await database.pool.query(
      "INSERT INTO generation_runs(id,user_id,status,request,prompt_snapshot) VALUES($1,$2,'succeeded',$3,$4)",
      [
        runId,
        userId,
        JSON.stringify({ prompt }),
        JSON.stringify({ schemaVersion: 1, finalPrompt: prompt, userPrompt: prompt }),
      ],
    );
    await database.pool.query(
      'INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256) VALUES($1,$2,$3,$4,$5,4,3,$6,$7)',
      [assetId, runId, userId, key, 'image/png', bytes.length, hash],
    );
    s3.objects.set(key, bytes);
    return { runId, assetId, includePrompt: true, key, bytes, hash, prompt };
  }
  async function startHistory(
    items: Array<{ runId: string; assetId: string; includePrompt: boolean }>,
    uris: string[] = [],
    uploads: string[] = [],
  ) {
    const authorization = await authorized(uris);
    const input = {
      ...authorization,
      input: {
        ...authorization.input,
        historySources: items.map(({ runId, assetId, includePrompt }) => ({
          runId,
          assetId,
          includePrompt,
        })),
        sourceAssetIds: uploads,
      },
    };
    expect((await post('/executions', input)).status).toBe(202);
    return input;
  }
  async function document(id: string) {
    const session = await state(id);
    expect(session.status).toBe('completed');
    return designSchemeRevisionDocumentSchema.parse(session.result?.document);
  }
  function runtime() {
    const generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        async sign() {
          throw new Error('No signing');
        },
        async readObject() {
          throw new Error('No read');
        },
        async putObject() {
          throw new Error('No write');
        },
        async removeObjects() {
          throw new Error('No remove');
        },
      },
      { apiIssuer: env.PUBLIC_BASE_URL, upstreamIssuer: env.NEW_API_BASE_URL },
    );
    return new DesignSchemeRunService(database.db, assets, generation);
  }
  async function trial(
    doc: ReturnType<typeof designSchemeRevisionDocumentSchema.parse>,
    refs: string[] = [],
  ) {
    return runtime().prepare(
      owner,
      prepareDesignSchemeRunInputSchema.parse({
        executionId: randomUUID(),
        schemeId: doc.schemeId,
        revisionId: doc.revisionId,
        mode: 'trial',
        brief: '',
        inputValues: { topic: 'City' },
        executionSettings: {
          providerId: 'cloud-default',
          size: '1024x1024',
          quality: 'high',
          outputCount: 1,
          referenceAssetIds: refs,
          promptReferenceSelections: [],
        },
      }),
      owner,
    );
  }
  async function repositoryFiles(paths = ['style.png', 'ignored.png'], color = '#dd0044') {
    const bytes = await sharp({ create: { width: 5, height: 4, channels: 3, background: color } })
      .png()
      .toBuffer();
    github.state.files = paths.map((name) => ({ name, content: bytes }));
    Object.assign(model.state.analyst, {
      referenceImages: paths
        .filter((name) => name !== 'ignored.png')
        .map((path) => ({ path, role: 'style-reference' })),
    });
    return bytes;
  }
  async function ready(
    uris = [repo],
    uploads: string[] = [],
    histories: Array<{ runId: string; assetId: string; includePrompt: boolean }> = [],
  ) {
    const input = await startHistory(histories, uris, uploads);
    for (const _uri of uris) {
      await service.process(owner, input.input.executionId);
      const pending = await state(input.input.executionId);
      expect(pending.status).toBe('confirmation-required');
      expect(
        (
          await post('/confirm-source', {
            executionId: input.input.executionId,
            confirmationId: pending.pendingSource?.confirmationId,
            decision: 'install',
          })
        ).status,
      ).toBe(200);
    }
    return input.input.executionId;
  }
  async function update(old: ReturnType<typeof designSchemeRevisionDocumentSchema.parse>) {
    const detail = await new DesignSchemeService(database.db, assets).get(owner, {
      id: old.schemeId,
    });
    const id = randomUUID();
    const input = {
      executionId: id,
      schemeId: old.schemeId,
      baseRevisionId: old.revisionId,
      expectedVersion: detail.summary.version,
    };
    expect((await post('/executions', { operation: 'check-update', input })).status).toBe(202);
    await service.process(owner, id);
    let pending = await state(id);
    for (let step = 0; step < 34 && pending.status !== 'authorization-required'; step++) {
      expect(['queued', 'preparing', 'confirmation-required']).toContain(pending.status);
      if (pending.status === 'confirmation-required') {
        await post('/confirm-source', {
          executionId: id,
          confirmationId: pending.pendingSource?.confirmationId,
          decision: 'install',
        });
      }
      await service.process(owner, id);
      pending = await state(id);
    }
    expect(pending.status).toBe('authorization-required');
    const scope = await authorized();
    expect(
      (
        await post('/authorize-update', {
          executionId: id,
          expectedSessionVersion: pending.version,
          text: { ...scope.text, maxModelCalls: pending.update!.changes.length + 1 },
        })
      ).status,
    ).toBe(200);
    return id;
  }

  it('adopts only selected exact files as owned reference copies with truthful source, license and real image preparation', async () => {
    const bytes = await repositoryFiles();
    model.state.compiler.inputs.push(
      Object.assign(
        { label: '参考图', kind: 'image', required: true, variable: '' },
        { imageRole: 'style-reference' },
      ),
    );
    const id = await ready();
    const requestCount = github.requests.length;
    github.state.commit = 'd'.repeat(40);
    github.state.files = [];
    await service.process(owner, id);
    const doc = await document(id);
    const fixed = await frozen(id);
    expect(fixed.repositories).toHaveLength(1);
    expect(fixed.repositories?.[0].omittedPaths).toEqual(['ignored.png']);
    expect(doc.repositoryImages).toHaveLength(1);
    expect(doc.repositoryImages?.[0]).toMatchObject({
      relativePath: 'style.png',
      imageRole: 'style-reference',
      assetId: doc.assetIds[0],
    });
    expect(fixed.repositories?.[0].images[0].asset).toMatchObject({
      origin: 'repository',
      role: 'reference',
      license: null,
    });
    expect(doc.fidelity).toBe('adapted');
    expect(doc.compilation.warnings.join(' ')).toContain('未做图片视觉解析');
    const detail = await new DesignSchemeService(database.db, assets).get(owner, {
      id: doc.schemeId,
    });
    expect(detail.document.repositoryImages).toEqual(doc.repositoryImages);
    expect(Buffer.from((await assets.content(owner, doc.assetIds[0])).bytes)).toEqual(bytes);
    expect(JSON.stringify((await trial(doc, doc.assetIds)).plan)).toContain(doc.assetIds[0]);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM generation_runs')).rows[0].n,
    ).toBe(0);
    expect(github.requests).toHaveLength(requestCount);
    expect(model.posts).toHaveLength(2);
    expect(JSON.stringify(model.posts)).not.toContain('image_url');
  });
  it('keeps same-named images in different confirmed repositories distinct and combines history/uploads', async () => {
    await repositoryFiles(['style.png']);
    const h = await history();
    const uploaded = await upload();
    const id = await ready([repo, 'https://github.com/example/second'], [uploaded.stage.id], [h]);
    await service.process(owner, id);
    const doc = await document(id);
    expect(doc.assetIds).toHaveLength(4);
    expect(doc.repositoryImages).toHaveLength(2);
    expect(new Set(doc.repositoryImages?.map((image) => image.snapshotId)).size).toBe(2);
    expect(new Set(doc.repositoryImages?.map((image) => image.assetId)).size).toBe(2);
    expect(JSON.stringify(model.posts.at(-1))).toContain(h.prompt);
    await trial(doc);
  });
  it.each(['missing-path', 'text-path', 'conflicting-role', 'invalid-image'] as const)(
    'rejects %s before Compiler or asset publication',
    async (mode) => {
      await repositoryFiles(['style.png']);
      if (mode === 'invalid-image')
        github.state.files[0].content = Buffer.from('not a decoded PNG');
      if (mode === 'missing-path')
        Object.assign(model.state.analyst, {
          referenceImages: [{ path: 'outside.png', role: 'style-reference' }],
        });
      if (mode === 'text-path')
        Object.assign(model.state.analyst, {
          referenceImages: [{ path: 'README.md', role: 'style-reference' }],
        });
      if (mode === 'conflicting-role')
        Object.assign(model.state.analyst, {
          referenceImages: [
            { path: 'style.png', role: 'style-reference' },
            { path: 'style.png', role: 'subject-reference' },
          ],
        });
      if (mode === 'invalid-image') {
        const input = await startHistory([], [repo]);
        await service.process(owner, input.input.executionId);
        expect((await state(input.input.executionId)).status).toBe('failed');
        expect(model.posts).toHaveLength(0);
        expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(0);
        return;
      }
      const id = await ready();
      await service.process(owner, id);
      expect((await state(id)).status).toBe(mode === 'conflicting-role' ? 'blocked' : 'failed');
      expect(model.posts).toHaveLength(1);
      expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(0);
      await service.process(owner, id);
      expect(model.posts).toHaveLength(1);
    },
  );
  it('deduplicates identical path/role selections and records unselected images', async () => {
    await repositoryFiles();
    Object.assign(model.state.analyst, {
      referenceImages: Array(2).fill({ path: 'style.png', role: 'style-reference' }),
    });
    const id = await ready();
    await service.process(owner, id);
    expect((await document(id)).assetIds).toHaveLength(1);
    expect((await frozen(id)).repositories?.[0].omittedPaths).toEqual(['ignored.png']);
  });
  it('rejects aggregate repository count over64 after durable Analysts but before copying or Compiler', async () => {
    await repositoryFiles(Array.from({ length: 24 }, (_, i) => `image${i}.png`));
    const id = await ready([
      repo,
      'https://github.com/example/second',
      'https://github.com/example/third',
    ]);
    await service.process(owner, id);
    expect((await state(id)).status).toBe('blocked');
    expect(model.posts).toHaveLength(3);
    expect(
      (await database.pool.query('SELECT * FROM generation_reference_uploads')).rows,
    ).toHaveLength(0);
  });
  it('retains copies and provenance through modification without a new source read', async () => {
    const bytes = await repositoryFiles(['style.png']);
    const first = await ready();
    await service.process(owner, first);
    const old = await document(first);
    const detail = await new DesignSchemeService(database.db, assets).get(owner, {
      id: old.schemeId,
    });
    const scope = await authorized();
    const id = randomUUID();
    const reads = github.requests.length;
    await database.pool.query(
      "UPDATE design_scheme_source_preparations SET expires_at=now()-interval '2 days' WHERE snapshot_id=ANY($1::text[])",
      [old.sourceSnapshotIds],
    );
    expect(
      (
        await post('/executions', {
          operation: 'modify',
          text: scope.text,
          input: {
            executionId: id,
            schemeId: old.schemeId,
            baseRevisionId: old.revisionId,
            expectedVersion: detail.summary.version,
            instruction: 'Use more whitespace',
          },
        })
      ).status,
    ).toBe(202);
    await service.process(owner, id);
    const revised = await document(id);
    expect(revised.repositoryImages).toEqual(old.repositoryImages);
    expect(revised.assetIds).toEqual(old.assetIds);
    expect(Buffer.from((await assets.content(owner, revised.assetIds[0])).bytes)).toEqual(bytes);
    expect(github.requests).toHaveLength(reads);
    await trial(revised);
  });
  it('replaces changed-source images atomically, retains unchanged images and protects formal current', async () => {
    const firstBytes = await repositoryFiles(['style.png']);
    github.state.overrides['example/second'] = {
      commit: github.state.commit,
      content: github.state.content,
      files: [...github.state.files],
    };
    const id = await ready([repo, 'https://github.com/example/second']);
    await service.process(owner, id);
    const old = await document(id);
    await database.pool.query(
      "INSERT INTO design_scheme_runs(run_id,user_id,scheme_id,revision_id,mode,status,policy) VALUES($1,$2,$3,$4,'trial','completed','{}')",
      [randomUUID(), owner, old.schemeId, old.revisionId],
    );
    await database.pool.query(
      "UPDATE design_schemes SET status='formal',cover_asset_id=$2 WHERE id=$1",
      [old.schemeId, old.assetIds[0]],
    );
    github.state.commit = 'c'.repeat(40);
    github.state.content = Buffer.from('Updated instructions');
    const nextBytes = await repositoryFiles(['style.png'], '#0033ee');
    const nextId = await update(old);
    await service.process(owner, nextId);
    const next = await document(nextId);
    expect(next.assetIds).toHaveLength(2);
    expect(next.assetIds).not.toContain(old.assetIds[0]);
    expect(next.assetIds).toContain(old.assetIds[1]);
    expect(
      next.repositoryImages?.some(
        (image) => image.snapshotId === old.repositoryImages?.[0].snapshotId,
      ),
    ).toBe(false);
    expect(
      next.repositoryImages?.some(
        (image) => image.snapshotId === old.repositoryImages?.[1].snapshotId,
      ),
    ).toBe(true);
    const added = next.assetIds.find((id) => !old.assetIds.includes(id))!;
    expect(Buffer.from((await assets.content(owner, added)).bytes)).toEqual(nextBytes);
    expect(Buffer.from((await assets.content(owner, old.assetIds[0])).bytes)).toEqual(firstBytes);
    const schemes = new DesignSchemeService(database.db, assets);
    expect((await schemes.get(owner, { id: old.schemeId })).document).toEqual(old);
    expect(
      (
        await schemes.get(owner, {
          id: old.schemeId,
          revision: { kind: 'working-draft', revisionId: next.revisionId },
        })
      ).document,
    ).toEqual(next);
    await trial(next);
    const bound = (
      await database.pool.query(
        'SELECT source_snapshot_id FROM design_scheme_source_bindings WHERE revision_id=$1',
        [next.revisionId],
      )
    ).rows
      .map((row) => row.source_snapshot_id)
      .sort();
    expect(bound).toEqual([...next.sourceSnapshotIds].sort());
  });
  it('rolls back promotion and draft then resumes the same adopted IDs in a distinct PID with no repeated model calls', async () => {
    await repositoryFiles(['style.png']);
    const id = await ready();
    await database.pool.query(
      "CREATE FUNCTION repo_asset_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER repo_asset_failure AFTER INSERT ON design_scheme_assets FOR EACH ROW EXECUTE FUNCTION repo_asset_failure()",
    );
    try {
      await expect(service.process(owner, id)).rejects.toThrow('temporarily unavailable');
      expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(0);
      expect(await copies(id)).toHaveLength(1);
    } finally {
      await database.pool.query(
        'DROP TRIGGER repo_asset_failure ON design_scheme_assets; DROP FUNCTION repo_asset_failure()',
      );
    }
    const fixed = await frozen(id);
    const recovered = await oneProcess(id);
    expect(recovered.pid).not.toBe(process.pid);
    expect(recovered.session.status).toBe('completed');
    expect((await document(id)).repositoryImages?.[0].assetId).toBe(
      fixed.repositories?.[0].images[0].asset.id,
    );
    expect(model.posts).toHaveLength(2);
  });
  it('records an explicit no-adoption result and leaves all unselected source images out of assets', async () => {
    await repositoryFiles();
    Object.assign(model.state.analyst, { referenceImages: [] });
    const id = await ready();
    await service.process(owner, id);
    const doc = await document(id);
    expect(doc.assetIds).toEqual([]);
    expect(doc.repositoryImages).toEqual([]);
    expect(doc.compilation.warnings.join(' ')).toContain('未采用 2 张');
    expect((await frozen(id)).repositories?.[0].omittedPaths).toEqual(['ignored.png', 'style.png']);
    expect(
      (await database.pool.query('SELECT * FROM generation_reference_uploads')).rows,
    ).toHaveLength(0);
  });
  it('rejects rewritten or stripped repository provenance and cross-owner image reads', async () => {
    await repositoryFiles(['style.png']);
    const id = await ready();
    await service.process(owner, id);
    const doc = await document(id);
    const detail = await new DesignSchemeService(database.db, assets).get(owner, {
      id: doc.schemeId,
    });
    const forged = {
      ...doc,
      revisionId: randomUUID(),
      parentRevisionId: doc.revisionId,
      repositoryImages: doc.repositoryImages?.map((image) => ({
        ...image,
        relativePath: 'README.md',
      })),
    };
    await expect(
      new DesignSchemeService(database.db, assets).update(owner, {
        schemeId: doc.schemeId,
        baseRevisionId: doc.revisionId,
        expectedVersion: detail.summary.version,
        document: forged,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      new DesignSchemeService(database.db, assets).update(owner, {
        schemeId: doc.schemeId,
        baseRevisionId: doc.revisionId,
        expectedVersion: detail.summary.version,
        document: { ...forged, repositoryImages: [] },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(
      (await new DesignSchemeService(database.db, assets).get(owner, { id: doc.schemeId }))
        .document,
    ).toEqual(doc);
    await expect(assets.content(secondOwner, doc.assetIds[0])).rejects.toBeDefined();
  });
  it('concurrent free adoption chooses one stable context and leaves losing copies registered', async () => {
    await repositoryFiles(['style.png']);
    const id = await ready();
    const originalStage = assets.stage.bind(assets);
    let arrived = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    assets.stage = async (...args) => {
      arrived++;
      await held;
      return originalStage(...args);
    };
    const first = service.process(owner, id);
    await expect.poll(() => arrived).toBe(1);
    const second = service.process(owner, id);
    await expect.poll(() => arrived).toBe(2);
    release();
    await Promise.all([first, second]);
    const doc = await document(id);
    expect(doc.repositoryImages?.[0].assetId).toBe(
      (await frozen(id)).repositories?.[0].images[0].asset.id,
    );
    expect(model.posts).toHaveLength(2);
    expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(1);
    expect(
      (await database.pool.query('SELECT * FROM generation_reference_uploads')).rows,
    ).toHaveLength(1);
  });
  it.each(['cancel', 'unknown', 'copy-tamper'] as const)(
    'preserves %s during adoption/Compiler and never silently re-calls a paid role',
    async (kind) => {
      await repositoryFiles(['style.png']);
      const id = await ready();
      const originalStage = assets.stage.bind(assets);
      assets.stage = async (...args) => {
        const copy = await originalStage(...args);
        if (kind === 'cancel') await service.cancel(owner, id);
        if (kind === 'unknown') model.state.mode = 'drop';
        if (kind === 'copy-tamper')
          await database.pool.query(
            'UPDATE generation_reference_uploads SET byte_size=byte_size+1 WHERE id=$1',
            [copy.id],
          );
        return copy;
      };
      await service.process(owner, id);
      const session = await state(id);
      expect(session.status).toBe(kind === 'cancel' ? 'cancelled' : 'blocked');
      expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(0);
      expect(model.posts).toHaveLength(kind === 'unknown' ? 2 : 1);
      await service.process(owner, id);
      expect(model.posts).toHaveLength(kind === 'unknown' ? 2 : 1);
      expect(
        (await database.pool.query('SELECT * FROM generation_reference_uploads')).rows,
      ).toHaveLength(1);
    },
  );
  it('recovers a failed free adoption write in a new PID without repeating Analyst', async () => {
    await repositoryFiles(['style.png']);
    const id = await ready();
    await database.pool.query(
      "CREATE FUNCTION repo_adoption_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.materials->'repositories' IS NOT NULL THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER repo_adoption_failure BEFORE UPDATE ON design_scheme_agent_sessions FOR EACH ROW EXECUTE FUNCTION repo_adoption_failure()",
    );
    try {
      await expect(service.process(owner, id)).rejects.toThrow('temporarily unavailable');
      expect((await state(id)).status).toBe('compiling');
      expect(model.posts).toHaveLength(1);
    } finally {
      await database.pool.query(
        'DROP TRIGGER repo_adoption_failure ON design_scheme_agent_sessions; DROP FUNCTION repo_adoption_failure()',
      );
    }
    const recovered = await oneProcess(id);
    expect(recovered.pid).not.toBe(process.pid);
    expect(recovered.session.status).toBe('completed');
    expect(model.posts).toHaveLength(2);
    expect(
      (await database.pool.query('SELECT * FROM generation_reference_uploads')).rows,
    ).toHaveLength(1);
  });
  it('rolls back new update assets and pointers then recovers the exact adopted images in a new PID', async () => {
    await repositoryFiles(['style.png']);
    const id = await ready();
    await service.process(owner, id);
    const old = await document(id);
    github.state.commit = 'd'.repeat(40);
    await repositoryFiles(['style.png'], '#1111dd');
    const updateId = await update(old);
    model.posts.length = 0;
    await database.pool.query(
      "CREATE FUNCTION repo_update_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER repo_update_failure AFTER INSERT ON design_scheme_assets FOR EACH ROW EXECUTE FUNCTION repo_update_failure()",
    );
    try {
      await expect(service.process(owner, updateId)).rejects.toThrow('temporarily unavailable');
      expect(
        (await new DesignSchemeService(database.db, assets).get(owner, { id: old.schemeId }))
          .document,
      ).toEqual(old);
      expect(await copies(updateId)).toHaveLength(1);
    } finally {
      await database.pool.query(
        'DROP TRIGGER repo_update_failure ON design_scheme_assets; DROP FUNCTION repo_update_failure()',
      );
    }
    const fixed = await frozen(updateId);
    expect((await oneProcess(updateId)).session.status).toBe('completed');
    const revised = await document(updateId);
    expect(revised.assetIds).toEqual([fixed.repositories?.[0].images[0].asset.id]);
    expect(model.posts).toHaveLength(2);
    await trial(revised);
  });
  it('retains a durable adoption across actual SIGKILL after Compiler POST and never resends an unknown call', async () => {
    await repositoryFiles(['style.png']);
    const id = await ready();
    model.state.mode = 'hold-compiler';
    const child = spawn(
      'pnpm',
      ['exec', 'tsx', 'src/__tests__/fixtures/text-agent-process.ts', id],
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
    let ended = false;
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => {
        ended = true;
        resolve();
      });
    });
    let pid = 0;
    try {
      await expect.poll(() => model.posts.length, { timeout: 20_000 }).toBe(2);
      pid = Number(stdout.match(/TEXT_PID=(\d+)/)?.[1]);
      expect(pid).toBeGreaterThan(0);
      const before = await frozen(id);
      process.kill(pid, 'SIGKILL');
      await exited;
      const resumed = await oneProcess(id);
      expect(resumed.pid).not.toBe(pid);
      expect(resumed.session.status).toBe('compiling');
      expect(await frozen(id)).toEqual(before);
      await service.cancel(owner, id);
      await database.pool.query(
        "UPDATE design_scheme_text_calls SET lease_until=now()-interval '1 second' WHERE execution_id=$1",
        [id],
      );
      await service.reconcile();
      const calls = (
        await database.pool.query(
          'SELECT status FROM design_scheme_text_calls WHERE execution_id=$1 ORDER BY ordinal',
          [id],
        )
      ).rows;
      expect(calls.map((call) => call.status)).toEqual(['completed', 'unknown']);
      expect((await state(id)).status).toBe('cancelled');
      expect(model.posts).toHaveLength(2);
      expect(await copies(id)).toHaveLength(1);
      expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(0);
    } finally {
      model.release();
      if (!ended && pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already exited */
        }
      }
      if (!ended) child.kill('SIGTERM');
      await exited;
    }
  }, 45_000);
  it('detects a lost adopted copy while Compiler is in flight without publishing or re-calling', async () => {
    await repositoryFiles(['style.png']);
    const id = await ready();
    model.state.mode = 'hold-compiler';
    const pending = service.process(owner, id);
    try {
      await expect.poll(() => model.posts.length).toBe(2);
      const staged = await copies(id);
      s3.objects.delete(staged[0].object_key);
    } finally {
      model.release();
    }
    await pending;
    expect((await state(id)).status).toBe('blocked');
    expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(0);
    await service.process(owner, id);
    expect(model.posts).toHaveLength(2);
  });
  it('an update may explicitly adopt no replacement image while preserving the old revision copy', async () => {
    const bytes = await repositoryFiles(['style.png']);
    const id = await ready();
    await service.process(owner, id);
    const old = await document(id);
    github.state.commit = 'e'.repeat(40);
    Object.assign(model.state.analyst, { referenceImages: [] });
    const nextId = await update(old);
    await service.process(owner, nextId);
    const next = await document(nextId);
    expect(next.assetIds).toEqual([]);
    expect(next.repositoryImages).toEqual([]);
    expect(next.compilation.warnings.join(' ')).toContain('移除新修订中 1 张');
    expect(next.compilation.warnings).not.toContain(
      '已保留原方案图片；本次文本编译未做图片视觉解析。',
    );
    expect(Buffer.from((await assets.content(owner, old.assetIds[0])).bytes)).toEqual(bytes);
    await trial(next);
  });
});
