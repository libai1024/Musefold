import { createHash, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { cloudGenerationRequestSchema } from '@musefold/contracts';
import {
  type MusefoldDatabase,
  generationExecutionReceipts,
  createDatabase,
  generationAssets,
  generationEvents,
  generationRuns,
  migrateDatabase,
  objectCleanupQueue,
  user,
} from '@musefold/db';
import { eq, sql } from 'drizzle-orm';
import { runMigrations } from 'graphile-worker';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generationJobKey } from '../tasks.js';
import {
  type FixtureExecutionAuthority,
  attachExecutionReceipt,
  seedExecutionAuthority,
} from './fixtures/execution-authority.js';
import {
  PROCESS_TEST_API_ISSUER,
  PROCESS_TEST_KEY,
  PROCESS_TEST_USER,
  ProcessWorker,
  createProcessTestServer,
  waitUntil,
} from './fixtures/process-runtime.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('worker processes: real crash/restart, competing leases and Graphile reconcile', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: MusefoldDatabase;
  let databaseUrl: string;
  let databaseName: string;
  let authority: FixtureExecutionAuthority;
  let server: Awaited<ReturnType<typeof createProcessTestServer>>;
  const workers: ProcessWorker[] = [];
  const databaseErrors: Error[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
  }, 180_000);

  beforeEach(async () => {
    databaseErrors.length = 0;
    // Each case owns a new database: crashed Graphile job locks are never edited or unlocked.
    databaseName = `process_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(container.getConnectionUri());
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    ({ db, pool } = createDatabase(databaseUrl, { max: 5 }));
    pool.on('error', (error) => databaseErrors.push(error));
    await migrateDatabase(db);
    await runMigrations({ pgPool: pool });
    await db.insert(user).values({
      id: PROCESS_TEST_USER,
      name: 'Process fixture',
      email: 'process@example.test',
    });
    server = await createProcessTestServer();
    authority = await seedExecutionAuthority(db, {
      userId: PROCESS_TEST_USER,
      apiIssuer: PROCESS_TEST_API_ISSUER,
      upstreamIssuer: server.url,
      encryptionKey: PROCESS_TEST_KEY,
      apiKey: 'fixture-only',
    });
  }, 30_000);

  afterEach(async () => {
    const ownedWorkers = workers.splice(0);
    const stopped = await Promise.allSettled(ownedWorkers.map((worker) => worker.stop('SIGKILL')));
    const runs = await db
      .select({
        id: generationRuns.id,
        status: generationRuns.status,
        epoch: generationRuns.attemptCount,
        sent: generationRuns.upstreamRequestSent,
        lease: generationRuns.leaseExpiresAt,
        error: generationRuns.errorCode,
      })
      .from(generationRuns);
    const receipts = await db
      .select({
        runId: generationExecutionReceipts.originalRunId,
        status: generationExecutionReceipts.status,
        dispatch: generationExecutionReceipts.dispatch,
        cost: generationExecutionReceipts.costPoints,
        provenance: generationExecutionReceipts.costProvenance,
        revision: generationExecutionReceipts.revision,
      })
      .from(generationExecutionReceipts);
    console.info(
      'WORKER_MATRIX',
      JSON.stringify({
        test: expect.getState().currentTestName,
        pids: ownedWorkers.map((w) => w.child.pid),
        exits: stopped,
        runs,
        receipts,
        providerCalls: Object.fromEntries(server.calls),
        objectHashes: [...server.objects.keys()].map((k) =>
          createHash('sha256').update(k).digest('hex'),
        ),
        events: await db
          .select({ runId: generationEvents.runId, type: generationEvents.eventType })
          .from(generationEvents),
        assetCount: (await db.select({ id: generationAssets.id }).from(generationAssets)).length,
        cleanupPending: (
          await db.select({ objectKey: objectCleanupQueue.objectKey }).from(objectCleanupQueue)
        ).length,
      }),
    );
    await server?.close();
    await pool?.end();
    if (databaseName) {
      // pg.Pool.end() can resolve while the backend is still closing its socket.
      // Wait for real disconnection instead of FORCE-killing clients and hiding errors.
      await waitUntil(async () => {
        const result = await admin.query<{ count: string }>(
          'SELECT count(*) FROM pg_stat_activity WHERE datname = $1',
          [databaseName],
        );
        return result.rows[0]?.count === '0';
      }, 'closed PostgreSQL connections');
      await admin.query(`DROP DATABASE ${databaseName}`);
    }
    for (const result of stopped) if (result.status === 'rejected') throw result.reason;
    expect(databaseErrors).toEqual([]);
  }, 30_000);

  afterAll(async () => {
    await admin?.end();
    await container?.stop();
  });

  async function insertRun(bindingState: 'bound' | 'legacy_unbound' = 'bound') {
    const runId = randomUUID();
    await db.insert(generationRuns).values({
      id: runId,
      userId: PROCESS_TEST_USER,
      runKind: 'free_generation',
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'queued',
      request: cloudGenerationRequestSchema.parse({ prompt: runId }),
      idempotencyKey: `process-${runId}`,
      providerModel: 'musefold-image-pro',
    });
    if (bindingState === 'bound') {
      await attachExecutionReceipt(db, { runId, userId: PROCESS_TEST_USER, authority });
    } else {
      const receiptId = randomUUID();
      await db.insert(generationExecutionReceipts).values({
        id: receiptId,
        principalId: PROCESS_TEST_USER,
        idempotencyKey: `process-${runId}`,
        operation: 'legacy_unknown',
        originalRunId: runId,
        bindingState: 'legacy_unbound',
        binding: null,
        authorizingSessionId: null,
        authRevision: null,
        status: 'queued',
        dispatch: 'not_started',
        costProvenance: 'not_sent',
        costPoints: 0,
      });
      await db
        .update(generationRuns)
        .set({ executionReceiptId: receiptId })
        .where(eq(generationRuns.id, runId));
    }
    return runId;
  }

  async function enqueue(task: string, runId?: string) {
    const payload = runId ? { userId: PROCESS_TEST_USER, runId } : {};
    await db.execute(sql`
      SELECT graphile_worker.add_job(
        ${task}::text, ${JSON.stringify(payload)}::json,
        max_attempts := 1,
        job_key := ${runId ? generationJobKey(runId) : randomUUID()}::text,
        job_key_mode := 'replace'
      )
    `);
  }

  async function start(pauseAt = '') {
    const worker = new ProcessWorker(databaseUrl, server.url, pauseAt);
    workers.push(worker);
    await worker.wait(pauseAt === 'before-runner' ? 'barrier' : 'ready');
    return worker;
  }

  async function loadRun(runId: string) {
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId));
    return row;
  }

  async function waitStatus(runId: string, status: string) {
    await waitUntil(async () => (await loadRun(runId))?.status === status, status);
    return loadRun(runId);
  }

  async function expireLease(runId: string) {
    // Advance only the application lease deadline. Real subprocesses, epochs,
    // provider markers and Graphile's crash locks remain untouched.
    await db
      .update(generationRuns)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(generationRuns.id, runId));
  }

  async function runMaintenance(
    worker: ProcessWorker,
    task = 'generation/reconcile',
    runId?: string,
  ) {
    // Once barriers open, either real worker may consume a maintenance job.
    const consumers = [...new Set([worker, ...workers])];
    const count = () =>
      consumers.reduce(
        (total, consumer) =>
          total +
          consumer.messages.filter((m) => m.type === 'task-finished' && m.task === task).length,
        0,
      );
    const before = count();
    await enqueue(task, runId);
    await waitUntil(() => count() > before, task);
  }

  async function expectTerminal(runId: string, status: string, assetCount: number) {
    const row = await waitStatus(runId, status);
    const assets = await db
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, runId));
    const events = await db
      .select()
      .from(generationEvents)
      .where(eq(generationEvents.runId, runId));
    expect(assets).toHaveLength(assetCount);
    expect(assets.map((asset) => asset.position)).toEqual(assetCount === 1 ? [0] : []);
    expect(
      events.filter((event) =>
        ['generation.succeeded', 'generation.failed', 'generation.cancelled'].includes(
          event.eventType,
        ),
      ),
    ).toHaveLength(1);
    expect(row?.leaseExpiresAt).toBeNull();
    return row;
  }

  it('legacy_unbound stays rejected with zero paid HTTP despite currently valid account credentials', async () => {
    const runId = await insertRun('legacy_unbound');
    await enqueue('generation.generate', runId);
    const worker = await start();
    await worker.wait('task-finished', { task: 'generation.generate' });
    expect(await expectTerminal(runId, 'failed', 0)).toMatchObject({
      errorCode: 'ACCOUNT_IDENTITY_UNVERIFIED',
      upstreamRequestSent: false,
      attemptCount: 0,
    });
    const [receipt] = await db
      .select()
      .from(generationExecutionReceipts)
      .where(eq(generationExecutionReceipts.originalRunId, runId));
    expect(receipt).toMatchObject({
      bindingState: 'legacy_unbound',
      binding: null,
      status: 'failed',
      dispatch: 'not_started',
      costProvenance: 'not_sent',
      costPoints: 0,
    });
    await runMaintenance(worker, 'generation.generate', runId);
    await expectTerminal(runId, 'failed', 0);
    expect(server.calls.get(runId) ?? 0).toBe(0);
    expect(server.objects.size).toBe(0);
  }, 30_000);

  it.each(['sent-marker', 'claimed-receipt', 'both'] as const)(
    'defensive queued %s evidence becomes unknown without a new dispatch',
    async (evidence) => {
      const runId = await insertRun();
      // Deliberately inconsistent persisted states: normal dispatch updates both records atomically.
      // Either durable indication must prevent a recovered/legacy queued row from paying twice.
      if (evidence !== 'claimed-receipt')
        await db
          .update(generationRuns)
          .set({ upstreamRequestSent: true })
          .where(eq(generationRuns.id, runId));
      if (evidence !== 'sent-marker')
        await db
          .update(generationExecutionReceipts)
          .set({
            dispatch: 'claimed',
            claimedAt: new Date(),
            costProvenance: 'unknown',
            costPoints: null,
          })
          .where(eq(generationExecutionReceipts.originalRunId, runId));
      await enqueue('generation.generate', runId);
      const worker = await start();
      await worker.wait('task-finished', { task: 'generation.generate' });
      expect(await expectTerminal(runId, 'failed', 0)).toMatchObject({
        attemptCount: 0,
        errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
        upstreamRequestSent: evidence !== 'claimed-receipt',
      });
      const receipt = async () =>
        (
          await db
            .select()
            .from(generationExecutionReceipts)
            .where(eq(generationExecutionReceipts.originalRunId, runId))
        )[0];
      const before = await receipt();
      expect(before).toMatchObject({
        status: 'failed',
        dispatch: 'claimed',
        costProvenance: 'unknown',
        costPoints: null,
      });
      await runMaintenance(worker);
      await runMaintenance(worker, 'generation.generate', runId);
      await expectTerminal(runId, 'failed', 0);
      expect(await receipt()).toEqual(before);
      expect(server.calls.get(runId) ?? 0).toBe(0);
      expect(server.objects.size).toBe(0);
    },
    30_000,
  );

  it('queued before runner crash survives a new PID; SIGTERM closes runner and pool cleanly', async () => {
    const runId = await insertRun();
    await enqueue('generation.generate', runId);
    const original = await start('before-runner');
    expect(await original.stop('SIGKILL')).toEqual({ code: null, signal: 'SIGKILL' });
    expect(await loadRun(runId)).toMatchObject({ status: 'queued', attemptCount: 0 });
    const restarted = await start();
    expect(restarted.child.pid).not.toBe(original.child.pid);
    await expectTerminal(runId, 'succeeded', 1);
    await restarted.wait('task-finished', { task: 'generation.generate' });
    expect(server.calls.get(runId)).toBe(1);
    expect(await restarted.stop()).toEqual({ code: 0, signal: null });
    expect(restarted.messages.some((message) => message.type === 'stopped')).toBe(true);
  }, 30_000);

  it.each([false, true])(
    'crash before upstream, cancelling=%s: reconcile safely continues or cancels',
    async (cancelling) => {
      const runId = await insertRun();
      await enqueue('generation.generate', runId);
      const original = await start('before-upstream');
      await original.wait('barrier');
      expect(await loadRun(runId)).toMatchObject({
        status: 'running',
        attemptCount: 1,
        upstreamRequestSent: false,
      });
      await original.stop('SIGKILL');
      if (cancelling)
        await db
          .update(generationRuns)
          .set({ status: 'cancelling' })
          .where(eq(generationRuns.id, runId));
      await expireLease(runId);
      const restarted = await start();
      expect(restarted.child.pid).not.toBe(original.child.pid);
      await runMaintenance(restarted);
      const row = await expectTerminal(
        runId,
        cancelling ? 'cancelled' : 'succeeded',
        cancelling ? 0 : 1,
      );
      expect(row?.attemptCount).toBe(cancelling ? 1 : 2);
      expect(server.calls.get(runId) ?? 0).toBe(cancelling ? 0 : 1);
      await runMaintenance(restarted);
      await expectTerminal(runId, cancelling ? 'cancelled' : 'succeeded', cancelling ? 0 : 1);
      expect(server.calls.get(runId) ?? 0).toBe(cancelling ? 0 : 1);
    },
    30_000,
  );

  it.each([false, true])(
    'SIGKILL after committed dispatch claim and before HTTP, cancelling=%s: restart remains unknown without sending',
    async (cancelling) => {
      const runId = await insertRun();
      await enqueue('generation.generate', runId);
      const original = await start('after-claim');
      await original.wait('barrier', { phase: 'after-claim', epoch: 1 });
      expect(await loadRun(runId)).toMatchObject({
        status: 'running',
        attemptCount: 1,
        upstreamRequestSent: true,
      });
      const [claimed] = await db
        .select()
        .from(generationExecutionReceipts)
        .where(eq(generationExecutionReceipts.originalRunId, runId));
      expect(claimed).toMatchObject({
        bindingState: 'bound',
        status: 'running',
        dispatch: 'claimed',
        costProvenance: 'unknown',
        costPoints: null,
      });
      expect(claimed.claimedAt).toBeInstanceOf(Date);
      expect(server.calls.get(runId) ?? 0).toBe(0);
      expect(await original.stop('SIGKILL')).toEqual({ code: null, signal: 'SIGKILL' });
      if (cancelling)
        await db
          .update(generationRuns)
          .set({ status: 'cancelling' })
          .where(eq(generationRuns.id, runId));
      await expireLease(runId);
      const replacement = await start();
      expect(replacement.child.pid).not.toBe(original.child.pid);
      await runMaintenance(replacement);
      expect(await expectTerminal(runId, 'failed', 0)).toMatchObject({
        errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
        upstreamRequestSent: true,
        attemptCount: 1,
      });
      const [terminal] = await db
        .select()
        .from(generationExecutionReceipts)
        .where(eq(generationExecutionReceipts.id, claimed.id));
      expect(terminal).toMatchObject({
        status: 'failed',
        dispatch: 'claimed',
        costProvenance: 'unknown',
        costPoints: null,
      });
      await runMaintenance(replacement, 'generation.generate', runId);
      await runMaintenance(replacement);
      await expectTerminal(runId, 'failed', 0);
      expect(server.calls.get(runId) ?? 0).toBe(0);
      expect(server.objects.size).toBe(0);
    },
    30_000,
  );

  it.each([false, true])(
    'crash after upstream HTTP acceptance, cancelling=%s: unknown never re-sends',
    async (cancelling) => {
      const runId = await insertRun();
      server.heldRuns.add(runId);
      await enqueue('generation.generate', runId);
      const original = await start();
      await waitUntil(() => server.calls.get(runId) === 1, 'provider acceptance');
      expect(await loadRun(runId)).toMatchObject({ attemptCount: 1, upstreamRequestSent: true });
      await original.stop('SIGKILL');
      if (cancelling)
        await db
          .update(generationRuns)
          .set({ status: 'cancelling' })
          .where(eq(generationRuns.id, runId));
      await expireLease(runId);
      const restarted = await start();
      await runMaintenance(restarted);
      expect(await expectTerminal(runId, 'failed', 0)).toMatchObject({
        errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
        upstreamRequestSent: true,
      });
      server.release(runId);
      await runMaintenance(restarted);
      await runMaintenance(restarted, 'generation.generate', runId);
      expect(server.calls.get(runId)).toBe(1);
      expect(server.objects.size).toBe(0);
      await expectTerminal(runId, 'failed', 0);
    },
    30_000,
  );

  it('a completed run survives restart and duplicate delivery without extra assets or terminal events', async () => {
    const runId = await insertRun();
    await enqueue('generation.generate', runId);
    const original = await start();
    await original.wait('task-finished', { task: 'generation.generate' });
    await expectTerminal(runId, 'succeeded', 1);
    await original.stop('SIGKILL');
    await enqueue('generation.generate', runId);
    const restarted = await start();
    await restarted.wait('task-finished', { task: 'generation.generate' });
    await expectTerminal(runId, 'succeeded', 1);
    expect(server.calls.get(runId)).toBe(1);
    expect(server.objects.size).toBe(1);
  }, 30_000);

  it('crash after upload leaves durable cleanup; restarted maintenance retries an S3 outage', async () => {
    const runId = await insertRun();
    await enqueue('generation.generate', runId);
    const original = await start('after-upload');
    await original.wait('barrier');
    expect(server.objects.size).toBe(1);
    expect(await db.select().from(objectCleanupQueue)).toHaveLength(1);
    await original.stop('SIGKILL');
    await expireLease(runId);
    const restarted = await start();
    await runMaintenance(restarted);
    await expectTerminal(runId, 'failed', 0);
    await db.update(objectCleanupQueue).set({ nextAttemptAt: new Date(0) });
    server.setFailDeletes(true);
    await runMaintenance(restarted, 'maintenance/cleanup');
    const [pending] = await db.select().from(objectCleanupQueue);
    expect(pending).toMatchObject({ attemptCount: 1 });
    expect(server.objects.size).toBe(1);
    server.setFailDeletes(false);
    await db.update(objectCleanupQueue).set({ nextAttemptAt: new Date(0) });
    await runMaintenance(restarted, 'maintenance/cleanup');
    expect(await db.select().from(objectCleanupQueue)).toHaveLength(0);
    expect(server.objects.size).toBe(0);
    expect(server.calls.get(runId)).toBe(1);
  }, 30_000);

  it('two processes: old epoch cannot send upstream or mark failed over the new successful owner', async () => {
    const runId = await insertRun();
    await enqueue('generation.generate', runId);
    const original = await start('before-upstream');
    await original.wait('barrier', { epoch: 1 });
    await expireLease(runId);
    const replacement = await start();
    await runMaintenance(replacement);
    expect(await expectTerminal(runId, 'succeeded', 1)).toMatchObject({ attemptCount: 2 });
    original.send('release');
    await original.wait('task-finished', { task: 'generation.generate' });
    await expectTerminal(runId, 'succeeded', 1);
    expect(server.calls.get(runId)).toBe(1);
    expect(server.objects.size).toBe(1);
  }, 30_000);

  it('old heartbeat cannot extend the replacement lease; losing epoch aborts before HTTP', async () => {
    const runId = await insertRun();
    await enqueue('generation.generate', runId);
    const original = await start('before-upstream');
    await original.wait('barrier', { epoch: 1 });
    await expireLease(runId);
    const replacement = await start('before-upstream');
    await runMaintenance(replacement);
    await replacement.wait('barrier', { epoch: 2 });
    const before = await loadRun(runId);
    original.send('renew');
    await original.wait('renewed', { lost: true });
    expect((await loadRun(runId))?.leaseExpiresAt).toEqual(before?.leaseExpiresAt);
    original.send('release');
    await original.wait('task-finished', { task: 'generation.generate' });
    expect(await loadRun(runId)).toMatchObject({
      status: 'running',
      attemptCount: 2,
      upstreamRequestSent: false,
    });
    replacement.send('release');
    await expectTerminal(runId, 'succeeded', 1);
    expect(server.calls.get(runId)).toBe(1);
  }, 30_000);

  it.each([false, true])(
    'late upload finalizer after real reconcile, cancelling=%s, queues its orphan for guarded maintenance',
    async (cancelling) => {
      const runId = await insertRun();
      await enqueue('generation.generate', runId);
      const original = await start('after-upload');
      await original.wait('barrier');
      if (cancelling)
        await db
          .update(generationRuns)
          .set({ status: 'cancelling' })
          .where(eq(generationRuns.id, runId));
      await expireLease(runId);
      const replacement = await start();
      await runMaintenance(replacement);
      expect(await expectTerminal(runId, 'failed', 0)).toMatchObject({
        errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
      });
      original.send('release');
      await original.wait('task-finished', { task: 'generation.generate' });
      await expectTerminal(runId, 'failed', 0);
      expect(server.calls.get(runId)).toBe(1);
      expect(server.objects.size).toBe(1);
      expect(await db.select().from(objectCleanupQueue)).toHaveLength(1);
      await runMaintenance(replacement, 'maintenance/cleanup');
      expect(server.objects.size).toBe(0);
      expect(await db.select().from(objectCleanupQueue)).toHaveLength(0);
    },
    30_000,
  );

  it('reconcile leaves valid leases alone, repairs an old queued row once and ignores terminal rows', async () => {
    const activeId = await insertRun();
    await enqueue('generation.generate', activeId);
    const active = await start('before-upstream');
    await active.wait('barrier');
    const youngId = await insertRun();
    const youngBefore = await loadRun(youngId);
    const activeBefore = await loadRun(activeId);
    const queuedId = await insertRun();
    await db
      .update(generationRuns)
      .set({ createdAt: new Date(Date.now() - 6 * 60_000) })
      .where(eq(generationRuns.id, queuedId));
    const runner = await start();
    await runMaintenance(runner);
    await expectTerminal(queuedId, 'succeeded', 1);
    await runMaintenance(runner);
    expect(await loadRun(activeId)).toMatchObject({
      status: 'running',
      attemptCount: 1,
      upstreamRequestSent: false,
    });
    expect(await loadRun(activeId)).toEqual(activeBefore);
    expect(await loadRun(youngId)).toEqual(youngBefore);
    expect(server.calls.get(youngId) ?? 0).toBe(0);
    expect(server.calls.get(activeId) ?? 0).toBe(0);
    expect(server.calls.get(queuedId)).toBe(1);
    active.send('release');
    await expectTerminal(activeId, 'succeeded', 1);
    await runMaintenance(runner);
    await expectTerminal(queuedId, 'succeeded', 1);
    await expectTerminal(activeId, 'succeeded', 1);
    expect(await loadRun(youngId)).toEqual(youngBefore);
    // This worker pauses every generation attempt; retire it before delivering the young job.
    await active.wait('task-finished', { task: 'generation.generate' });
    expect(await active.stop()).toEqual({ code: 0, signal: null });
    await runMaintenance(runner, 'generation.generate', youngId);
    await expectTerminal(youngId, 'succeeded', 1);
    expect(server.calls.get(youngId)).toBe(1);
  }, 30_000);
});
