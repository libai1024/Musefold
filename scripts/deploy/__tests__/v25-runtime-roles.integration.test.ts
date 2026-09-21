import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDisposableObjectStorage } from '../../../apps/worker/src/__tests__/fixtures/disposable-object-storage.js';

const describeImage = process.env.RUN_V25_IMAGE_TESTS === 'true' ? describe : describe.skip;
const execute = promisify(execFile);
const roles = ['musefold_v25_api', 'musefold_v25_worker', 'musefold_v25_agent'] as const;
const passwords = [
  'synthetic-api-password',
  'synthetic-worker-password',
  'synthetic-agent-password',
];

describeImage('v2.5 isolated actual image runtime roles without DDL ownership', () => {
  let postgres: StartedPostgreSqlContainer;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  let directory: string;
  let apiImage: string;
  let workerImage: string;
  let grants: string;
  const containers: string[] = [];
  async function docker(...args: string[]) {
    return (
      await execute('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024 })
    ).stdout.trim();
  }
  function url(role: string, password: string, inContainer = false) {
    const target = new URL(postgres.getConnectionUri());
    target.username = role;
    target.password = password;
    target.pathname = '/v25_roles';
    if (inContainer) target.hostname = 'host.docker.internal';
    return target.href;
  }
  async function query(connectionString: string, statement: string, values?: unknown[]) {
    const client = new pg.Client({ connectionString });
    let connectionError: Error | undefined;
    client.on('error', (error) => {
      connectionError ??= error;
    });
    let result: pg.QueryResult;
    try {
      await client.connect();
      result = await client.query(statement, values);
    } finally {
      await client.end();
    }
    if (connectionError) throw connectionError;
    return result;
  }
  const migrationUrl = (inContainer = false) =>
    url('musefold_v25_migration', 'synthetic-migration-password', inContainer);
  async function envFile(name: string, environment: Record<string, string>) {
    const file = join(directory, `${name}.env`);
    await writeFile(
      file,
      Object.entries(environment)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      { mode: 0o600 },
    );
    return file;
  }
  beforeAll(async () => {
    apiImage = process.env.V25_API_IMAGE ?? '';
    workerImage = process.env.WORKER_CONTAINER_IMAGE ?? '';
    for (const image of [apiImage, workerImage])
      if (!/^sha256:[a-f0-9]{64}$/.test(image))
        throw new Error('Exact API and worker image IDs required');
    directory = await mkdtemp(join(tmpdir(), 'musefold-v25-roles-'));
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
    await query(
      postgres.getConnectionUri(),
      "CREATE ROLE musefold_v25_migration LOGIN PASSWORD 'synthetic-migration-password'",
    );
    await query(
      postgres.getConnectionUri(),
      'CREATE DATABASE v25_roles OWNER musefold_v25_migration',
    );
    for (let index = 0; index < roles.length; index++) {
      await query(
        postgres.getConnectionUri(),
        `CREATE ROLE ${roles[index]} LOGIN PASSWORD '${passwords[index]}'`,
      );
    }
    const migrationEnv = await envFile('migration', {
      MIGRATION_DATABASE_URL: migrationUrl(true),
      MIGRATION_RELEASE: 'a'.repeat(40),
    });
    const output = await docker(
      'run',
      '--rm',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=128m,mode=1777',
      '--add-host',
      'host.docker.internal:host-gateway',
      '--env-file',
      migrationEnv,
      apiImage,
      './node_modules/.bin/tsx',
      'src/migrate-bin.ts',
    );
    expect(JSON.parse(output).status).toBe('migrated');
    grants = await readFile(
      new URL('../../../infra/v2.5/runtime-grants.sql', import.meta.url),
      'utf8',
    );
    await query(migrationUrl(), grants);
    await query(migrationUrl(), grants);
    storage = await createDisposableObjectStorage();
  }, 180000);
  afterAll(async () => {
    for (const id of containers.reverse()) await docker('rm', '--force', id);
    await storage?.close();
    await postgres?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it.each(roles)(
    '%s can use runtime data but cannot own schema or rewrite migration ledgers',
    async (role) => {
      const connection = url(role, passwords[roles.indexOf(role)]);
      expect((await query(connection, 'SELECT count(*)::int AS n FROM prompts')).rows[0].n).toBe(0);
      for (const statement of [
        'CREATE TABLE public.unauthorized (id integer)',
        'CREATE SCHEMA unauthorized',
        'DELETE FROM drizzle.__drizzle_migrations',
        'DELETE FROM graphile_worker.migrations',
        'TRUNCATE prompts',
      ])
        await expect(query(connection, statement)).rejects.toMatchObject({ code: '42501' });
    },
  );

  it('rejects an unsafe runtime role before applying any grants', async () => {
    await query(postgres.getConnectionUri(), 'ALTER ROLE musefold_v25_api CREATEDB');
    try {
      await expect(query(migrationUrl(), grants)).rejects.toMatchObject({ code: 'P0001' });
    } finally {
      await query(postgres.getConnectionUri(), 'ALTER ROLE musefold_v25_api NOCREATEDB');
    }
  });

  it('keeps RLS enabled and rejects an unrelated role even with table DML grants', async () => {
    await query(
      postgres.getConnectionUri(),
      "CREATE ROLE unrelated_runtime LOGIN PASSWORD 'synthetic-unrelated-password'",
    );
    await query(
      migrationUrl(),
      `
      GRANT USAGE ON SCHEMA graphile_worker TO unrelated_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO unrelated_runtime;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA graphile_worker TO unrelated_runtime;
    `,
    );
    const unrelatedUrl = url('unrelated_runtime', 'synthetic-unrelated-password');
    await expect(
      query(unrelatedUrl, "SELECT graphile_worker.add_job('unrelated-task', '{}'::json)"),
    ).rejects.toMatchObject({ code: '42501' });
    const policies = await query(
      migrationUrl(),
      `
      SELECT c.relrowsecurity, p.polroles::oid[] AS roles
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='graphile_worker' AND p.polname='musefold_v25_runtime'
    `,
    );
    const ids = (
      await query(migrationUrl(), 'SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[])', [roles])
    ).rows
      .map((row) => row.oid)
      .sort();
    expect(policies.rows).toHaveLength(4);
    for (const policy of policies.rows) {
      expect(policy.relrowsecurity).toBe(true);
      expect(policy.roles.sort()).toEqual(ids);
    }
  });

  it('rejects ownership of a function, not just tables or schemas', async () => {
    const administrator = new URL(postgres.getConnectionUri());
    administrator.pathname = '/v25_roles';
    await query(
      administrator.href,
      `
      CREATE FUNCTION public.unsafe_owned_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
      ALTER FUNCTION public.unsafe_owned_function() OWNER TO musefold_v25_api;
    `,
    );
    try {
      await expect(query(migrationUrl(), grants)).rejects.toMatchObject({
        code: 'P0001',
        message: 'V25_RUNTIME_ROLE_UNSAFE_OR_MISSING',
      });
    } finally {
      await query(administrator.href, 'DROP FUNCTION public.unsafe_owned_function()');
    }
  });

  it('requires a new privilege review when the Graphile private schema changes', async () => {
    await query(
      migrationUrl(),
      `
      CREATE TABLE graphile_worker.unreviewed_queue (id integer);
      ALTER TABLE graphile_worker.unreviewed_queue ENABLE ROW LEVEL SECURITY;
    `,
    );
    try {
      await expect(query(migrationUrl(), grants)).rejects.toMatchObject({
        code: 'P0001',
        message: 'V25_GRAPHILE_SCHEMA_REVIEW_REQUIRED',
      });
      expect(
        (
          await query(
            migrationUrl(),
            "SELECT has_table_privilege('musefold_v25_api', 'graphile_worker.unreviewed_queue', 'SELECT') AS allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
    } finally {
      await query(migrationUrl(), 'DROP TABLE graphile_worker.unreviewed_queue');
    }
    await query(migrationUrl(), grants);
  });

  it('starts actual API and both worker images and acknowledges jobs with three separate runtime credentials', async () => {
    const endpoint = new URL(storage.endpoint);
    endpoint.hostname = 'host.docker.internal';
    for (let index = 0; index < roles.length; index++) {
      const role = roles[index];
      const file = await envFile(role, {
        NODE_ENV: 'production',
        PORT: '8787',
        PUBLIC_BASE_URL: 'https://runtime-fixture.example.test',
        DATABASE_URL: url(role, passwords[index], true),
        NEW_API_BASE_URL: 'https://unused-provider.invalid',
        BETTER_AUTH_SECRET: 'synthetic-runtime-auth-secret',
        CREDENTIAL_ENCRYPTION_KEY: 'synthetic-runtime-encryption-key',
        S3_ENDPOINT: endpoint.href,
        S3_REGION: 'us-east-1',
        S3_BUCKET: storage.bucket,
        S3_ACCESS_KEY_ID: 'gc-fixture-owner',
        S3_SECRET_ACCESS_KEY: 'synthetic-gc-storage-password',
      });
      const id = await docker(
        'create',
        '--name',
        `musefold-v25-role-${randomUUID()}`,
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=128m,mode=1777',
        '--add-host',
        'host.docker.internal:host-gateway',
        ...(index === 0 ? ['-p', '127.0.0.1::8787'] : []),
        '--env-file',
        file,
        index === 1 ? workerImage : apiImage,
        ...(index === 2 ? ['./node_modules/.bin/tsx', 'src/agent-worker-bin.ts'] : []),
      );
      containers.push(id);
      await docker('start', id);
      const ready = [
        '[api] listening',
        '[worker] generation worker started',
        '[scheme-agent] worker started',
      ][index];
      await expect.poll(async () => docker('logs', id), { timeout: 30000 }).toContain(ready);
    }
    const port = JSON.parse(
      await docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', containers[0]),
    )['8787/tcp'][0].HostPort;
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    const ids: string[] = [];
    for (const task of ['generation/reconcile', 'design-scheme-agent/reconcile']) {
      const result = await query(
        url(roles[0], passwords[0]),
        'SELECT (graphile_worker.add_job($1, $2::json, max_attempts := 1)).id',
        [task, '{}'],
      );
      ids.push(String(result.rows[0].id));
    }
    await expect
      .poll(
        async () =>
          (
            await query(
              migrationUrl(),
              'SELECT id FROM graphile_worker.jobs WHERE id=ANY($1::bigint[])',
              [ids],
            )
          ).rowCount,
        { timeout: 30000 },
      )
      .toBe(0);
    for (const id of containers) {
      const output = await docker('logs', id);
      for (const value of [
        ...passwords,
        'synthetic-migration-password',
        'synthetic-runtime-auth-secret',
      ])
        expect(output).not.toContain(value);
    }
    for (const id of containers.slice(1)) {
      await docker('stop', '--time', '10', id);
      expect(await docker('inspect', '--format', '{{.State.ExitCode}}', id)).toBe('0');
    }
    console.log(
      JSON.stringify({
        scope: 'isolated-real-images-ddl-denied-runtime-roles',
        apiImage,
        workerImage,
        acknowledged: ids.length,
      }),
    );
  }, 120000);
});
