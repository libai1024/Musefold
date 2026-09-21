import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  createDatabase,
  migrateDatabase,
  retireDesignSchemeSourcePreparations,
} from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processObjectInventoryCandidates } from '../object-inventory-delete.js';
import {
  INVENTORY_GRACE_MS,
  INVENTORY_PREFIXES,
  inventoryScopeId,
  scanObjectInventoryPage,
} from '../object-inventory.js';
import { PostgresObjectCleanupStore, processObjectCleanupBatch } from '../tasks.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'scheme-hardexit-owner';
const HASH = 'a'.repeat(64);

/**
 * D02 scheme hard-delete exit (lifecycle doc §14.5 registered gap). The policy
 * stands: a soft-deleted scheme's asset/source rows keep protecting their
 * objects. The exit once the rows are actually hard-deleted is already
 * complete and needs no new production path:
 *   account cascade (or an explicit scheme-row delete) removes the reference
 *   rows -> the ordinary inventory rediscovery observes the orphaned objects
 *   -> the existing candidate executor re-checks identity, retires the key
 *   (publication fence) and really deletes the bytes -> late re-publication is
 *   rejected with P0001. Source copies bound to a deleted scheme exit through
 *   the existing retireDesignSchemeSourcePreparations + shared outbox.
 * No "delete everything" exit is added (D02.7 red line); repeated hard
 * deletes and repeated executor runs stay idempotent.
 */
