import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createDatabase, enqueueObjectCleanup, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeExpiredSoftDeletedRuns } from '../retention.js';
import { PostgresObjectCleanupStore, processObjectCleanupBatch } from '../tasks.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'ledger-exit-owner';
const SOFT_DELETE_PURGE_AGE_MS = 31 * 24 * 60 * 60_000;

/**
 * D02.2 consumed-upload ledger exit (retention policy outlet). The registry row of a
 * consumed upload blocks retirement only while a row-level reference or its own live
 * TTL says so; age alone is never an exit. Once the consuming row is retired by the
 * existing B77 R01 purge, protection disappears through the same queries and the
 * ordinary registry-TTL/outbox path reclaims the object. Late references landing
 * after retirement are fenced with P0001 — covered by
 * storage-publication-guards (reference link) and reference-lease-matrix
 * (design_scheme_generation_references), not duplicated here.
 */
describeDb('consumed upload ledger exit through the existing retention policy', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  let now: Date;

  const store = () => new PostgresObjectCleanupStore(database.db);
  const head = (objectKey: string) =>
    storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
  const put = (objectKey: string) =>
    storage.client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: 'ledger-exit-bytes' }),
    );
  const retired = async (objectKey: string) =>
    (
      await database.pool.query(
        `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [objectKey],
      )
    ).rows;
  const registry = async (objectKey: string) =>
    (
      await database.pool.query('SELECT * FROM generation_reference_uploads WHERE object_key=$1', [
        objectKey,
      ])
    ).rows;
  const outbox = async (objectKey: string) =>
    (
      await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
        objectKey,
      ])
    ).rows;
  const count = async (table: string) =>
    Number((await database.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  const insertRun = (runId: string, deletedAt: Date | null = null) =>
    database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,deleted_at) VALUES($1,$2,'succeeded','{}',$3)`,
      [runId, OWNER, deletedAt],
    );
  const insertRegistry = (objectKey: string, expiresAt: Date) =>
    database.pool.query(
      `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
       VALUES($1,$2,$3,'consumed.png','image/png',17,'available',$4)`,
      [randomUUID(), OWNER, objectKey, expiresAt],
    );
  const enqueueStaleIntent = (objectKey: string, at: Date) =>
    enqueueObjectCleanup(
      database.db,
      [
        {
          objectKey,
          ownerId: OWNER,
          objectType: 'generation_reference',
          reason: 'reference_expired',
        },
      ],
      at,
    );

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
      `INSERT INTO "user"(id,name,email) VALUES($1,'LedgerExit','ledger-exit@example.test')`,
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

  it('pins the three states of a Composer-consumed upload: TTL lease, link protection, policy exit', async () => {
    const runId = randomUUID();
    const referenceId = randomUUID();
    const objectKey = `users/${OWNER}/references/${referenceId}`;
    await put(objectKey);
    await insertRegistry(objectKey, new Date(now.getTime() + 60 * 60_000));

    // State 1 — unconsumed inside the registry TTL: a stale intent is fenced as leased
    // and the TTL scanner does not queue the row. Age outside the TTL is not an exit.
    await enqueueStaleIntent(objectKey, now);
    expect(await store().queueExpiredReferences(now)).toBe(0);
    expect(
      await processObjectCleanupBatch(store(), storage.client, storage.bucket, undefined, now),
    ).toMatchObject({ deleted: 0, protected: 1, failed: 0 });
    expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);
    expect(await retired(objectKey)).toEqual([]);
    expect(await registry(objectKey)).toHaveLength(1);

    // State 2 — consumed by a generation run: the reference link protects permanently,
    // including after the upload TTL has passed. The expired registry row is neither
    // queued by the TTL scanner nor authorized for retirement.
    await insertRun(runId);
    await database.pool.query(
      `INSERT INTO generation_reference_links(run_id,reference_id,user_id)
       SELECT $1,id,user_id FROM generation_reference_uploads WHERE object_key=$2`,
      [runId, objectKey],
    );
    const consumedNow = new Date(now.getTime() + 25 * 60 * 60_000);
    await database.pool.query(
      `UPDATE generation_reference_uploads SET expires_at=$1 WHERE object_key=$2`,
      [new Date(now.getTime() - 1000), objectKey],
    );
    expect(await store().queueExpiredReferences(consumedNow)).toBe(0);
    await enqueueStaleIntent(objectKey, consumedNow);
    expect(
      await processObjectCleanupBatch(
        store(),
        storage.client,
        storage.bucket,
        undefined,
        consumedNow,
      ),
    ).toMatchObject({ deleted: 0, protected: 1, failed: 0 });
    expect(await outbox(objectKey)).toEqual([]);
    expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);
    expect(await retired(objectKey)).toEqual([]);

    // State 3 — the consuming row retires under the existing B77 R01 policy: the real
    // soft-delete purge drains the link, the registry TTL scanner requeues the row and
    // the shared outbox retires the key, deletes the object and acknowledges both rows.
    await database.pool.query(`UPDATE generation_runs SET deleted_at=$1 WHERE id=$2`, [
      new Date(now.getTime() - SOFT_DELETE_PURGE_AGE_MS),
      runId,
    ]);
    expect(await purgeExpiredSoftDeletedRuns(database.db)).toMatchObject({ purged: 1 });
    expect(await count('generation_reference_links')).toBe(0);
    expect(await count('generation_runs')).toBe(0);
    expect(await store().queueExpiredReferences(consumedNow)).toBe(1);
    const [pending] = await registry(objectKey);
    expect(pending.status).toBe('cleanup_pending');
    expect(
      await processObjectCleanupBatch(
        store(),
        storage.client,
        storage.bucket,
        undefined,
        consumedNow,
      ),
    ).toMatchObject({ deleted: 1, protected: 0, failed: 0 });
    await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await retired(objectKey)).toHaveLength(1);
    expect(await outbox(objectKey)).toEqual([]);
    expect(await registry(objectKey)).toEqual([]);
  }, 30000);

  it('exits a scheme-run frozen reference through the purge outbox intent, not the registry TTL', async () => {
    // Production shape: adoption already removed the registry row; the frozen run
    // reference is the only protection and the purge itself enqueues the key.
    const runId = randomUUID();
    const objectKey = `users/${OWNER}/design-scheme-uploads/${randomUUID()}`;
    await put(objectKey);
    await insertRun(runId);
    await database.pool.query(
      `INSERT INTO design_scheme_generation_references
       (generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
       VALUES($1,$2,$3,0,$4,'frozen.png','image/png',17,repeat('a',64))`,
      [runId, OWNER, randomUUID(), objectKey],
    );

    // Reference exists: a stale intent is fenced as permanent and the object survives.
    await enqueueStaleIntent(objectKey, now);
    expect(
      await processObjectCleanupBatch(store(), storage.client, storage.bucket, undefined, now),
    ).toMatchObject({ deleted: 0, protected: 1, failed: 0 });
    expect(await outbox(objectKey)).toEqual([]);
    expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);
    expect(await retired(objectKey)).toEqual([]);

    // The reference row retires with its run under the existing purge; the drain itself
    // enqueues the object key (reason generation_purge) and the outbox deletes it.
    await database.pool.query(`UPDATE generation_runs SET deleted_at=$1 WHERE id=$2`, [
      new Date(now.getTime() - SOFT_DELETE_PURGE_AGE_MS),
      runId,
    ]);
    // Use the same explicit clock for enqueue and claim. The wall clock may have
    // advanced past the fixture's initial +1s during real PG/MinIO IO.
    const purge = await purgeExpiredSoftDeletedRuns(database.db, now);
    expect(purge.purged).toBe(1);
    expect(purge.objectKeys).toEqual([objectKey]);
    expect(await count('design_scheme_generation_references')).toBe(0);
    expect((await outbox(objectKey))[0].next_attempt_at.getTime()).toBe(now.getTime());
    expect(
      await processObjectCleanupBatch(store(), storage.client, storage.bucket, undefined, now),
    ).toMatchObject({ deleted: 1, protected: 0, failed: 0 });
    await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await retired(objectKey)).toHaveLength(1);
    expect(await outbox(objectKey)).toEqual([]);
  }, 30000);
});
