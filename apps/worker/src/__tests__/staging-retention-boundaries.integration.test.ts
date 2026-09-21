import {
  createDatabase,
  migrateDatabase,
  retireDesignSchemePackageStages,
  retireDesignSchemeSourcePreparations,
} from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { maintenanceFacts, seedMaintenanceMatrix } from './fixtures/maintenance-matrix.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('staging retirement backlog and child-reference lock boundaries', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 2 });
    await migrateDatabase(database.db);
  }, 180_000);
  beforeEach(async () => {
    await database.pool.query(
      'TRUNCATE "user",object_cleanup_queue,sync_retention_state,rate_limit_buckets RESTART IDENTITY CASCADE',
    );
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  it.each(['package', 'source'] as const)(
    'retires only 100 of 1001 %s preparations per call and preserves future owner peers',
    async (kind) => {
      await database.pool.query(
        `INSERT INTO "user"(id,name,email) VALUES ('backlog-owner','Owned','backlog@example.test'),('other-owner','Other','other@example.test')`,
      );
      if (kind === 'package') {
        await database.pool.query(`INSERT INTO design_scheme_package_stages
        (id,user_id,request_id,request_hash,package_hash,byte_size,format_version,parser_version,object_key,status,authority_hash,expires_at)
        SELECT 'item-'||lpad(n::text,4,'0'),'backlog-owner','request-'||n,repeat('a',64),repeat('b',64),4,2,1,'packages/owned/'||n,'awaiting_upload',repeat('c',64),now()-interval '1 day' FROM generate_series(1,1001) n`);
        await database.pool.query(`INSERT INTO design_scheme_package_stages
        (id,user_id,request_id,request_hash,package_hash,byte_size,format_version,parser_version,object_key,status,authority_hash,expires_at)
        VALUES ('future-peer','other-owner','request-1',repeat('a',64),repeat('b',64),4,2,1,'packages/future','awaiting_upload',repeat('c',64),now()+interval '1 day')`);
      } else {
        await database.pool.query(`INSERT INTO design_scheme_source_preparations(user_id,execution_id,confirmation_id,request_hash,request,status,expires_at)
        SELECT 'backlog-owner','item-'||lpad(n::text,4,'0'),'confirmation-'||n,repeat('a',64),'{}','queued',now()-interval '1 day' FROM generate_series(1,1001) n`);
        await database.pool.query(`INSERT INTO design_scheme_source_preparations(user_id,execution_id,confirmation_id,request_hash,request,status,expires_at)
        VALUES ('other-owner','item-0001','confirmation-1',repeat('a',64),'{}','queued',now()+interval '1 day')`);
      }
      const table =
        kind === 'package' ? 'design_scheme_package_stages' : 'design_scheme_source_preparations';
      const peer = (await database.pool.query(`SELECT * FROM ${table} WHERE user_id='other-owner'`))
        .rows;
      const execute = () =>
        kind === 'package'
          ? retireDesignSchemePackageStages(database.db)
          : retireDesignSchemeSourcePreparations(database.db);
      for (let batch = 0; batch < 11; batch++) {
        expect(await execute()).toBe(batch === 10 ? 1 : 100);
        expect(
          Number(
            (await database.pool.query(`SELECT count(*) AS n FROM ${table} WHERE status='expired'`))
              .rows[0].n,
          ),
        ).toBe(Math.min(1001, (batch + 1) * 100));
        expect(
          (await database.pool.query(`SELECT * FROM ${table} WHERE user_id='other-owner'`)).rows,
        ).toEqual(peer);
      }
      expect(await execute()).toBe(0);
      const queued = (
        await database.pool.query('SELECT object_key,owner_id FROM object_cleanup_queue')
      ).rows;
      expect(queued).toHaveLength(kind === 'package' ? 1001 : 0);
      for (const row of queued) expect(row.owner_id).toBe('backlog-owner');
    },
    30000,
  );

  it.each(['package', 'source'] as const)(
    'bounds %s child-row lock waits, rolls back all changes and permits retry',
    async (kind) => {
      await seedMaintenanceMatrix(database.pool);
      const before = await maintenanceFacts(database.pool);
      const originalTimeout = (await database.pool.query('SHOW lock_timeout')).rows;
      const holder = await database.pool.connect();
      const execute = () =>
        kind === 'package'
          ? retireDesignSchemePackageStages(database.db)
          : retireDesignSchemeSourcePreparations(database.db);
      let pending: Promise<{ code?: string }> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await holder.query('BEGIN');
        if (kind === 'package')
          await holder.query(
            "SELECT * FROM generation_reference_uploads WHERE id='package-expired' FOR UPDATE",
          );
        else
          await holder.query(
            "SELECT * FROM design_scheme_source_files WHERE snapshot_id='source-expired' FOR UPDATE",
          );
        pending = execute().then(
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
        expect(await maintenanceFacts(database.pool)).toEqual(before);
        // With max=2 and one connection still held, this is the same operation connection.
        expect((await database.pool.query('SHOW lock_timeout')).rows).toEqual(originalTimeout);
        await holder.query('COMMIT');
        expect(await execute()).toBe(1);
        expect(await execute()).toBe(0);
      } finally {
        if (timer) clearTimeout(timer);
        await holder.query('ROLLBACK');
        await pending;
        holder.release();
      }
    },
    15000,
  );
});
