import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { expect, vi } from 'vitest';
import { startNewApiIdentityFixture } from '../../../../apps/api/src/__tests__/fixtures/new-api-identity-fixture.js';
import { imageModelFixture } from '../../../../apps/api/src/__tests__/fixtures/image-model.js';
import { createDisposableObjectStorage } from '../../../../apps/worker/src/__tests__/fixtures/disposable-object-storage.js';
import { createV25DeploymentPlan } from '../../v25-plan.mjs';

const execute = promisify(execFile);
const runtimeRoles = {
  api: 'musefold_v25_api',
  worker: 'musefold_v25_worker',
  schemeAgent: 'musefold_v25_agent',
};
const syntheticPassword = (role: string) => `synthetic-staging-${role}-password`;
const migrationRole = 'musefold_v25_migration';

async function availablePort() {
  const probe = createPortProbe();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === 'string') throw new Error('Missing staging port');
  return address.port;
}

/** Only creates disposable local resources; never reads production credentials or deploys remotely. */
export async function startV25Staging() {
  const images = {
    api: process.env.V25_API_IMAGE ?? '',
    worker: process.env.WORKER_CONTAINER_IMAGE ?? '',
    web: process.env.V25_WEB_IMAGE ?? '',
  };
  for (const image of Object.values(images))
    if (!/^sha256:[a-f0-9]{64}$/.test(image))
      throw new Error('Exact local staging image IDs required');
  const project = `musefold-v25-staging-${randomUUID().slice(0, 8)}`;
  const directory = await mkdtemp(join(tmpdir(), `${project}-`));
  const composePath = join(directory, 'release.compose.json');
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let postgres: StartedPostgreSqlContainer | undefined;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>> | undefined;
  let recoveryStorage: Awaited<ReturnType<typeof createDisposableObjectStorage>> | undefined;
  let activeDatabase = 'v25_staging';
  let identity: Awaited<ReturnType<typeof startNewApiIdentityFixture>> | undefined;
  const image = await imageModelFixture();
  let upstream: ReturnType<typeof createServer> | undefined;
  let composeWritten = false;
  const upstreamErrors: string[] = [];
  const deniedImageRequests: number[] = [];

  async function docker(...args: string[]) {
    return (
      await execute('docker', args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
    ).stdout.trim();
  }
  const compose = (...args: string[]) =>
    docker('compose', '--project-name', project, '--file', composePath, ...args);
  const toContainer = (address: string) => {
    const value = new URL(address);
    value.hostname = 'host.docker.internal';
    return value.href;
  };
  function databaseUrl(role = migrationRole, inContainer = false, database = activeDatabase) {
    if (!postgres) throw new Error('Staging database unavailable');
    const value = new URL(postgres.getConnectionUri());
    value.username = role;
    value.password = syntheticPassword(role);
    value.pathname = `/${database}`;
    return inContainer ? toContainer(value.href) : value.href;
  }
  async function query(statement: string, values?: unknown[], connectionString = databaseUrl()) {
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
  async function close() {
    image.release();
    const failures: unknown[] = [];
    for (const dispose of [
      () => (composeWritten ? compose('down', '--timeout', '10') : undefined),
      () =>
        new Promise<void>((resolve) => {
          if (!upstream) return resolve();
          upstream.closeAllConnections();
          upstream.close(() => resolve());
        }),
      () => identity?.close(),
      () => recoveryStorage?.close(),
      () => storage?.close(),
      () => postgres?.stop(),
      () => rm(directory, { recursive: true, force: true }),
    ]) {
      try {
        await dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new Error(`Staging teardown failed in ${failures.length} owned resources`);
  }
  try {
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
    for (const role of [migrationRole, ...Object.values(runtimeRoles)])
      await query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${syntheticPassword(role)}'`,
        undefined,
        postgres.getConnectionUri(),
      );
    await query(
      `CREATE DATABASE v25_staging OWNER ${migrationRole}`,
      undefined,
      postgres.getConnectionUri(),
    );
    storage = await createDisposableObjectStorage();
    identity = await startNewApiIdentityFixture();
    const account = identity;
    for (const [id, username] of [
      [42, 'staging-alice'],
      [43, 'staging-bob'],
    ] as const) {
      account.addOwner({ id, username });
      account.mapUsername(username, id);
    }
    upstream = createServer((request, response) => {
      void (async () => {
        if (request.url?.startsWith('/v1/images/')) {
          const key = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
          if (![42, 43].some((owner) => account.isTokenKeyActive(owner, key))) {
            deniedImageRequests.push(401);
            response.writeHead(401).end('{}');
            return;
          }
          if (!(await image.handle(request, response))) response.writeHead(404).end('{}');
          return;
        }
        // Forward actual auth HTTP without logging bodies, cookies, bearer tokens or keys.
        const forwarded = httpRequest(
          new URL(request.url ?? '/', account.baseUrl),
          {
            method: request.method,
            headers: { ...request.headers, host: new URL(account.baseUrl).host },
          },
          (incoming) => {
            response.writeHead(incoming.statusCode ?? 502, incoming.headers);
            incoming.pipe(response);
          },
        );
        forwarded.on('error', () => {
          upstreamErrors.push('identity-forward-failed');
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        request.pipe(forwarded);
      })().catch(() => {
        upstreamErrors.push('controlled-upstream-failed');
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      upstream?.once('error', reject);
      upstream?.listen(0, '127.0.0.1', resolve);
    });
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string')
      throw new Error('Missing upstream port');
    const upstreamUrl = toContainer(`http://127.0.0.1:${upstreamAddress.port}`);
    const envFiles = {
      api: 'api.env',
      worker: 'worker.env',
      schemeAgent: 'scheme-agent.env',
      migration: 'migration.env',
    };
    for (const [service, file] of Object.entries(envFiles)) {
      const environment =
        service === 'migration'
          ? {
              MIGRATION_DATABASE_URL: databaseUrl(migrationRole, true),
            }
          : {
              DATABASE_URL: databaseUrl(runtimeRoles[service as keyof typeof runtimeRoles], true),
              NEW_API_BASE_URL: upstreamUrl,
              BETTER_AUTH_SECRET: 'synthetic-staging-auth-secret',
              CREDENTIAL_ENCRYPTION_KEY: 'synthetic-staging-encryption-key',
              S3_ENDPOINT: toContainer(storage.endpoint),
              S3_REGION: 'us-east-1',
              S3_BUCKET: storage.bucket,
              S3_ACCESS_KEY_ID: 'gc-fixture-owner',
              S3_SECRET_ACCESS_KEY: 'synthetic-gc-storage-password',
            };
      await writeFile(
        join(directory, file),
        Object.entries(environment)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
        { mode: 0o600 },
      );
    }
    const plan = createV25DeploymentPlan({
      formatVersion: 1,
      environment: 'staging',
      project,
      publicBaseUrl: baseUrl,
      webPort: port,
      // A fixture plan is not a source/artifact attestation or a publishable release manifest.
      source: {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        treeSha256: '0'.repeat(64),
        dirty: true,
      },
      images,
      envFiles,
    });
    for (const service of Object.values(plan.compose.services) as Array<Record<string, unknown>>)
      service.extra_hosts = ['host.docker.internal:host-gateway'];
    await writeFile(composePath, JSON.stringify(plan.compose), { mode: 0o600 });
    composeWritten = true;
    await compose('config', '--quiet');
    await compose('run', '--rm', '--no-deps', 'migrate');
    const grants = await readFile(
      new URL('../../../../infra/v2.5/runtime-grants.sql', import.meta.url),
      'utf8',
    );
    await query(grants);
    await compose(
      'up',
      '--detach',
      '--no-build',
      '--pull',
      'never',
      'api',
      'scheme-agent',
      'worker',
      'web',
    );
    for (const [service, line] of Object.entries({
      api: '[api] listening',
      worker: '[worker] generation worker started',
      'scheme-agent': '[scheme-agent] worker started',
    }))
      await vi.waitFor(
        async () => {
          expect(await compose('logs', '--no-color', service)).toContain(line);
        },
        { timeout: 30000, interval: 250 },
      );
    await vi.waitFor(
      async () => {
        expect(
          (await fetch(`${baseUrl}/settings`, { signal: AbortSignal.timeout(2000) })).status,
        ).toBe(200);
      },
      { timeout: 30000, interval: 250 },
    );
    return {
      baseUrl,
      images,
      project,
      directory,
      compose,
      query,
      docker,
      databaseUrl,
      postgres,
      storage,
      identity,
      image,
      upstreamErrors,
      deniedImageRequests,
      close,
      async assertRuntimeImages(expected = images) {
        for (const [service, expectedImage] of Object.entries({
          ...expected,
          'scheme-agent': expected.api,
        })) {
          const id = await compose('ps', '--quiet', service);
          expect(id).not.toBe('');
          expect(await docker('inspect', '--format', '{{.Image}}', id)).toBe(expectedImage);
        }
      },
      async rollbackToLocalImages(previous: typeof images) {
        for (const [service, image] of Object.entries(previous)) {
          if (
            !/^sha256:[a-f0-9]{64}$/.test(image) ||
            image === images[service as keyof typeof images]
          )
            throw new Error('Distinct exact local rollback images required');
        }
        // Both source fields are fixture-only, never release provenance claims.
        const rollbackPlan = createV25DeploymentPlan({
          ...plan.release,
          previous: { source: plan.release.source, images: previous },
        });
        if (!('compose' in rollbackPlan.rollback)) throw new Error('Rollback plan unavailable');
        const rollbackCompose = rollbackPlan.rollback.compose;
        for (const service of Object.values(rollbackCompose.services) as Array<
          Record<string, unknown>
        >)
          service.extra_hosts = ['host.docker.internal:host-gateway'];
        const previousPath = join(directory, 'previous.compose.json');
        await writeFile(previousPath, JSON.stringify(rollbackCompose), { mode: 0o600 });
        // Execute the generated plan's actual command arguments, resolving only its local file.
        for (const step of rollbackPlan.rollback.steps) {
          const args = step.args.map((arg: string) =>
            arg === 'release.compose.json'
              ? composePath
              : arg === 'previous.compose.json'
                ? previousPath
                : arg,
          );
          await docker(...args);
        }
      },
      async returnToCurrentImages() {
        await compose('stop', '--timeout', '15', 'api', 'scheme-agent', 'worker', 'web');
        await compose(
          'up',
          '--detach',
          '--no-build',
          '--pull',
          'never',
          'api',
          'scheme-agent',
          'worker',
          'web',
        );
      },
      async createRecoveryStorage() {
        if (recoveryStorage) throw new Error('Recovery storage already created');
        recoveryStorage = await createDisposableObjectStorage();
        return recoveryStorage;
      },
      async pointToRecoveryDatabase() {
        if (!recoveryStorage) throw new Error('Recovery storage unavailable');
        // This fixture can only switch to its one disposable recovery target.
        for (const [service, file] of Object.entries(envFiles)) {
          const path = join(directory, file);
          const role =
            service === 'migration'
              ? migrationRole
              : runtimeRoles[service as keyof typeof runtimeRoles];
          const contents = await readFile(path, 'utf8');
          await writeFile(
            path,
            contents
              .replace(
                /^(MIGRATION_DATABASE_URL|DATABASE_URL)=.*$/m,
                `$1=${databaseUrl(role, true, 'v25_recovery')}`,
              )
              .replace(/^S3_ENDPOINT=.*$/m, `S3_ENDPOINT=${toContainer(recoveryStorage.endpoint)}`),
            { mode: 0o600 },
          );
        }
        activeDatabase = 'v25_recovery';
      },
      async assertLogsSafe() {
        const logs = await compose('logs', '--no-color');
        for (const value of [
          'fixture-password',
          'sk-fixture-',
          'fixture-jwt-',
          'fixture-refresh-',
          'synthetic-staging-auth-secret',
          'synthetic-staging-encryption-key',
          ...[migrationRole, ...Object.values(runtimeRoles)].map(syntheticPassword),
        ])
          expect(logs).not.toContain(value);
        expect(upstreamErrors).toEqual([]);
        expect(deniedImageRequests).toEqual([]);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
