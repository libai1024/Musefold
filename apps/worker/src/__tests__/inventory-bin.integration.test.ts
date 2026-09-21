import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';
import { createHeldInventoryResponseProxy } from './fixtures/held-inventory-response.js';
import { waitUntil } from './fixtures/process-runtime.js';
import { inventoryScopeId, scanObjectInventoryPage } from '../object-inventory.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('actual bin inventory pause and interrupted-page recovery', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  let proxy: Awaited<ReturnType<typeof createHeldInventoryResponseProxy>>;
  const children: Array<{ child: ChildProcess; exited: Promise<unknown> }> = [];
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    storage = await createDisposableObjectStorage();
    proxy = await createHeldInventoryResponseProxy(storage.endpoint);
  }, 180000);
  afterAll(async () => {
    for (const worker of children)
      if (worker.child.exitCode === null && worker.child.signalCode === null)
        worker.child.kill('SIGKILL');
    await Promise.all(children.map((worker) => worker.exited));
    await proxy?.close();
    await storage?.close();
    await database?.pool.end();
    await container?.stop();
  });
  async function start(paused: boolean) {
    const child = fork(fileURLToPath(new URL('../bin.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        DATABASE_URL: container.getConnectionUri(),
        PUBLIC_BASE_URL: 'https://owned-inventory.example.test',
        NEW_API_BASE_URL: proxy.endpoint,
        CREDENTIAL_ENCRYPTION_KEY: 'synthetic-inventory-encryption-key',
        S3_ENDPOINT: proxy.endpoint,
        S3_REGION: 'us-east-1',
        S3_BUCKET: storage.bucket,
        S3_ACCESS_KEY_ID: 'gc-fixture-owner',
        S3_SECRET_ACCESS_KEY: 'synthetic-gc-storage-password',
        WORKER_CONCURRENCY: '1',
        MAINTENANCE_CLEANUP_PAUSED: String(paused),
      },
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    children.push({ child, exited });
    await waitUntil(
      () => output.includes('[worker] generation worker started'),
      'inventory bin startup',
    );
    return {
      child,
      exited,
      get output() {
        return output;
      },
    };
  }
  async function enqueue(task: string, payload: Record<string, unknown> = {}) {
    const key = `owned-inventory-${randomUUID()}`;
    await database.pool.query('SELECT graphile_worker.add_job($1,$2::json,job_key:=$3)', [
      task,
      JSON.stringify(payload),
      key,
    ]);
    return key;
  }
  async function completed(key: string) {
    await waitUntil(
      async () =>
        !(
          await database.pool.query('SELECT id FROM graphile_worker._private_jobs WHERE key=$1', [
            key,
          ])
        ).rowCount,
      'inventory task completion',
    );
  }
  it('records no candidate while paused; SIGKILL leaves the page uncommitted and a new PID resumes it', async () => {
    const key = `users/owned/references/${randomUUID()}`;
    await storage.client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: 'owned-orphan' }),
    );
    const paused = await start(true);
    for (const alias of ['maintenance.inventory', 'maintenance/inventory'])
      await completed(await enqueue(alias));
    expect(paused.output).toContain('[inventory] paused');
    expect((await database.pool.query('SELECT * FROM object_inventory_cursors')).rows).toEqual([]);
    expect(proxy.held).toBe(0);
    paused.child.kill('SIGTERM');
    expect(await paused.exited).toEqual({ code: 0, signal: null });
    const interrupted = await start(false);
    await enqueue('maintenance/inventory');
    await waitUntil(() => proxy.held === 1, 'real S3 page held after the durable claim');
    const claim = (await database.pool.query('SELECT * FROM object_inventory_cursors')).rows[0];
    expect(claim.lease_token).toBeTruthy();
    expect(claim.continuation_token).toBeNull();
    expect((await database.pool.query('SELECT * FROM object_inventory_candidates')).rows).toEqual(
      [],
    );
    interrupted.child.kill('SIGKILL');
    expect(await interrupted.exited).toEqual({ code: null, signal: 'SIGKILL' });
    proxy.release();
    // Explicitly accelerate the persisted lease; the kill, HTTP page and subsequent PID are real.
    await database.pool.query("UPDATE object_inventory_cursors SET lease_until='1970-01-01Z'");
    const resumed = await start(false);
    await completed(await enqueue('maintenance/inventory'));
    expect(resumed.child.pid).not.toBe(interrupted.child.pid);
    expect(
      (await database.pool.query('SELECT object_key FROM object_inventory_candidates')).rows,
    ).toEqual([{ object_key: key }]);
    expect(
      (
        await database.pool.query(
          'SELECT count(*) AS n FROM object_inventory_cursors WHERE lease_token IS NOT NULL',
        )
      ).rows[0].n,
    ).toBe('0');
    expect(
      await (
        await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }))
      ).Body?.transformToString(),
    ).toBe('owned-orphan');
    expect(resumed.output).not.toContain(key);
    expect(resumed.output).not.toContain('synthetic-gc-storage-password');
    console.info('[inventory bin]', {
      interruptedPid: interrupted.child.pid,
      resumedPid: resumed.child.pid,
      recovered: 1,
      deleted: 0,
    });
    resumed.child.kill('SIGTERM');
    expect(await resumed.exited).toEqual({ code: 0, signal: null });
  }, 60000);
  it('pauses eligible deletion, keeps a real HEAD claim across SIGKILL, then a new PID reclaims and deletes the bytes', async () => {
    const key = `users/owned/references/${randomUUID()}`;
    proxy.release();
    await proxy.close();
    proxy = await createHeldInventoryResponseProxy(storage.endpoint, key);
    await storage.client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: 'owned-delete-restart' }),
    );
    const scopeId = inventoryScopeId(storage.bucket, proxy.endpoint);
    await scanObjectInventoryPage(
      { db: database.db, s3: storage.client, bucket: storage.bucket, scopeId },
      'users/',
    );
    // Only this owned observation's grace and later claim expiry are accelerated.
    await database.pool.query(
      "UPDATE object_inventory_candidates SET eligible_at='1970-01-01Z' WHERE scope_id=$1 AND object_key=$2",
      [scopeId, key],
    );
    const candidate = async () =>
      (
        await database.pool.query(
          'SELECT * FROM object_inventory_candidates WHERE scope_id=$1 AND object_key=$2',
          [scopeId, key],
        )
      ).rows;
    const before = await candidate();
    const paused = await start(true);
    for (const alias of ['maintenance.inventory', 'maintenance/inventory'])
      await completed(await enqueue(alias));
    expect(await candidate()).toEqual(before);
    expect(proxy.held).toBe(0);
    paused.child.kill('SIGTERM');
    expect(await paused.exited).toEqual({ code: 0, signal: null });
    const interrupted = await start(false);
    await completed(await enqueue('maintenance/inventory', { mode: 'dry-run' }));
    expect(await candidate()).toEqual(before);
    expect(proxy.held).toBe(0);
    await enqueue('maintenance/inventory');
    await waitUntil(() => proxy.held === 1, 'actual object HEAD held after persisted delete claim');
    const [claim] = await candidate();
    expect(claim.claim_token).toBeTruthy();
    expect(claim.attempt_count).toBe(1);
    interrupted.child.kill('SIGKILL');
    expect(await interrupted.exited).toEqual({ code: null, signal: 'SIGKILL' });
    proxy.release();
    expect(await candidate()).toEqual([claim]);
    await database.pool.query(
      "UPDATE object_inventory_candidates SET claim_until='1970-01-01Z' WHERE scope_id=$1 AND object_key=$2",
      [scopeId, key],
    );
    const pausedReplacement = await start(true);
    await completed(await enqueue('maintenance/inventory'));
    expect((await candidate())[0].attempt_count).toBe(1);
    expect(
      (await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key })))
        .ContentLength,
    ).toBeGreaterThan(0);
    pausedReplacement.child.kill('SIGTERM');
    expect(await pausedReplacement.exited).toEqual({ code: 0, signal: null });
    const resumed = await start(false);
    await completed(await enqueue('maintenance/inventory'));
    expect(resumed.child.pid).not.toBe(interrupted.child.pid);
    expect(await candidate()).toEqual([]);
    await expect(
      storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key })),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(
      (
        await database.pool.query(
          "SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
          [key],
        )
      ).rowCount,
    ).toBe(1);
    await waitUntil(
      () => resumed.output.includes('[inventory-delete]'),
      'committed deletion counters',
    );
    expect(resumed.output).not.toContain(key);
    expect(resumed.output).not.toContain('synthetic-gc-storage-password');
    console.info('[inventory deletion bin]', {
      interruptedPid: interrupted.child.pid,
      resumedPid: resumed.child.pid,
      deleted: 1,
    });
    resumed.child.kill('SIGTERM');
    expect(await resumed.exited).toEqual({ code: 0, signal: null });
  }, 60000);

  it('consumes an actual five-minute cron job with Graphile metadata and leaves no retry', async () => {
    proxy.release();
    const key = `users/owned/references/${randomUUID()}`;
    await storage.client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: 'owned-cron-orphan' }),
    );
    await database.pool.query(`
      CREATE TABLE inventory_cron_observations(payload jsonb NOT NULL);
      CREATE FUNCTION observe_inventory_cron() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF to_jsonb(NEW.payload) ? '_cron' AND EXISTS (
          SELECT 1 FROM graphile_worker._private_tasks
          WHERE id=NEW.task_id AND identifier='maintenance/inventory'
        ) THEN INSERT INTO inventory_cron_observations VALUES(to_jsonb(NEW.payload)); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER observe_inventory_cron AFTER INSERT ON graphile_worker._private_jobs
        FOR EACH ROW EXECUTE FUNCTION observe_inventory_cron();
    `);
    const worker = await start(false);
    try {
      // No add_job call or clock override: execute the unchanged bin.ts crontab.
      await expect
        .poll(
          async () =>
            (
              await database.pool.query(
                'SELECT object_key FROM object_inventory_candidates WHERE object_key=$1',
                [key],
              )
            ).rows,
          { timeout: 330000, interval: 500 },
        )
        .toEqual([{ object_key: key }]);
      const scheduled = (
        await database.pool.query('SELECT payload FROM inventory_cron_observations')
      ).rows;
      expect(scheduled).toHaveLength(1);
      const metadata = scheduled[0].payload._cron;
      expect(metadata).toEqual({ ts: expect.any(String), backfilled: false });
      expect(new Date(metadata.ts).getUTCMinutes() % 5).toBe(0);
      await expect
        .poll(
          async () =>
            (
              await database.pool.query(
                `SELECT id FROM graphile_worker._private_jobs WHERE payload->'_cron'->>'ts'=$1`,
                [metadata.ts],
              )
            ).rows,
        )
        .toEqual([]);
      expect(worker.output).not.toContain('InvalidInventoryRequest');
      expect(
        await (
          await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }))
        ).Body?.transformToString(),
      ).toBe('owned-cron-orphan');
      console.info('[inventory actual cron]', { pid: worker.child.pid, metadata, recorded: 1 });
    } finally {
      worker.child.kill('SIGTERM');
      expect(await worker.exited).toEqual({ code: 0, signal: null });
    }
  }, 360000);
});
