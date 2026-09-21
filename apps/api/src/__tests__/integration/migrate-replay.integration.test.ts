import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type MusefoldDatabase, createDatabase, migrateDatabase } from '@musefold/db';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';
const describeDb = runDatabaseTests ? describe : describe.skip;

/**
 * Q03 增量:空库走 migrateDatabase(0000→latest)后再立刻回放。
 * 只断言 drizzle 账本幂等,不碰业务数据、不改 migrations SQL。
 */
describeDb('PG migrate replay(空库 0000→latest 再幂等回放)', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const created = createDatabase(container.getConnectionUri(), { max: 5 });
    db = created.db;
    pool = created.pool;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function drizzleMigrationCount(): Promise<number> {
    const { rows } = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
    );
    return rows[0]?.count ?? 0;
  }

  it('fresh migrate 后再 replay 不抛错,且 __drizzle_migrations 行数相同且 > 0', async () => {
    await expect(migrateDatabase(db)).resolves.toBeUndefined();
    const first = await drizzleMigrationCount();
    expect(first).toBeGreaterThan(0);

    await expect(migrateDatabase(db)).resolves.toBeUndefined();
    const second = await drizzleMigrationCount();
    expect(second).toBe(first);
  });
});
