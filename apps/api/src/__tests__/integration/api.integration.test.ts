import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type {
  NewApiClient,
  RelayApiToken,
  RelayAuthSession,
  RelayUser,
} from '@musefold/new-api-client';
import {
  MAX_OBJECT_CLEANUP_ATTEMPTS,
  type MusefoldDatabase,
  createDatabase,
  markObjectCleanupAttemptFailed,
  migrateDatabase,
} from '@musefold/db';
import { runMigrations } from 'graphile-worker';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createAuth } from '../../auth/index.js';
import { loadEnv } from '../../env.js';
import { AccountService } from '../../modules/account/service.js';
import type { AssetUrlSigner } from '../../modules/generation/s3-signer.js';
import { GenerationService } from '../../modules/generation/service.js';
import { SkillService } from '../../modules/mcp/skills.js';
import { PromptService } from '../../modules/prompts/service.js';
import { RateLimiter } from '../../modules/rate-limit/service.js';
import { SyncService } from '../../modules/sync/service.js';
import { WorkbenchService } from '../../modules/workbench/service.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';
const describeDb = runDatabaseTests ? describe : describe.skip;

const RELAY_USER: RelayUser = { id: 42, username: 'tester', quota: 2_000_000, group: 'default' };

function relaySession(): RelayAuthSession {
  return {
    jwt: `jwt-${Date.now()}`,
    jwtExpiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    refreshToken: 'refresh-token',
    user: RELAY_USER,
  };
}

/** 假 New API:凭据校验/余额/兑换全部走内存实现。 */
function createFakeNewApi(): NewApiClient {
  const tokens: RelayApiToken[] = [];
  let quota = RELAY_USER.quota;
  return {
    async register() {},
    async login({ username, password }) {
      if (password !== 'correct-password') {
        throw Object.assign(new Error('用户名或密码错误'), { code: 'credentials' });
      }
      // newApiUserId 全局唯一(一个中继账号=一个云端用户),每个用户名派生独立 id。
      const id =
        username === RELAY_USER.username
          ? RELAY_USER.id
          : 10_000 + [...username].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      return { ...relaySession(), user: { ...RELAY_USER, id, username } };
    },
    async refresh() {
      return relaySession();
    },
    async getSelf() {
      return { ...RELAY_USER, quota };
    },
    async listUserModels() {
      return ['musefold-image-pro'];
    },
    async createToken(_jwt, input) {
      tokens.push({ id: tokens.length + 1, name: input.name, status: 1, keyMasked: 'sk-***' });
    },
    async listTokens() {
      return [...tokens];
    },
    async fetchTokenKey(_jwt, tokenId) {
      return `sk-full-${tokenId}`;
    },
    async redeem(_jwt, code) {
      if (code !== 'GOOD-CODE') {
        throw Object.assign(new Error('兑换码无效'), { code: 'redeem' });
      }
      quota += 500_000;
      return { quotaAdded: 500_000 };
    },
    async getPricing() {
      return { version: 'v1', groupRatio: {}, models: [] };
    },
    async getNotices() {
      return [];
    },
  };
}

const purgedObjectKeys: string[][] = [];
const putObjects: Array<{ objectKey: string; byteLength: number; contentType: string }> = [];
let removeObjectsError: Error | null = null;
let putObjectError: Error | null = null;
const fakeSigner: AssetUrlSigner = {
  // 故意用非默认值:验证契约 expiresAt 跟随签名 TTL 而不是硬编码。
  urlTtlSeconds: 7_200,
  async sign(objectKey) {
    return { url: `https://cdn.test/${objectKey}?sig=x`, expiresAt: new Date().toISOString() };
  },
  async putObject(objectKey, body, contentType) {
    if (putObjectError) throw putObjectError;
    putObjects.push({ objectKey, byteLength: body.byteLength, contentType });
  },
  async removeObjects(objectKeys) {
    purgedObjectKeys.push(objectKeys);
    if (removeObjectsError) throw removeObjectsError;
  },
};

