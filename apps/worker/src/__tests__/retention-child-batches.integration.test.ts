import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase, RETENTION_BATCH_SIZE } from '@musefold/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeExpiredSoftDeletedPrompts, purgeExpiredSoftDeletedRuns } from '../retention.js';
import { maintenanceFacts, seedMaintenanceMatrix } from './fixtures/maintenance-matrix.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('resumable retention bounds all child rows before removing their parent', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
  }, 180_000);
  beforeEach(async () => {
    await database.pool.query('DROP FUNCTION IF EXISTS owned_purge_completion_failure() CASCADE');
    await database.pool.query(
      'TRUNCATE "user",object_cleanup_queue,sync_retention_state,rate_limit_buckets RESTART IDENTITY CASCADE',
    );
    await seedMaintenanceMatrix(database.pool);
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  const cases = [
    ['generation_assets', 'run_id', 'run-expired'],
    ['generation_events', 'run_id', 'run-expired'],
    ['generation_reference_links', 'run_id', 'run-expired'],
    ['prompt_usage_events', 'prompt_id', 'prompt-expired'],
    ['prompt_tag_links', 'prompt_id', 'prompt-expired'],
  ] as const;

  it.each(cases)(
    '%s drains 1000 then 1 then no-op without losing durable progress',
    async (table, key, id) => {
      if (table === 'generation_assets') {
        await database.pool.query(`INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256,position)
        SELECT 'bulk-asset-'||n,'run-expired','owned-maintenance','owned/child/asset/'||n,'image/png',1,1,4,repeat('a',64),n FROM generate_series(1,1000) n`);
      } else if (table === 'generation_events') {
        await database.pool.query(
          `INSERT INTO generation_events(run_id,user_id,event_type) SELECT 'run-expired','owned-maintenance','generation.progress' FROM generate_series(1,1001)`,
        );
      } else if (table === 'generation_reference_links') {
        await database.pool.query(`INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
        SELECT 'bulk-reference-'||n,'owned-maintenance','owned/child/reference/'||n,'Owned','image/png',4,'available',now()+interval '1 day' FROM generate_series(1,1001) n`);
        await database.pool.query(`INSERT INTO generation_reference_links(run_id,user_id,reference_id)
        SELECT 'run-expired','owned-maintenance','bulk-reference-'||n FROM generate_series(1,1001) n`);
      } else if (table === 'prompt_usage_events') {
        await database.pool.query(`INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action)
        SELECT 'owned-maintenance','bulk-usage-'||n,'prompt-expired','copy' FROM generate_series(1,1000) n`);
      } else {
        await database.pool.query(
          `INSERT INTO prompt_tags(id,user_id,name) SELECT 'bulk-tag-'||n,'owned-maintenance','Owned '||n FROM generate_series(1,1001) n`,
        );
        await database.pool.query(
          `INSERT INTO prompt_tag_links(prompt_id,tag_id) SELECT 'prompt-expired','bulk-tag-'||n FROM generate_series(1,1001) n`,
        );
      }
      const count = async () =>
        Number(
          (await database.pool.query(`SELECT count(*) AS n FROM ${table} WHERE ${key}=$1`, [id]))
            .rows[0].n,
        );
      const execute = () =>
        table.startsWith('generation')
          ? purgeExpiredSoftDeletedRuns(database.db)
          : purgeExpiredSoftDeletedPrompts(database.db);
      const parentTable = table.startsWith('generation') ? 'generation_runs' : 'prompts';
      expect(await count()).toBe(RETENTION_BATCH_SIZE + 1);
      expect((await execute()).purged).toBe(0);
      expect(await count()).toBe(1);
      const first = (
        await database.pool.query(`SELECT purge_started_at FROM ${parentTable} WHERE id=$1`, [id])
      ).rows;
      expect(first).toHaveLength(1);
      expect(first[0].purge_started_at).toBeInstanceOf(Date);
      // A new pool has no process-local cursor; committed rows alone resume the work.
      await database.pool.end();
      database = createDatabase(container.getConnectionUri());
      expect((await execute()).purged).toBe(1);
      expect(await count()).toBe(0);
      expect((await execute()).purged).toBe(0);
      expect((await database.pool.query(`SELECT id FROM ${parentTable} ORDER BY id`)).rows).toEqual(
        [{ id: table.startsWith('generation') ? 'run-live' : 'prompt-live' }],
      );
      if (table === 'generation_assets') {
        expect(
          Number(
            (
              await database.pool.query(
                "SELECT count(*) AS n FROM object_cleanup_queue WHERE reason='generation_purge'",
              )
            ).rows[0].n,
          ),
        ).toBe(1001);
      }
      if (table === 'prompt_tag_links')
        expect(
          Number((await database.pool.query('SELECT count(*) AS n FROM prompt_tags')).rows[0].n),
        ).toBe(1001);
    },
  );

  it('shares the source-reference budget across parents while respecting each run’s 16-reference database limit', async () => {
    await database.pool.query(`INSERT INTO generation_runs(id,user_id,status,request,deleted_at)
      SELECT 'group-'||lpad(n::text,3,'0'),'owned-maintenance','succeeded','{}',now()-interval '31 days' FROM generate_series(1,100) n`);
    await database.pool.query(`INSERT INTO design_scheme_generation_references(generation_run_id,user_id,asset_id,position,object_key,name,mime_type,byte_size,content_hash)
      SELECT r.id,r.user_id,'reference-'||n,n,'owned/child/'||r.id||'/'||n,'Owned reference','image/png',4,repeat('b',64)
      FROM generation_runs r CROSS JOIN generate_series(0,15) n WHERE r.id LIKE 'group-%'`);
    const first = await purgeExpiredSoftDeletedRuns(database.db);
    expect(first.purged).toBe(63); // 62 complete groups plus the original one-asset fixture.
    expect(first.objectKeys).toHaveLength(1001);
    expect(
      (
        await database.pool.query(
          'SELECT count(*)::int AS n FROM design_scheme_generation_references',
        )
      ).rows[0].n,
    ).toBe(600);
    const second = await purgeExpiredSoftDeletedRuns(database.db);
    expect(second.purged).toBe(38);
    expect(second.objectKeys).toHaveLength(600);
    expect(new Set([...first.objectKeys, ...second.objectKeys]).size).toBe(1601);
    expect(await purgeExpiredSoftDeletedRuns(database.db)).toEqual({ purged: 0, objectKeys: [] });
    expect((await database.pool.query('SELECT id FROM generation_runs')).rows).toEqual([
      { id: 'run-live' },
    ]);
  });

  it('two concurrent batches drain disjoint child sets, then finish the one remaining asset', async () => {
    await database.pool.query(`INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256,position)
      SELECT 'bulk-asset-'||n,'run-expired','owned-maintenance','owned/child/asset/'||n,'image/png',1,1,4,repeat('a',64),n FROM generate_series(1,2000) n`);
    const batches = await Promise.all([
      purgeExpiredSoftDeletedRuns(database.db),
      purgeExpiredSoftDeletedRuns(database.db),
    ]);
    for (const batch of batches) {
      expect(batch.purged).toBe(0);
      expect(batch.objectKeys).toHaveLength(1000);
    }
    expect(new Set(batches.flatMap((batch) => batch.objectKeys)).size).toBe(2000);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM generation_assets WHERE run_id='run-expired'",
        )
      ).rows[0].n,
    ).toBe(1);
    const last = await purgeExpiredSoftDeletedRuns(database.db);
    expect(last.purged).toBe(1);
    expect(last.objectKeys).toHaveLength(1);
    expect(await purgeExpiredSoftDeletedRuns(database.db)).toEqual({ purged: 0, objectKeys: [] });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS n FROM object_cleanup_queue WHERE reason='generation_purge'",
        )
      ).rows[0].n,
    ).toBe(2001);
  });

  it.each(['generation_runs', 'prompts'] as const)(
    '%s retains the committed first batch when final completion fails, then retries only the remainder',
    async (table) => {
      const generation = table === 'generation_runs';
      if (generation) {
        await database.pool.query(`INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256,position)
        SELECT 'bulk-asset-'||n,'run-expired','owned-maintenance','owned/child/asset/'||n,'image/png',1,1,4,repeat('a',64),n FROM generate_series(1,1000) n`);
      } else {
        await database.pool.query(`INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action)
        SELECT 'owned-maintenance','bulk-usage-'||n,'prompt-expired','copy' FROM generate_series(1,1000) n`);
      }
      const execute = () =>
        generation
          ? purgeExpiredSoftDeletedRuns(database.db)
          : purgeExpiredSoftDeletedPrompts(database.db);
      expect((await execute()).purged).toBe(0);
      const first = await maintenanceFacts(database.pool);
      await database.pool.query(
        `CREATE FUNCTION owned_purge_completion_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Owned completion failure'; END $$`,
      );
      await database.pool.query(
        `CREATE TRIGGER owned_purge_completion_failure BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION owned_purge_completion_failure()`,
      );
      await expect(execute()).rejects.toMatchObject({ cause: { code: 'P0001' } });
      expect(await maintenanceFacts(database.pool)).toEqual(first);
      await database.pool.query('DROP FUNCTION owned_purge_completion_failure() CASCADE');
      expect((await execute()).purged).toBe(1);
      expect((await execute()).purged).toBe(0);
      if (generation)
        expect(
          Number(
            (
              await database.pool.query(
                "SELECT count(*) AS n FROM object_cleanup_queue WHERE reason='generation_purge'",
              )
            ).rows[0].n,
          ),
        ).toBe(1001);
    },
  );
});
