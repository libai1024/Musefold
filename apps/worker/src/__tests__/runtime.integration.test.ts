import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { cloudGenerationRequestSchema } from '@musefold/contracts';
import {
  type MusefoldDatabase,
  createDatabase,
  generationAssets,
  generationRuns,
  migrateDatabase,
  objectCleanupQueue,
  user,
} from '@musefold/db';
import { eq, sql } from 'drizzle-orm';
import { runMigrations, runOnce } from 'graphile-worker';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GeneratedImage } from '../image-gateway.js';
import { UpstreamImageError } from '../image-gateway.js';
import { loadEnv } from '../env.js';
import { generationJobKey, createTaskList } from '../tasks.js';
import { purgeExpiredSoftDeletedRuns } from '../retention.js';
import {
  type FixtureExecutionAuthority,
  attachExecutionReceipt,
  seedExecutionAuthority,
} from './fixtures/execution-authority.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';
const describeDb = runDatabaseTests ? describe : describe.skip;

const ENCRYPTION_KEY = 'integration-test-encryption-key';
const USER_ID = 'user-worker-runtime';
const FAKE_IMAGE: GeneratedImage = {
  bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
  mimeType: 'image/png',
  width: 1,
  height: 1,
};

function fakeGenerate(images = [FAKE_IMAGE], afterClaim?: () => Promise<void>) {
  return vi.fn<NonNullable<Parameters<typeof createTaskList>[0]['generate']>>(
    async (_request, _references, options) => {
      if (!(await options.claimUpstreamRequest()))
        throw new UpstreamImageError('unknown', 'Synthetic dispatch claim rejected', 'not_sent');
      await afterClaim?.();
      return images;
    },
  );
}

function createMemoryS3() {
  const objects = new Map<string, Buffer>();
  const s3 = {
    send: async (command: {
      input?: {
        Key?: string;
        Body?: Buffer | Uint8Array;
        Delete?: { Objects?: Array<{ Key?: string }> };
      };
    }) => {
      const key = command.input?.Key;
      if (key && command.input?.Body != null) {
        const body = command.input.Body;
        objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
        return {};
      }
      if (key) {
        const stored = objects.get(key);
        if (!stored) throw new Error('NoSuchKey');
        return { Body: { transformToByteArray: async () => new Uint8Array(stored) } };
      }
      for (const object of command.input?.Delete?.Objects ?? []) {
        if (object.Key) objects.delete(object.Key);
      }
      return { Errors: [] };
    },
  } as unknown as S3Client;
  return { s3, objects };
}