function designSchemeDocument(
  schemeId: string,
  revisionId: string,
  parentRevisionId: string | null = null,
): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId,
    schemeId,
    name: '云端编辑海报',
    summary: '严格网格与克制配色的编辑海报方案。',
    fidelity: 'faithful',
    sources: [],
    sourceSnapshotIds: [],
    inputs: [{ id: 'subject', label: '主题', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'prompt_main',
        order: 0,
        kind: 'input-template',
        template: '{{subject}}',
        variables: ['subject'],
        sourceIds: [],
      },
    ],
    assetIds: [],
    compilation: {
      compiledAt: '2026-09-01T00:00:00.000Z',
      model: { model: 'integration-test-model' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    parentRevisionId,
    createdBy: 'user',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function parseJsonColumn(value: unknown): Record<string, unknown> {
  return typeof value === 'string'
    ? (JSON.parse(value) as Record<string, unknown>)
    : (value as Record<string, unknown>);
}

describeDb('API 集成(真 PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  let cookie = '';

  const request = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: container.getConnectionUri(),
      BETTER_AUTH_SECRET: 'integration-test-secret',
      NEW_API_BASE_URL: 'https://new-api.test',
      CREDENTIAL_ENCRYPTION_KEY: 'integration-test-encryption-key',
    });
    const created = createDatabase(env.DATABASE_URL, { max: 5 });
    db = created.db;
    pool = created.pool;
    await migrateDatabase(db);
    await runMigrations({ pgPool: pool });

    const newApi = createFakeNewApi();
    const account = new AccountService({
      db,
      newApi,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
    });
    const auth = createAuth({
      env,
      db,
      newApi,
      hooks: { onSessionEstablished: (input) => account.persistSessionCredentials(input) },
    });
    const prompts = new PromptService(db);
    app = createApp({
      env,
      db,
      auth,
      rateLimiter: new RateLimiter(db, env.BETTER_AUTH_SECRET),
      services: {
        account,
        prompts,
        sync: new SyncService(db, prompts),
        workbench: new WorkbenchService(db),
        generation: new GenerationService(db, fakeSigner),
        skills: new SkillService(db),
      },
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('健康检查与 OpenAPI 文档可访问', async () => {
    expect((await request('/healthz')).status).toBe(200);
    const doc = await request('/api/v1/openapi.json');
    expect(doc.status).toBe(200);
    const body = (await doc.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toContain('/api/v1/prompts');
  });

  it('未登录访问业务 API 返回 401', async () => {
    const response = await request('/api/v1/prompts');
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('错误密码登录被 New API 委托拒绝', async () => {
    const response = await request('/api/auth/sign-in/new-api', {
      method: 'POST',
      body: JSON.stringify({ email: 'tester@musefold.app', password: 'wrong' }),
    });
    expect(response.status).toBe(401);
  });

  it('注册/登录建立会话并固化生图凭据', async () => {
    const response = await request('/api/auth/sign-up/new-api', {
      method: 'POST',
      body: JSON.stringify({ email: 'tester@musefold.app', password: 'correct-password' }),
    });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    cookie = (setCookie ?? '')
      .split(/,(?=[^;]+=)/)
      .map((part) => part.split(';')[0])
      .join('; ');

    const status = await request('/api/v1/account/status');
    expect(status.status).toBe(200);
    // username 来自 New API getSelf(事实源),不是登录邮箱。
    const summary = (await status.json()) as { username: string; quota: number };
    expect(summary.username).toBe('tester');
    expect(summary.quota).toBe(2_000_000);
  });

  it('兑换码成功并返回新余额', async () => {
    const bad = await request('/api/v1/account/redeem', {
      method: 'POST',
      body: JSON.stringify({ code: 'BAD-CODE' }),
    });
    expect(bad.status).toBe(400);

    const good = await request('/api/v1/account/redeem', {
      method: 'POST',
      body: JSON.stringify({ code: 'GOOD-CODE' }),
    });
    expect(good.status).toBe(200);
    const body = (await good.json()) as { creditedQuota: number; account: { quota: number } };
    expect(body.creditedQuota).toBe(500_000);
    expect(body.account.quota).toBe(2_500_000);
  });

  let promptId = '';
  let promptVersion = 0;

  it('提示词 CRUD 与乐观锁', async () => {
    const created = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '城市夜景',
        description: null,
        content: 'neon city at night, rain, cinematic',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    expect(created.status).toBe(201);
    const prompt = (await created.json()) as { id: string; version: number };
    promptId = prompt.id;
    promptVersion = prompt.version;

    const list = await request('/api/v1/prompts?limit=10');
    expect(list.status).toBe(200);
    const page = (await list.json()) as { items: Array<{ id: string }> };
    expect(page.items.some((item) => item.id === promptId)).toBe(true);

    const updated = await request(`/api/v1/prompts/${promptId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '城市夜景 v2', expectedVersion: promptVersion }),
    });
    expect(updated.status).toBe(200);
    const updatedPrompt = (await updated.json()) as { title: string; version: number };
    expect(updatedPrompt.title).toBe('城市夜景 v2');
    promptVersion = updatedPrompt.version;

    const conflict = await request(`/api/v1/prompts/${promptId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '过期写入', expectedVersion: 1 }),
    });
    expect(conflict.status).toBe(409);
  });

  it('工作台草稿往返保留提示词选择意图并拒绝越权来源', async () => {
    const fullPromptResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '草稿整条',
        description: null,
        content: 'full draft source',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const fullPrompt = (await fullPromptResponse.json()) as { id: string; version: number };
    const excerptPromptResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '草稿片段',
        description: null,
        content: 'excerpt draft source',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const excerptPrompt = (await excerptPromptResponse.json()) as { id: string; version: number };
    const selections = [
      { promptId: fullPrompt.id, scope: 'full', expectedVersion: fullPrompt.version },
      {
        promptId: excerptPrompt.id,
        scope: 'excerpt',
        expectedVersion: excerptPrompt.version,
        range: { start: 0, end: 7 },
      },
    ];

    const created = await request('/api/v1/workbench/sessions', {
      method: 'POST',
      body: JSON.stringify({
        title: '选择意图往返',
        draft: { prompt: '', negative: '', params: {}, promptReferenceSelections: selections },
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      id: string;
      version: number;
      draft: { promptReferenceSelections: typeof selections };
    };
    expect(createdBody.draft.promptReferenceSelections).toEqual(selections);

    const fetched = await request(`/api/v1/workbench/sessions/${createdBody.id}`);
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as typeof createdBody).draft.promptReferenceSelections).toEqual(
      selections,
    );

    const updated = await request(`/api/v1/workbench/sessions/${createdBody.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: createdBody.version,
        draft: {
          prompt: 'updated',
          negative: '',
          params: {},
          promptReferenceSelections: selections,
        },
      }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as typeof createdBody;
    expect(updatedBody.draft.promptReferenceSelections).toEqual(selections);

    const missing = await request('/api/v1/workbench/sessions', {
      method: 'POST',
      body: JSON.stringify({
        draft: {
          prompt: '',
          negative: '',
          params: {},
          promptReferenceSelections: [
            { promptId: 'missing-draft-prompt', scope: 'full', expectedVersion: 1 },
          ],
        },
      }),
    });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });

    const deletedResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '草稿已删',
        description: null,
        content: 'deleted draft source',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const deletedPrompt = (await deletedResponse.json()) as { id: string; version: number };
    await request(`/api/v1/prompts/${deletedPrompt.id}`, { method: 'DELETE' });
    const deleted = await request('/api/v1/workbench/sessions', {
      method: 'POST',
      body: JSON.stringify({
        draft: {
          prompt: '',
          negative: '',
          params: {},
          promptReferenceSelections: [
            { promptId: deletedPrompt.id, scope: 'full', expectedVersion: deletedPrompt.version },
          ],
        },
      }),
    });
    expect(deleted.status).toBe(400);

    const signup = await app.request('/api/auth/sign-up/new-api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'draft-owner-b@musefold.app', password: 'correct-password' }),
    });
    expect(signup.status).toBe(200);
    const otherCookie = (signup.headers.get('set-cookie') ?? '')
      .split(/,(?=[^;]+=)/)
      .map((part) => part.split(';')[0])
      .join('; ');
    const otherPromptResponse = await app.request('/api/v1/prompts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: otherCookie },
      body: JSON.stringify({
        title: '另一用户草稿',
        description: null,
        content: 'other owner source',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const otherPrompt = (await otherPromptResponse.json()) as { id: string; version: number };
    const otherOwner = await request('/api/v1/workbench/sessions', {
      method: 'POST',
      body: JSON.stringify({
        draft: {
          prompt: '',
          negative: '',
          params: {},
          promptReferenceSelections: [
            { promptId: otherPrompt.id, scope: 'full', expectedVersion: otherPrompt.version },
          ],
        },
      }),
    });
    expect(otherOwner.status).toBe(400);
  });

  it('回收站:无 body 软删/恢复(api-client 形态)与永久删除', async () => {
    const created = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '待清理',
        description: null,
        content: 'to be purged',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const prompt = (await created.json()) as { id: string };

    // api-client 的 remove/restore 不携带 expectedVersion body,必须可用。
    const removed = await request(`/api/v1/prompts/${prompt.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const restoredNoBody = await request(`/api/v1/prompts/${prompt.id}/restore`, {
      method: 'POST',
    });
    expect(restoredNoBody.status).toBe(200);

    // 活跃行不允许 purge;软删后 purge 成功且行彻底消失。
    const purgeActive = await request(`/api/v1/prompts/${prompt.id}/purge`, { method: 'POST' });
    expect(purgeActive.status).toBe(400);
    await request(`/api/v1/prompts/${prompt.id}`, { method: 'DELETE' });
    const purged = await request(`/api/v1/prompts/${prompt.id}/purge`, { method: 'POST' });
    expect(purged.status).toBe(200);
    const gone = await request(`/api/v1/prompts/${prompt.id}`);
    expect(gone.status).toBe(404);
  });

  it('同步:注册设备 → push 变更 → pull 收敛', async () => {
    const deviceId = '00000000-0000-4000-8000-000000000001';
    const registered = await request('/api/v1/sync/devices', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        name: 'Test MacBook',
        platform: 'macos',
        clientVersion: '2.5.0',
      }),
    });
    expect(registered.status).toBe(201);

    const push = await request('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        mutations: [
          {
            mutationId: 'mut-000000000000000000001',
            entityType: 'prompt',
            entityId: 'p-sync-000000000000000001',
            operation: 'create',
            baseVersion: null,
            payload: {
              title: '来自桌面的提示词',
              content: 'sunset over mountains',
              description: null,
              negative: null,
              folderId: null,
              modelId: null,
              params: null,
            },
          },
        ],
      }),
    });
    expect(push.status).toBe(200);
    const pushBody = (await push.json()) as {
      results: Array<{
        status: string;
        version: number | null;
        snapshot: Record<string, unknown> | null;
        errorCode: string | null;
      }>;
    };
    const firstResult = pushBody.results[0];
    expect(firstResult?.status).toBe('applied');

    const pull = await request(`/api/v1/sync/pull?cursor=0&limit=100&deviceId=${deviceId}`);
    expect(pull.status).toBe(200);
    const pullBody = (await pull.json()) as {
      changes: Array<{ entityId: string; operation: string }>;
    };
    expect(
      pullBody.changes.some(
        (change) =>
          change.entityId === 'p-sync-000000000000000001' && change.operation === 'upsert',
      ),
    ).toBe(true);

    const equivalentReplay = await request('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        mutations: [
          {
            mutationId: 'mut-000000000000000000001',
            entityType: 'prompt',
            entityId: 'p-sync-000000000000000001',
            operation: 'create',
            baseVersion: null,
            payload: {
              params: null,
              modelId: null,
              folderId: null,
              negative: null,
              content: 'sunset over mountains',
              description: null,
              title: '来自桌面的提示词',
            },
          },
        ],
      }),
    });
    const equivalentBody = (await equivalentReplay.json()) as typeof pushBody;
    expect(equivalentBody.results[0]).toEqual({
      ...firstResult,
      status: 'duplicate',
    });

    const mismatchedReplay = await request('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        mutations: [
          {
            mutationId: 'mut-000000000000000000001',
            entityType: 'prompt',
            entityId: 'p-sync-000000000000000001',
            operation: 'create',
            baseVersion: null,
            payload: { title: '重复', content: 'x' },
          },
        ],
      }),
    });
    const mismatchBody = (await mismatchedReplay.json()) as typeof pushBody;
    expect(mismatchBody.results[0]).toEqual({
      ...firstResult,
      status: 'rejected',
      version: null,
      snapshot: null,
      errorCode: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
    });

    await pool.query(
      `UPDATE sync_mutation_results
       SET request_fingerprint = NULL
       WHERE device_id = $1 AND mutation_id = $2`,
      [deviceId, 'mut-000000000000000000001'],
    );
    const legacyReplay = await request('/api/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        mutations: [
          {
            mutationId: 'mut-000000000000000000001',
            entityType: 'prompt',
            entityId: 'p-sync-000000000000000001',
            operation: 'create',
            baseVersion: null,
            payload: { title: '迁移前重放', content: 'legacy' },
          },
        ],
      }),
    });
    const legacyBody = (await legacyReplay.json()) as typeof pushBody;
    expect(legacyBody.results[0]).toEqual({
      ...firstResult,
      status: 'duplicate',
    });
  });

  it('工作台会话生命周期', async () => {
    const created = await request('/api/v1/workbench/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: '晚霞尝试', draft: { prompt: 'sunset', size: 'auto' } }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as {
      id: string;
      version: number;
      latestJobStatus: string | null;
    };
    expect(session.latestJobStatus).toBeNull();

    // 挂一个生成任务后,会话行状态点派生字段反映最近 run(§3.3)。
    const generationInSession = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-session-dot-001' },
      body: JSON.stringify({
        prompt: 'sunset over the sea',
        sessionId: session.id,
        size: 'auto',
        quality: 'auto',
        count: 1,
        runKind: 'free_generation',
      }),
    });
    expect(generationInSession.status).toBe(201);
    const sessionJob = (await generationInSession.json()) as {
      id: string;
      sessionId: string | null;
    };
    expect(sessionJob.sessionId).toBe(session.id);

    await pool.query(
      "UPDATE generation_runs SET status = 'failed', progress = 100, finished_at = now() WHERE id = $1",
      [sessionJob.id],
    );
    const retried = await request(`/api/v1/generations/${sessionJob.id}/retry`, {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-session-retry-001' },
    });
    expect(retried.status).toBe(201);
    await expect(retried.json()).resolves.toMatchObject({
      sessionId: session.id,
      parentRunId: sessionJob.id,
      status: 'queued',
    });

    const list = await request('/api/v1/workbench/sessions');
    const page = (await list.json()) as {
      items: Array<{ id: string; latestJobStatus: string | null }>;
    };
    const listed = page.items.find((item) => item.id === session.id);
    expect(listed).toBeTruthy();
    expect(listed?.latestJobStatus).toBe('queued');

    const archivedCreated = await request('/api/v1/workbench/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: '已归档尝试' }),
    });
    const archivedSession = (await archivedCreated.json()) as { id: string; version: number };
    const archivedUpdated = await request(`/api/v1/workbench/sessions/${archivedSession.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: archivedSession.version, archived: true }),
    });
    const archived = (await archivedUpdated.json()) as { id: string; version: number };

    const archivedList = await request(
      '/api/v1/workbench/sessions?archivedOnly=true&includeArchived=true&includeDeleted=true',
    );
    const archivedPage = (await archivedList.json()) as { items: Array<{ id: string }> };
    expect(archivedPage.items.some((item) => item.id === archived.id)).toBe(true);
    expect(archivedPage.items.some((item) => item.id === session.id)).toBe(false);

    await request(`/api/v1/workbench/sessions/${archived.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ expectedVersion: archived.version }),
    });
    const archivedAfterDelete = await request(
      '/api/v1/workbench/sessions?archivedOnly=true&includeArchived=true&includeDeleted=true',
    );
    const archivedAfterDeletePage = (await archivedAfterDelete.json()) as {
      items: Array<{ id: string }>;
    };
    expect(archivedAfterDeletePage.items.some((item) => item.id === archived.id)).toBe(false);

    const removed = await request(`/api/v1/workbench/sessions/${session.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ expectedVersion: session.version }),
    });
    expect(removed.status).toBe(200);
  });

  it('生成任务解析提示词引用并冻结最终请求与来源快照', async () => {
    const sourceResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '直接来源',
        description: null,
        content: 'direct source content',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const source = (await sourceResponse.json()) as { id: string; version: number };
    const referenceResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '引用来源',
        description: null,
        content: '😀 first reference text',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const reference = (await referenceResponse.json()) as { id: string; version: number };
    const create = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-prompt-resolution-001' },
      body: JSON.stringify({
        prompt: 'user prompt',
        promptId: source.id,
        promptReferenceSelections: [
          {
            promptId: reference.id,
            scope: 'excerpt',
            expectedVersion: reference.version,
            range: { start: 0, end: 10 },
          },
        ],
        size: 'auto',
        quality: 'auto',
        count: 1,
      }),
    });
    expect(create.status).toBe(201);
    const job = (await create.json()) as {
      id: string;
      userPrompt: string;
      promptReferences: Array<{
        title: string;
        text: string;
        scope: string;
        sourceVersion: number;
      }>;
      request: { prompt: string };
    };
    expect(job.userPrompt).toBe('user prompt');
    expect(job.promptReferences).toEqual([
      {
        promptId: reference.id,
        title: '引用来源',
        text: '😀 first r',

        scope: 'excerpt',
        sourceVersion: reference.version,
      },
    ]);
    expect(job.request.prompt).toContain('user prompt');
    expect(job.request.prompt).toContain('参考提示词：');
    expect(job.request.prompt).toContain('😀 first r');

    const stored = await pool.query<{
      request: string | Record<string, unknown>;
      prompt_snapshot: string | Record<string, unknown>;
    }>('SELECT request, prompt_snapshot FROM generation_runs WHERE id = $1', [job.id]);
    const requestJson = parseJsonColumn(stored.rows[0]?.request);
    const snapshot = parseJsonColumn(stored.rows[0]?.prompt_snapshot) as Record<string, unknown>;
    expect(requestJson.prompt).toBe(job.request.prompt);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      userPrompt: 'user prompt',
      directPrompt: {
        id: source.id,
        title: '直接来源',
        content: 'direct source content',
        version: source.version,
      },
      promptReferences: job.promptReferences,
      finalPrompt: job.request.prompt,
    });
    expect(snapshot.logicalRequest).toMatchObject({
      prompt: 'user prompt',
      promptId: source.id,
      promptReferenceSelections: [
        {
          promptId: reference.id,
          scope: 'excerpt',
          expectedVersion: reference.version,
          range: { start: 0, end: 10 },
        },
      ],
    });
    expect(snapshot.logicalRequestFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('生成任务拒绝缺失/越权/已删除/版本不匹配的提示词来源', async () => {
    const cases = [
      {
        key: 'itest-prompt-missing-001',
        selection: { promptId: 'missing-generation-prompt', scope: 'full', expectedVersion: 1 },
      },
    ];
    for (const { key, selection } of cases) {
      const response = await request('/api/v1/generations', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify({ prompt: 'source test', promptReferenceSelections: [selection] }),
      });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'PROMPT_NOT_FOUND' } });
    }

    const created = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '待删生成来源',
        description: null,
        content: 'deleted generation source',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const prompt = (await created.json()) as { id: string; version: number };
    await request(`/api/v1/prompts/${prompt.id}`, { method: 'DELETE' });
    const deleted = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-prompt-deleted-001' },
      body: JSON.stringify({
        prompt: 'source test',
        promptReferenceSelections: [
          { promptId: prompt.id, scope: 'full', expectedVersion: prompt.version },
        ],
      }),
    });
    expect(deleted.status).toBe(404);

    const mismatchSourceResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '版本来源',
        description: null,
        content: 'version source',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const mismatchSource = (await mismatchSourceResponse.json()) as { id: string; version: number };
    const mismatchUpdate = await request(`/api/v1/prompts/${mismatchSource.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '版本来源 v2', expectedVersion: mismatchSource.version }),
    });
    const mismatchCurrent = (await mismatchUpdate.json()) as { version: number };
    const mismatch = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-prompt-version-001' },
      body: JSON.stringify({
        prompt: 'source test',
        promptReferenceSelections: [
          {
            promptId: mismatchSource.id,
            scope: 'full',
            expectedVersion: mismatchCurrent.version - 1,
          },
        ],
      }),
    });
    expect(mismatch.status).toBe(409);
    await expect(mismatch.json()).resolves.toMatchObject({
      error: { code: 'PROMPT_VERSION_CONFLICT' },
    });

    const signup = await app.request('/api/auth/sign-up/new-api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'generation-owner-b@musefold.app',
        password: 'correct-password',
      }),
    });
    expect(signup.status).toBe(200);
    const otherCookie = (signup.headers.get('set-cookie') ?? '')
      .split(/,(?=[^;]+=)/)
      .map((part) => part.split(';')[0])
      .join('; ');
    const otherPromptResponse = await app.request('/api/v1/prompts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: otherCookie },
      body: JSON.stringify({
        title: '另一用户生成来源',
        description: null,
        content: 'other generation source',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const otherPrompt = (await otherPromptResponse.json()) as { id: string; version: number };
    const otherOwner = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-prompt-owner-001' },
      body: JSON.stringify({
        prompt: 'source test',
        promptReferenceSelections: [
          { promptId: otherPrompt.id, scope: 'full', expectedVersion: otherPrompt.version },
        ],
      }),
    });
    expect(otherOwner.status).toBe(404);
  });

  it('生成任务入队(幂等)并可取消', async () => {
    const missingPrompt = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-generation-missing-prompt-001' },
      body: JSON.stringify({
        prompt: 'missing prompt source',
        promptId: 'missing-prompt-id',
        size: 'auto',
        quality: 'auto',
        count: 1,
      }),
    });
    expect(missingPrompt.status).toBe(404);
    await expect(missingPrompt.json()).resolves.toMatchObject({
      error: { code: 'PROMPT_NOT_FOUND' },
    });

    const idempotencyKey = 'itest-generation-0001';
    const jobsBefore = await pool.query(
      "SELECT count(*)::int AS count FROM graphile_worker.jobs WHERE task_identifier = 'generation.generate'",
    );
    const createBody = JSON.stringify({
      prompt: 'a red fox in snow',
      promptId,
      size: 'auto',
      quality: 'auto',
      count: 1,
      runKind: 'free_generation',
    });
    const created = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: createBody,
    });
    expect(created.status).toBe(201);
    const job = (await created.json()) as { id: string; status: string };
    expect(job.status).toBe('queued');

    const duplicated = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: createBody,
    });
    expect(duplicated.status).toBe(201);
    expect(((await duplicated.json()) as { id: string }).id).toBe(job.id);

    // 增量计数(其他用例也会入队):创建 + 幂等重放只多 1 个任务。
    const jobsAfter = await pool.query(
      "SELECT count(*)::int AS count FROM graphile_worker.jobs WHERE task_identifier = 'generation.generate'",
    );
    expect(jobsAfter.rows[0].count - jobsBefore.rows[0].count).toBe(1);

    const cancelled = await request(`/api/v1/generations/${job.id}/cancel`, { method: 'POST' });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { status: string }).status).toBe('cancelled');

    const history = await request('/api/v1/generations?limit=10');
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as { items: Array<{ id: string }> };
    expect(historyBody.items.some((item) => item.id === job.id)).toBe(true);

    // 回收站闭环:软删 → deletedOnly 只见已删 → 默认列表不见 → 恢复。
    const removed = await request(`/api/v1/generations/${job.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const trash = await request('/api/v1/generations?limit=10&deletedOnly=true');
    const trashBody = (await trash.json()) as { items: Array<{ id: string }> };
    expect(trashBody.items.some((item) => item.id === job.id)).toBe(true);
    const liveAfterRemove = await request('/api/v1/generations?limit=10');
    const liveBody = (await liveAfterRemove.json()) as { items: Array<{ id: string }> };
    expect(liveBody.items.some((item) => item.id === job.id)).toBe(false);
    const restored = await request(`/api/v1/generations/${job.id}/restore`, { method: 'POST' });
    expect(restored.status).toBe(200);

    // 永久删除闭环:活跃行拒绝;软删后 purge 硬删行(资产级联)并转交对象存储清理。
    const purgeActive = await request(`/api/v1/generations/${job.id}/purge`, { method: 'POST' });
    expect(purgeActive.status).toBe(400);
    await pool.query(
      `INSERT INTO generation_assets
         (id, run_id, user_id, object_key, mime_type, width, height, byte_size, checksum_sha256, position)
       SELECT 'itest-asset-1', r.id, r.user_id, 'assets/itest-asset-1.png', 'image/png', 512, 512, 1024, repeat('0', 64), 0
       FROM generation_runs r WHERE r.id = $1`,
      [job.id],
    );
    await request(`/api/v1/generations/${job.id}`, { method: 'DELETE' });
    const purged = await request(`/api/v1/generations/${job.id}/purge`, { method: 'POST' });
    expect(purged.status).toBe(200);
    expect(purgedObjectKeys.at(-1)).toEqual(['assets/itest-asset-1.png']);
    const cleanupAfterSuccess = await pool.query(
      'SELECT count(*)::int AS count FROM object_cleanup_queue WHERE object_key = $1',
      ['assets/itest-asset-1.png'],
    );
    expect(cleanupAfterSuccess.rows[0].count).toBe(0);
    const gone = await request(`/api/v1/generations/${job.id}`);
    expect(gone.status).toBe(404);
    const orphanAssets = await pool.query(
      'SELECT count(*)::int AS count FROM generation_assets WHERE run_id = $1',
      [job.id],
    );
    expect(orphanAssets.rows[0].count).toBe(0);
  });

  it('S3 删除 outage 不阻塞永久删除且保留 durable cleanup intent', async () => {
    const created = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-purge-outage-001' },
      body: JSON.stringify({ prompt: 'purge outage', size: 'auto', quality: 'auto', count: 1 }),
    });
    expect(created.status).toBe(201);
    const job = (await created.json()) as { id: string };
    const objectKey = `users/outage/generations/${job.id}/asset`;
    await pool.query(
      `UPDATE generation_runs SET status = 'failed', progress = 100, finished_at = now() WHERE id = $1`,
      [job.id],
    );
    await pool.query(
      `INSERT INTO generation_assets
         (id, run_id, user_id, object_key, mime_type, width, height, byte_size, checksum_sha256, position)
       SELECT 'itest-outage-asset', r.id, r.user_id, $2, 'image/png', 1, 1, 4, repeat('0', 64), 0
       FROM generation_runs r WHERE r.id = $1`,
      [job.id, objectKey],
    );
    await request(`/api/v1/generations/${job.id}`, { method: 'DELETE' });
    removeObjectsError = Object.assign(new Error('S3 unavailable'), { name: 'S3Unavailable' });
    try {
      const purged = await request(`/api/v1/generations/${job.id}/purge`, { method: 'POST' });
      expect(purged.status).toBe(200);
    } finally {
      removeObjectsError = null;
    }

    expect((await request(`/api/v1/generations/${job.id}`)).status).toBe(404);
    const cleanup = await pool.query<{
      object_key: string;
      owner_id: string;
      object_type: string;
      reason: string;
      attempt_count: number;
      last_error: string;
      next_attempt_at: Date;
    }>(
      `SELECT object_key, owner_id, object_type, reason, attempt_count, last_error, next_attempt_at
       FROM object_cleanup_queue WHERE object_key = $1`,
      [objectKey],
    );
    expect(cleanup.rows).toHaveLength(1);
    expect(cleanup.rows[0]).toMatchObject({
      object_key: objectKey,
      object_type: 'generation_asset',
      reason: 'generation_purge',
      attempt_count: 1,
      last_error: 'S3Unavailable',
    });
    expect(cleanup.rows[0]?.owner_id).toBeTruthy();
    expect(cleanup.rows[0]?.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('对象清理连续失败达到上限后进入可审计终态', async () => {
    const objectKey = `itest/cleanup-abandoned-${Date.now()}`;
    const now = new Date('2026-09-01T00:00:00.000Z');
    await pool.query(
      `INSERT INTO object_cleanup_queue
         (object_key, owner_id, object_type, reason, next_attempt_at)
       VALUES ($1, 'itest-owner', 'generation_asset', 'generation_compensation', $2)`,
      [objectKey, now],
    );

    for (let attempt = 0; attempt < MAX_OBJECT_CLEANUP_ATTEMPTS; attempt += 1) {
      await markObjectCleanupAttemptFailed(db, [objectKey], new Error('S3 unavailable'), now);
    }

    const cleanup = await pool.query<{
      attempt_count: number;
      abandoned_at: Date | null;
      last_error: string;
    }>(
      `SELECT attempt_count, abandoned_at, last_error
       FROM object_cleanup_queue WHERE object_key = $1`,
      [objectKey],
    );
    expect(cleanup.rows[0]).toMatchObject({
      attempt_count: MAX_OBJECT_CLEANUP_ATTEMPTS,
      last_error: 'Error',
    });
    expect(cleanup.rows[0]?.abandoned_at?.toISOString()).toBe(now.toISOString());
    const due = await pool.query(
      `SELECT object_key FROM object_cleanup_queue
       WHERE object_key = $1 AND next_attempt_at <= $2 AND abandoned_at IS NULL`,
      [objectKey, new Date('2100-01-01T00:00:00.000Z')],
    );
    expect(due.rows).toHaveLength(0);
  });

  it('同一幂等键并发建单只提交一行、一份事件和一个 Graphile job', async () => {
    const key = 'itest-generation-race-001';
    const body = JSON.stringify({
      prompt: 'concurrent generation',
      size: 'auto',
      quality: 'auto',
      count: 1,
      runKind: 'free_generation',
    });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request('/api/v1/generations', {
          method: 'POST',
          headers: { 'idempotency-key': key },
          body,
        }),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const ids = await Promise.all(
      responses.map(async (response) => ((await response.json()) as { id: string }).id),
    );
    expect(new Set(ids).size).toBe(1);

    const userResult = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [
      'tester@musefold.app',
    ]);
    expect(userResult.rows).toHaveLength(1);
    const userId = userResult.rows[0]?.id;
    expect(userId).toBeTruthy();
    const [runCount, eventCount, jobCount] = await Promise.all([
      pool.query(
        'SELECT count(*)::int AS count FROM generation_runs WHERE user_id = $1 AND idempotency_key = $2',
        [userId, key],
      ),
      pool.query(
        "SELECT count(*)::int AS count FROM generation_events WHERE run_id = $1 AND event_type = 'generation.requested'",
        [ids[0]],
      ),
      pool.query(
        "SELECT count(*)::int AS count FROM graphile_worker.jobs WHERE task_identifier = 'generation.generate' AND key = $1",
        [`generation:${ids[0]}`],
      ),
    ]);
    expect(runCount.rows[0].count).toBe(1);
    expect(eventCount.rows[0].count).toBe(1);
    expect(jobCount.rows[0].count).toBe(1);
  });

  it('同一幂等键携带不同规范 payload 显式冲突', async () => {
    const key = 'itest-generation-payload-001';
    const first = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({ prompt: 'first payload', size: 'auto', quality: 'auto', count: 1 }),
    });
    expect(first.status).toBe(201);

    const conflict = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({
        prompt: 'different payload',
        size: 'auto',
        quality: 'auto',
        count: 1,
      }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: 'GENERATION_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('迁移前无提示词快照的云生成幂等重放兼容且坏请求冲突', async () => {
    const userResult = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [
      'tester@musefold.app',
    ]);
    const userId = userResult.rows[0]?.id;
    expect(userId).toBeTruthy();

    const validRunId = 'itest-legacy-generation-valid-001';
    const malformedRunId = 'itest-legacy-generation-bad-001';
    const validKey = 'itest-legacy-generation-valid-key-001';
    const malformedKey = 'itest-legacy-generation-bad-key-001';
    const legacyRequest = {
      prompt: 'legacy cloud request',
      size: 'auto',
      quality: 'auto',
      count: 1,
      referenceImages: [],
    };

    await pool.query(
      `INSERT INTO generation_runs
         (id, user_id, run_kind, actor_type, approval_status, status, progress, request,
          prompt_snapshot, idempotency_key, provider_model)
       VALUES ($1, $2, 'free_generation', 'web', 'not_required', 'queued', 0, $3, NULL, $4, $5),
              ($6, $2, 'free_generation', 'web', 'not_required', 'queued', 0, $7, NULL, $8, $5)`,
      [
        validRunId,
        userId,
        legacyRequest,
        validKey,
        'musefold-image-pro',
        malformedRunId,
        { prompt: 42 },
        malformedKey,
      ],
    );

    try {
      const replay = await request('/api/v1/generations', {
        method: 'POST',
        headers: { 'idempotency-key': validKey },
        body: JSON.stringify({
          prompt: legacyRequest.prompt,
          size: legacyRequest.size,
          quality: legacyRequest.quality,
          count: legacyRequest.count,
        }),
      });
      expect(replay.status).toBe(201);
      expect(((await replay.json()) as { id: string }).id).toBe(validRunId);

      const changed = await request('/api/v1/generations', {
        method: 'POST',
        headers: { 'idempotency-key': validKey },
        body: JSON.stringify({
          prompt: 'changed legacy request',
          size: legacyRequest.size,
          quality: legacyRequest.quality,
          count: legacyRequest.count,
        }),
      });
      expect(changed.status).toBe(409);
      await expect(changed.json()).resolves.toMatchObject({
        error: { code: 'GENERATION_IDEMPOTENCY_CONFLICT' },
      });

      const malformedReplay = await request('/api/v1/generations', {
        method: 'POST',
        headers: { 'idempotency-key': malformedKey },
        body: JSON.stringify({
          prompt: 'legacy request replay',
          size: 'auto',
          quality: 'auto',
          count: 1,
        }),
      });
      expect(malformedReplay.status).toBe(409);
      await expect(malformedReplay.json()).resolves.toMatchObject({
        error: { code: 'GENERATION_IDEMPOTENCY_CONFLICT' },
      });
    } finally {
      await pool.query('DELETE FROM generation_runs WHERE id IN ($1, $2)', [
        validRunId,
        malformedRunId,
      ]);
    }
  });

  it('提示词引用拒绝切开 UTF-16 代理对并接受对齐范围', async () => {
    const promptResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '代理对边界',
        description: null,
        content: '😀x',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    expect(promptResponse.status).toBe(201);
    const prompt = (await promptResponse.json()) as { id: string; version: number };

    const aligned = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-utf16-aligned-001' },
      body: JSON.stringify({
        prompt: '',
        promptReferenceSelections: [
          {
            promptId: prompt.id,
            scope: 'excerpt',
            expectedVersion: prompt.version,
            range: { start: 0, end: 2 },
          },
        ],
      }),
    });
    expect(aligned.status).toBe(201);

    for (const [key, range] of [
      ['itest-utf16-split-start-001', { start: 1, end: 2 }],
      ['itest-utf16-split-end-001', { start: 0, end: 1 }],
    ] as const) {
      const split = await request('/api/v1/generations', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: JSON.stringify({
          prompt: '',
          promptReferenceSelections: [
            { promptId: prompt.id, scope: 'excerpt', expectedVersion: prompt.version, range },
          ],
        }),
      });
      expect(split.status).toBe(400);
      await expect(split.json()).resolves.toMatchObject({
        error: {
          code: 'VALIDATION_FAILED',
          details: {
            fieldPath: 'promptReferenceSelections.0.range',
            start: range.start,
            end: range.end,
            length: 3,
          },
        },
      });
    }
  });

  it('并发取消是幂等的, running 不会重复推进或追加事件', async () => {
    const created = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-generation-cancel-race-001' },
      body: JSON.stringify({ prompt: 'cancel race', size: 'auto', quality: 'auto', count: 1 }),
    });
    const job = (await created.json()) as { id: string };
    await pool.query(
      "UPDATE generation_runs SET status = 'running', progress = 5, lease_expires_at = now() + interval '10 minutes' WHERE id = $1",
      [job.id],
    );

    const cancellations = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(`/api/v1/generations/${job.id}/cancel`, { method: 'POST' }),
      ),
    );
    expect(cancellations.every((response) => response.status === 200)).toBe(true);
    expect(
      await Promise.all(
        cancellations.map(
          async (response) => ((await response.json()) as { status: string }).status,
        ),
      ),
    ).toEqual(['cancelling', 'cancelling', 'cancelling', 'cancelling']);
    const events = await pool.query(
      "SELECT count(*)::int AS count FROM generation_events WHERE run_id = $1 AND event_type = 'generation.cancelling'",
      [job.id],
    );
    expect(events.rows[0].count).toBe(1);
    const current = await pool.query('SELECT status FROM generation_runs WHERE id = $1', [job.id]);
    expect(current.rows[0].status).toBe('cancelling');
  });

  it('幂等键按用户隔离:另一账号复用同一个键各自成单', async () => {
    // 用户 A 在上一个用例已用 itest-generation-0001 建单;复合唯一(user_id, idempotency_key)
    // 下用户 B 复用同一个键必须各自成单,而不是撞全局唯一约束或拿到 A 的任务。
    const signup = await app.request('/api/auth/sign-up/new-api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'tester-b@musefold.app', password: 'correct-password' }),
    });
    expect(signup.status).toBe(200);
    const otherCookie = (signup.headers.get('set-cookie') ?? '')
      .split(/,(?=[^;]+=)/)
      .map((part) => part.split(';')[0])
      .join('; ');

    const created = await app.request('/api/v1/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: otherCookie,
        'idempotency-key': 'itest-generation-0001',
      },
      body: JSON.stringify({
        prompt: 'same key, different user',
        size: 'auto',
        quality: 'auto',
        count: 1,
        runKind: 'free_generation',
      }),
    });
    expect(created.status).toBe(201);
    const job = (await created.json()) as { request: { prompt: string } };
    expect(job.request.prompt).toBe('same key, different user');
  });

  it('资产 expiresAt 跟随签名 TTL 派生', async () => {
    const created = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-ttl-0001' },
      body: JSON.stringify({
        prompt: 'ttl check',
        size: 'auto',
        quality: 'auto',
        count: 1,
        runKind: 'free_generation',
      }),
    });
    const job = (await created.json()) as { id: string };
    await pool.query(
      `INSERT INTO generation_assets
         (id, run_id, user_id, object_key, mime_type, width, height, byte_size, checksum_sha256, position)
       SELECT 'itest-asset-ttl', r.id, r.user_id, 'assets/itest-asset-ttl.png', 'image/png', 512, 512, 1024, repeat('0', 64), 0
       FROM generation_runs r WHERE r.id = $1`,
      [job.id],
    );
    const fetched = await request(`/api/v1/generations/${job.id}`);
    const fetchedJob = (await fetched.json()) as { assets: Array<{ expiresAt: string }> };
    const deltaSeconds = (Date.parse(fetchedJob.assets[0]?.expiresAt ?? '') - Date.now()) / 1_000;
    expect(deltaSeconds).toBeGreaterThan(fakeSigner.urlTtlSeconds - 120);
    expect(deltaSeconds).toBeLessThanOrEqual(fakeSigner.urlTtlSeconds + 120);
  });

  it('参考图:上传落对象存储,展示 URL 302,随生成入库时 URL 归一化', async () => {
    // PNG 魔数 + 填充字节(服务端嗅探魔数定 mime,不信任表单自报类型)。
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const form = new FormData();
    form.append('file', new File([pngBytes], 'style.png', { type: 'image/png' }));
    const uploaded = await app.request('/api/v1/reference-images', {
      method: 'POST',
      headers: { cookie },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const reference = (await uploaded.json()) as {
      id: string;
      url: string;
      name: string;
      mimeType: string;
      byteSize: number;
    };
    expect(reference.mimeType).toBe('image/png');
    expect(reference.name).toBe('style.png');
    expect(reference.byteSize).toBe(pngBytes.byteLength);
    expect(reference).not.toHaveProperty('objectKey');
    expect(reference.url).toBe(`/api/v1/reference-images/${reference.id}/url`);
    const stored = putObjects.at(-1);
    expect(stored?.contentType).toBe('image/png');
    expect(stored?.objectKey).toMatch(new RegExp(`^users/.+/references/${reference.id}$`));

    // 展示 URL:按用户前缀重建对象键签名后 302(与资产 URL 同款,<img src> 直接可用)。
    const redirect = await request(reference.url);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(`https://cdn.test/${stored?.objectKey}?sig=x`);

    // 非图片字节被魔数嗅探拒绝。
    const badForm = new FormData();
    badForm.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'fake.png'));
    const rejected = await app.request('/api/v1/reference-images', {
      method: 'POST',
      headers: { cookie },
      body: badForm,
    });
    expect(rejected.status).toBe(400);

    // 随生成提交:客户端自报的 url 被服务端归一为标准路由后入库。
    const created = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-reference-001' },
      body: JSON.stringify({
        prompt: 'remix with reference',
        size: 'auto',
        quality: 'auto',
        count: 1,
        referenceImages: [{ ...reference, url: 'https://evil.example/spoof.png' }],
      }),
    });
    expect(created.status).toBe(201);
    const job = (await created.json()) as {
      id: string;
      request: { referenceImages: Array<{ id: string; url: string }> };
    };
    expect(job.request.referenceImages).toHaveLength(1);
    expect(job.request.referenceImages[0]?.url).toBe(
      `/api/v1/reference-images/${reference.id}/url`,
    );
    const retention = await pool.query<{
      status: string;
      object_key: string;
      expires_at: Date;
      link_count: number;
    }>(
      `SELECT u.status, u.object_key, u.expires_at,
              (SELECT count(*)::int FROM generation_reference_links l
               WHERE l.reference_id = u.id AND l.run_id = $2) AS link_count
       FROM generation_reference_uploads u WHERE u.id = $1`,
      [reference.id, job.id],
    );
    expect(retention.rows[0]).toMatchObject({
      status: 'available',
      object_key: stored?.objectKey,
      link_count: 1,
    });
    expect(retention.rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());

    // 历史读回同样携带参考图(时间线回合附件区数据源)。
    const fetched = await request(`/api/v1/generations/${job.id}`);
    const fetchedJob = (await fetched.json()) as {
      request: { referenceImages: Array<{ url: string }> };
    };
    expect(fetchedJob.request.referenceImages[0]?.url).toBe(
      `/api/v1/reference-images/${reference.id}/url`,
    );

    const otherSignup = await app.request('/api/auth/sign-up/new-api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `reference-owner-${Date.now()}@musefold.app`,
        password: 'correct-password',
      }),
    });
    expect(otherSignup.status).toBe(200);
    const otherCookie = (otherSignup.headers.get('set-cookie') ?? '')
      .split(/,(?=[^;]+=)/)
      .map((part) => part.split(';')[0])
      .join('; ');
    const hidden = await app.request(reference.url, { headers: { cookie: otherCookie } });
    expect(hidden.status).toBe(404);
    const foreignGeneration = await app.request('/api/v1/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: otherCookie,
        'idempotency-key': 'itest-reference-owner-001',
      },
      body: JSON.stringify({
        prompt: 'foreign reference',
        referenceImages: [reference],
      }),
    });
    expect(foreignGeneration.status).toBe(404);
  });
  it('参考图 PUT 失败时保留 registry 与 durable cleanup intent', async () => {
    const userResult = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [
      'tester@musefold.app',
    ]);
    const userId = userResult.rows[0]?.id;
    expect(userId).toBeTruthy();
    const before = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM generation_reference_uploads
       WHERE user_id = $1 AND status = 'cleanup_pending'`,
      [userId],
    );
    putObjectError = Object.assign(new Error('put timed out'), { name: 'S3PutTimeout' });
    const form = new FormData();
    form.append(
      'file',
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
        'ambiguous.png',
      ),
    );
    try {
      const failed = await app.request('/api/v1/reference-images', {
        method: 'POST',
        headers: { cookie },
        body: form,
      });
      expect(failed.status).toBe(500);
    } finally {
      putObjectError = null;
    }

    const pending = await pool.query<{
      id: string;
      object_key: string;
      status: string;
      object_type: string;
      reason: string;
    }>(
      `SELECT u.id, u.object_key, u.status, q.object_type, q.reason
       FROM generation_reference_uploads u
       JOIN object_cleanup_queue q ON q.object_key = u.object_key
       WHERE u.user_id = $1 AND u.status = 'cleanup_pending'
       ORDER BY u.created_at DESC LIMIT 1`,
      [userId],
    );
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]).toMatchObject({
      status: 'cleanup_pending',
      object_type: 'generation_reference',
      reason: 'reference_upload_failed',
    });
    expect(pending.rows[0]?.object_key).toBe(`users/${userId}/references/${pending.rows[0]?.id}`);
    const after = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM generation_reference_uploads
       WHERE user_id = $1 AND status = 'cleanup_pending'`,
      [userId],
    );
    expect(after.rows[0]?.count).toBe((before.rows[0]?.count ?? 0) + 1);
  });

  it('提示词选择幂等按逻辑请求比较并支持引用-only与组合顺序', async () => {
    const promptResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '逻辑引用',
        description: null,
        content: 'reference content',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const prompt = (await promptResponse.json()) as { id: string; version: number };
    const uploadedReferences = [] as Array<{
      id: string;
      url: string;
      name: string;
      mimeType: string;
      byteSize: number;
    }>;
    for (const name of ['one.png', 'two.png']) {
      const form = new FormData();
      form.append(
        'file',
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], name, {
          type: 'image/png',
        }),
      );
      const response = await app.request('/api/v1/reference-images', {
        method: 'POST',
        headers: { cookie },
        body: form,
      });
      expect(response.status).toBe(201);
      uploadedReferences.push((await response.json()) as (typeof uploadedReferences)[number]);
    }
    const key = 'itest-logical-request-001';
    const first = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({
        prompt: '',
        promptReferenceSelections: [
          { promptId: prompt.id, scope: 'full', expectedVersion: prompt.version },
        ],
        aspectRatio: '2:8',
        size: 'auto',
        quality: 'auto',
        count: 1,
        referenceImages: uploadedReferences.map((reference, index) => ({
          ...reference,
          url: `https://evil.example/${index + 1}.png`,
        })),
      }),
    });
    expect(first.status).toBe(201);
    const firstJob = (await first.json()) as {
      id: string;
      request: {
        prompt: string;
        aspectRatio?: string;
        referenceImages: Array<{ url: string }>;
      };
    };
    expect(firstJob.request.aspectRatio).toBe('1:4');
    const promptIndex = firstJob.request.prompt.indexOf('参考提示词：');
    const imageIndex = firstJob.request.prompt.indexOf('参考图按上传顺序');
    const ratioIndex = firstJob.request.prompt.indexOf('画面比例约束：');
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeLessThan(imageIndex);
    expect(imageIndex).toBeLessThan(ratioIndex);
    expect(firstJob.request.referenceImages[0]?.url).toBe(uploadedReferences[0]?.url);

    const equivalent = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({
        prompt: '',
        promptReferenceSelections: [
          { promptId: prompt.id, scope: 'full', expectedVersion: prompt.version },
        ],
        aspectRatio: '1:4',
        size: 'auto',
        quality: 'auto',
        count: 1,
        referenceImages: uploadedReferences,
      }),
    });
    expect(equivalent.status).toBe(201);
    expect(((await equivalent.json()) as { id: string }).id).toBe(firstJob.id);

    const changedRange = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({
        prompt: '',
        promptReferenceSelections: [
          {
            promptId: prompt.id,
            scope: 'excerpt',
            expectedVersion: prompt.version,
            range: { start: 0, end: 5 },
          },
        ],
      }),
    });
    expect(changedRange.status).toBe(409);
    await expect(changedRange.json()).resolves.toMatchObject({
      error: { code: 'GENERATION_IDEMPOTENCY_CONFLICT' },
    });

    const forged = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-forged-selection-001' },
      body: JSON.stringify({
        prompt: '',
        promptReferenceSelections: [
          {
            promptId: prompt.id,
            scope: 'full',
            expectedVersion: prompt.version,
            title: 'forged title',
            text: 'forged text',
          },
        ],
      }),
    });
    expect(forged.status).toBe(400);
    await expect(forged.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('创建后提示词编辑/删除不改变快照,重试不重新解析提示词', async () => {
    const promptResponse = await request('/api/v1/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: '不可变来源',
        description: null,
        content: 'immutable prompt content',
        negative: 'immutable negative',
        folderId: null,
        modelId: null,
        params: null,
      }),
    });
    const prompt = (await promptResponse.json()) as { id: string; version: number };
    const created = await request('/api/v1/generations', {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-immutable-source-001' },
      body: JSON.stringify({
        prompt: 'keep user text',
        promptId: prompt.id,
        promptReferenceSelections: [
          { promptId: prompt.id, scope: 'full', expectedVersion: prompt.version },
        ],
        size: 'auto',
        quality: 'auto',
        count: 1,
      }),
    });
    expect(created.status).toBe(201);
    const sourceJob = (await created.json()) as {
      id: string;
      request: { prompt: string; negative?: string };
      promptReferences: Array<{ title: string; text: string; sourceVersion: number }>;
    };
    const before = await pool.query('SELECT prompt_snapshot FROM generation_runs WHERE id = $1', [
      sourceJob.id,
    ]);
    const beforeSnapshot = parseJsonColumn(before.rows[0]?.prompt_snapshot);

    const updated = await request(`/api/v1/prompts/${prompt.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: '已编辑来源',
        content: 'edited prompt content',
        expectedVersion: prompt.version,
      }),
    });
    expect(updated.status).toBe(200);
    const deleted = await request(`/api/v1/prompts/${prompt.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);

    const fetched = await request(`/api/v1/generations/${sourceJob.id}`);
    const fetchedJob = (await fetched.json()) as typeof sourceJob;
    expect(fetchedJob.request.prompt).toBe(sourceJob.request.prompt);
    expect(fetchedJob.promptReferences).toEqual(sourceJob.promptReferences);

    await pool.query(
      "UPDATE generation_runs SET status = 'failed', progress = 100, finished_at = now() WHERE id = $1",
      [sourceJob.id],
    );
    const retry = await request(`/api/v1/generations/${sourceJob.id}/retry`, {
      method: 'POST',
      headers: { 'idempotency-key': 'itest-immutable-retry-001' },
    });
    expect(retry.status).toBe(201);
    const retryJob = (await retry.json()) as typeof sourceJob & {
      parentRunId: string;
    };
    expect(retryJob.parentRunId).toBe(sourceJob.id);
    expect(retryJob.request).toEqual(sourceJob.request);
    expect(retryJob.promptReferences).toEqual(sourceJob.promptReferences);

    const retryRow = await pool.query(
      'SELECT request, prompt_snapshot FROM generation_runs WHERE id = $1',
      [retryJob.id],
    );
    expect(parseJsonColumn(retryRow.rows[0]?.request)).toEqual(
      parseJsonColumn(
        (await pool.query('SELECT request FROM generation_runs WHERE id = $1', [sourceJob.id]))
          .rows[0]?.request,
      ),
    );
    expect(parseJsonColumn(retryRow.rows[0]?.prompt_snapshot)).toEqual(beforeSnapshot);
  });
  it('云端设计方案:owner 隔离、不可变 revision、乐观锁、软删除与明确不可用错误', async () => {
    const schemeId = 'scheme_cloud_integration';
    const revision1 = 'revision_cloud_1';
    const revision2 = 'revision_cloud_2';
    const created = await request('/api/v1/design-schemes', {
      method: 'POST',
      body: JSON.stringify({
        executionId: 'execution_cloud_1',
        brief: '创建云端编辑海报方案',
        sourceUris: [],
        sourceBindings: [],
        sourcePackages: [],
        sourceSnapshots: [],
        sourceAssetIds: [],
        sourceAssets: [],
        document: designSchemeDocument(schemeId, revision1),
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      scheme: { id: string; version: number; currentRevisionId: string };
      document: { revisionId: string };
    };
    expect(createdBody.scheme).toMatchObject({
      id: schemeId,
      version: 1,
      currentRevisionId: revision1,
    });
    expect(createdBody.document.revisionId).toBe(revision1);

    const detail = await request(`/api/v1/design-schemes/${schemeId}`);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      summary: { id: schemeId, inputLabels: ['主题 · 必需'] },
      document: { revisionId: revision1 },
      assets: [],
      sourceSnapshots: [],
    });

    const updated = await request('/api/v1/design-schemes/update', {
      method: 'POST',
      body: JSON.stringify({
        schemeId,
        baseRevisionId: revision1,
        document: {
          ...designSchemeDocument(schemeId, revision2, revision1),
          name: '云端编辑海报 v2',
        },
        expectedVersion: 1,
      }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { scheme: { version: number } };
    expect(updatedBody.scheme.version).toBe(2);

    const revisions = await pool.query<{ revision_id: string }>(
      'SELECT revision_id FROM design_scheme_revisions WHERE scheme_id = $1 ORDER BY revision_id',
      [schemeId],
    );
    expect(revisions.rows.map((row) => row.revision_id)).toEqual([revision1, revision2]);

    const staleRename = await request('/api/v1/design-schemes/rename', {
      method: 'POST',
      body: JSON.stringify({ schemeId, name: '过期名字', expectedVersion: 1 }),
    });
    expect(staleRename.status).toBe(409);
    await expect(staleRename.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { designSchemeCode: 'DESIGN_SCHEME_VERSION_CONFLICT' },
      },
    });

    const agentCreate = await request('/api/v1/design-schemes', {
      method: 'POST',
      body: JSON.stringify({
        executionId: 'execution_cloud_agent',
        brief: '让 Agent 生成方案',
        sourceUris: [],
        sourceBindings: [],
        sourceAssetIds: [],
      }),
    });
    expect(agentCreate.status).toBe(501);
    await expect(agentCreate.json()).resolves.toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        retryable: false,
        details: {
          operation: 'create',
          designSchemeError: { code: 'DESIGN_SCHEME_CLOUD_CREATE_UNAVAILABLE' },
        },
      },
    });

    const otherSignup = await app.request('/api/auth/sign-up/new-api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'design-scheme-owner-b@musefold.app',
        password: 'correct-password',
      }),
    });
    const otherCookie = (otherSignup.headers.get('set-cookie') ?? '')
      .split(/,(?=[^;]+=)/)
      .map((part) => part.split(';')[0])
      .join('; ');
    const hidden = await app.request(`/api/v1/design-schemes/${schemeId}`, {
      headers: { 'content-type': 'application/json', cookie: otherCookie },
    });
    expect(hidden.status).toBe(404);

    const removed = await request('/api/v1/design-schemes/remove', {
      method: 'POST',
      body: JSON.stringify({ schemeId, expectedVersion: 2 }),
    });
    expect(removed.status).toBe(200);
    const gone = await request(`/api/v1/design-schemes/${schemeId}`);
    expect(gone.status).toBe(404);
    const stored = await pool.query<{ deleted_at: Date | null; revision_count: number }>(
      `SELECT ds.deleted_at,
              (SELECT count(*)::int FROM design_scheme_revisions r WHERE r.scheme_id = ds.id) AS revision_count
       FROM design_schemes ds WHERE ds.id = $1`,
      [schemeId],
    );
    expect(stored.rows[0]?.deleted_at).toBeTruthy();
    expect(stored.rows[0]?.revision_count).toBe(2);
  });

  it('MCP well-known 资源元数据可发现,未带 token 的调用返回 401', async () => {
    const metadata = await request('/.well-known/oauth-protected-resource/mcp');
    expect([200, 404]).toContain(metadata.status);

    const unauthorized = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('www-authenticate')).toBeTruthy();
  });
});
