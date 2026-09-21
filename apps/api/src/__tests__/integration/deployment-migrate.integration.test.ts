import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION_LOCK, runDeploymentMigrations } from '../../deployment/migrate.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const release = 'a'.repeat(40);

describeDb('controlled v2.5 release migration: real PostgreSQL and CLI', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let environment: NodeJS.ProcessEnv;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    environment = {
      MIGRATION_DATABASE_URL: container.getConnectionUri(),
      MIGRATION_RELEASE: release,
    };
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function ledgers() {
    const result = await pool.query(`select
      (select count(*)::int from drizzle.__drizzle_migrations) as application,
      (select count(*)::int from graphile_worker.migrations) as queue`);
    return result.rows[0];
  }

  it('rejects a competing release before creating either schema and later retries cleanly', async () => {
    const owner = await pool.connect();
    try {
      await owner.query('select pg_advisory_lock($1, $2)', [...MIGRATION_LOCK]);
      await expect(runDeploymentMigrations(environment)).rejects.toThrow(
        'MIGRATION_ALREADY_RUNNING',
      );
      expect(
        (
          await pool.query(
            "select to_regnamespace('drizzle') as application, to_regnamespace('graphile_worker') as queue",
          )
        ).rows[0],
      ).toEqual({ application: null, queue: null });
    } finally {
      await owner.query('select pg_advisory_unlock($1, $2)', [...MIGRATION_LOCK]);
      owner.release();
    }
    await expect(runDeploymentMigrations(environment)).resolves.toEqual({
      status: 'migrated',
      release,
    });
    const first = await ledgers();
    expect(first.application).toBeGreaterThan(0);
    expect(first.queue).toBeGreaterThan(0);
    await expect(runDeploymentMigrations(environment)).resolves.toEqual({
      status: 'migrated',
      release,
    });
    expect(await ledgers()).toEqual(first);
  }, 60_000);

  it('releases the lock after DDL failure without claiming success', async () => {
    await pool.query('create database denied');
    await pool.query("create role denied_role login password 'synthetic-denied'");
    const url = new URL(container.getConnectionUri());
    url.pathname = '/denied';
    const admin = new pg.Pool({ connectionString: url.href });
    try {
      await admin.query('revoke create on schema public from public');
      url.username = 'denied_role';
      url.password = 'synthetic-denied';
      await expect(
        runDeploymentMigrations({ ...environment, MIGRATION_DATABASE_URL: url.href }),
      ).rejects.toThrow();
      const client = await admin.connect();
      try {
        expect(
          (
            await client.query('select pg_try_advisory_lock($1, $2) as acquired', [
              ...MIGRATION_LOCK,
            ])
          ).rows[0].acquired,
        ).toBe(true);
        await client.query('select pg_advisory_unlock($1, $2)', [...MIGRATION_LOCK]);
        expect(
          (await client.query("select to_regnamespace('drizzle') as application")).rows[0]
            .application,
        ).toBeNull();
      } finally {
        client.release();
      }
    } finally {
      await admin.end();
    }
  }, 30_000);

  it('runs the production entry, reports only identity and exits after closing connections', async () => {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('../../migrate-bin.ts', import.meta.url))],
        {
          env: { ...process.env, ...environment },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.once('error', reject);
      child.once('exit', (code) => resolve({ code, output }));
    });
    expect(result.code).toBe(0);
    expect(result.output.trim()).toBe(JSON.stringify({ status: 'migrated', release }));
    expect(result.output).not.toContain(container.getPassword());
  }, 30_000);
});
