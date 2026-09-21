import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const describeImage = process.env.RUN_V25_IMAGE_TESTS === 'true' ? describe : describe.skip;
const execute = promisify(execFile);
const release = 'a'.repeat(40);

describeImage('v2.5 actual production API image migration', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let directory: string;
  let image: string;
  let containerUrl: string;
  const ends: Promise<void>[] = [];
  beforeAll(async () => {
    image = process.env.V25_API_IMAGE ?? '';
    if (!/^sha256:[a-f0-9]{64}$/.test(image))
      throw new Error('V25_API_IMAGE must be an exact local image ID');
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
    pool.on('connect', (client) =>
      ends.push(new Promise<void>((resolve) => client.once('end', resolve))),
    );
    directory = await mkdtemp(join(tmpdir(), 'musefold-v25-migration-image-'));
    const connection = new URL(postgres.getConnectionUri());
    connection.hostname = 'host.docker.internal';
    containerUrl = connection.href;
  }, 180000);
  afterAll(async () => {
    await pool?.end();
    await Promise.all(ends);
    await postgres?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function run(
    environment: Record<string, string>,
    args = ['./node_modules/.bin/tsx', 'src/migrate-bin.ts'],
  ) {
    const path = join(directory, 'migration.env');
    await writeFile(
      path,
      Object.entries(environment)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      { mode: 0o600 },
    );
    return execute(
      'docker',
      [
        'run',
        '--rm',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=128m,mode=1777',
        '--add-host',
        'host.docker.internal:host-gateway',
        '--env-file',
        path,
        image,
        ...args,
      ],
      { timeout: 45000, maxBuffer: 1024 * 1024 },
    );
  }
  async function counts() {
    return (
      await pool.query(`select
      (select count(*)::int from drizzle.__drizzle_migrations) as application,
      (select count(*)::int from graphile_worker.migrations) as queue`)
    ).rows[0];
  }

  it('migrates a fresh PG and replays from the non-root read-only prod image without pnpm', async () => {
    const inspect = await execute('docker', [
      'image',
      'inspect',
      image,
      '--format',
      '{{.Config.User}}',
    ]);
    expect(inspect.stdout.trim()).toBe('musefold');
    const absent = await run({}, [
      'node',
      '-e',
      "const r=require('node:child_process').spawnSync('pnpm',['--version']);if(r.error?.code==='ENOENT')console.log('pnpm-absent');else process.exit(1)",
    ]);
    expect(absent.stdout.trim()).toBe('pnpm-absent');
    const environment = { MIGRATION_DATABASE_URL: containerUrl, MIGRATION_RELEASE: release };
    const first = await run(environment);
    expect(first.stdout.trim()).toBe(JSON.stringify({ status: 'migrated', release }));
    expect(first.stderr).toBe('');
    const before = await counts();
    expect(before.application).toBeGreaterThan(0);
    expect(before.queue).toBeGreaterThan(0);
    await run(environment);
    expect(await counts()).toEqual(before);
    console.log(JSON.stringify({ scope: 'actual-prod-api-image-migration', image, ...before }));
  }, 120000);

  it('does not fall back to runtime DATABASE_URL or disclose configuration on failure', async () => {
    const before = await counts();
    const result = await run({ DATABASE_URL: containerUrl, MIGRATION_RELEASE: release }).then(
      () => {
        throw new Error('Migration accepted runtime credentials');
      },
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe('[migration] failed; no application rollout was authorized');
    expect(await counts()).toEqual(before);
  }, 60000);
});
