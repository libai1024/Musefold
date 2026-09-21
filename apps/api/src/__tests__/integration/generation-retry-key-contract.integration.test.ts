import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  type ExecutionBinding,
  type GenerationJob,
  generationExecutionReceiptSchema,
} from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from 'graphile-worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { generationRoutes } from '../../modules/generation/routes.js';
import { GenerationService } from '../../modules/generation/service.js';
import {
  GENERATION_TEST_ISSUERS,
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

// R4-1 层 B 补缺：重试不得复用源 create 的 Idempotency-Key（新请求单独授权+独立 key），
// 且重试子被接受后源 key 仍按 ordinary_create 重放、两个 key 各自满足同一 canonical 合同。
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'retry-key-owner';
const AUTH = generationAuthSession(OWNER);
const forbiddenIo = async (): Promise<never> => {
  throw new Error('This retry-key fixture must not perform object or provider IO');
};

describeDb('generation retry key separation: one canonical contract, one key per operation', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let generation: GenerationService;
  let binding: ExecutionBinding;
  let app: OpenAPIHono<AuthedEnv>;
  const connectionEnds: Promise<void>[] = [];
  let poolErrors = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 10 });
    database.pool.on('error', () => {
      poolErrors += 1;
    });
    database.pool.on('connect', (client) => {
      connectionEnds.push(new Promise<void>((done) => client.once('end', done)));
    });
    await migrateDatabase(database.db);
    await runMigrations({ pgPool: database.pool });
    generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        sign: forbiddenIo,
        readObject: forbiddenIo,
        putObject: forbiddenIo,
        removeObjects: forbiddenIo,
      },
      GENERATION_TEST_ISSUERS,
    );
    app = new OpenAPIHono<AuthedEnv>();
    app.use('*', async (c, next) => {
      c.set('userId', OWNER);
      c.set('sessionId', AUTH);
      await next();
    });
    app.onError((error, c) => {
      if (error instanceof AppError)
        return c.json(toErrorBody(error, 'retry-key-fixture'), error.status as 400);
      throw error;
    });
    app.route('/', generationRoutes(generation));
  }, 120_000);

  beforeEach(async () => {
    await database.pool.query('TRUNCATE "user" CASCADE');
    await database.pool.query('DELETE FROM generation_execution_receipts');
    await database.pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$1)', [OWNER]);
    binding = await seedGenerationAuthority(database.db, { principalId: OWNER, ownerId: '42' });
  });

  afterAll(async () => {
    await database?.pool.end();
    await Promise.all(connectionEnds);
    await container?.stop();
    expect(poolErrors).toBe(0);
  });

  function post(path: string, body?: unknown, key: string = randomUUID()) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function create(key: string = randomUUID()) {
    const response = await post('/generations', { prompt: 'Retry key separation poster' }, key);
    expect(response.status).toBe(201);
    return (await response.json()) as GenerationJob;
  }

  async function counts() {
    return (
      await database.pool.query(`SELECT
      (SELECT count(*)::int FROM generation_runs) AS runs,
      (SELECT count(*)::int FROM generation_execution_receipts) AS receipts,
      (SELECT count(*)::int FROM graphile_worker._private_jobs j JOIN generation_runs r ON j.payload->>'runId'=r.id) AS jobs`)
    ).rows[0];
  }

  async function rawReceipt(key: string) {
    const result = await database.pool.query(
      'SELECT * FROM generation_execution_receipts WHERE principal_id=$1 AND idempotency_key=$2',
      [OWNER, key],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
  }

  async function publicReceipt(key: string) {
    const response = await app.request(
      `/generations/receipts/by-key?key=${encodeURIComponent(key)}`,
    );
    expect(response.status).toBe(200);
    return generationExecutionReceiptSchema.parse(await response.json());
  }

  it('rejects a retry that reuses the source create key, which keeps replaying ordinary_create', async () => {
    const sourceKey = randomUUID();
    const source = await create(sourceKey);
    const before = await counts();
    const cancelled = await post(`/generations/${source.id}/cancel`);
    expect(cancelled.status).toBe(200);
    const cancelledCounts = await counts();
    // 同一个 key 跨 operation 复用：receipt 已按 ordinary_create 接受，重试意图必须 409。
    const conflict = await post(`/generations/${source.id}/retry`, undefined, sourceKey);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: 'GENERATION_IDEMPOTENCY_CONFLICT' },
    });
    expect(await counts()).toEqual(cancelledCounts);
    expect((await counts()).runs).toBe(before.runs);
    // 源 key 仍按 ordinary_create 语义重放原任务，不产生第二个 run/receipt/job。
    const replay = await post('/generations', { prompt: 'Retry key separation poster' }, sourceKey);
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as GenerationJob).id).toBe(source.id);
    expect(await counts()).toEqual(cancelledCounts);
    expect((await publicReceipt(sourceKey)).operation).toBe('ordinary_create');
  });

  it('keeps source and retry keys on their own sides of the same canonical receipt contract', async () => {
    const sourceKey = randomUUID();
    const source = await create(sourceKey);
    await post(`/generations/${source.id}/cancel`);
    const sourceRowBefore = await rawReceipt(sourceKey);
    const retryKey = randomUUID();
    const accepted = await post(`/generations/${source.id}/retry`, undefined, retryKey);
    expect(accepted.status).toBe(201);
    const child = (await accepted.json()) as GenerationJob;
    expect(child.parentRunId).toBe(source.id);
    expect(child.request).toEqual(source.request);
    // 原请求身份/费用不变：源回执行在子任务受理前后逐字段一致。
    expect(await rawReceipt(sourceKey)).toEqual(sourceRowBefore);
    // 两个 key 各自满足同一 canonical 合同：源 ordinary_create、子 explicit_retry+sourceRunId。
    const sourceReceipt = await publicReceipt(sourceKey);
    const retryReceipt = await publicReceipt(retryKey);
    expect(sourceReceipt).toMatchObject({
      operation: 'ordinary_create',
      sourceRunId: null,
      binding,
    });
    expect(retryReceipt).toMatchObject({
      operation: 'explicit_retry',
      sourceRunId: source.id,
      binding,
    });
    expect(retryReceipt.idempotencyKey).not.toBe(sourceReceipt.idempotencyKey);
    // 重试 key 不得移用到另一个源：key↔intent 绑定必须拒绝。
    const hijack = await post(`/generations/${randomUUID()}/retry`, undefined, retryKey);
    expect(hijack.status).toBe(409);
    expect(await hijack.json()).toMatchObject({
      error: { code: 'GENERATION_IDEMPOTENCY_CONFLICT' },
    });
    expect(await counts()).toEqual({ runs: 2, receipts: 2, jobs: 2 });
  });
});
