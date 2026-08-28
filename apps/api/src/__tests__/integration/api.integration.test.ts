import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type {
  NewApiClient,
  RelayApiToken,
  RelayAuthSession,
  RelayUser,
} from '@musefold/new-api-client';
import { type MusefoldDatabase, createDatabase, migrateDatabase } from '@musefold/db';
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
      return { ...relaySession(), user: { ...RELAY_USER, username } };
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

const fakeSigner: AssetUrlSigner = {
  async sign(objectKey) {
    return { url: `https://cdn.test/${objectKey}?sig=x`, expiresAt: new Date().toISOString() };
  },
};

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
      results: Array<{ status: string; version: number | null }>;
    };
    expect(pushBody.results[0]?.status).toBe('applied');

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

    const duplicate = await request('/api/v1/sync/push', {
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
    const duplicateBody = (await duplicate.json()) as { results: Array<{ status: string }> };
    expect(duplicateBody.results[0]?.status).toBe('duplicate');
  });

  it('工作台会话生命周期', async () => {
    const created = await request('/api/v1/workbench/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: '晚霞尝试', draft: { prompt: 'sunset', size: 'auto' } }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string; version: number };

    const list = await request('/api/v1/workbench/sessions');
    const page = (await list.json()) as { items: Array<{ id: string }> };
    expect(page.items.some((item) => item.id === session.id)).toBe(true);

    const removed = await request(`/api/v1/workbench/sessions/${session.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ expectedVersion: session.version }),
    });
    expect(removed.status).toBe(200);
  });

  it('生成任务入队(幂等)并可取消', async () => {
    const idempotencyKey = 'itest-generation-0001';
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

    const jobs = await pool.query(
      "SELECT count(*)::int AS count FROM graphile_worker.jobs WHERE task_identifier = 'generation.generate'",
    );
    expect(jobs.rows[0].count).toBe(1);

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
