import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { retireUnprotectedObjects } from '../object-retirement.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('reference publication pins the registry key until commit', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    await database.pool.query(`INSERT INTO "user"(id,name,email) VALUES('link-owner','Owned','link@example.test');
      INSERT INTO generation_runs(id,user_id,status,request) VALUES('link-run','link-owner','succeeded','{}')`);
  }, 180000);
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  const insertLink = (id: string) =>
    database.pool.query(
      "INSERT INTO generation_reference_links(run_id,reference_id,user_id) VALUES('link-run',$1,'link-owner')",
      [id],
    );
  async function seed(status = 'available') {
    const id = randomUUID(),
      key = `users/link-owner/references/${randomUUID()}`;
    await database.pool.query(
      `INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      VALUES($1,'link-owner',$2,'owned.png','image/png',4,$3,now()-interval '1 day')`,
      [id, key, status],
    );
    return { id, key };
  }
  it('blocks registry key mutation while a new link waits for its object key lock', async () => {
    const { id, key } = await seed();
    const holder = await database.pool.connect(),
      linker = await database.pool.connect(),
      updater = await database.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      const pid = (await linker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await holder.query('BEGIN');
      await holder.query('SELECT musefold_lock_storage_key($1)', [key]);
      pending = linker.query(
        "INSERT INTO generation_reference_links(run_id,reference_id,user_id) VALUES('link-run',$1,'link-owner')",
        [id],
      );
      void pending.catch(() => undefined);
      await expect
        .poll(
          async () =>
            (
              await database.pool.query('SELECT wait_event FROM pg_stat_activity WHERE pid=$1', [
                pid,
              ])
            ).rows[0]?.wait_event,
          { timeout: 1500, interval: 20 },
        )
        .toBe('advisory');
      await updater.query("SET lock_timeout='250ms'");
      await expect(
        updater.query('UPDATE generation_reference_uploads SET object_key=$2 WHERE id=$1', [
          id,
          `${key}-replacement`,
        ]),
      ).rejects.toMatchObject({ code: '55P03' });
      await holder.query('COMMIT');
      await pending;
      expect(
        (
          await database.pool.query(
            'SELECT object_key FROM generation_reference_uploads WHERE id=$1',
            [id],
          )
        ).rows,
      ).toEqual([{ object_key: key }]);
      expect(await retireUnprotectedObjects(database.db, [key])).toEqual({
        permanent: [key],
        leased: [],
      });
    } finally {
      await holder.query('ROLLBACK');
      await pending?.catch(() => undefined);
      holder.release();
      linker.release();
      updater.release();
    }
  });
  it('rejects moving an inactive but referenced registry onto a retired key', async () => {
    const { id, key } = await seed('cleanup_pending');
    await insertLink(id);
    const retired = `users/link-owner/references/${randomUUID()}`;
    expect(await retireUnprotectedObjects(database.db, [retired])).toEqual({
      permanent: [],
      leased: [],
    });
    await expect(
      database.pool.query('UPDATE generation_reference_uploads SET object_key=$2 WHERE id=$1', [
        id,
        retired,
      ]),
    ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
    expect(
      (
        await database.pool.query(
          'SELECT object_key FROM generation_reference_uploads WHERE id=$1',
          [id],
        )
      ).rows,
    ).toEqual([{ object_key: key }]);
    expect(await retireUnprotectedObjects(database.db, [key])).toEqual({
      permanent: [key],
      leased: [],
    });
  });
  it('allows cleanup state changes on a valid referenced object while preserving its protection', async () => {
    const { id, key } = await seed();
    await insertLink(id);
    await database.pool.query(
      "UPDATE generation_reference_uploads SET status='cleanup_pending' WHERE id=$1",
      [id],
    );
    expect(await retireUnprotectedObjects(database.db, [key])).toEqual({
      permanent: [key],
      leased: [],
    });
  });
});
