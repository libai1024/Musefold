import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  migrateDatabase,
  RETENTION_BATCH_SIZE,
  retireDesignSchemeSourcePreparations,
} from '@musefold/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { maintenanceFacts, seedMaintenanceMatrix } from './fixtures/maintenance-matrix.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('source retirement bounds child file rows across a whole transaction', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 1 });
    await migrateDatabase(database.db);
  }, 180_000);
  beforeEach(async () => {
    await database.pool.query('DROP FUNCTION IF EXISTS fail_source_cleanup_enqueue() CASCADE');
    await database.pool.query(
      'TRUNCATE "user",object_cleanup_queue,sync_retention_state,rate_limit_buckets RESTART IDENTITY CASCADE',
    );
    await seedMaintenanceMatrix(database.pool);
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  async function addFiles(snapshot: string, count: number) {
    await database.pool.query(
      `INSERT INTO design_scheme_source_files(snapshot_id,user_id,relative_path,kind,size_bytes,content_hash,object_key)
      SELECT $1::text,'owned-maintenance','file-'||lpad(n::text,4,'0')||'.md','text',4,repeat('a',64),'owned/retention/'||$1::text||'/'||n FROM generate_series(1,$2::int) n`,
      [snapshot, count],
    );
  }

  async function remainingFiles() {
    return Number(
      (
        await database.pool.query(
          "SELECT count(*) AS n FROM design_scheme_source_files WHERE snapshot_id='source-expired' AND object_key IS NOT NULL",
        )
      ).rows[0].n,
    );
  }

  it.each(['single', 'multiple'] as const)(
    'bounds %s snapshots to 1000 detached files and queued keys per call, then resumes all leftovers',
    async (kind) => {
      const snapshots = ['source-expired'];
      if (kind === 'multiple') {
        snapshots.push('source-second');
        await database.pool.query(`INSERT INTO design_scheme_source_snapshots(id,user_id,package_id,resolved_ref)
        SELECT 'source-second',user_id,package_id,resolved_ref FROM design_scheme_source_snapshots WHERE id='source-expired'`);
        await database.pool.query(`INSERT INTO design_scheme_source_preparations(user_id,execution_id,confirmation_id,request_hash,request,status,snapshot_id,content_hash,confirmation,expires_at)
        SELECT user_id,'source-second','confirm-second',request_hash,request,status,'source-second',content_hash,confirmation,expires_at FROM design_scheme_source_preparations WHERE execution_id='source-expired'`);
      }
      const extra = kind === 'single' ? 1000 : 750;
      for (const snapshot of snapshots) {
        await addFiles(snapshot, extra);
      }
      const remaining = async () =>
        Number(
          (
            await database.pool.query(
              'SELECT count(*) AS n FROM design_scheme_source_files WHERE snapshot_id=ANY($1::text[]) AND object_key IS NOT NULL',
              [snapshots],
            )
          ).rows[0].n,
        );
      const queued = async () =>
        Number(
          (await database.pool.query('SELECT count(*) AS n FROM object_cleanup_queue')).rows[0].n,
        );
      const live = (
        await database.pool.query(
          "SELECT * FROM design_scheme_source_files WHERE snapshot_id='source-live'",
        )
      ).rows;
      let files = await remaining();
      const initial = files;
      expect(initial).toBe(kind === 'single' ? 1001 : 1501);
      const initialQueue = await queued();
      let rounds = 0;
      while (files > 0) {
        expect(rounds++).toBeLessThan(3);
        const beforeQueue = await queued();
        expect(await retireDesignSchemeSourcePreparations(database.db)).toBeGreaterThan(0);
        const next = await remaining();
        expect(files - next).toBe(Math.min(files, RETENTION_BATCH_SIZE));
        expect((await queued()) - beforeQueue).toBe(files - next);
        expect(
          (
            await database.pool.query(
              "SELECT * FROM design_scheme_source_files WHERE snapshot_id='source-live'",
            )
          ).rows,
        ).toEqual(live);
        files = next;
      }
      expect(rounds).toBe(2);
      expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(0);
      expect(await queued()).toBe(initialQueue + initial);
      expect(
        (await database.pool.query('SELECT DISTINCT owner_id FROM object_cleanup_queue')).rows,
      ).toEqual([{ owner_id: 'owned-maintenance' }]);
    },
  );

  it('rolls back file detachment and parent retirement when the durable cleanup enqueue fails mid-batch', async () => {
    await addFiles('source-expired', 1000);
    const before = await maintenanceFacts(database.pool);
    await database.pool.query(`CREATE FUNCTION fail_source_cleanup_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.object_key='owned/retention/source-expired/500' THEN RAISE EXCEPTION 'owned enqueue failure'; END IF; RETURN NEW; END $$`);
    await database.pool.query(
      `CREATE TRIGGER fail_source_cleanup_enqueue BEFORE INSERT ON object_cleanup_queue FOR EACH ROW EXECUTE FUNCTION fail_source_cleanup_enqueue()`,
    );
    await expect(retireDesignSchemeSourcePreparations(database.db)).rejects.toMatchObject({
      cause: { code: 'P0001' },
    });
    expect(await maintenanceFacts(database.pool)).toEqual(before);
    await database.pool.query('DROP FUNCTION fail_source_cleanup_enqueue() CASCADE');
    expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(1);
    expect(await remainingFiles()).toBe(1);
    expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(1);
    expect(await remainingFiles()).toBe(0);
    expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(0);
  });

  it('does not lock the file beyond this batch; a later locked batch rolls back and can retry', async () => {
    await addFiles('source-expired', 1000);
    const holder = new pg.Client({ connectionString: container.getConnectionUri() });
    await holder.connect();
    let pending: ReturnType<typeof execute> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const execute = () =>
      retireDesignSchemeSourcePreparations(database.db).then(
        (retired) => ({ retired }),
        (error: unknown) => ({ code: (error as { cause?: { code?: string } }).cause?.code }),
      );
    const observe = (operation: ReturnType<typeof execute>) =>
      Promise.race([
        operation,
        new Promise<{ code: string }>((resolve) => {
          timer = setTimeout(() => resolve({ code: 'probe-deadline-exceeded' }), 4000);
        }),
      ]);
    try {
      await holder.query('BEGIN');
      await holder.query(
        "SELECT * FROM design_scheme_source_files WHERE snapshot_id='source-expired' AND relative_path='file-1000.md' FOR UPDATE",
      );
      pending = execute();
      expect(await observe(pending)).toEqual({ retired: 1 });
      if (timer) clearTimeout(timer);
      expect(await remainingFiles()).toBe(1);
      const before = await maintenanceFacts(database.pool);
      const timeout = (await database.pool.query('SHOW lock_timeout')).rows;
      pending = execute();
      expect(await observe(pending)).toEqual({ code: '55P03' });
      expect(await maintenanceFacts(database.pool)).toEqual(before);
      expect((await database.pool.query('SHOW lock_timeout')).rows).toEqual(timeout);
      await holder.query('COMMIT');
      expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(1);
      expect(await remainingFiles()).toBe(0);
      expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(0);
    } finally {
      if (timer) clearTimeout(timer);
      await holder.query('ROLLBACK');
      await pending;
      await holder.end();
    }
  }, 15000);

  it.each(['binding', 'upload lease'] as const)(
    'preserves all files under an active %s while draining other expired files',
    async (protection) => {
      await addFiles('source-expired', 1000);
      await addFiles('source-live', 1001);
      await database.pool.query(
        "UPDATE design_scheme_source_preparations SET expires_at=now()-interval '2 days' WHERE execution_id='source-live'",
      );
      if (protection === 'binding') {
        await database.pool.query(`INSERT INTO design_schemes(id,user_id,name,source_presentation,current_revision_id,fidelity)
        VALUES ('owned-bound-scheme','owned-maintenance','Owned binding','skill','owned-bound-revision','verified')`);
        await database.pool.query(`INSERT INTO design_scheme_revisions(revision_id,scheme_id,user_id,schema_version,document,created_by)
        VALUES ('owned-bound-revision','owned-bound-scheme','owned-maintenance',1,'{"revisionId":"owned-bound-revision","schemeId":"owned-bound-scheme"}','user')`);
        await database.pool.query(`INSERT INTO design_scheme_source_bindings(revision_id,source_snapshot_id,user_id,role)
        VALUES ('owned-bound-revision','source-live','owned-maintenance','reference')`);
      } else {
        await database.pool.query(
          "UPDATE design_scheme_source_preparations SET upload_lease_until=now()+interval '1 day' WHERE execution_id='source-live'",
        );
      }
      const before = (
        await database.pool.query(
          "SELECT * FROM design_scheme_source_files WHERE snapshot_id='source-live' ORDER BY relative_path",
        )
      ).rows;
      expect(before).toHaveLength(1002);
      expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(
        protection === 'binding' ? 2 : 1,
      );
      expect(await remainingFiles()).toBe(1);
      expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(1);
      expect(await remainingFiles()).toBe(0);
      expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(0);
      expect(
        (
          await database.pool.query(
            "SELECT * FROM design_scheme_source_files WHERE snapshot_id='source-live' ORDER BY relative_path",
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await database.pool.query(
            'SELECT * FROM object_cleanup_queue WHERE object_key=ANY($1::text[])',
            [before.map((row) => row.object_key)],
          )
        ).rows,
      ).toEqual([]);
    },
  );
});
