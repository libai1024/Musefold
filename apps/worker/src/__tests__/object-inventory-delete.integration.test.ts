import { randomUUID } from 'node:crypto';
import {
  DeleteBucketPolicyCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVENTORY_GRACE_MS,
  INVENTORY_PREFIXES,
  inventoryScopeId,
  scanObjectInventoryPage,
} from '../object-inventory.js';
import {
  INVENTORY_DELETE_BATCH_SIZE,
  processObjectInventoryCandidates,
} from '../object-inventory-delete.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb(
  'inventory candidates reclaim actual MinIO bytes through durable PostgreSQL claims',
  () => {
    let container: StartedPostgreSqlContainer;
    let database: ReturnType<typeof createDatabase>;
    let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
    let now: Date;
    let scopeId: string;
    const deps = (db = database.db) => ({
      db,
      s3: storage.client,
      bucket: storage.bucket,
      scopeId,
      now: () => now,
    });
    const key = () => `users/inventory-owner/references/${randomUUID()}`;
    const put = (objectKey: string, body = 'owned-inventory-bytes') =>
      storage.client.send(
        new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: body }),
      );
    const head = (objectKey: string) =>
      storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
    const rows = async () =>
      (await database.pool.query('SELECT * FROM object_inventory_candidates ORDER BY object_key'))
        .rows;
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
    async function publish(objectKey: string) {
      await database.pool.query(
        `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      VALUES($1,'inventory-owner',$2,'owned.png','image/png',20,'available',$3)`,
        [randomUUID(), objectKey, new Date(now.getTime() + 7 * INVENTORY_GRACE_MS)],
      );
    }
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
        `INSERT INTO "user"(id,name,email) VALUES('inventory-owner','Owned','inventory@example.test')`,
      );
      for (;;) {
        const page = await storage.client.send(
          new ListObjectsV2Command({ Bucket: storage.bucket }),
        );
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

    it('respects the original grace, dry-run and scope, then removes all seven orphan categories and preserves live uploads and unmanaged bytes', async () => {
      const id = randomUUID();
      const orphans = [
        `users/missing-owner/generations/${id}/${id}`,
        key(),
        `users/inventory-owner/design-scheme-uploads/${id}`,
        `scheme-sources/${'a'.repeat(64)}/${id}/${id}`,
        `scheme-packages/${'a'.repeat(64)}/${id}`,
        `scheme-imports/${id}/${id}/${'b'.repeat(64)}`,
        `scheme-exports/${id}`,
      ];
      const live = key(),
        unmanaged = 'users/inventory-owner/original-file';
      await publish(live);
      for (const value of [...orphans, live, unmanaged]) await put(value);
      await scan();
      expect(await rows()).toHaveLength(7);
      expect((await processObjectInventoryCandidates(deps())).claimed).toBe(0);
      await expireGrace();
      const before = await rows();
      expect((await processObjectInventoryCandidates(deps(), 'dry-run')).dryRun).toBe(1);
      expect(await rows()).toEqual(before);
      expect(
        (await processObjectInventoryCandidates({ ...deps(), scopeId: 'f'.repeat(64) })).claimed,
      ).toBe(0);
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 7,
        deleted: 7,
        failed: 0,
        abandoned: 0,
      });
      expect(await rows()).toEqual([]);
      for (const value of orphans)
        await expect(head(value)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      expect((await head(live)).ContentLength).toBeGreaterThan(0);
      expect((await head(unmanaged)).ContentLength).toBeGreaterThan(0);
      expect((await processObjectInventoryCandidates(deps())).claimed).toBe(0);
    });

    it('protects a reference committed after HEAD and rejects publication after final authorization', async () => {
      const kept = key(),
        removed = key();
      await put(kept);
      await put(removed);
      await scan();
      await expireGrace();
      const send = storage.client.send.bind(storage.client);
      const spy = vi.spyOn(storage.client, 'send');
      spy.mockImplementation(async (command, options) => {
        if (command instanceof HeadObjectCommand && command.input.Key === kept) {
          const result = await send(command, options);
          await publish(kept);
          return result;
        }
        if (
          command instanceof DeleteObjectsCommand &&
          command.input.Delete?.Objects?.some(({ Key }) => Key === removed)
        ) {
          await expect(publish(removed)).rejects.toMatchObject({
            code: 'P0001',
            message: 'ObjectStorageKeyRetired',
          });
        }
        return send(command, options);
      });
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 2,
        protected: 1,
        deleted: 1,
        failed: 0,
      });
      spy.mockRestore();
      expect((await head(kept)).ContentLength).toBeGreaterThan(0);
      await expect(head(removed)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    });

    it.each([false, true])(
      'starts a new grace period after overwrite, identical bytes=%s',
      async (sameBytes) => {
        const objectKey = key();
        await put(objectKey);
        await scan();
        await expireGrace();
        const [previous] = await rows();
        // Directory timestamps retain milliseconds; do not add a whole-second sleep for HEAD rounding.
        while (Date.now() <= previous.modified_at.getTime() + 2)
          await new Promise((resolve) => setTimeout(resolve, 5));
        await put(objectKey, sameBytes ? 'owned-inventory-bytes' : 'changed-owned-bytes');
        expect(await processObjectInventoryCandidates(deps())).toMatchObject({
          changed: 1,
          deleted: 0,
          failed: 0,
        });
        const [candidate] = await rows();
        expect(candidate.eligible_at.getTime()).toBe(now.getTime() + INVENTORY_GRACE_MS);
        expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);
        await expireGrace();
        expect((await processObjectInventoryCandidates(deps())).deleted).toBe(1);
      },
    );

    it('does not shorten the grace when object modification is later than the observation clock', async () => {
      const objectKey = key();
      await put(objectKey);
      const object = (
        await storage.client.send(
          new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: objectKey, MaxKeys: 1 }),
        )
      ).Contents?.[0];
      if (!object?.LastModified) throw new Error('Owned directory metadata missing');
      now = new Date(object.LastModified.getTime() - 1000);
      await scan();
      now = new Date(now.getTime() + INVENTORY_GRACE_MS);
      expect((await processObjectInventoryCandidates(deps())).claimed).toBe(0);
      const [candidate] = await rows();
      expect(candidate.eligible_at.getTime()).toBe(
        object.LastModified.getTime() + INVENTORY_GRACE_MS,
      );
      now = candidate.eligible_at;
      expect((await processObjectInventoryCandidates(deps())).deleted).toBe(1);
    });

    it('fences an old HEAD response after an independent pool takes over an expired claim', async () => {
      const objectKey = key();
      await put(objectKey);
      await scan();
      await expireGrace();
      const other = createDatabase(container.getConnectionUri());
      let release!: () => void, started!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const send = storage.client.send.bind(storage.client);
      let first = true,
        deletes = 0;
      const spy = vi.spyOn(storage.client, 'send').mockImplementation(async (command, options) => {
        if (command instanceof DeleteObjectsCommand) deletes++;
        const result = await send(command, options);
        if (command instanceof HeadObjectCommand && first) {
          first = false;
          started();
          await held;
        }
        return result;
      });
      const old = processObjectInventoryCandidates(deps());
      void old.catch(() => undefined);
      try {
        await entered;
        const claimedBeforeScan = await rows();
        expect((await scanObjectInventoryPage(deps(), 'users/')).recorded).toBe(0);
        expect(await rows()).toEqual(claimedBeforeScan);
        now = new Date(now.getTime() + 10 * 60_000 + 1);
        expect((await processObjectInventoryCandidates(deps(other.db))).deleted).toBe(1);
        release();
        expect((await old).stale).toBe(1);
        expect(deletes).toBe(1);
        expect(await rows()).toEqual([]);
      } finally {
        release();
        await old.catch(() => undefined);
        spy.mockRestore();
        await other.pool.end();
      }
    });

    it('retains a failed acknowledgement after real deletion, then acknowledges the missing object on retry', async () => {
      const objectKey = key();
      await put(objectKey);
      await scan();
      await expireGrace();
      await database.pool.query(`CREATE FUNCTION owned_fail_inventory_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned ack failure'; END $$;
      CREATE TRIGGER owned_inventory_ack BEFORE DELETE ON object_inventory_candidates FOR EACH ROW EXECUTE FUNCTION owned_fail_inventory_ack()`);
      try {
        expect(await processObjectInventoryCandidates(deps())).toMatchObject({
          failed: 1,
          deleted: 0,
        });
        expect(await rows()).toHaveLength(1);
        await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
        await expect(publish(objectKey)).rejects.toMatchObject({
          code: 'P0001',
          message: 'ObjectStorageKeyRetired',
        });
      } finally {
        await database.pool.query(
          'DROP TRIGGER owned_inventory_ack ON object_inventory_candidates; DROP FUNCTION owned_fail_inventory_ack()',
        );
      }
      now = new Date(now.getTime() + 300000);
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        missing: 1,
        deleted: 0,
        failed: 0,
      });
      expect(await rows()).toEqual([]);
    });

    it('persists all twelve per-object delete failures, abandons automatic retry, and allows explicit retry with the retirement retained', async () => {
      const objectKey = key();
      await put(objectKey);
      await scan();
      await expireGrace();
      const resource = `arn:aws:s3:::${storage.bucket}/${objectKey}`;
      await storage.client.send(
        new PutBucketPolicyCommand({
          Bucket: storage.bucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:ListBucket'],
                Resource: [`arn:aws:s3:::${storage.bucket}`],
                Condition: { StringEquals: { 's3:prefix': objectKey } },
              },
              { Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [resource] },
              { Effect: 'Deny', Principal: '*', Action: ['s3:DeleteObject'], Resource: [resource] },
            ],
          }),
        }),
      );
      const restricted = storage.anonymousClient();
      try {
        for (let attempt = 1; attempt <= 12; attempt++) {
          await database.pool.query('UPDATE object_inventory_candidates SET next_attempt_at=$1', [
            now,
          ]);
          expect(
            await processObjectInventoryCandidates({ ...deps(), s3: restricted }),
          ).toMatchObject({ failed: 1, abandoned: attempt === 12 ? 1 : 0, deleted: 0 });
          const [row] = await rows();
          expect(row.attempt_count).toBe(attempt);
          expect(row.last_error).toBe('S3DeleteObjectsError');
          expect(row.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
        }
      } finally {
        restricted.destroy();
        await storage.client.send(new DeleteBucketPolicyCommand({ Bucket: storage.bucket }));
      }
      now = new Date(now.getTime() + INVENTORY_GRACE_MS);
      const abandonedBeforeScan = await rows();
      expect((await scanObjectInventoryPage(deps(), 'users/')).recorded).toBe(0);
      expect(await rows()).toEqual(abandonedBeforeScan);
      expect((await processObjectInventoryCandidates(deps())).claimed).toBe(0);
      await expect(publish(objectKey)).rejects.toMatchObject({
        code: 'P0001',
        message: 'ObjectStorageKeyRetired',
      });
      await database.pool.query(
        'UPDATE object_inventory_candidates SET abandoned_at=NULL,attempt_count=0,next_attempt_at=$1',
        [now],
      );
      expect((await processObjectInventoryCandidates(deps())).deleted).toBe(1);
      expect(await rows()).toEqual([]);
    }, 30000);

    it('makes a final expired crash claim visible as abandoned, then rechecks new references on explicit retry', async () => {
      const objectKey = key();
      await put(objectKey);
      await scan();
      await expireGrace();
      // Persisted crash fixture: an old process exhausted its twelfth claim without finalization.
      await database.pool.query(
        `UPDATE object_inventory_candidates SET attempt_count=12,claim_token=$1,claim_until=$2`,
        [randomUUID(), new Date(now.getTime() - 1)],
      );
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 0,
        abandoned: 1,
        deleted: 0,
      });
      const [abandoned] = await rows();
      expect(abandoned.last_error).toBe('InventoryClaimExpired');
      expect(abandoned.abandoned_at).not.toBeNull();
      expect(abandoned.claim_token).toBeNull();
      await publish(objectKey);
      await scan();
      expect(await rows()).toEqual([abandoned]);
      await database.pool.query(
        'UPDATE object_inventory_candidates SET attempt_count=0,abandoned_at=NULL,next_attempt_at=$1',
        [now],
      );
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 1,
        protected: 1,
        deleted: 0,
      });
      expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);
    });

    it('keeps candidate retry facts across actual object-storage downtime and recovery', async () => {
      const objectKey = key();
      await put(objectKey);
      await scan();
      await expireGrace();
      await storage.stop();
      try {
        expect(await processObjectInventoryCandidates(deps())).toMatchObject({
          claimed: 1,
          failed: 1,
          deleted: 0,
        });
        const [failed] = await rows();
        expect(failed.last_error).toBe('InventoryHeadFailed');
        expect(failed.attempt_count).toBe(1);
        expect(failed.claim_token).toBeNull();
      } finally {
        await storage.start();
      }
      now = new Date(now.getTime() + 300000);
      expect((await processObjectInventoryCandidates(deps())).deleted).toBe(1);
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    }, 30000);

    it('drains 1001 objects in bounded batches through a newly opened pool', async () => {
      const objectKeys = Array.from({ length: 1001 }, () => key());
      for (let offset = 0; offset < objectKeys.length; offset += 20)
        await Promise.all(objectKeys.slice(offset, offset + 20).map((value) => put(value)));
      await scan();
      await expireGrace();
      expect(await rows()).toHaveLength(1001);
      const first = await processObjectInventoryCandidates(deps());
      expect(first.claimed).toBe(INVENTORY_DELETE_BATCH_SIZE);
      const other = createDatabase(container.getConnectionUri());
      let deleted = first.deleted;
      try {
        while ((await rows()).length) {
          const result = await processObjectInventoryCandidates(deps(other.db));
          expect(result.claimed).toBeLessThanOrEqual(INVENTORY_DELETE_BATCH_SIZE);
          expect(result.claimed).toBeGreaterThan(0);
          expect(result.failed).toBe(0);
          deleted += result.deleted;
        }
      } finally {
        await other.pool.end();
      }
      expect(deleted).toBe(1001);
      expect(
        (await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket })))
          .Contents ?? [],
      ).toEqual([]);
    }, 60000);
  },
);
