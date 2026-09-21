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
import { execFile } from 'node:child_process';
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

describeDb('cloud Agent owned history and selected prompts (real PG and HTTP)', () => {
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
  it('freezes true history provenance, full selected prompt, independent image and both semantic source roles', async () => {
    const original = await history();
    const input = await startHistory([original]);
    const id = input.input.executionId;
    const frozenInput = await frozen(id);
    const snapshot = sourceSnapshotSchema.parse(frozenInput.history?.snapshot);
    const copy = referenceAssetMetadataSchema.parse(frozenInput.history?.assets[0]);
    expect(snapshot.kind).toBe('history');
    expect(snapshot.historyItems?.[0]).toMatchObject({
      selection: { runId: original.runId, assetId: original.assetId, includePrompt: true },
      imageAssetId: copy.id,
      prompt: original.prompt,
    });
    const textFile = sourceFileMetadataSchema.parse(
      snapshot.files.find((file) => file.kind === 'text'),
    );
    expect(textFile.contentHash).toBe(createHash('sha256').update(original.prompt).digest('hex'));
    expect(textFile.sizeBytes).toBe(Buffer.byteLength(original.prompt));
    // Delete real original DB history and bytes after admission. The immutable context must survive.
    await database.pool.query('DELETE FROM generation_runs WHERE id=$1', [original.runId]);
    s3.objects.delete(original.key);
    await service.process(owner, id);
    const doc = await document(id);
    expect(doc.assetIds).toEqual([copy.id]);
    expect(
      doc.sources
        .filter((source) => source.snapshotId === snapshot.id)
        .map((source) => source.role),
    ).toEqual(['example', 'context']);
    expect(doc.sources.some((source) => source.kind.startsWith('github'))).toBe(false);
    expect(doc.fidelity).toBe('adapted');
    const detail = await new DesignSchemeService(database.db, assets).get(owner, {
      id: doc.schemeId,
    });
    expect(detail.sourceSnapshots).toEqual([snapshot]);
    expect(detail.assets[0]).toMatchObject({
      id: copy.id,
      origin: 'cloud-run',
      role: 'example',
      contentHash: original.hash,
    });
    expect(Buffer.from((await assets.content(owner, copy.id)).bytes)).toEqual(original.bytes);
    expect(model.posts).toHaveLength(1);
    expect(model.posts[0].messages[1].content).toContain(original.prompt);
    expect(model.posts[0].messages[1].content).toContain(textFile.relativePath);
    expect(model.posts[0].messages[1].content).toContain('未接收历史图片像素');
    const bound = (
      await database.pool.query(
        'SELECT source_snapshot_id,role FROM design_scheme_source_bindings WHERE revision_id=$1',
        [doc.revisionId],
      )
    ).rows;
    expect(bound).toEqual([{ source_snapshot_id: snapshot.id, role: 'example' }]);
    expect((await trial(doc)).executionBinding?.model).toBe('musefold-image-pro');
  });
  it('does not load an unselected private prompt into the snapshot, model, result or events', async () => {
    const original = await history('PRIVATE_PROMPT_NOT_SELECTED');
    await database.pool.query('UPDATE generation_runs SET prompt_snapshot=NULL WHERE id=$1', [
      original.runId,
    ]);
    const input = await startHistory([{ ...original, includePrompt: false }]);
    await service.process(owner, input.input.executionId);
    const doc = await document(input.input.executionId);
    const material = await frozen(input.input.executionId);
    expect(material.history?.snapshot.historyItems?.[0].prompt).toBeNull();
    expect(material.history?.snapshot.files).toHaveLength(1);
    expect(JSON.stringify([doc, material, model.posts])).not.toContain(
      'PRIVATE_PROMPT_NOT_SELECTED',
    );
    expect(doc.sources.filter((source) => source.kind === 'conversation-turn')).toHaveLength(0);
    expect(model.posts[0].messages[1].content).toContain('用户未附带');
  });
  it.each([
    'foreign',
    'wrong-run',
    'deleted',
    'pending',
    'hash',
    'key',
    'dimensions',
    'missing-prompt',
    'changed-prompt',
    'too-long',
  ] as const)('rejects %s history before model discovery/POST', async (kind) => {
    const item = await history('original', kind === 'foreign' ? secondOwner : owner);
    const input = await authorized();
    if (kind === 'wrong-run') item.runId = randomUUID();
    if (kind === 'deleted')
      await database.pool.query('UPDATE generation_runs SET deleted_at=now() WHERE id=$1', [
        item.runId,
      ]);
    if (kind === 'pending')
      await database.pool.query("UPDATE generation_runs SET status='running' WHERE id=$1", [
        item.runId,
      ]);
    if (kind === 'hash')
      await database.pool.query(
        "UPDATE generation_assets SET checksum_sha256=repeat('f',64) WHERE id=$1",
        [item.assetId],
      );
    if (kind === 'key')
      await database.pool.query(
        "UPDATE generation_assets SET object_key='outside-owned-history' WHERE id=$1",
        [item.assetId],
      );
    if (kind === 'dimensions')
      await database.pool.query('UPDATE generation_assets SET width=5 WHERE id=$1', [item.assetId]);
    if (kind === 'missing-prompt')
      await database.pool.query('UPDATE generation_runs SET prompt_snapshot=NULL WHERE id=$1', [
        item.runId,
      ]);
    if (kind === 'changed-prompt')
      await database.pool.query(
        "UPDATE generation_runs SET prompt_snapshot=jsonb_set(prompt_snapshot,'{finalPrompt}','\"changed\"') WHERE id=$1",
        [item.runId],
      );
    if (kind === 'too-long')
      await database.pool.query(
        'UPDATE generation_runs SET request=$2,prompt_snapshot=$3 WHERE id=$1',
        [
          item.runId,
          JSON.stringify({ prompt: 'x'.repeat(8001) }),
          JSON.stringify({ schemaVersion: 1, finalPrompt: 'x'.repeat(8001) }),
        ],
      );
    model.gets.length = 0;
    const response = await post('/executions', {
      ...input,
      input: {
        ...input.input,
        historySources: [{ runId: item.runId, assetId: item.assetId, includePrompt: true }],
      },
    });
    expect(response.status).toBe(409);
    expect(model.gets).toHaveLength(0);
    expect(model.posts).toHaveLength(0);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_agent_sessions'))
        .rows[0].n,
    ).toBe(0);
  });
  it('rejects history deletion racing free copying before admission', async () => {
    const item = await history();
    const stage = assets.stage.bind(assets);
    assets.stage = async (...args) => {
      const value = await stage(...args);
      await database.pool.query('DELETE FROM generation_runs WHERE id=$1', [item.runId]);
      return value;
    };
    const input = await authorized();
    expect(
      (
        await post('/executions', {
          ...input,
          input: {
            ...input.input,
            historySources: [{ runId: item.runId, assetId: item.assetId, includePrompt: true }],
          },
        })
      ).status,
    ).toBe(409);
    expect(model.posts).toHaveLength(0);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_agent_sessions'))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await database.pool.query('SELECT count(*)::int AS n FROM generation_reference_uploads'))
        .rows[0].n,
    ).toBe(1);
  });
  it('combines uploaded images, GitHub reports and selected history prompts with truthful evidence', async () => {
    const h = await history('HISTORY_LAYOUT_RULE');
    const uploadItem = await upload();
    const input = await startHistory([h], [repo], [uploadItem.stage.id]);
    await service.process(owner, input.input.executionId);
    const waiting = await state(input.input.executionId);
    expect(waiting.status).toBe('confirmation-required');
    await post('/confirm-source', {
      executionId: input.input.executionId,
      confirmationId: waiting.pendingSource?.confirmationId,
      decision: 'install',
    });
    const fixed = await frozen(input.input.executionId);
    const path = fixed.history?.snapshot.historyItems?.[0].promptPath ?? 'missing';
    Object.assign(model.state.compiler.constraints[0], { evidencePaths: [path] });
    await service.process(owner, input.input.executionId);
    const doc = await document(input.input.executionId);
    expect(doc.sourceSnapshotIds).toHaveLength(2);
    expect(doc.assetIds).toEqual([fixed.uploads[0].asset.id, fixed.history?.assets[0].id]);
    const compiler = model.posts[1].messages[1].content;
    expect(compiler).toContain('仓库分析报告');
    expect(compiler).toContain('HISTORY_LAYOUT_RULE');
    expect(compiler).toContain('已保存 1 张图片');
    const evidence = doc.sources.find((source) => source.kind === 'history-image');
    expect(doc.constraints[0].sourceIds).toEqual([evidence?.id]);
    expect(model.posts).toHaveLength(2);
    expect((await trial(doc)).plan.steps.length).toBeGreaterThan(0);
  });
  it('replays exact context after original history is gone, with no model discovery or new copies', async () => {
    const h = await history();
    const input = await startHistory([h]);
    const fixed = await frozen(input.input.executionId);
    await database.pool.query('DELETE FROM generation_runs WHERE id=$1', [h.runId]);
    s3.objects.delete(h.key);
    model.gets.length = 0;
    const count = s3.writes.length;
    expect((await post('/executions', input)).status).toBe(202);
    expect(await frozen(input.input.executionId)).toEqual(fixed);
    expect(s3.writes).toHaveLength(count);
    expect(model.gets).toHaveLength(0);
    await service.process(owner, input.input.executionId);
    expect((await state(input.input.executionId)).status).toBe('completed');
  });
  it('rolls back history metadata, assets and draft together, then resumes in a new PID with one POST', async () => {
    const h = await history();
    const input = await startHistory([h]);
    const id = input.input.executionId;
    const fixed = await frozen(id);
    await database.pool.query(
      "CREATE FUNCTION history_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER history_failure AFTER INSERT ON design_scheme_assets FOR EACH ROW EXECUTE FUNCTION history_failure()",
    );
    try {
      await expect(service.process(owner, id)).rejects.toThrow('temporarily unavailable');
      expect(
        (
          await database.pool.query('SELECT * FROM design_scheme_source_snapshots WHERE id=$1', [
            fixed.history?.snapshot.id,
          ])
        ).rows,
      ).toHaveLength(0);
      expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(0);
      expect(await copies(id)).toHaveLength(1);
    } finally {
      await database.pool.query(
        'DROP TRIGGER history_failure ON design_scheme_assets; DROP FUNCTION history_failure()',
      );
    }
    await database.pool.query('DELETE FROM generation_runs WHERE id=$1', [h.runId]);
    s3.objects.delete(h.key);
    const resumed = await oneProcess(id);
    expect(resumed.pid).not.toBe(process.pid);
    expect(resumed.session.status).toBe('completed');
    expect(model.posts).toHaveLength(1);
    expect(
      Buffer.from((await assets.content(owner, fixed.history?.assets[0].id ?? 'missing')).bytes),
    ).toEqual(h.bytes);
  });
  it.each(['cancel', 'unknown', 'copy-lost'] as const)(
    'preserves terminal %s semantics and never sends another paid call',
    async (kind) => {
      const input = await startHistory([await history()]);
      const id = input.input.executionId;
      if (kind === 'unknown') {
        model.state.mode = 'drop';
        await service.process(owner, id);
        expect((await state(id)).blocker).toBe('AGENT_TEXT_RESULT_UNKNOWN');
      } else {
        model.state.mode = 'hold';
        const pending = service.process(owner, id);
        await expect.poll(() => model.posts.length).toBe(1);
        if (kind === 'cancel') await service.cancel(owner, id);
        else s3.objects.delete((await copies(id))[0].object_key);
        model.release();
        await pending;
        expect((await state(id)).status).toBe(kind === 'cancel' ? 'cancelled' : 'blocked');
      }
      await service.process(owner, id);
      expect(model.posts).toHaveLength(1);
      expect((await database.pool.query('SELECT * FROM design_schemes')).rows).toHaveLength(0);
    },
  );
  it('rejects caller-authored history provenance in deterministic creation', async () => {
    const input = await startHistory([await history()]);
    await service.process(owner, input.input.executionId);
    const doc = await document(input.input.executionId);
    const fixed = await frozen(input.input.executionId);
    await expect(
      new DesignSchemeService(database.db, assets).create(owner, {
        executionId: randomUUID(),
        brief: 'forged',
        sourceUris: [],
        sourcePackages: [],
        sourceAssets: [],
        historySources: [],
        sourceBindings: doc.sources,
        sourceAssetIds: [],
        sourceSnapshots: [sourceSnapshotSchema.parse(fixed.history?.snapshot)],
        document: { ...doc, schemeId: randomUUID(), revisionId: randomUUID(), assetIds: [] },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it.each(['modify', 'update'] as const)(
    'preserves history, image references and formal current through %s with real draft preparation',
    async (operation) => {
      const h = await history('History style stays traceable');
      const item = await upload();
      const input = await startHistory([h], [repo], [item.stage.id]);
      await service.process(owner, input.input.executionId);
      const waiting = await state(input.input.executionId);
      await post('/confirm-source', {
        executionId: input.input.executionId,
        confirmationId: waiting.pendingSource?.confirmationId,
        decision: 'install',
      });
      await service.process(owner, input.input.executionId);
      const old = await document(input.input.executionId);
      const frozenInput = await frozen(input.input.executionId);
      const historyId = frozenInput.history?.snapshot.id;
      await database.pool.query(
        "INSERT INTO design_scheme_runs(run_id,user_id,scheme_id,revision_id,mode,status,policy) VALUES($1,$2,$3,$4,'trial','completed','{}')",
        [randomUUID(), owner, old.schemeId, old.revisionId],
      );
      await database.pool.query(
        "UPDATE design_schemes SET status='formal',cover_asset_id=$2 WHERE id=$1",
        [old.schemeId, old.assetIds[0]],
      );
      await database.pool.query('DELETE FROM generation_runs WHERE id=$1', [h.runId]);
      s3.objects.delete(h.key);
      model.posts.length = 0;
      model.gets.length = 0;
      const detail = await new DesignSchemeService(database.db, assets).get(owner, {
        id: old.schemeId,
      });
      const scope = await authorized();
      const id = randomUUID();
      const baseInput = {
        executionId: id,
        schemeId: old.schemeId,
        baseRevisionId: old.revisionId,
        expectedVersion: detail.summary.version,
      };
      if (operation === 'modify') {
        expect(
          (
            await post('/executions', {
              operation: 'modify',
              text: scope.text,
              input: { ...baseInput, instruction: 'Use more whitespace' },
            })
          ).status,
        ).toBe(202);
      } else {
        github.state.commit = 'c'.repeat(40);
        github.state.content = Buffer.from('Updated layout instructions');
        expect(
          (await post('/executions', { operation: 'check-update', input: baseInput })).status,
        ).toBe(202);
        await service.process(owner, id);
        const nextSource = await state(id);
        expect(nextSource.status).toBe('confirmation-required');
        await post('/confirm-source', {
          executionId: id,
          confirmationId: nextSource.pendingSource?.confirmationId,
          decision: 'install',
        });
        await service.process(owner, id);
        const approval = await state(id);
        expect(approval.status).toBe('authorization-required');
        expect(
          (
            await post('/authorize-update', {
              executionId: id,
              expectedSessionVersion: approval.version,
              text: { ...scope.text, maxModelCalls: 2 },
            })
          ).status,
        ).toBe(200);
        model.state.compiler.fidelity = 'faithful'; // Preserved images still cannot gain a visual fidelity claim.
      }
      await service.process(owner, id);
      const next = await document(id);
      expect(next.assetIds).toEqual(old.assetIds);
      expect(next.sourceSnapshotIds).toContain(historyId);
      expect(next.fidelity).toBe('adapted');
      expect(next.compilation.warnings.join(' ')).toContain('未做图片视觉解析');
      const schemes = new DesignSchemeService(database.db, assets);
      expect((await schemes.get(owner, { id: old.schemeId })).document).toEqual(old);
      const draft = await schemes.get(owner, {
        id: old.schemeId,
        revision: { kind: 'working-draft', revisionId: next.revisionId },
      });
      expect(draft.sourceSnapshots.find((snapshot) => snapshot.id === historyId)).toEqual(
        frozenInput.history?.snapshot,
      );
      expect((await trial(next)).executionBinding?.model).toBe('musefold-image-pro');
      expect(
        Buffer.from(
          (await assets.content(owner, frozenInput.history?.assets[0].id ?? 'missing')).bytes,
        ),
      ).toEqual(h.bytes);
      expect(model.posts).toHaveLength(operation === 'modify' ? 1 : 2);
      const bindings = (
        await database.pool.query(
          'SELECT source_snapshot_id FROM design_scheme_source_bindings WHERE revision_id=$1',
          [next.revisionId],
        )
      ).rows
        .map((row) => row.source_snapshot_id)
        .sort();
      expect(bindings).toEqual([...next.sourceSnapshotIds].sort());
    },
  );
  it('uses a history copy as a required-image reference in the real run planner', async () => {
    const h = await history();
    const input = await startHistory([h]);
    model.state.compiler.inputs.push(
      Object.assign(
        { label: '参考图', kind: 'image', required: true, variable: '' },
        { imageRole: 'subject-reference' },
      ),
    );
    await service.process(owner, input.input.executionId);
    const doc = await document(input.input.executionId);
    expect(JSON.stringify((await trial(doc, doc.assetIds)).plan)).toContain(doc.assetIds[0]);
    expect(
      (
        await database.pool.query('SELECT count(*)::int AS n FROM generation_runs WHERE id<>$1', [
          h.runId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
  it('rejects more than eight included prompts and mixed material counts over 64 before sending', async () => {
    const input = await authorized();
    const historySources = Array.from({ length: 9 }, () => ({
      runId: randomUUID(),
      assetId: randomUUID(),
      includePrompt: true,
    }));
    expect(
      (await post('/executions', { ...input, input: { ...input.input, historySources } })).status,
    ).toBe(409);
    expect(
      (
        await post('/executions', {
          ...input,
          input: {
            ...input.input,
            executionId: randomUUID(),
            sourceAssetIds: Array.from({ length: 64 }, () => randomUUID()),
            historySources: historySources.slice(0, 1),
          },
        })
      ).status,
    ).toBe(409);
    expect(s3.writes).toHaveLength(0);
    expect(model.posts).toHaveLength(0);
  });
  it('detects changed frozen prompt data before any model call', async () => {
    const input = await startHistory([await history()]);
    const id = input.input.executionId;
    await database.pool.query(
      `UPDATE design_scheme_agent_sessions SET materials=jsonb_set(materials,'{history,snapshot,historyItems,0,prompt}','"altered after admission"') WHERE execution_id=$1`,
      [id],
    );
    await service.process(owner, id);
    expect(await state(id)).toMatchObject({
      status: 'blocked',
      blocker: 'AGENT_MATERIALS_INVALID',
    });
    expect(model.posts).toHaveLength(0);
  });
});
