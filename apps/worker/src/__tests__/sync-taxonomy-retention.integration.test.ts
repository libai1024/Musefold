import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase, SYNC_RETENTION_MS } from '@musefold/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trimExpiredSyncRecords } from '../sync-retention.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const NOW = new Date('2026-09-13T00:00:00.000Z');
describeDb('taxonomy deletion identities survive exact90day PG retention boundaries', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 3 });
    await migrateDatabase(database.db);
  }, 180000);
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  it('trims log/receipt at cutoff inclusively, keeps newer rows, and never trims either owner’s minimal deletion identity', async () => {
    await database.pool.query(
      `INSERT INTO "user"(id,name,email) VALUES ('retention-a','Synthetic A','ra@example.test'),('retention-b','Synthetic B','rb@example.test')`,
    );
    await database.pool.query(
      `INSERT INTO sync_taxonomy_tombstones(user_id,entity_type,entity_id,version,entity_created_at,deleted_at)
      VALUES ('retention-a','folder','same-id',7,$1,$2),('retention-b','folder','same-id',9,$1,$2),
      ('retention-a','tag','same-id',8,$1,$2)`,
      [new Date(NOW.getTime() - 100 * 86400000), new Date(NOW.getTime() - 91 * 86400000)],
    );
    for (const [id, offset] of [
      ['older', -1],
      ['boundary', 0],
      ['newer', 1],
    ] as const) {
      const created = new Date(NOW.getTime() - SYNC_RETENTION_MS + offset);
      await database.pool.query(
        `INSERT INTO sync_change_log(user_id,entity_type,entity_id,operation,version,snapshot,created_at)
        VALUES ('retention-a','folder',$1,'delete',2,'{}',$2)`,
        [id, created],
      );
      await database.pool.query(
        `INSERT INTO sync_mutation_results(user_id,device_id,mutation_id,entity_type,entity_id,result_status,created_at)
        VALUES ('retention-a','historical-device',$1,'folder',$1,'applied',$2)`,
        [id, created],
      );
    }
    const before = (
      await database.pool.query(
        'SELECT * FROM sync_taxonomy_tombstones ORDER BY user_id,entity_type',
      )
    ).rows;
    expect(Object.keys(before[0]).sort()).toEqual([
      'deleted_at',
      'entity_created_at',
      'entity_id',
      'entity_type',
      'user_id',
      'version',
    ]);
    expect(await trimExpiredSyncRecords(database.db, new Date(NOW.getTime() - 2))).toMatchObject({
      purged: 0,
    });
    expect(await trimExpiredSyncRecords(database.db, new Date(NOW.getTime() - 1))).toMatchObject({
      purged: 2,
      changeLogs: 1,
      mutationResults: 1,
    });
    const atBoundary = await trimExpiredSyncRecords(database.db, NOW);
    expect(atBoundary).toMatchObject({ purged: 2, changeLogs: 1, mutationResults: 1 });
    expect((await database.pool.query('SELECT entity_id FROM sync_change_log')).rows).toEqual([
      { entity_id: 'newer' },
    ]);
    expect(
      (await database.pool.query('SELECT mutation_id FROM sync_mutation_results')).rows,
    ).toEqual([{ mutation_id: 'newer' }]);
    const watermark = (await database.pool.query('SELECT * FROM sync_retention_state')).rows;
    expect(await trimExpiredSyncRecords(database.db, NOW)).toEqual({
      ...atBoundary,
      purged: 0,
      changeLogs: 0,
      mutationResults: 0,
    });
    expect((await database.pool.query('SELECT * FROM sync_retention_state')).rows).toEqual(
      watermark,
    );
    const after = (
      await database.pool.query(
        'SELECT * FROM sync_taxonomy_tombstones ORDER BY user_id,entity_type',
      )
    ).rows;
    expect(after).toEqual(before);
  });
});
