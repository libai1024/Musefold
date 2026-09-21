import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { cloudGenerationRequestSchema } from '@musefold/contracts';
import {
  createDatabase,
  generationAssets,
  generationEvents,
  generationExecutionReceipts,
  generationRuns,
  migrateDatabase,
  user,
  type MusefoldDatabase,
} from '@musefold/db';
import { eq, sql } from 'drizzle-orm';
import { runMigrations } from 'graphile-worker';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generationJobKey } from '../tasks.js';
import {
  attachExecutionReceipt,
  seedExecutionAuthority,
  type FixtureExecutionAuthority,
} from './fixtures/execution-authority.js';
import { createProcessTestServer, waitUntil } from './fixtures/process-runtime.js';

// Dedicated real-image gate: build apps/worker/Dockerfile, then explicitly enable this suite.
// Ordinary integration may run without a built image; release evidence must include this gate.
const describeContainer =
  process.env.RUN_WORKER_CONTAINER_TESTS === 'true' ? describe : describe.skip;
const execute = promisify(execFile);
const OWNER = 'worker-container-fixture';
const ISSUER = 'https://worker-container.example.test';
const SECRET = 'synthetic-container-encryption-key';
const PROVIDER_KEY = 'synthetic-container-provider-key';
const S3_SECRET = 'synthetic-container-storage-key';
async function docker(...args: string[]) {
  return (
    await execute('docker', args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
  ).stdout.trim();
}

class ImageWorker {
  readonly name = `musefold-worker-test-${randomUUID()}`;
  id = '';
  pid = 0;
  imageId = '';
  finalState: { Running: boolean; ExitCode: number; OOMKilled: boolean } | undefined;
  constructor(private readonly image: string) {}

  async start(environment: Record<string, string>) {
    const directory = await mkdtemp(join(tmpdir(), 'musefold-container-env-'));
    try {
      const file = join(directory, 'worker.env');
      await writeFile(
        file,
        Object.entries(environment)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
        { mode: 0o600 },
      );
      this.id = await docker(
        'create',
        '--name',
        this.name,
        '--label',
        'musefold.test=worker-runtime',
        '--add-host',
        'host.docker.internal:host-gateway',
        '--env-file',
        file,
        this.image,
      );
      await docker('start', this.id);
      const inspected = JSON.parse(await docker('inspect', this.id))[0];
      this.pid = inspected.State.Pid;
      this.imageId = inspected.Image;
      expect(inspected.Config.User).toBe('musefold');
      expect(inspected.Config.Cmd).toEqual(['./node_modules/.bin/tsx', 'src/bin.ts']);
      expect(this.pid).toBeGreaterThan(0);
      await waitUntil(async () => {
        const logs = await docker('logs', this.id);
        const state = JSON.parse(await docker('inspect', '--format', '{{json .State}}', this.id));
        if (!state.Running) throw new Error('Official worker image exited before readiness');
        return logs.includes('[worker] generation worker started');
      }, 'official image readiness');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async stop(kill = false) {
    if (!this.id) return;
    const state = JSON.parse(await docker('inspect', '--format', '{{json .State}}', this.id));
    if (state.Running)
      await docker(
        kill ? 'kill' : 'stop',
        ...(kill ? ['--signal', 'KILL'] : ['--time', '10']),
        this.id,
      );
    this.finalState = JSON.parse(await docker('inspect', '--format', '{{json .State}}', this.id));
    expect(this.finalState?.Running).toBe(false);
    expect(this.finalState?.OOMKilled).toBe(false);
    const result = await execute('docker', ['logs', this.id], {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const logs = result.stdout + result.stderr;
    for (const secret of [SECRET, PROVIDER_KEY, S3_SECRET])
      expect(logs.includes(secret)).toBe(false);
    return this.finalState?.ExitCode;
  }
  async remove() {
    if (this.id) await docker('rm', '--force', this.id);
  }
}

describeContainer('official worker container: startup, shutdown and recovery', () => {
  let postgres: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let authority: FixtureExecutionAuthority;
  let server: Awaited<ReturnType<typeof createProcessTestServer>>;
  let environment: Record<string, string>;
  const workers: ImageWorker[] = [];
  const databaseErrors: Error[] = [];

  beforeAll(async () => {
    if (!process.env.WORKER_CONTAINER_IMAGE)
      throw new Error(
        'WORKER_CONTAINER_IMAGE must identify an already-built official Dockerfile image',
      );
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
    ({ db, pool } = createDatabase(postgres.getConnectionUri(), { max: 5 }));
    pool.on('error', (error) => databaseErrors.push(error));
    await migrateDatabase(db);
    await runMigrations({ pgPool: pool });
    await db
      .insert(user)
      .values({ id: OWNER, name: 'Container fixture', email: 'container@example.test' });
    // The production image reaches this test-only HTTP server through Docker's host gateway.
    server = await createProcessTestServer('0.0.0.0');
    const http = new URL(server.url);
    http.hostname = 'host.docker.internal';
    const connection = new URL(postgres.getConnectionUri());
    connection.hostname = 'host.docker.internal';
    authority = await seedExecutionAuthority(db, {
      userId: OWNER,
      apiIssuer: ISSUER,
      upstreamIssuer: http.origin,
      encryptionKey: SECRET,
      apiKey: PROVIDER_KEY,
    });
    environment = {
      NODE_ENV: 'production',
      DATABASE_URL: connection.toString(),
      PUBLIC_BASE_URL: ISSUER,
      NEW_API_BASE_URL: http.origin,
      CREDENTIAL_ENCRYPTION_KEY: SECRET,
      S3_ENDPOINT: http.origin,
      S3_BUCKET: 'test-bucket',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'synthetic-container-access',
      S3_SECRET_ACCESS_KEY: S3_SECRET,
      WORKER_CONCURRENCY: '1',
    };
  }, 180_000);
  beforeEach(() => {
    databaseErrors.length = 0;
  });
  afterEach(async () => {
    const owned = workers.splice(0);
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      for (const worker of owned) await worker.stop();
      console.info(
        'WORKER_CONTAINER',
        JSON.stringify({
          test: expect.getState().currentTestName,
          processes: owned.map((w) => ({
            id: w.id,
            pid: w.pid,
            imageId: w.imageId,
            state: w.finalState,
          })),
          providerCalls: Object.fromEntries(server.calls),
          runs: await db
            .select({
              id: generationRuns.id,
              status: generationRuns.status,
              epoch: generationRuns.attemptCount,
              error: generationRuns.errorCode,
              sent: generationRuns.upstreamRequestSent,
              lease: generationRuns.leaseExpiresAt,
            })
            .from(generationRuns),
          receipts: await db
            .select({
              runId: generationExecutionReceipts.originalRunId,
              status: generationExecutionReceipts.status,
              dispatch: generationExecutionReceipts.dispatch,
              cost: generationExecutionReceipts.costPoints,
              provenance: generationExecutionReceipts.costProvenance,
            })
            .from(generationExecutionReceipts),
          assets: await db
            .select({ runId: generationAssets.runId, position: generationAssets.position })
            .from(generationAssets),
          objectHashes: [...server.objects.keys()].map((k) =>
            createHash('sha256').update(k).digest('hex'),
          ),
        }),
      );
    } finally {
      cleanup = await Promise.allSettled(owned.map((w) => w.remove()));
    }
    for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
    expect(databaseErrors).toEqual([]);
  }, 60_000);
  afterAll(async () => {
    await server?.close();
    await pool?.end();
    await postgres?.stop();
  });

  async function queued() {
    const id = randomUUID();
    await db.insert(generationRuns).values({
      id,
      userId: OWNER,
      runKind: 'free_generation',
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'queued',
      request: cloudGenerationRequestSchema.parse({ prompt: id }),
      idempotencyKey: `container-${id}`,
      providerModel: 'musefold-image-pro',
    });
    await attachExecutionReceipt(db, { runId: id, userId: OWNER, authority });
    return id;
  }
  async function enqueue(runId?: string) {
    await db.execute(sql`SELECT graphile_worker.add_job(
      ${runId ? 'generation.generate' : 'generation/reconcile'}::text,
      ${JSON.stringify(runId ? { userId: OWNER, runId } : {})}::json,
      max_attempts := 1,job_key := ${runId ? generationJobKey(runId) : randomUUID()}::text,job_key_mode := 'replace')`);
  }
  async function start() {
    const worker = new ImageWorker(process.env.WORKER_CONTAINER_IMAGE ?? '');
    workers.push(worker);
    await worker.start(environment);
    return worker;
  }
  async function row(id: string) {
    return (await db.select().from(generationRuns).where(eq(generationRuns.id, id)))[0];
  }
  async function terminal(id: string, status: string, assets: number) {
    await waitUntil(async () => (await row(id))?.status === status, `container terminal ${status}`);
    expect(
      await db.select().from(generationAssets).where(eq(generationAssets.runId, id)),
    ).toHaveLength(assets);
    const events = await db.select().from(generationEvents).where(eq(generationEvents.runId, id));
    expect(
      events.filter((e) =>
        ['generation.succeeded', 'generation.failed', 'generation.cancelled'].includes(e.eventType),
      ),
    ).toHaveLength(1);
    expect((await row(id)).leaseExpiresAt).toBeNull();
    return row(id);
  }
  async function queueDrained() {
    await waitUntil(async () => {
      const result = await pool.query(
        'SELECT count(*)::integer AS n FROM graphile_worker.jobs WHERE attempts < max_attempts OR locked_at IS NOT NULL',
      );
      return result.rows[0].n === 0;
    }, 'container queue drained');
  }

  it('official non-root image processes once; a fresh container preserves result and exits cleanly', async () => {
    const id = await queued();
    await enqueue(id);
    const first = await start();
    await terminal(id, 'succeeded', 1);
    await queueDrained();
    const before = await row(id);
    expect(await first.stop()).toBe(0);
    await enqueue(id);
    const second = await start();
    expect(second.id).not.toBe(first.id);
    expect(second.pid).not.toBe(first.pid);
    await queueDrained();
    await terminal(id, 'succeeded', 1);
    expect(await row(id)).toEqual(before);
    expect(server.calls.get(id)).toBe(1);
    expect(await second.stop()).toBe(0);
  }, 60_000);

  it('SIGKILL during accepted HTTP becomes unknown on real container restart and never resends', async () => {
    const id = await queued();
    server.heldRuns.add(id);
    await enqueue(id);
    const first = await start();
    await waitUntil(() => server.calls.get(id) === 1, 'container provider acceptance');
    expect((await row(id)).upstreamRequestSent).toBe(true);
    expect(await first.stop(true)).toBe(137);
    // Explicit isolated lease acceleration; natural 10-minute expiry has a separate real-bin gate.
    await db
      .update(generationRuns)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(generationRuns.id, id));
    const second = await start();
    expect(second.id).not.toBe(first.id);
    expect(second.pid).not.toBe(first.pid);
    await enqueue();
    expect(await terminal(id, 'failed', 0)).toMatchObject({
      errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
      attemptCount: 1,
    });
    const receipt = (
      await db
        .select()
        .from(generationExecutionReceipts)
        .where(eq(generationExecutionReceipts.originalRunId, id))
    )[0];
    expect(receipt).toMatchObject({
      status: 'failed',
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
    });
    server.release(id);
    await enqueue(id);
    await enqueue();
    // The killed Graphile lock is deliberately retained; wait for our new deliveries, not dead locks.
    await waitUntil(async () => {
      const result = await pool.query(
        'SELECT count(*)::integer AS n FROM graphile_worker.jobs WHERE attempts < max_attempts',
      );
      return result.rows[0].n === 0;
    }, 'replacement deliveries consumed');
    await terminal(id, 'failed', 0);
    expect(server.calls.get(id)).toBe(1);
    expect(await second.stop()).toBe(0);
  }, 60_000);
});
