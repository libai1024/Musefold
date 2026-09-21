import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  migrateDatabase,
  retireDesignSchemePackageStages,
  retireDesignSchemeSourcePreparations,
} from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeExpiredSoftDeletedRuns } from '../retention.js';
import { PostgresObjectCleanupStore } from '../tasks.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'matrix-catalog-owner';
const SOFT_DELETE_PURGE_AGE_MS = 31 * 24 * 60 * 60_000;
const HASH = 'a'.repeat(64);

interface MatrixEntry {
  /** Asset category named after the D02.1 cloud catalog (lifecycle doc §14.5). */
  category: string;
  key: () => string;
  /** Commits the reference/lease rows that must block retirement (orphan: no-op). */
  protect: (key: string) => Promise<void>;
  /** Protection class while the reference/lease exists; null expects none (orphan). */
  phase1: 'permanent' | 'leased' | null;
  /** Executes the existing retention/policy exit that removes the reference. */
  exit: (key: string) => Promise<void>;
}

/**
 * D02.1 cloud asset protection matrix: every catalog category must prove that an
 * existing reference/lease blocks the deletion authorization (and writes no
 * retirement hash), and that the category's own policy exit makes the key retirable.
 * The physical deletion chain after authorization is covered per category by the
 * object-cleanup/package-cleanup/consumed-upload-ledger-exit suites; this matrix pins
 * the authorization side so the doc catalog stays test-enforced.
 */
