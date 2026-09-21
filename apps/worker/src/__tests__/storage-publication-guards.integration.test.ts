import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedStoragePublicationMatrix } from './fixtures/storage-publication.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('migrated storage publication guards cover canonical and lease writers', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  const retired = `users/owned-maintenance/references/${randomUUID()}`;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    await seedStoragePublicationMatrix(database.pool);
    await database.pool.query(
      "INSERT INTO object_key_retirements(key_hash) VALUES(encode(sha256(convert_to($1,'UTF8')),'hex'))",
      [retired],
    );
  }, 180000);
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  it.each([
    'generation_assets',
    'design_scheme_assets',
    'design_scheme_source_files',
    'design_scheme_generation_references',
    'generation_reference_uploads',
    'design_scheme_package_stages',
    'design_scheme_package_exports',
  ])('rejects a retired object in %s without changing prior rows', async (table) => {
    const before = (
      await database.pool.query(`SELECT object_key FROM ${table} ORDER BY object_key`)
    ).rows;
    expect(before.length).toBeGreaterThan(0);
    await expect(
      database.pool.query(`UPDATE ${table} SET object_key=$1`, [retired]),
    ).rejects.toMatchObject({
      code: 'P0001',
      message: 'ObjectStorageKeyRetired',
    });
    expect(
      (await database.pool.query(`SELECT object_key FROM ${table} ORDER BY object_key`)).rows,
    ).toEqual(before);
  });

  it('allows an inactive upload cleanup record but rejects reactivation or a new reference link', async () => {
    await database.pool.query(
      `UPDATE generation_reference_uploads SET status='cleanup_pending',object_key=$1 WHERE id='reference-expired'`,
      [retired],
    );
    await expect(
      database.pool.query(
        `INSERT INTO generation_reference_links(run_id,reference_id,user_id) SELECT id,'reference-expired',user_id FROM generation_runs LIMIT 1`,
      ),
    ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
    await expect(
      database.pool.query(
        `UPDATE generation_reference_uploads SET status='available',expires_at=now()+interval '1 day' WHERE id='reference-expired'`,
      ),
    ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
    expect(
      (
        await database.pool.query(
          `SELECT status FROM generation_reference_uploads WHERE id='reference-expired'`,
        )
      ).rows,
    ).toEqual([{ status: 'cleanup_pending' }]);
  });

  it('rejects an expired import renewal while preserving a new attempt namespace', async () => {
    await expect(
      database.pool.query(
        `UPDATE design_scheme_package_imports SET lease_until=now()+interval '1 day'`,
      ),
    ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageLeaseExpired' });
    const attempt = randomUUID();
    await database.pool.query(
      `UPDATE design_scheme_package_imports SET epoch=epoch+1,attempt_id=$1,lease_until=now()+interval '1 day'`,
      [attempt],
    );
    expect(
      (await database.pool.query('SELECT epoch,attempt_id FROM design_scheme_package_imports'))
        .rows,
    ).toEqual([{ epoch: 2, attempt_id: attempt }]);
  });

  it('rejects an expired generation renewal without blocking a new epoch', async () => {
    await database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request,attempt_count,lease_expires_at) VALUES('expired-epoch','owned-maintenance','running','{}',1,now()-interval '1 second')`,
    );
    await expect(
      database.pool.query(
        `UPDATE generation_runs SET lease_expires_at=now()+interval '1 day' WHERE id='expired-epoch'`,
      ),
    ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageLeaseExpired' });
    await database.pool.query(
      `UPDATE generation_runs SET attempt_count=attempt_count+1,lease_expires_at=now()+interval '1 day' WHERE id='expired-epoch'`,
    );
    expect(
      (
        await database.pool.query(
          `SELECT attempt_count FROM generation_runs WHERE id='expired-epoch'`,
        )
      ).rows,
    ).toEqual([{ attempt_count: 2 }]);
  });
});
