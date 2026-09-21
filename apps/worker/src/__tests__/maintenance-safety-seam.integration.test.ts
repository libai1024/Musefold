import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createDatabase, enqueueObjectCleanup, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { JobHelpers } from 'graphile-worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskList, type TaskDependencies } from '../tasks.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'safety-seam-owner';

/**
 * D02.7 read-only observation and pause seams. The pause switch is the
 * existing process-level MAINTENANCE_CLEANUP_PAUSED flag: a paused executor
 * stops claiming new work (nothing is dequeued, protected, retired or
 * deleted) while already-issued storage deletes are never interrupted;
 * resuming picks the same durable intents up. The safety-snapshot task is the
 * read-only seam: it aggregates the five counters without touching any table
 * and stays available while GC is paused, logging counts only — never keys.
 */
describeDb('maintenance safety observation and pause seams', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  let now: Date;

  const env = (paused: boolean): TaskDependencies['env'] => ({
    PUBLIC_BASE_URL: 'https://app.example.test',
    NEW_API_BASE_URL: 'https://unused.example.test',
    CREDENTIAL_ENCRYPTION_KEY: 'safety-seam-encryption-key',
    S3_BUCKET: storage.bucket,
    S3_ENDPOINT: storage.endpoint,
    S3_REGION: 'us-east-1',
    MAINTENANCE_CLEANUP_PAUSED: paused,
  });
  const helpers = () => {
    const info = vi.fn();
    return { info, jobHelpers: { logger: { info } } as unknown as JobHelpers };
  };
  const head = (objectKey: string) =>
    storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
  const retired = async (objectKey: string) =>
    (
      await database.pool.query(
        `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [objectKey],
      )
    ).rows;
  const queueRow = async (objectKey: string) =>
    (
      await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
        objectKey,
      ])
    ).rows[0];
  const facts = async () => {
    const result: Record<string, unknown[]> = {};
    for (const table of [
      'object_cleanup_queue',
      'object_inventory_candidates',
      'object_inventory_cursors',
      'object_key_retirements',
    ]) {
      result[table] = (
        await database.pool.query(`SELECT * FROM ${table} ORDER BY row_to_json(${table})::text`)
      ).rows;
    }
    return result;
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    storage = await createDisposableObjectStorage();
  }, 180000);
  beforeEach(async () => {
    now = new Date(Date.now() + 1000);
    await database.pool.query(
      'TRUNCATE "user",object_key_retirements,object_cleanup_queue,object_inventory_candidates,object_inventory_cursors CASCADE',
    );
    await database.pool.query(
      `INSERT INTO "user"(id,name,email) VALUES($1,'SafetySeam','safety-seam@example.test')`,
      [OWNER],
    );
    for (;;) {
      const page = await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket }));
      if (!page.Contents?.length) break;
      await storage.client.send(
        new DeleteObjectsCommand({
          Bucket: storage.bucket,
          Delete: { Objects: page.Contents.map(({ Key }) => ({ Key })) },
        }),
      );
    }
  });
  afterAll(async () => {
    await storage?.close();
    await database?.pool.end();
    await container?.stop();
  });

  it('paused executor claims nothing, the read-only snapshot keeps observing, resume deletes', async () => {
    const objectKey = `users/${OWNER}/references/${randomUUID()}`;
    await storage.client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: 'seam-bytes' }),
    );
    await enqueueObjectCleanup(
      database.db,
      [
        {
          objectKey,
          ownerId: OWNER,
          objectType: 'generation_reference',
          reason: 'reference_expired',
        },
      ],
      now,
      // Already due: a paused executor must leave this claimable row untouched.
      new Date(Date.now() - 1000),
    );

    // Paused: both destructive tasks return before any claim. The queue row keeps
    // its zero attempt count, no retirement is written and the bytes survive.
    const pausedTasks = createTaskList({ db: database.db, env: env(true), s3: storage.client });
    const pausedLogs = helpers();
    await pausedTasks['maintenance.cleanup']?.({}, pausedLogs.jobHelpers);
    await pausedTasks['maintenance.inventory']?.({}, pausedLogs.jobHelpers);
    expect(pausedLogs.info.mock.calls.map(([message]) => String(message))).toEqual([
      '[maintenance] paused',
      '[inventory] paused',
    ]);
    expect((await queueRow(objectKey)).attempt_count).toBe(0);
    expect(await retired(objectKey)).toEqual([]);
    expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);

    // The read-only seam is not paused: it aggregates counters with zero side
    // effects and logs counts only — the real key never reaches the log line.
    const before = await facts();
    const snapshotLogs = helpers();
    await pausedTasks['maintenance/safety-snapshot']?.({}, snapshotLogs.jobHelpers);
    await pausedTasks['maintenance.safety-snapshot']?.({}, snapshotLogs.jobHelpers);
    expect(snapshotLogs.info).toHaveBeenCalledTimes(2);
    const line = String(snapshotLogs.info.mock.calls[0]?.[0]);
    expect(line.startsWith('[maintenance-safety] ')).toBe(true);
    expect(line).not.toContain(objectKey);
    const report = JSON.parse(line.replace('[maintenance-safety] ', '')) as {
      outbox: { due: number };
      totals: { candidates: number; deleted: number; failed: number; abandoned: number };
    };
    expect(report.outbox.due).toBe(1);
    expect(report.totals).toMatchObject({
      candidates: 1,
      deleted: 0,
      failed: 0,
      abandoned: 0,
    });
    expect(await facts()).toEqual(before);

    // Resume: the same durable intent is claimed through the ordinary outbox and
    // the object is really deleted with its retirement hash persisted.
    const resumedTasks = createTaskList({ db: database.db, env: env(false), s3: storage.client });
    const resumedLogs = helpers();
    await resumedTasks['maintenance.cleanup']?.({}, resumedLogs.jobHelpers);
    await expect(head(objectKey)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
    expect(await queueRow(objectKey)).toBeUndefined();
    expect(await retired(objectKey)).toHaveLength(1);
    for (const call of resumedLogs.info.mock.calls) {
      expect(String(call[0])).not.toContain(objectKey);
    }
  }, 30000);
});