describeDb('cloud asset catalog protection matrix', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;

  const store = () => new PostgresObjectCleanupStore(database.db);
  const retired = async (objectKey: string) =>
    (
      await database.pool.query(
        `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [objectKey],
      )
    ).rows;
  const onlyRunId = async () =>
    (await database.pool.query('SELECT id FROM generation_runs')).rows[0].id as string;
  const segment = (key: string, index: number) => {
    const part = key.split('/')[index];
    if (!part) throw new Error('invalid fixture object key');
    return part;
  };
  const insertRun = (runId: string, status = 'succeeded', lease: Date | null = null) =>
    database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,lease_expires_at) VALUES($1,$2,$3,'{}',$4)`,
      [runId, OWNER, status, lease],
    );
  const softDeleteAndPurgeRun = async (runId: string) => {
    await database.pool.query(`UPDATE generation_runs SET deleted_at=$1 WHERE id=$2`, [
      new Date(Date.now() - SOFT_DELETE_PURGE_AGE_MS),
      runId,
    ]);
    expect((await purgeExpiredSoftDeletedRuns(database.db)).purged).toBe(1);
  };
  const insertRegistry = (id: string, objectKey: string, expiresAt: Date) =>
    database.pool.query(
      `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
       VALUES($1,$2,$3,'matrix.png','image/png',17,'available',$4)`,
      [id, OWNER, objectKey, expiresAt],
    );
  const insertStage = (stageId: string, objectKey: string, status: string, expires: Date) =>
    database.pool.query(
      `INSERT INTO design_scheme_package_stages
       (id,user_id,request_id,request_hash,package_hash,byte_size,format_version,parser_version,object_key,status,preview,confirmation_hash,authority_hash,expires_at)
       VALUES($1,$2,$3,repeat('a',64),repeat('b',64),128,2,1,$4,$5,'{}',repeat('c',64),repeat('d',64),$6)`,
      [stageId, OWNER, randomUUID(), objectKey, status, expires],
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
  }, 180000);
  beforeEach(async () => {
    await database.pool.query(
      'TRUNCATE "user",object_key_retirements,object_cleanup_queue,object_inventory_candidates,object_inventory_cursors CASCADE',
    );
    await database.pool.query(
      `INSERT INTO "user"(id,name,email) VALUES($1,'MatrixCatalog','matrix-catalog@example.test')`,
      [OWNER],
    );
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  const entries: MatrixEntry[] = [
    {
      category: 'generated object (generation_assets)',
      key: () => `users/${OWNER}/generations/${randomUUID()}/${randomUUID()}`,
      protect: async (key) => {
        const runId = segment(key, 3);
        await insertRun(runId);
        await database.pool.query(
          `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,checksum_sha256)
           VALUES($1,$2,$3,$4,'image/png',1,1,$5)`,
          [randomUUID(), runId, OWNER, key, HASH],
        );
      },
      phase1: 'permanent',
      exit: async (key) => softDeleteAndPurgeRun(segment(key, 3)),
    },
    {
      category: 'Composer reference consumed by a run (generation_reference_links)',
      key: () => `users/${OWNER}/references/${randomUUID()}`,
      protect: async (key) => {
        const runId = randomUUID();
        await insertRun(runId);
        await insertRegistry(randomUUID(), key, new Date(Date.now() - 1000));
        await database.pool.query(
          `INSERT INTO generation_reference_links(run_id,reference_id,user_id)
           SELECT $1,id,user_id FROM generation_reference_uploads WHERE object_key=$2`,
          [runId, key],
        );
      },
      phase1: 'permanent',
      exit: async () => softDeleteAndPurgeRun(await onlyRunId()),
    },
    {
      category: 'scheme-adopted asset of a soft-deleted scheme (design_scheme_assets)',
      key: () => `users/${OWNER}/design-scheme-uploads/${randomUUID()}`,
      protect: async (key) => {
        const schemeId = randomUUID();
        const revisionId = randomUUID();
        await database.pool.query(
          `INSERT INTO design_schemes(id,user_id,name,source_presentation,current_revision_id,fidelity,deleted_at)
           VALUES($1,$2,'Matrix scheme','musefold-created',$3,'faithful',$4)`,
          [schemeId, OWNER, revisionId, new Date()],
        );
        await database.pool.query(
          `INSERT INTO design_scheme_revisions(revision_id,scheme_id,user_id,schema_version,document,created_by)
           VALUES($1,$2,$3,1,$4,'user')`,
          [revisionId, schemeId, OWNER, JSON.stringify({ schemeId, revisionId })],
        );
        await database.pool.query(
          `INSERT INTO design_scheme_assets(id,user_id,revision_id,object_key,role,origin,mime_type,width,height,content_hash)
           VALUES($1,$2,$3,$4,'reference','uploaded','image/png',1,1,$5)`,
          [randomUUID(), OWNER, revisionId, key, HASH],
        );
      },
      phase1: 'permanent',
      exit: async () => {
        // Scheme hard purge is not implemented (registered D02 gap): soft deletion must
        // keep protecting, and the exit today is row cascade (account deletion) or a
        // future scheme purge. The DELETE models that row-level disappearance.
        await database.pool.query('DELETE FROM design_schemes');
      },
    },
    {
      category: 'scheme source frozen copy (design_scheme_source_files)',
      key: () => `scheme-sources/${HASH}/${randomUUID()}/${randomUUID()}`,
      protect: async (key) => {
        const snapshotId = segment(key, 2);
        const packageId = randomUUID();
        await database.pool.query(
          `INSERT INTO design_scheme_source_packages(id,user_id,kind) VALUES($1,$2,'github')`,
          [packageId, OWNER],
        );
        await database.pool.query(
          `INSERT INTO design_scheme_source_snapshots(id,user_id,package_id,resolved_ref) VALUES($1,$2,$3,$4)`,
          [snapshotId, OWNER, packageId, HASH.slice(0, 40)],
        );
        await database.pool.query(
          `INSERT INTO design_scheme_source_files(snapshot_id,user_id,relative_path,kind,size_bytes,content_hash,object_key)
           VALUES($1,$2,'README.md','text',3,$3,$4)`,
          [snapshotId, OWNER, HASH, key],
        );
      },
      phase1: 'permanent',
      exit: async (key) => {
        // The existing preparation retirement nulls unbound file keys and enqueues them.
        await database.pool.query(
          `INSERT INTO design_scheme_source_preparations
           (user_id,execution_id,confirmation_id,request_hash,request,status,snapshot_id,content_hash,confirmation,expires_at)
           VALUES($1,$2,$3,$4,'{}','ready',$5,$6,'{}',$7)`,
          [OWNER, randomUUID(), randomUUID(), HASH, segment(key, 2), HASH, new Date(0)],
        );
        expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(1);
      },
    },
    {
      category: 'scheme-run frozen reference (design_scheme_generation_references)',
      key: () => `users/${OWNER}/design-scheme-uploads/${randomUUID()}`,
      protect: async (key) => {
        const runId = randomUUID();
        await insertRun(runId);
        await database.pool.query(
          `INSERT INTO design_scheme_generation_references
           (generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
           VALUES($1,$2,$3,0,$4,'frozen.png','image/png',17,$5)`,
          [runId, OWNER, randomUUID(), key, HASH],
        );
      },
      phase1: 'permanent',
      exit: async () => softDeleteAndPurgeRun(await onlyRunId()),
    },
    {
      category: 'share-package staged upload (design_scheme_package_stages)',
      key: () => `scheme-packages/${HASH}/${randomUUID()}`,
      protect: async (key) => {
        const stageId = randomUUID();
        await insertRegistry(stageId, key, new Date(Date.now() + 60 * 60_000));
        await insertStage(stageId, key, 'ready', new Date(Date.now() + 60 * 60_000));
      },
      phase1: 'leased',
      exit: async () => {
        await database.pool.query(`UPDATE design_scheme_package_stages SET expires_at=$1`, [
          new Date(0),
        ]);
        expect(await retireDesignSchemePackageStages(database.db)).toBe(1);
      },
    },
    {
      category: 'share-package import copy under a running lease (design_scheme_package_imports)',
      key: () => `scheme-imports/${randomUUID()}/${randomUUID()}/${HASH}`,
      protect: async (key) => {
        const stageId = segment(key, 1);
        const attemptId = segment(key, 2);
        // The import FK requires its stage row; the stage's own object key differs.
        await insertStage(
          stageId,
          `scheme-packages/${HASH}/${randomUUID()}`,
          'confirmed',
          new Date(Date.now() + 60 * 60_000),
        );
        await database.pool.query(
          `INSERT INTO design_scheme_package_imports
           (stage_id,user_id,request_hash,authority_hash,confirmation_hash,parser_version,mapping_version,seed,attempt_id,status,lease_until)
           VALUES($1,$2,repeat('a',64),repeat('b',64),repeat('c',64),1,1,$3,$4,'running',$5)`,
          [stageId, OWNER, randomUUID(), attemptId, new Date(Date.now() + 60 * 60_000)],
        );
      },
      phase1: 'leased',
      exit: async () => {
        // Lease expiry is the import fence's exit; successful imports are protected by
        // the promoted canonical source/asset rows instead.
        await database.pool.query(`UPDATE design_scheme_package_imports SET lease_until=$1`, [
          new Date(0),
        ]);
      },
    },
    {
      category: 'share-package export archive (design_scheme_package_exports)',
      key: () => `scheme-exports/${randomUUID()}`,
      protect: async (key) => {
        await database.pool.query(
          `INSERT INTO design_scheme_package_exports
           (id,user_id,request_id,request_hash,authority_hash,scheme_id,revision_id,expected_version,basis_hash,object_key,status,package_hash,size_bytes,lease_until,expires_at)
           VALUES($1,$2,$3,repeat('a',64),repeat('b',64),$4,$5,1,repeat('c',64),$6,'ready',repeat('d',64),128,$7,$7)`,
          [
            randomUUID(),
            OWNER,
            randomUUID(),
            randomUUID(),
            randomUUID(),
            key,
            new Date(Date.now() + 60 * 60_000),
          ],
        );
      },
      phase1: 'leased',
      exit: async () => {
        // Time-based exit: the intent written at creation matures once both the build
        // lease and the ready TTL have passed.
        await database.pool.query(
          `UPDATE design_scheme_package_exports SET lease_until=$1,expires_at=$1`,
          [new Date(0)],
        );
      },
    },
    {
      category: 'uncommitted generation output under a run namespace lease (generation_runs)',
      key: () => `users/${OWNER}/generations/${randomUUID()}/${randomUUID()}`,
      protect: async (key) => {
        await insertRun(segment(key, 3), 'running', new Date(Date.now() + 60 * 60_000));
      },
      phase1: 'leased',
      exit: async (key) => {
        // Mirrors the finish transition: terminal status clears the lease.
        await database.pool.query(
          `UPDATE generation_runs SET status='failed',lease_expires_at=NULL WHERE id=$1`,
          [segment(key, 3)],
        );
      },
    },
    {
      category: 'failed/interrupted orphan without any database row',
      key: () => `users/${OWNER}/references/${randomUUID()}`,
      protect: async () => {},
      phase1: null,
      exit: async () => {},
    },
  ];

  for (const entry of entries) {
    it(`${entry.category}: reference blocks retirement; its policy exit permits it`, async () => {
      const key = entry.key();
      await entry.protect(key);
      if (entry.phase1 === null) {
        // Orphan baseline: no rows at all, so the first authorization already retires.
        // Discovery grace and physical deletion for this class live in the inventory suites.
        expect(await store().authorizeDeletion([key])).toEqual({ permanent: [], leased: [] });
        expect(await retired(key)).toHaveLength(1);
        return;
      }
      expect(await store().authorizeDeletion([key])).toEqual(
        entry.phase1 === 'permanent'
          ? { permanent: [key], leased: [] }
          : { permanent: [], leased: [key] },
      );
      expect(await retired(key)).toEqual([]);
      await entry.exit(key);
      expect(await store().authorizeDeletion([key])).toEqual({ permanent: [], leased: [] });
      expect(await retired(key)).toHaveLength(1);
    });
  }
});