describeDb(
  'scheme hard-delete exit through cascade, rediscovery and the existing executors',
  () => {
    let container: StartedPostgreSqlContainer;
    let database: ReturnType<typeof createDatabase>;
    let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
    let now: Date;
    let scopeId: string;

    const store = () => new PostgresObjectCleanupStore(database.db);
    const deps = () => ({
      db: database.db,
      s3: storage.client,
      bucket: storage.bucket,
      scopeId,
      now: () => now,
    });
    const put = (objectKey: string) =>
      storage.client.send(
        new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: 'scheme-exit-bytes' }),
      );
    const head = (objectKey: string) =>
      storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
    const get = (objectKey: string) =>
      storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
    const expectGone = async (objectKey: string) => {
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    };
    const retired = async (objectKey: string) =>
      (
        await database.pool.query(
          `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
          [objectKey],
        )
      ).rows;
    const count = async (table: string) =>
      Number((await database.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    const candidates = async () =>
      (await database.pool.query('SELECT object_key FROM object_inventory_candidates ORDER BY 1'))
        .rows;
    const sorted = (values: string[]) => [...values].sort();

    async function scan() {
      for (const prefix of INVENTORY_PREFIXES)
        for (;;) {
          if ((await scanObjectInventoryPage(deps(), prefix)).completed) break;
        }
    }
    const expireGrace = async () => {
      const latest = (
        await database.pool.query(
          'SELECT max(eligible_at) AS deadline FROM object_inventory_candidates',
        )
      ).rows[0].deadline as Date | null;
      now = new Date(Math.max(now.getTime() + INVENTORY_GRACE_MS, latest?.getTime() ?? 0));
    };

    interface SchemeFixture {
      schemeId: string;
      revisionId: string;
      assetKey: string;
      sourceKey: string;
      snapshotId: string;
    }

    async function seedScheme(userId: string, deletedAt: Date | null): Promise<SchemeFixture> {
      const schemeId = randomUUID();
      const revisionId = randomUUID();
      const snapshotId = randomUUID();
      const assetKey = `users/${userId}/design-scheme-uploads/${randomUUID()}`;
      const sourceKey = `scheme-sources/${HASH}/${snapshotId}/${randomUUID()}`;
      await database.pool.query(
        `INSERT INTO design_schemes(id,user_id,name,source_presentation,current_revision_id,fidelity,deleted_at)
       VALUES($1,$2,'Hard-exit scheme','musefold-created',$3,'faithful',$4)`,
        [schemeId, userId, revisionId, deletedAt],
      );
      await database.pool.query(
        `INSERT INTO design_scheme_revisions(revision_id,scheme_id,user_id,schema_version,document,created_by)
       VALUES($1,$2,$3,1,$4,'user')`,
        [revisionId, schemeId, userId, JSON.stringify({ schemeId, revisionId })],
      );
      await database.pool.query(
        `INSERT INTO design_scheme_assets(id,user_id,revision_id,object_key,role,origin,mime_type,width,height,content_hash)
       VALUES($1,$2,$3,$4,'reference','uploaded','image/png',1,1,$5)`,
        [randomUUID(), userId, revisionId, assetKey, HASH],
      );
      const packageId = randomUUID();
      await database.pool.query(
        `INSERT INTO design_scheme_source_packages(id,user_id,kind) VALUES($1,$2,'github')`,
        [packageId, userId],
      );
      await database.pool.query(
        `INSERT INTO design_scheme_source_snapshots(id,user_id,package_id,resolved_ref)
       VALUES($1,$2,$3,$4)`,
        [snapshotId, userId, packageId, HASH.slice(0, 40)],
      );
      await database.pool.query(
        `INSERT INTO design_scheme_source_files(snapshot_id,user_id,relative_path,kind,size_bytes,content_hash,object_key)
       VALUES($1,$2,'README.md','text',3,$3,$4)`,
        [snapshotId, userId, HASH, sourceKey],
      );
      await database.pool.query(
        `INSERT INTO design_scheme_source_bindings(revision_id,source_snapshot_id,user_id,role)
       VALUES($1,$2,$3,'normative')`,
        [revisionId, snapshotId, userId],
      );
      return { schemeId, revisionId, assetKey, sourceKey, snapshotId };
    }

    beforeAll(async () => {
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      database = createDatabase(container.getConnectionUri());
      await migrateDatabase(database.db);
      storage = await createDisposableObjectStorage();
      scopeId = inventoryScopeId(storage.bucket, storage.endpoint);
    }, 180000);
    beforeEach(async () => {
      now = new Date(Date.now() + 1000);
      await database.pool.query(
        'TRUNCATE "user",object_key_retirements,object_cleanup_queue,object_inventory_candidates,object_inventory_cursors CASCADE',
      );
      await database.pool.query(
        `INSERT INTO "user"(id,name,email) VALUES($1,'SchemeHardExit','scheme-hardexit@example.test')`,
        [OWNER],
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

    it('account cascade releases a soft-deleted scheme to rediscovery, real deletion and P0001 fences', async () => {
      const fixture = await seedScheme(OWNER, new Date());
      const { assetKey, sourceKey } = fixture;
      await put(assetKey);
      await put(sourceKey);
      // A scheme-run frozen reference layers a second protector onto the asset bytes.
      const runId = randomUUID();
      await database.pool.query(
        `INSERT INTO generation_runs(id,user_id,status,request) VALUES($1,$2,'succeeded','{}')`,
        [runId, OWNER],
      );
      await database.pool.query(
        `INSERT INTO design_scheme_generation_references
       (generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
       VALUES($1,$2,$3,0,$4,'frozen.png','image/png',17,$5)`,
        [runId, OWNER, randomUUID(), assetKey, HASH],
      );

      // Soft-deleted scheme: asset, source and frozen reference all keep protecting;
      // a deletion authorization attempt writes no retirement hash and the inventory
      // scan records no candidate.
      const phase1 = await store().authorizeDeletion([assetKey, sourceKey], now);
      expect(sorted(phase1.permanent)).toEqual(sorted([assetKey, sourceKey]));
      expect(phase1.leased).toEqual([]);
      expect(await retired(assetKey)).toEqual([]);
      expect(await retired(sourceKey)).toEqual([]);
      await scan();
      expect(await candidates()).toEqual([]);
      expect((await get(assetKey)).Body).toBeDefined();
      expect((await get(sourceKey)).Body).toBeDefined();

      // The existing hard-delete path: account cascade removes every reference row.
      await database.pool.query('DELETE FROM "user" WHERE id=$1', [OWNER]);
      for (const table of [
        'design_schemes',
        'design_scheme_revisions',
        'design_scheme_assets',
        'design_scheme_source_bindings',
        'design_scheme_source_files',
        'design_scheme_source_snapshots',
        'design_scheme_source_packages',
        'design_scheme_generation_references',
        'generation_runs',
      ]) {
        expect(await count(table)).toBe(0);
      }

      // Rediscovery only observes: candidates are recorded, bytes stay readable.
      await scan();
      expect((await candidates()).map((row) => row.object_key)).toEqual(
        sorted([assetKey, sourceKey]),
      );
      expect((await get(assetKey)).Body).toBeDefined();
      expect((await get(sourceKey)).Body).toBeDefined();

      // After the grace the existing executor re-checks identity, retires the keys
      // and really deletes the objects through disposable MinIO.
      await expireGrace();
      expect(await processObjectInventoryCandidates(deps(), 'record')).toMatchObject({
        claimed: 2,
        deleted: 2,
        failed: 0,
        protected: 0,
      });
      await expectGone(assetKey);
      await expectGone(sourceKey);
      expect(await retired(assetKey)).toHaveLength(1);
      expect(await retired(sourceKey)).toHaveLength(1);
      expect(await candidates()).toEqual([]);

      // Late re-publication of either retired key is fenced with P0001.
      const successor = 'scheme-hardexit-successor';
      await database.pool.query(
        `INSERT INTO "user"(id,name,email) VALUES($1,'Successor','successor@example.test')`,
        [successor],
      );
      const reseeded = await seedScheme(successor, null);
      await expect(
        database.pool.query(
          `INSERT INTO design_scheme_assets(id,user_id,revision_id,object_key,role,origin,mime_type,width,height,content_hash)
         VALUES($1,$2,$3,$4,'reference','uploaded','image/png',1,1,$5)`,
          [randomUUID(), successor, reseeded.revisionId, assetKey, HASH],
        ),
      ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
      await expect(
        database.pool.query(
          `INSERT INTO design_scheme_source_files(snapshot_id,user_id,relative_path,kind,size_bytes,content_hash,object_key)
         VALUES($1,$2,'LATE.md','text',3,$3,$4)`,
          [reseeded.snapshotId, successor, HASH, sourceKey],
        ),
      ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });

      // Repeated hard delete and repeated executor runs are idempotent no-ops.
      await database.pool.query('DELETE FROM "user" WHERE id=$1', [OWNER]);
      expect(await processObjectInventoryCandidates(deps(), 'record')).toMatchObject({
        claimed: 0,
        deleted: 0,
        failed: 0,
      });
      await scan();
      expect(await candidates()).toEqual([]);
      expect(await retired(assetKey)).toHaveLength(1);
    }, 60000);

    it('explicit scheme-row delete frees assets to rediscovery while the surviving source snapshot exits through preparation retirement', async () => {
      const fixture = await seedScheme(OWNER, new Date());
      const { assetKey, sourceKey, schemeId, snapshotId } = fixture;
      await put(assetKey);
      await put(sourceKey);
      // The source copy arrived through a preparation whose own window has closed;
      // its binding keeps the file canonical while the scheme lives.
      await database.pool.query(
        `INSERT INTO design_scheme_source_preparations
       (user_id,execution_id,confirmation_id,request_hash,request,status,snapshot_id,content_hash,confirmation,expires_at)
       VALUES($1,$2,$3,$4,'{}','ready',$5,$6,'{}',$7)`,
        [OWNER, randomUUID(), randomUUID(), HASH, snapshotId, HASH, new Date(0)],
      );

      // Soft-deleted scheme: both objects protected, no retirement hash.
      const phase1 = await store().authorizeDeletion([assetKey, sourceKey], now);
      expect(sorted(phase1.permanent)).toEqual(sorted([assetKey, sourceKey]));
      expect(await retired(assetKey)).toEqual([]);

      // Explicit hard delete of the scheme row (the future purge path): the asset
      // and binding rows cascade away; the user-level source snapshot survives by
      // design and keeps protecting its frozen copy.
      await database.pool.query('DELETE FROM design_schemes WHERE id=$1', [schemeId]);
      expect(await count('design_scheme_assets')).toBe(0);
      expect(await count('design_scheme_revisions')).toBe(0);
      expect(await count('design_scheme_source_bindings')).toBe(0);
      expect(await count('design_scheme_source_files')).toBe(1);
      expect(await count('design_scheme_source_snapshots')).toBe(1);
      expect(await store().findProtected([sourceKey], now)).toEqual({
        permanent: [sourceKey],
        leased: [],
      });

      // The released asset object is rediscovered and really deleted.
      await scan();
      expect((await candidates()).map((row) => row.object_key)).toEqual([assetKey]);
      expect((await get(assetKey)).Body).toBeDefined();
      await expireGrace();
      expect(await processObjectInventoryCandidates(deps(), 'record')).toMatchObject({
        claimed: 1,
        deleted: 1,
        failed: 0,
      });
      await expectGone(assetKey);
      expect(await retired(assetKey)).toHaveLength(1);
      expect((await get(sourceKey)).Body).toBeDefined();

      // The unbound source copy exits through the existing preparation retirement
      // into the shared outbox, which retires the key and deletes the bytes.
      expect(await retireDesignSchemeSourcePreparations(database.db, now)).toBe(1);
      const fileRow = (
        await database.pool.query(
          'SELECT object_key FROM design_scheme_source_files WHERE snapshot_id=$1',
          [snapshotId],
        )
      ).rows[0];
      expect(fileRow.object_key).toBeNull();
      expect(
        (
          await database.pool.query('SELECT reason FROM object_cleanup_queue WHERE object_key=$1', [
            sourceKey,
          ])
        ).rows,
      ).toEqual([{ reason: 'reference_expired' }]);
      expect(
        await processObjectCleanupBatch(store(), storage.client, storage.bucket, undefined, now),
      ).toMatchObject({ deleted: 1, protected: 0, failed: 0 });
      await expectGone(sourceKey);
      expect(await retired(sourceKey)).toHaveLength(1);

      // Late re-publication of both retired keys is fenced with P0001.
      const reseeded = await seedScheme(OWNER, null);
      await expect(
        database.pool.query(
          `INSERT INTO design_scheme_assets(id,user_id,revision_id,object_key,role,origin,mime_type,width,height,content_hash)
         VALUES($1,$2,$3,$4,'reference','uploaded','image/png',1,1,$5)`,
          [randomUUID(), OWNER, reseeded.revisionId, assetKey, HASH],
        ),
      ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
      await expect(
        database.pool.query(
          `INSERT INTO design_scheme_source_files(snapshot_id,user_id,relative_path,kind,size_bytes,content_hash,object_key)
         VALUES($1,$2,'LATE.md','text',3,$3,$4)`,
          [reseeded.snapshotId, OWNER, HASH, sourceKey],
        ),
      ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });

      // Repeating the hard delete and both exits stays idempotent.
      await database.pool.query('DELETE FROM design_schemes WHERE id=$1', [schemeId]);
      expect(await retireDesignSchemeSourcePreparations(database.db, now)).toBe(0);
      expect(
        await processObjectCleanupBatch(store(), storage.client, storage.bucket, undefined, now),
      ).toMatchObject({ deleted: 0, protected: 0, failed: 0 });
      expect(await processObjectInventoryCandidates(deps(), 'record')).toMatchObject({
        claimed: 0,
        deleted: 0,
        failed: 0,
      });
      expect(await retired(assetKey)).toHaveLength(1);
      expect(await retired(sourceKey)).toHaveLength(1);
    }, 60000);
  },
);
