import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  migrateDatabase,
  SOFT_DELETE_RETENTION_MS,
  SYNC_RETENTION_MS,
} from '@musefold/db';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeExpiredSoftDeletedPrompts, purgeExpiredSoftDeletedRuns } from '../retention.js';
import { trimExpiredSyncRecords } from '../sync-retention.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const NOW = new Date('2026-11-02T00:00:00.000Z');
const owner = 'owned-retention';
const factTables = [
  'generation_runs',
  'generation_assets',
  'generation_execution_receipts',
  'generation_reference_uploads',
  'design_scheme_generation_references',
  'object_cleanup_queue',
] as const;

describeDb('retention timestamps and fee/reference rollback on actual PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    // A single pooled connection makes timezone and post-rollback settings assertions exact.
    database = createDatabase(container.getConnectionUri(), { max: 1 });
    await migrateDatabase(database.db);
  }, 180_000);
  beforeEach(async () => {
    await database.pool.query("SET TIME ZONE 'UTC'");
    await database.pool.query('DROP FUNCTION IF EXISTS owned_retention_failure() CASCADE');
    await database.pool.query(
      'TRUNCATE "user",generation_execution_receipts,object_cleanup_queue,sync_retention_state RESTART IDENTITY CASCADE',
    );
    await database.pool.query(
      "INSERT INTO \"user\"(id,name,email) VALUES ($1,'Owned','retention@example.test')",
      [owner],
    );
  });
  afterEach(async () => {
    await database.pool.query("SET TIME ZONE 'UTC'");
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  it.each(['UTC', 'Asia/Shanghai', 'America/Los_Angeles'])(
    'uses the same exact 30/90-day instants in %s and preserves future timestamps',
    async (zone) => {
      await database.pool.query("SELECT set_config('TimeZone',$1,false)", [zone]);
      expect((await database.pool.query('SHOW TIME ZONE')).rows[0].TimeZone).toBe(zone);
      await database.pool.query(
        "INSERT INTO sync_devices(user_id,device_id,name,platform,client_version) VALUES ($1,'owned-device','Owned','macos','2.5.0')",
        [owner],
      );
      const devices = (await database.pool.query('SELECT * FROM sync_devices')).rows;
      for (const [id, offset] of [
        ['before', -1],
        ['at', 0],
        ['after', 1],
        ['future', null],
      ] as const) {
        const deletion = new Date(
          offset === null
            ? NOW.getTime() + 86400000
            : NOW.getTime() - SOFT_DELETE_RETENTION_MS + offset,
        );
        const syncTime = new Date(
          offset === null ? NOW.getTime() + 86400000 : NOW.getTime() - SYNC_RETENTION_MS + offset,
        );
        await database.pool.query(
          "INSERT INTO prompts(id,user_id,title,content,deleted_at) VALUES ($1,$2,'Owned','Owned body',$3)",
          [id, owner, deletion],
        );
        await database.pool.query(
          "INSERT INTO generation_runs(id,user_id,status,request,deleted_at) VALUES ($1,$2,'succeeded','{}',$3)",
          [id, owner, deletion],
        );
        await database.pool.query(
          "INSERT INTO sync_change_log(user_id,entity_type,entity_id,operation,version,snapshot,created_at) VALUES ($1,'prompt',$2,'delete',1,'{}',$3)",
          [owner, id, syncTime],
        );
        await database.pool.query(
          "INSERT INTO sync_mutation_results(user_id,device_id,mutation_id,entity_type,entity_id,result_status,created_at) VALUES ($1,'owned-device',$2,'prompt',$2,'applied',$3)",
          [owner, id, syncTime],
        );
      }
      expect(await purgeExpiredSoftDeletedPrompts(database.db, NOW)).toEqual({ purged: 2 });
      expect(await purgeExpiredSoftDeletedRuns(database.db, NOW)).toEqual({
        purged: 2,
        objectKeys: [],
      });
      expect(await trimExpiredSyncRecords(database.db, NOW)).toEqual({
        purged: 4,
        changeLogs: 2,
        mutationResults: 2,
        minAvailableCursor: 2,
      });
      for (const table of ['prompts', 'generation_runs'])
        expect((await database.pool.query(`SELECT id FROM ${table} ORDER BY id`)).rows).toEqual([
          { id: 'after' },
          { id: 'future' },
        ]);
      expect(
        (await database.pool.query('SELECT entity_id FROM sync_change_log ORDER BY seq')).rows,
      ).toEqual([{ entity_id: 'after' }, { entity_id: 'future' }]);
      expect(
        (
          await database.pool.query(
            'SELECT mutation_id FROM sync_mutation_results ORDER BY mutation_id',
          )
        ).rows,
      ).toEqual([{ mutation_id: 'after' }, { mutation_id: 'future' }]);
      expect((await database.pool.query('SELECT * FROM sync_devices')).rows).toEqual(devices);
      expect(await purgeExpiredSoftDeletedPrompts(database.db, NOW)).toEqual({ purged: 0 });
      expect(await purgeExpiredSoftDeletedRuns(database.db, NOW)).toEqual({
        purged: 0,
        objectKeys: [],
      });
      expect(await trimExpiredSyncRecords(database.db, NOW)).toEqual({
        purged: 0,
        changeLogs: 0,
        mutationResults: 0,
        minAvailableCursor: 2,
      });
      expect((await database.pool.query('SHOW TIME ZONE')).rows[0].TimeZone).toBe(zone);
    },
  );

  async function facts() {
    const result: Record<string, pg.QueryResultRow[]> = {};
    for (const table of factTables)
      result[table] = (
        await database.pool.query(`SELECT * FROM ${table} ORDER BY row_to_json(${table})::text`)
      ).rows;
    return result;
  }

  async function seedReceipts(cost: 'known' | 'unknown') {
    // Historic legacy-unbound receipts exercise maintenance, not paid request admission.
    for (const id of ['expired', 'future']) {
      const deletedAt = new Date(
        NOW.getTime() - SOFT_DELETE_RETENTION_MS + (id === 'expired' ? 0 : 1),
      );
      const status = cost === 'known' ? 'succeeded' : 'failed';
      await database.pool.query(
        `INSERT INTO generation_execution_receipts
        (id,principal_id,idempotency_key,operation,original_run_id,binding_state,status,dispatch,cost_provenance,cost_points,terminal_at)
        VALUES ($1,$2,$1,'ordinary_create',$1,'legacy_unbound',$3,'claimed',$4,$5,$6)`,
        [
          id,
          owner,
          status,
          cost === 'known' ? 'provider_reported' : 'unknown',
          cost === 'known' ? 3 : null,
          NOW,
        ],
      );
      await database.pool.query(
        `INSERT INTO generation_runs(id,user_id,status,request,deleted_at,cost_points,execution_receipt_id)
        VALUES ($1,$2,$3,'{}',$4,$5,$1)`,
        [id, owner, status, deletedAt, cost === 'known' ? 3 : null],
      );
      await database.pool.query(
        `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256,position)
        VALUES ($1,$1,$2,$3,'image/png',1,1,4,repeat('a',64),0)`,
        [id, owner, `owned/assets/${id}`],
      );
      await database.pool.query(
        `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
        VALUES ($1,$2,$3,'Owned reference','image/png',4,'available',$4)`,
        [id, owner, `owned/references/${id}`, new Date(NOW.getTime() + 86400000)],
      );
      await database.pool.query(
        `INSERT INTO design_scheme_generation_references(generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
        VALUES ($1,$2,$1,0,$3,'Owned reference','image/png',4,repeat('b',64))`,
        [id, owner, `owned/references/${id}`],
      );
    }
  }

  async function verifyRetry(before: Awaited<ReturnType<typeof facts>>) {
    const result = await purgeExpiredSoftDeletedRuns(database.db, NOW);
    expect(result.purged).toBe(1);
    expect(result.objectKeys.sort()).toEqual(['owned/assets/expired', 'owned/references/expired']);
    const after = await facts();
    for (const table of ['generation_runs', 'generation_assets'])
      expect(after[table]).toEqual(before[table].filter((row) => row.id === 'future'));
    expect(after.design_scheme_generation_references).toEqual(
      before.design_scheme_generation_references.filter(
        (row) => row.generation_run_id === 'future',
      ),
    );
    expect(after.generation_reference_uploads).toEqual(before.generation_reference_uploads);
    expect(after.generation_execution_receipts).toEqual(
      before.generation_execution_receipts.map((row) =>
        row.id === 'expired'
          ? { ...row, purged_at: NOW, updated_at: NOW, revision: row.revision + 1 }
          : row,
      ),
    );
    expect(
      after.object_cleanup_queue
        .map((row) => ({ key: row.object_key, owner: row.owner_id }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ).toEqual([
      { key: 'owned/assets/expired', owner },
      { key: 'owned/references/expired', owner },
    ]);
    expect(await purgeExpiredSoftDeletedRuns(database.db, NOW)).toEqual({
      purged: 0,
      objectKeys: [],
    });
    expect(await facts()).toEqual(after);
  }

  it.each(['known', 'unknown'] as const)(
    'rolls back %s fees, purge markers, released references and queue writes if final run deletion fails',
    async (cost) => {
      await seedReceipts(cost);
      const before = await facts();
      for (const table of factTables.filter((name) => name !== 'object_cleanup_queue'))
        expect(before[table]).toHaveLength(2);
      await database.pool.query(`CREATE FUNCTION owned_retention_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Owned retention fault'; END $$;
      CREATE TRIGGER owned_retention_failure BEFORE DELETE ON generation_runs FOR EACH ROW WHEN (OLD.id='expired') EXECUTE FUNCTION owned_retention_failure()`);
      await expect(purgeExpiredSoftDeletedRuns(database.db, NOW)).rejects.toMatchObject({
        cause: { code: 'P0001' },
      });
      expect(await facts()).toEqual(before);
      await database.pool.query('DROP FUNCTION owned_retention_failure() CASCADE');
      await verifyRetry(before);
    },
  );

  it.each([
    'generation_execution_receipts',
    'generation_assets',
    'design_scheme_generation_references',
  ] as const)(
    'bounds a held %s child lock and rolls back fees and cleanup intent before retry',
    async (table) => {
      await seedReceipts('unknown');
      const before = await facts();
      const originalTimeout = (await database.pool.query('SHOW lock_timeout')).rows;
      const holder = new pg.Client({ connectionString: container.getConnectionUri() });
      await holder.connect();
      let pending: Promise<{ code?: string }> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await holder.query('BEGIN');
        const key = table === 'design_scheme_generation_references' ? 'generation_run_id' : 'id';
        await holder.query(`SELECT * FROM ${table} WHERE ${key}='expired' FOR UPDATE`);
        pending = purgeExpiredSoftDeletedRuns(database.db, NOW).then(
          () => ({ code: 'unexpected-success' }),
          (error: unknown) => ({ code: (error as { cause?: { code?: string } }).cause?.code }),
        );
        const outcome = await Promise.race([
          pending,
          new Promise<{ code: string }>((resolve) => {
            timer = setTimeout(() => resolve({ code: 'probe-deadline-exceeded' }), 4000);
          }),
        ]);
        expect(outcome).toEqual({ code: '55P03' });
        expect(await facts()).toEqual(before);
        expect((await database.pool.query('SHOW lock_timeout')).rows).toEqual(originalTimeout);
        await holder.query('COMMIT');
        await verifyRetry(before);
      } finally {
        if (timer) clearTimeout(timer);
        await holder.query('ROLLBACK');
        await pending;
        await holder.end();
      }
    },
    15000,
  );
});
