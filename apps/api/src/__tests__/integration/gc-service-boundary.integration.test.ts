import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { packageHash } from '../../modules/design-scheme-packages/bytes.js';
import { packageFixture } from '../../modules/design-scheme-packages/__tests__/fixture.js';
import { DesignSchemePackageService } from '../../modules/design-scheme-packages/service.js';
import {
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';
import { GenerationBrowserWorker } from '../fixtures/generation-browser-worker.js';
import {
  GC_STORAGE_ACCESS_KEY,
  GC_STORAGE_SECRET_KEY,
  createDelayedPutProxy,
  createDisposableMinio,
} from '../fixtures/gc-object-storage.js';

const OWNER = 'gc-boundary-owner';
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

/**
 * D02.3 service boundary: a real API-service child process relaying PUTs into real
 * MinIO while a real worker bin process runs maintenance against the same PostgreSQL.
 * No in-process stubs cross the boundary; only persisted timestamps are accelerated.
 */
describeDb('GC service boundary across actual API and worker processes', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let minio: Awaited<ReturnType<typeof createDisposableMinio>>;
  let worker: GenerationBrowserWorker;
  let bytes: Buffer;
  // begin/get/cancel never touch object storage; the child process owns the PUT.
  const service = () =>
    new DesignSchemePackageService(database.db, {
      put: () => Promise.reject(new Error('unexpected parent put')),
      read: () => Promise.reject(new Error('unexpected parent read')),
    });
  const head = (objectKey: string) =>
    minio.client.send(new HeadObjectCommand({ Bucket: minio.bucket, Key: objectKey }));
  const retired = async (objectKey: string) =>
    (
      await database.pool.query(
        `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [objectKey],
      )
    ).rows;
  const outbox = async (objectKey: string) =>
    (
      await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
        objectKey,
      ])
    ).rows;
  const stageRow = async (id: string) =>
    (await database.pool.query('SELECT * FROM design_scheme_package_stages WHERE id=$1', [id]))
      .rows[0];
  const registry = async (objectKey: string) =>
    (
      await database.pool.query('SELECT * FROM generation_reference_uploads WHERE object_key=$1', [
        objectKey,
      ])
    ).rows;

  async function runMaintenance() {
    const key = `gc-boundary-${randomUUID()}`;
    await database.pool.query('SELECT graphile_worker.add_job($1,$2::json,job_key:=$3)', [
      'maintenance.cleanup',
      '{}',
      key,
    ]);
    await expect
      .poll(
        async () =>
          (
            await database.pool.query('SELECT id FROM graphile_worker._private_jobs WHERE key=$1', [
              key,
            ])
          ).rowCount,
        { timeout: 30000, interval: 100 },
      )
      .toBe(0);
  }

  function spawnStageProcess(mode: string, stageId: string, s3Endpoint: string) {
    const cwd = fileURLToPath(new URL('../../..', import.meta.url));
    const child = spawn(
      'pnpm',
      [
        'exec',
        'tsx',
        'src/__tests__/fixtures/package-stage-process.ts',
        mode,
        OWNER,
        generationAuthSession(OWNER),
        stageId,
      ],
      {
        cwd,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: container.getConnectionUri(),
          BETTER_AUTH_SECRET: 'fixture-auth-secret',
          NEW_API_BASE_URL: 'http://127.0.0.1:1',
          CREDENTIAL_ENCRYPTION_KEY: 'fixture-encryption-key',
          S3_ENDPOINT: s3Endpoint,
          S3_REGION: 'us-east-1',
          S3_BUCKET: minio.bucket,
          S3_ACCESS_KEY_ID: GC_STORAGE_ACCESS_KEY,
          S3_SECRET_ACCESS_KEY: GC_STORAGE_SECRET_KEY,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      },
    );
    void exited.catch(() => undefined);
    return {
      child,
      exited,
      output: () => output,
      /** The tsx grandchild's own PID; killing the pnpm wrapper alone leaks it. */
      pid: () => Number(output.match(/PACKAGE_PID=(\d+)/)?.[1] ?? 0),
    };
  }

  async function killStageProcess(handle: ReturnType<typeof spawnStageProcess>) {
    const pid = handle.pid();
    if (pid)
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    if (handle.child.exitCode === null && handle.child.signalCode === null)
      handle.child.kill('SIGKILL');
    await Promise.race([
      handle.exited,
      new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }

  async function begin() {
    return service().begin(OWNER, generationAuthSession(OWNER), {
      requestId: randomUUID(),
      packageHash: packageHash(bytes),
      sizeBytes: bytes.length,
      formatVersion: 2,
    });
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 10 });
    await migrateDatabase(database.db);
    await database.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [
      OWNER,
      `${OWNER}@example.test`,
    ]);
    await seedGenerationAuthority(database.db, { principalId: OWNER, ownerId: OWNER });
    minio = await createDisposableMinio();
    bytes = await packageFixture();
    worker = new GenerationBrowserWorker({
      DATABASE_URL: container.getConnectionUri(),
      PUBLIC_BASE_URL: 'https://gc-boundary.example.test',
      NEW_API_BASE_URL: 'http://127.0.0.1:1',
      CREDENTIAL_ENCRYPTION_KEY: 'fixture-encryption-key',
      S3_ENDPOINT: minio.endpoint,
      S3_REGION: 'us-east-1',
      S3_BUCKET: minio.bucket,
      S3_ACCESS_KEY_ID: GC_STORAGE_ACCESS_KEY,
      S3_SECRET_ACCESS_KEY: GC_STORAGE_SECRET_KEY,
      MAINTENANCE_CLEANUP_PAUSED: 'false',
    });
    await worker.waitUntilReady();
  }, 300000);
  beforeEach(async () => {
    await database.pool.query('DELETE FROM design_scheme_package_stages');
    await database.pool.query('DELETE FROM generation_reference_uploads');
    await database.pool.query('DELETE FROM object_cleanup_queue');
    await database.pool.query('DELETE FROM object_key_retirements');
    await database.pool.query('DELETE FROM object_inventory_candidates');
    await database.pool.query('DELETE FROM object_inventory_cursors');
    await database.pool.query(
      "UPDATE account_session_authorizations SET mode='normal', revision=1",
    );
  });
  afterAll(async () => {
    await worker?.stop('SIGTERM').catch(() => undefined);
    await minio?.close();
    await database?.pool.end();
    await container?.stop();
  });

  it('leases fence the worker claim while the API PUT is held, then the confirm and later cancel converge', async () => {
    const stage = await begin();
    const stored = await stageRow(stage.stagedPackageId);
    const objectKey = stored.object_key as string;
    const proxy = await createDelayedPutProxy(minio.endpoint);
    const child = spawnStageProcess('upload', stage.stagedPackageId, proxy.endpoint);
    try {
      // The API child is inside storage.put; no byte has reached the bucket yet.
      await expect.poll(() => proxy.held, { timeout: 20000, interval: 25 }).toBe(1);
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      // The in-flight upload lease must fence even an already-due outbox claim.
      await database.pool.query(
        `UPDATE object_cleanup_queue SET next_attempt_at=now()-interval '1 second' WHERE object_key=$1`,
        [objectKey],
      );
      await runMaintenance();
      expect(await retired(objectKey)).toEqual([]);
      const [deferred] = await outbox(objectKey);
      expect(deferred.last_error).toBe('active_generation_lease');
      expect(deferred.abandoned_at).toBeNull();
      expect(deferred.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 60_000);
      expect((await stageRow(stage.stagedPackageId)).status).toBe('uploading');
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });

      // The relayed PUT lands; the child confirm commits against the live lease.
      expect(proxy.release()).toBe(1);
      expect(await child.exited).toMatchObject({ code: 0 });
      const resultLine = child
        .output()
        .split('\n')
        .find((line) => line.startsWith('PACKAGE_RESULT='));
      if (!resultLine) throw new Error(`Missing child result: ${child.output()}`);
      expect(JSON.parse(resultLine.slice('PACKAGE_RESULT='.length)).status).toBe('ready');
      expect((await stageRow(stage.stagedPackageId)).status).toBe('ready');
      expect((await registry(objectKey))[0].status).toBe('available');
      const storedBytes = await minio.client.send(
        new GetObjectCommand({ Bucket: minio.bucket, Key: objectKey }),
      );
      if (!storedBytes.Body) throw new Error('Missing confirmed package body');
      expect(Buffer.from(await storedBytes.Body.transformToByteArray()).equals(bytes)).toBe(true);
      expect(worker.snapshot().running).toBe(true);

      // Later cancellation retires through the same worker process and deletes the bytes.
      await service().cancel(OWNER, generationAuthSession(OWNER), stage.stagedPackageId);
      await database.pool.query(
        `UPDATE object_cleanup_queue SET next_attempt_at=now()-interval '1 second' WHERE object_key=$1`,
        [objectKey],
      );
      await runMaintenance();
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      expect(await retired(objectKey)).toHaveLength(1);
      expect(await outbox(objectKey)).toEqual([]);
      expect(await registry(objectKey)).toEqual([]);
    } finally {
      await killStageProcess(child);
      await proxy.close();
    }
  }, 120000);

  it('reclaims the bytes of an API process SIGKILLed after its PUT but before its confirm', async () => {
    const stage = await begin();
    const stored = await stageRow(stage.stagedPackageId);
    const objectKey = stored.object_key as string;
    const child = spawnStageProcess('hold-after-put', stage.stagedPackageId, minio.endpoint);
    try {
      // Real bytes committed to the bucket; the child hangs before tx3 and dies.
      await expect
        .poll(
          async () => {
            try {
              return (await head(objectKey)).ContentLength === bytes.length;
            } catch {
              return false;
            }
          },
          { timeout: 20000, interval: 100 },
        )
        .toBe(true);
      // SIGKILL the recorded grandchild PID; the pnpm wrapper exits once its
      // stdio pipes close, and the stage row keeps whatever was committed.
      const pid = child.pid();
      expect(pid).toBeGreaterThan(0);
      process.kill(pid, 'SIGKILL');
      await Promise.race([
        child.exited,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('stage process did not exit after SIGKILL')), 15000),
        ),
      ]);
      expect((await stageRow(stage.stagedPackageId)).status).toBe('uploading');
      // Only persisted timestamps accelerate; the worker sees an expired upload lease.
      await database.pool.query(
        `UPDATE design_scheme_package_stages SET upload_lease_until=now()-interval '1 second' WHERE id=$1`,
        [stage.stagedPackageId],
      );
      await database.pool.query(
        `UPDATE object_cleanup_queue SET next_attempt_at=now()-interval '1 second' WHERE object_key=$1`,
        [objectKey],
      );
      await runMaintenance();
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      expect(await retired(objectKey)).toHaveLength(1);
      expect(await outbox(objectKey)).toEqual([]);
      // One pass fully converges the SIGKILLed upload: the cleanup task first expires
      // the lease-dead uploading stage (flipping its registry row to cleanup_pending),
      // then the objects stage retires, deletes and acknowledges — registry included.
      expect(await registry(objectKey)).toEqual([]);
      expect((await stageRow(stage.stagedPackageId)).status).toBe('expired');
      expect(worker.snapshot().running).toBe(true);
    } finally {
      await killStageProcess(child);
    }
  }, 120000);
});
