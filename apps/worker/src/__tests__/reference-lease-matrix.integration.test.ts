import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createDatabase, enqueueObjectCleanup, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVENTORY_GRACE_MS,
  INVENTORY_PREFIXES,
  inventoryScopeId,
  scanObjectInventoryPage,
} from '../object-inventory.js';
import { processObjectInventoryCandidates } from '../object-inventory-delete.js';
import { retireUnprotectedObjects } from '../object-retirement.js';
import { PostgresObjectCleanupStore, processObjectCleanupBatch } from '../tasks.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'matrix-owner';

/**
 * D02.3 reference/lease matrix: protection committed between the executor HEAD and
 * the authorization transaction must preserve the object; publication committed
 * after the final authorization must raise P0001. Covers the three branches without
 * prior authorization-window tests: design_scheme_generation_references,
 * design_scheme_package_exports lease and the generation_runs namespace lease.
 */
describeDb('reference and lease publication matrix across the authorization window', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  let now: Date;
  let scopeId: string;
  const deps = () => ({
    db: database.db,
    s3: storage.client,
    bucket: storage.bucket,
    scopeId,
    now: () => now,
  });
  const head = (objectKey: string) =>
    storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
  const put = (objectKey: string) =>
    storage.client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: 'matrix-bytes' }),
    );
  const rows = async () =>
    (await database.pool.query('SELECT * FROM object_inventory_candidates ORDER BY object_key'))
      .rows;
  const retired = async (objectKey: string) =>
    (
      await database.pool.query(
        `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [objectKey],
      )
    ).rows;
  const expireGrace = async () => {
    const latest = (
      await database.pool.query(
        'SELECT max(eligible_at) AS deadline FROM object_inventory_candidates',
      )
    ).rows[0].deadline as Date | null;
    now = new Date(Math.max(now.getTime() + INVENTORY_GRACE_MS, latest?.getTime() ?? 0));
  };
  async function scan() {
    for (const prefix of INVENTORY_PREFIXES)
      for (;;) {
        if ((await scanObjectInventoryPage(deps(), prefix)).completed) break;
      }
  }
  /** Commits protect() after the executor HEAD of objectKey, before its authorization. */
  function protectAfterHead(objectKey: string, protect: () => Promise<void>) {
    const send = storage.client.send.bind(storage.client);
    const spy = vi.spyOn(storage.client, 'send');
    spy.mockImplementation(async (command, options) => {
      const result = await send(command, options);
      if (command instanceof HeadObjectCommand && command.input.Key === objectKey) await protect();
      return result;
    });
    return spy;
  }
  const insertRun = (runId: string, status = 'succeeded', lease?: Date) =>
    database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,lease_expires_at) VALUES($1,$2,$3,'{}',$4)`,
      [runId, OWNER, status, lease ?? null],
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    storage = await createDisposableObjectStorage();
    scopeId = inventoryScopeId(storage.bucket, storage.endpoint);
  }, 180000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    now = new Date(Date.now() + 1000);
    await database.pool.query(
      'TRUNCATE "user",object_inventory_candidates,object_inventory_cursors,object_key_retirements,object_cleanup_queue CASCADE',
    );
    await database.pool.query(
      `INSERT INTO "user"(id,name,email) VALUES($1,'Matrix','matrix@example.test')`,
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

  it('design_scheme_generation_references committed after HEAD protects; after retirement it is P0001', async () => {
    const runId = randomUUID();
    await insertRun(runId);
    const objectKey = `users/${OWNER}/design-scheme-uploads/${randomUUID()}`;
    await put(objectKey);
    await scan();
    await expireGrace();
    const spy = protectAfterHead(objectKey, async () => {
      await database.pool.query(
        `INSERT INTO design_scheme_generation_references
         (generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
         VALUES($1,$2,$3,0,$4,'frozen.png','image/png',12,repeat('d',64))`,
        [runId, OWNER, randomUUID(), objectKey],
      );
    });
    try {
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 1,
        protected: 1,
        deleted: 0,
        failed: 0,
      });
    } finally {
      spy.mockRestore();
    }
    expect(await rows()).toEqual([]);
    expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);
    expect(await retired(objectKey)).toEqual([]);

    const retiredKey = `users/${OWNER}/design-scheme-uploads/${randomUUID()}`;
    expect(await retireUnprotectedObjects(database.db, [retiredKey], now)).toEqual({
      permanent: [],
      leased: [],
    });
    await expect(
      database.pool.query(
        `INSERT INTO design_scheme_generation_references
         (generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
         VALUES($1,$2,$3,1,$4,'late.png','image/png',12,repeat('e',64))`,
        [runId, OWNER, randomUUID(), retiredKey],
      ),
    ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
  }, 30000);

  it('design_scheme_package_exports lease committed after HEAD protects; after retirement it is P0001', async () => {
    const objectKey = `scheme-exports/${randomUUID()}`;
    await put(objectKey);
    await scan();
    await expireGrace();
    const insertExport = (key: string) =>
      database.pool.query(
        `INSERT INTO design_scheme_package_exports
         (id,user_id,request_id,request_hash,authority_hash,scheme_id,revision_id,expected_version,basis_hash,object_key,status,lease_until,expires_at)
         VALUES($1,$2,$3,repeat('a',64),repeat('b',64),$4,$5,1,repeat('c',64),$6,'preparing',$7,$8)`,
        [
          randomUUID(),
          OWNER,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          key,
          new Date(now.getTime() + 600_000),
          new Date(now.getTime() + INVENTORY_GRACE_MS),
        ],
      );
    const spy = protectAfterHead(objectKey, async () => {
      await insertExport(objectKey);
    });
    try {
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 1,
        protected: 1,
        deleted: 0,
        failed: 0,
      });
    } finally {
      spy.mockRestore();
    }
    expect(await rows()).toEqual([]);
    expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);

    const retiredKey = `scheme-exports/${randomUUID()}`;
    expect(await retireUnprotectedObjects(database.db, [retiredKey], now)).toEqual({
      permanent: [],
      leased: [],
    });
    await expect(insertExport(retiredKey)).rejects.toMatchObject({
      code: 'P0001',
      message: 'ObjectStorageKeyRetired',
    });
  }, 30000);

  it('generation_runs namespace lease committed after HEAD protects; asset publication after retirement is P0001', async () => {
    const runId = randomUUID();
    const objectKey = `users/${OWNER}/generations/${runId}/${randomUUID()}`;
    await put(objectKey);
    await scan();
    await expireGrace();
    const spy = protectAfterHead(objectKey, async () => {
      await insertRun(runId, 'running', new Date(now.getTime() + 600_000));
    });
    try {
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 1,
        protected: 1,
        deleted: 0,
        failed: 0,
      });
    } finally {
      spy.mockRestore();
    }
    expect(await rows()).toEqual([]);
    expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);

    // Mirror side: the namespace is retired, a late asset publication is fenced.
    const finishedRun = randomUUID();
    await insertRun(finishedRun);
    const retiredKey = `users/${OWNER}/generations/${finishedRun}/${randomUUID()}`;
    expect(await retireUnprotectedObjects(database.db, [retiredKey], now)).toEqual({
      permanent: [],
      leased: [],
    });
    await expect(
      database.pool.query(
        `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,checksum_sha256)
         VALUES($1,$2,$3,$4,'image/png',1,1,repeat('a',64))`,
        [randomUUID(), finishedRun, OWNER, retiredKey],
      ),
    ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
  }, 30000);

  it('isolates a lock-contested key so the rest of the cleanup batch still retires and deletes', async () => {
    const hot = `users/${OWNER}/references/${randomUUID()}`;
    const normals = [
      `users/${OWNER}/references/${randomUUID()}`,
      `users/${OWNER}/design-scheme-uploads/${randomUUID()}`,
    ];
    for (const key of [hot, ...normals]) {
      await put(key);
      await enqueueObjectCleanup(
        database.db,
        [
          {
            objectKey: key,
            ownerId: OWNER,
            objectType: 'generation_reference',
            reason: 'reference_expired',
          },
        ],
        now,
      );
    }
    // A slow publication transaction holds the hot key's advisory lock; its commit
    // or rollback decides the key, while the co-claimed batch must proceed.
    const holder = await database.pool.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT musefold_lock_storage_key($1)', [hot]);
    try {
      expect(
        await processObjectCleanupBatch(
          new PostgresObjectCleanupStore(database.db),
          storage.client,
          storage.bucket,
          undefined,
          now,
        ),
      ).toMatchObject({ deleted: 2, protected: 1, failed: 0 });
      for (const key of normals) {
        await expect(head(key)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
        expect(await retired(key)).toHaveLength(1);
      }
      expect((await head(hot)).ContentLength).toBeGreaterThan(0);
      const [deferred] = (
        await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [hot])
      ).rows;
      expect(deferred.last_error).toBe('active_generation_lease');
      expect(deferred.abandoned_at).toBeNull();
      expect(deferred.attempt_count).toBe(0);
      expect(deferred.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    // With the contested lock gone, the deferred key retires and deletes normally.
    await database.pool.query(
      'UPDATE object_cleanup_queue SET next_attempt_at=$1 WHERE object_key=$2',
      [now, hot],
    );
    expect(
      await processObjectCleanupBatch(
        new PostgresObjectCleanupStore(database.db),
        storage.client,
        storage.bucket,
        undefined,
        now,
      ),
    ).toMatchObject({ deleted: 1, protected: 0, failed: 0 });
    await expect(head(hot)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await retired(hot)).toHaveLength(1);
    expect(
      (await database.pool.query('SELECT count(*) AS n FROM object_cleanup_queue')).rows[0].n,
    ).toBe('0');
  }, 30000);
});
