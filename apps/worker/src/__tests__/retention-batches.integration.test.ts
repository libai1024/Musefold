import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  migrateDatabase,
  SOFT_DELETE_RETENTION_MS,
  SYNC_RETENTION_MS,
} from '@musefold/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeExpiredSoftDeletedPrompts, purgeExpiredSoftDeletedRuns } from '../retention.js';
import { trimExpiredSyncRecords } from '../sync-retention.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const NOW = new Date('2026-09-13T00:00:00.000Z');
const deletedAt = new Date(NOW.getTime() - SOFT_DELETE_RETENTION_MS);
const createdAt = new Date(NOW.getTime() - SYNC_RETENTION_MS);

describeDb('bounded retention on actual PostgreSQL backlog', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 5 });
    await migrateDatabase(database.db);
  }, 180_000);
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.pool.query('TRUNCATE "user",sync_retention_state RESTART IDENTITY CASCADE');
    await database.pool.query(`INSERT INTO "user"(id,name,email) VALUES
      ('batch-owner','Synthetic owner','batch-owner@example.test'),
      ('batch-other','Synthetic other','batch-other@example.test')`);
  });
  const count = async (table: string) =>
    Number((await database.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

  it('purges at most 1000 expired prompts, leaves the backlog for the next call and keeps newer/live rows', async () => {
    await database.pool.query(
      `INSERT INTO prompts(id,user_id,title,content,deleted_at)
      SELECT 'expired-'||lpad(n::text,4,'0'),'batch-owner','Old','Synthetic', $1 FROM generate_series(1,1001) n`,
      [deletedAt],
    );
    await database.pool.query(
      `INSERT INTO prompts(id,user_id,title,content,deleted_at)
      VALUES ('live','batch-other','Live','Keep',NULL),('newer','batch-owner','Recent','Keep',$1)`,
      [new Date(deletedAt.getTime() + 1)],
    );
    const first = await purgeExpiredSoftDeletedPrompts(database.db, NOW);
    expect(first).toEqual({ purged: 1000 });
    expect(await count('prompts')).toBe(3);
    expect(await purgeExpiredSoftDeletedPrompts(database.db, NOW)).toEqual({ purged: 1 });
    expect(await purgeExpiredSoftDeletedPrompts(database.db, NOW)).toEqual({ purged: 0 });
    expect((await database.pool.query('SELECT id FROM prompts ORDER BY id')).rows).toEqual([
      { id: 'live' },
      { id: 'newer' },
    ]);
  });

  it('purges at most 1000 terminal generation rows and preserves active sent requests', async () => {
    // SQL-only historic records exercise retention cardinality, not paid execution admission.
    await database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,deleted_at,cost_points)
      SELECT 'run-'||lpad(n::text,4,'0'),'batch-owner','succeeded','{}',$1,25 FROM generate_series(1,1001) n`,
      [deletedAt],
    );
    await database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,deleted_at,upstream_request_sent,error_code)
      VALUES ('running','batch-owner','running','{}',$1,true,NULL),
      ('cancelling','batch-owner','cancelling','{}',$1,true,NULL)`,
      [deletedAt],
    );
    const first = await purgeExpiredSoftDeletedRuns(database.db, NOW);
    expect(first).toEqual({ purged: 1000, objectKeys: [] });
    expect(await count('generation_runs')).toBe(3);
    expect(await purgeExpiredSoftDeletedRuns(database.db, NOW)).toEqual({
      purged: 1,
      objectKeys: [],
    });
    expect(await purgeExpiredSoftDeletedRuns(database.db, NOW)).toEqual({
      purged: 0,
      objectKeys: [],
    });
    expect(
      (await database.pool.query('SELECT id,cost_points FROM generation_runs ORDER BY id')).rows,
    ).toEqual([
      { id: 'cancelling', cost_points: null },
      { id: 'running', cost_points: null },
    ]);
  });

  it('bounds each sync table, preserves composite-key peers and advances a durable watermark across batches', async () => {
    await database.pool.query(`INSERT INTO sync_devices(user_id,device_id,name,platform,client_version)
      VALUES ('batch-owner','device','Synthetic','macos','2.5.0')`);
    await database.pool.query(
      `INSERT INTO sync_change_log(user_id,entity_type,entity_id,operation,version,snapshot,created_at)
      SELECT 'batch-owner','prompt','old-'||n,'delete',1,'{}',$1 FROM generate_series(1,1001) n`,
      [createdAt],
    );
    await database.pool.query(
      `INSERT INTO sync_mutation_results(user_id,device_id,mutation_id,entity_type,entity_id,result_status,created_at)
      SELECT 'batch-owner','device','mut-'||lpad(n::text,4,'0'),'prompt','old-'||n,'applied',$1 FROM generate_series(1,1001) n`,
      [createdAt],
    );
    await database.pool.query(
      `INSERT INTO sync_mutation_results(user_id,device_id,mutation_id,entity_type,entity_id,result_status,created_at)
      VALUES ('batch-other','device','mut-0001','prompt','keep-other-owner','applied',$1),
      ('batch-owner','another-device','mut-0001','prompt','keep-other-device','applied',$1)`,
      [NOW],
    );
    const initialDevices = (await database.pool.query('SELECT * FROM sync_devices')).rows;
    const first = await trimExpiredSyncRecords(database.db, NOW);
    expect(first).toEqual({
      purged: 2000,
      changeLogs: 1000,
      mutationResults: 1000,
      minAvailableCursor: 1000,
    });
    expect(await count('sync_change_log')).toBe(1);
    expect(await count('sync_mutation_results')).toBe(3);
    expect(await trimExpiredSyncRecords(database.db, NOW)).toEqual({
      purged: 2,
      changeLogs: 1,
      mutationResults: 1,
      minAvailableCursor: 1001,
    });
    const watermark = (await database.pool.query('SELECT * FROM sync_retention_state')).rows;
    expect(await trimExpiredSyncRecords(database.db, NOW)).toEqual({
      purged: 0,
      changeLogs: 0,
      mutationResults: 0,
      minAvailableCursor: 1001,
    });
    expect((await database.pool.query('SELECT * FROM sync_retention_state')).rows).toEqual(
      watermark,
    );
    expect((await database.pool.query('SELECT * FROM sync_devices')).rows).toEqual(initialDevices);
    expect(
      (await database.pool.query('SELECT entity_id FROM sync_mutation_results ORDER BY entity_id'))
        .rows,
    ).toEqual([{ entity_id: 'keep-other-device' }, { entity_id: 'keep-other-owner' }]);
  });

  it('rolls back already-deleted sync logs when mutation cleanup fails, then retries the whole batch', async () => {
    await database.pool.query(
      `INSERT INTO sync_change_log(user_id,entity_type,entity_id,operation,version,snapshot,created_at)
       VALUES ('batch-owner','prompt','old','delete',1,'{}',$1)`,
      [createdAt],
    );
    await database.pool.query(
      `INSERT INTO sync_mutation_results(user_id,device_id,mutation_id,entity_type,entity_id,result_status,created_at)
       VALUES ('batch-owner','device','old','prompt','old','applied',$1)`,
      [createdAt],
    );
    await database.pool.query(`INSERT INTO sync_retention_state(min_available_cursor) VALUES (0)`);
    const before = (await database.pool.query('SELECT * FROM sync_retention_state')).rows;
    await database.pool.query(`CREATE FUNCTION reject_retention_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic retention failure'; END $$;
      CREATE TRIGGER reject_retention_delete BEFORE DELETE ON sync_mutation_results
      FOR EACH ROW EXECUTE FUNCTION reject_retention_delete()`);
    try {
      await expect(trimExpiredSyncRecords(database.db, NOW)).rejects.toMatchObject({
        cause: { code: 'P0001' },
      });
      expect(await count('sync_change_log')).toBe(1);
      expect(await count('sync_mutation_results')).toBe(1);
      expect((await database.pool.query('SELECT * FROM sync_retention_state')).rows).toEqual(
        before,
      );
    } finally {
      await database.pool.query('DROP FUNCTION reject_retention_delete() CASCADE');
    }
    expect(await trimExpiredSyncRecords(database.db, NOW)).toEqual({
      purged: 2,
      changeLogs: 1,
      mutationResults: 1,
      minAvailableCursor: 1,
    });
  });

  it('rolls back usage deletion when a prompt cannot be deleted, then preserves unrelated usage on retry', async () => {
    await database.pool.query(
      `INSERT INTO prompts(id,user_id,title,content,deleted_at) VALUES ('old','batch-owner','Old','Keep',$1)`,
      [deletedAt],
    );
    await database.pool.query(`INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action)
      VALUES ('batch-owner','old-event','old','copy'),('batch-other','keep-event','other','copy')`);
    const usage = (await database.pool.query('SELECT * FROM prompt_usage_events ORDER BY event_id'))
      .rows;
    await database.pool.query(`CREATE FUNCTION reject_retention_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic retention failure'; END $$;
      CREATE TRIGGER reject_retention_delete BEFORE DELETE ON prompts
      FOR EACH ROW EXECUTE FUNCTION reject_retention_delete()`);
    try {
      await expect(purgeExpiredSoftDeletedPrompts(database.db, NOW)).rejects.toMatchObject({
        cause: { code: 'P0001' },
      });
      expect(await count('prompts')).toBe(1);
      expect(
        (await database.pool.query('SELECT * FROM prompt_usage_events ORDER BY event_id')).rows,
      ).toEqual(usage);
    } finally {
      await database.pool.query('DROP FUNCTION reject_retention_delete() CASCADE');
    }
    expect(await purgeExpiredSoftDeletedPrompts(database.db, NOW)).toEqual({ purged: 1 });
    expect((await database.pool.query('SELECT * FROM prompt_usage_events')).rows).toEqual([
      usage.find((row) => row.event_id === 'keep-event'),
    ]);
  });

  it.each(['prompts', 'generation_runs', 'sync_change_log'] as const)(
    'concurrent maintenance of %s counts each deleted row once and leaves a resumable backlog',
    async (table) => {
      if (table === 'prompts')
        await database.pool.query(
          `INSERT INTO prompts(id,user_id,title,content,deleted_at)
          SELECT 'old-'||lpad(n::text,4,'0'),'batch-owner','Old','Keep',$1 FROM generate_series(1,2001) n`,
          [deletedAt],
        );
      if (table === 'generation_runs')
        await database.pool.query(
          `INSERT INTO generation_runs(id,user_id,status,request,deleted_at)
          SELECT 'old-'||lpad(n::text,4,'0'),'batch-owner','succeeded','{}',$1 FROM generate_series(1,2001) n`,
          [deletedAt],
        );
      if (table === 'sync_change_log')
        await database.pool.query(
          `INSERT INTO sync_change_log(user_id,entity_type,entity_id,operation,version,snapshot,created_at)
          SELECT 'batch-owner','prompt','old-'||n,'delete',1,'{}',$1 FROM generate_series(1,2001) n`,
          [createdAt],
        );
      const execute = () =>
        table === 'prompts'
          ? purgeExpiredSoftDeletedPrompts(database.db, NOW)
          : table === 'generation_runs'
            ? purgeExpiredSoftDeletedRuns(database.db, NOW)
            : trimExpiredSyncRecords(database.db, NOW);
      const results = await Promise.all([execute(), execute()]);
      expect(results.every((result) => result.purged >= 0 && result.purged <= 1000)).toBe(true);
      const removed = results.reduce((total, result) => total + result.purged, 0);
      expect(removed).toBeGreaterThanOrEqual(1000);
      expect(await count(table)).toBe(2001 - removed);
      let continued = 0;
      for (let attempt = 0; attempt < 3; attempt++) continued += (await execute()).purged;
      expect(removed + continued).toBe(2001);
      expect(await count(table)).toBe(0);
      expect((await execute()).purged).toBe(0);
      if (table === 'sync_change_log')
        expect(
          (await database.pool.query('SELECT min_available_cursor FROM sync_retention_state')).rows,
        ).toEqual([{ min_available_cursor: '2001' }]);
    },
  );

  it.each(['prompts', 'generation_runs', 'sync_change_log'] as const)(
    'bounds lock waiting for %s, rolls back and permits a later retry',
    async (table) => {
      const at = table === 'sync_change_log' ? createdAt : deletedAt;
      if (table === 'prompts')
        await database.pool.query(
          `INSERT INTO prompts(id,user_id,title,content,deleted_at) VALUES ('held','batch-owner','Held','Keep',$1)`,
          [at],
        );
      if (table === 'generation_runs')
        await database.pool.query(
          `INSERT INTO generation_runs(id,user_id,status,request,deleted_at) VALUES ('held','batch-owner','succeeded','{}',$1)`,
          [at],
        );
      if (table === 'sync_change_log')
        await database.pool.query(
          `INSERT INTO sync_change_log(user_id,entity_type,entity_id,operation,version,snapshot,created_at) VALUES ('batch-owner','prompt','held','delete',1,'{}',$1)`,
          [at],
        );
      const execute = () =>
        table === 'prompts'
          ? purgeExpiredSoftDeletedPrompts(database.db, NOW)
          : table === 'generation_runs'
            ? purgeExpiredSoftDeletedRuns(database.db, NOW)
            : trimExpiredSyncRecords(database.db, NOW);
      const holder = await database.pool.connect();
      let pending: Promise<{ code?: string }> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const originalTimeout = (await database.pool.query('SHOW lock_timeout')).rows;
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT * FROM ${table} FOR UPDATE`);
        pending = execute().then(
          () => ({ code: 'unexpected-success' }),
          (error: unknown) => ({
            code: (error as { cause?: { code?: string } }).cause?.code,
          }),
        );
        const outcome = await Promise.race([
          pending,
          new Promise<{ code: string }>((resolve) => {
            timer = setTimeout(() => resolve({ code: 'probe-deadline-exceeded' }), 4000);
          }),
        ]);
        expect(outcome).toEqual({ code: '55P03' });
        expect(await count(table)).toBe(1);
        await holder.query('COMMIT');
        expect((await execute()).purged).toBe(1);
        expect(await count(table)).toBe(0);
        expect((await database.pool.query('SHOW lock_timeout')).rows).toEqual(originalTimeout);
      } finally {
        clearTimeout(timer);
        await holder.query('ROLLBACK');
        holder.release();
        await pending;
      }
    },
    10_000,
  );
});
