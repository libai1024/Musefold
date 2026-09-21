import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { retireUnprotectedObjects } from '../object-retirement.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('retirement and publication coordinate actual PostgreSQL transactions', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    await database.pool.query(`
      INSERT INTO "user"(id,name,email) VALUES ('retirement-owner','Owned','retirement@example.test');
      INSERT INTO generation_runs(id,user_id,status,request) VALUES ('retirement-run','retirement-owner','succeeded','{}');
    `);
  }, 180000);
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  const assetSql = `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,checksum_sha256)
    VALUES($1,'retirement-run','retirement-owner',$2,'image/png',1,1,repeat('a',64))`;
  const retireSql = `INSERT INTO object_key_retirements(key_hash) VALUES(encode(sha256(convert_to($1,'UTF8')),'hex'))`;
  const retired = async (key: string) =>
    (
      await database.pool.query(
        `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [key],
      )
    ).rows;
  async function waitForLock(pid?: number) {
    await expect
      .poll(
        async () =>
          (
            await database.pool.query(
              `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event='advisory' AND ($1::int IS NULL OR pid=$1)`,
              [pid ?? null],
            )
          ).rows[0].n,
        { timeout: 1500, interval: 20 },
      )
      .toBeGreaterThan(0);
  }

  it('waits for a pending publication then reads the committed reference before retiring', async () => {
    const client = await database.pool.connect();
    const key = `users/retirement-owner/references/${randomUUID()}`;
    let pending: ReturnType<typeof retireUnprotectedObjects> | undefined;
    try {
      await client.query('BEGIN');
      await client.query(assetSql, [randomUUID(), key]);
      pending = retireUnprotectedObjects(database.db, [key]);
      void pending.catch(() => undefined);
      await waitForLock();
      await client.query('COMMIT');
      expect(await pending).toEqual({ permanent: [key], leased: [] });
      expect(await retired(key)).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      await pending?.catch(() => undefined);
      client.release();
    }
  });

  it.each(['COMMIT', 'ROLLBACK'] as const)(
    'resolves a waiting publisher from the retirement transaction %s',
    async (finish) => {
      const collector = await database.pool.connect();
      const publisher = await database.pool.connect();
      const key = `users/retirement-owner/references/${randomUUID()}`;
      let publication: Promise<{ error?: { code: string; message: string } }> | undefined;
      try {
        const pid = (await publisher.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await collector.query('BEGIN');
        await collector.query('SELECT musefold_lock_storage_key($1)', [key]);
        await collector.query(retireSql, [key]);
        publication = publisher.query(assetSql, [randomUUID(), key]).then(
          () => ({}),
          (error) => ({ error }),
        );
        await waitForLock(pid);
        await collector.query(finish);
        if (finish === 'COMMIT') {
          expect(await publication).toMatchObject({
            error: { code: 'P0001', message: 'ObjectStorageKeyRetired' },
          });
          expect(await retired(key)).toHaveLength(1);
        } else {
          expect(await publication).toEqual({});
          expect(await retired(key)).toEqual([]);
          expect(await retireUnprotectedObjects(database.db, [key])).toEqual({
            permanent: [key],
            leased: [],
          });
        }
      } finally {
        await collector.query('ROLLBACK');
        await publication;
        collector.release();
        publisher.release();
      }
    },
  );

  it('bounds a busy writer wait and rolls the complete retirement batch back', async () => {
    const client = await database.pool.connect();
    const keys = [
      `users/retirement-owner/references/aaa-${randomUUID()}`,
      `users/retirement-owner/references/zzz-${randomUUID()}`,
    ];
    try {
      await client.query('BEGIN');
      await client.query('SELECT musefold_lock_storage_key($1)', [keys[1]]);
      await expect(retireUnprotectedObjects(database.db, keys)).rejects.toMatchObject({
        cause: { code: '55P03' },
      });
      expect(await retired(keys[0])).toEqual([]);
      expect(await retired(keys[1])).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