describeDb('worker disposable runtime(真 PostgreSQL + graphile-worker)', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let authority: FixtureExecutionAuthority;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused',
    NEW_API_BASE_URL: 'https://new-api.test',
    CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
    S3_BUCKET: 'musefold-runtime',
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const created = createDatabase(container.getConnectionUri(), { max: 5 });
    db = created.db;
    pool = created.pool;
    await migrateDatabase(db);
    await runMigrations({ pgPool: pool });
    await db.insert(user).values({
      id: USER_ID,
      name: 'Runtime Tester',
      email: 'runtime@test.local',
    });
    authority = await seedExecutionAuthority(db, {
      userId: USER_ID,
      apiIssuer: env.PUBLIC_BASE_URL,
      upstreamIssuer: env.NEW_API_BASE_URL,
      encryptionKey: ENCRYPTION_KEY,
      apiKey: 'sk-fake',
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function insertQueuedRun(runId = randomUUID()) {
    await db.insert(generationRuns).values({
      id: runId,
      userId: USER_ID,
      runKind: 'free_generation',
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'queued',
      request: cloudGenerationRequestSchema.parse({ prompt: 'runtime disposable' }),
      idempotencyKey: `idem-${runId}`,
      providerModel: 'musefold-image-pro',
    });
    await attachExecutionReceipt(db, { runId, userId: USER_ID, authority });
    return runId;
  }

  async function enqueueGenerate(runId: string) {
    await db.execute(sql`
      SELECT graphile_worker.add_job(
        'generation.generate',
        json_build_object('userId', ${USER_ID}::text, 'runId', ${runId}::text),
        max_attempts := 1,
        job_key := ${generationJobKey(runId)},
        job_key_mode := 'replace'
      )
    `);
  }

  async function runWorkerOnce(
    generate: Parameters<typeof createTaskList>[0]['generate'],
    s3 = createMemoryS3().s3,
    extra: Pick<Parameters<typeof createTaskList>[0], 'upload' | 'remove'> = {},
  ) {
    await runOnce({
      pgPool: pool,
      concurrency: 1,
      noHandleSignals: true,
      taskList: createTaskList({ db, env, s3, generate, ...extra }),
    });
  }

  async function loadRun(runId: string) {
    const rows = await db.select().from(generationRuns).where(eq(generationRuns.id, runId));
    return rows[0];
  }

  async function waitFor(
    predicate: () => Promise<boolean>,
    timeoutMs = 8_000,
    intervalMs = 40,
  ): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('timed out waiting for worker runtime condition');
  }

  it('入队后 runOnce:lease → fake provider → 上传 → succeeded 并落 1 张资产', async () => {
    const memory = createMemoryS3();
    const generate = fakeGenerate();
    const runId = await insertQueuedRun();
    await enqueueGenerate(runId);

    await runWorkerOnce(generate, memory.s3);

    const run = await loadRun(runId);
    expect(run).toMatchObject({
      status: 'succeeded',
      progress: 100,
      attemptCount: 1,
    });
    expect(generate).toHaveBeenCalledOnce();
    const assets = await db
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, runId));
    expect(assets).toHaveLength(1);
    expect(assets[0]?.objectKey).toMatch(new RegExp(`^users/${USER_ID}/generations/${runId}/`));
    expect(memory.objects.has(assets[0]?.objectKey ?? '')).toBe(true);
  });

  it('过期租约且已发上游:标 GENERATION_UPSTREAM_UNKNOWN,不调用 generate', async () => {
    const generate = fakeGenerate();
    const runId = randomUUID();
    await db.insert(generationRuns).values({
      id: runId,
      userId: USER_ID,
      runKind: 'free_generation',
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'running',
      progress: 40,
      request: cloudGenerationRequestSchema.parse({ prompt: 'stale lease' }),
      idempotencyKey: `idem-${runId}`,
      providerModel: 'musefold-image-pro',
      attemptCount: 1,
      upstreamRequestSent: true,
      startedAt: new Date(Date.now() - 60_000),
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    await attachExecutionReceipt(db, { runId, userId: USER_ID, authority });
    await enqueueGenerate(runId);

    await runWorkerOnce(generate);

    const run = await loadRun(runId);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
    });
    expect(generate).not.toHaveBeenCalled();
    const assets = await db
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, runId));
    expect(assets).toHaveLength(0);
  });

  it('运行中改为 cancelling:终态 cancelled,不落资产', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = fakeGenerate([FAKE_IMAGE], () => gate);
    const runId = await insertQueuedRun();
    await enqueueGenerate(runId);

    const running = runWorkerOnce(generate);
    await waitFor(async () => (await loadRun(runId))?.upstreamRequestSent === true);
    await db
      .update(generationRuns)
      .set({ status: 'cancelling' })
      .where(eq(generationRuns.id, runId));
    release();
    await running;

    const run = await loadRun(runId);
    expect(run?.status).toBe('cancelled');
    const assets = await db
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, runId));
    expect(assets).toHaveLength(0);
  });

  it('软删超过 30 天的终态 run 被 purge,未到期与非终态保留', async () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    const expiredId = randomUUID();
    const recentId = randomUUID();
    const runningId = randomUUID();
    await db.insert(generationRuns).values([
      {
        id: expiredId,
        userId: USER_ID,
        runKind: 'free_generation',
        actorType: 'web',
        status: 'succeeded',
        progress: 100,
        providerModel: 'musefold-image-pro',
        request: cloudGenerationRequestSchema.parse({ prompt: 'expired trash' }),
        idempotencyKey: `idem-${expiredId}`,
        deletedAt: new Date('2026-08-01T00:00:00.000Z'),
        finishedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        id: recentId,
        userId: USER_ID,
        runKind: 'free_generation',
        actorType: 'web',
        status: 'succeeded',
        progress: 100,
        providerModel: 'musefold-image-pro',
        request: cloudGenerationRequestSchema.parse({ prompt: 'recent trash' }),
        idempotencyKey: `idem-${recentId}`,
        deletedAt: new Date('2026-09-06T00:00:00.000Z'),
        finishedAt: new Date('2026-09-06T00:00:00.000Z'),
      },
      {
        id: runningId,
        userId: USER_ID,
        runKind: 'free_generation',
        actorType: 'web',
        status: 'running',
        progress: 20,
        providerModel: 'musefold-image-pro',
        request: cloudGenerationRequestSchema.parse({ prompt: 'still running' }),
        idempotencyKey: `idem-${runningId}`,
        deletedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
    for (const runId of [expiredId, recentId, runningId])
      await attachExecutionReceipt(db, { runId, userId: USER_ID, authority });
    const expiredKey = `users/${USER_ID}/generations/${expiredId}/asset`;
    await db.insert(generationAssets).values({
      id: randomUUID(),
      runId: expiredId,
      userId: USER_ID,
      objectKey: expiredKey,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteSize: 4,
      checksumSha256: '0'.repeat(64),
      position: 0,
    });

    const outcome = await purgeExpiredSoftDeletedRuns(db, now);
    expect(outcome).toEqual({ purged: 1, objectKeys: [expiredKey] });
    expect(await loadRun(expiredId)).toBeUndefined();
    expect(await loadRun(recentId)).toMatchObject({ status: 'succeeded' });
    expect(await loadRun(runningId)).toMatchObject({ status: 'running' });
    const queued = await db
      .select()
      .from(objectCleanupQueue)
      .where(eq(objectCleanupQueue.objectKey, expiredKey));
    expect(queued[0]).toMatchObject({
      ownerId: USER_ID,
      objectType: 'generation_asset',
      reason: 'generation_purge',
    });
  });

  it('过期租约且未发上游:续跑 generate 并 succeeded', async () => {
    const generate = fakeGenerate();
    const runId = randomUUID();
    await db.insert(generationRuns).values({
      id: runId,
      userId: USER_ID,
      runKind: 'free_generation',
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'running',
      progress: 40,
      request: cloudGenerationRequestSchema.parse({ prompt: 'restart continue' }),
      idempotencyKey: `idem-${runId}`,
      providerModel: 'musefold-image-pro',
      attemptCount: 1,
      upstreamRequestSent: false,
      startedAt: new Date(Date.now() - 60_000),
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    await attachExecutionReceipt(db, { runId, userId: USER_ID, authority });
    await enqueueGenerate(runId);

    await runWorkerOnce(generate);

    const run = await loadRun(runId);
    expect(run).toMatchObject({ status: 'succeeded', progress: 100 });
    expect(generate).toHaveBeenCalledOnce();
    const assets = await db
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, runId));
    expect(assets).toHaveLength(1);
  });

  it('迟到成功不得覆盖已标 unknown 的终态', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = fakeGenerate([FAKE_IMAGE], () => gate);
    const runId = await insertQueuedRun();
    await enqueueGenerate(runId);

    const inflight = runWorkerOnce(generate);
    await waitFor(async () => (await loadRun(runId))?.upstreamRequestSent === true);
    await db
      .update(generationRuns)
      .set({
        status: 'failed',
        progress: 100,
        errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
        errorMessage: 'worker 在上游请求完成前退出，结果无法确认',
        finishedAt: new Date(),
        leaseExpiresAt: null,
      })
      .where(eq(generationRuns.id, runId));
    release();
    await inflight;

    const run = await loadRun(runId);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
    });
    const assets = await db
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, runId));
    expect(assets).toHaveLength(0);
  });

  it('第二张上传失败不得 succeeded,已上传键进入 cleanup', async () => {
    const generate = fakeGenerate([FAKE_IMAGE, FAKE_IMAGE]);
    const uploadedKeys: string[] = [];
    const upload: NonNullable<Parameters<typeof createTaskList>[0]['upload']> = async (
      _s3,
      _bucket,
      payload,
      images,
      uploadedObjectKeys,
    ) => {
      const first = images[0];
      if (!first) throw new Error('expected two images');
      const id = randomUUID();
      const objectKey = `users/${payload.userId}/generations/${payload.runId}/${id}`;
      uploadedObjectKeys.push(objectKey);
      uploadedKeys.push(objectKey);
      throw Object.assign(new Error('成图保存失败，请重试'), { name: 'ObjectStorageError' });
    };
    const runId = await insertQueuedRun();
    await enqueueGenerate(runId);

    await runWorkerOnce(generate, createMemoryS3().s3, {
      upload,
    });

    const run = await loadRun(runId);
    expect(run?.status).not.toBe('succeeded');
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
    });
    const assets = await db
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, runId));
    expect(assets).toHaveLength(0);
    expect(uploadedKeys).toHaveLength(1);
    const queued = await db
      .select()
      .from(objectCleanupQueue)
      .where(eq(objectCleanupQueue.objectKey, uploadedKeys[0] ?? ''));
    expect(queued).toHaveLength(1);
  });
});
