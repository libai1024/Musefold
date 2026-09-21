import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { expect } from 'vitest';
import type { startV25Staging } from './v25-staging.js';

type Staging = Awaited<ReturnType<typeof startV25Staging>>;
const services = ['api', 'scheme-agent', 'worker', 'web'];
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

async function databaseSnapshot(staging: Staging, connection: string) {
  const tables = await staging.query(
    "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','drizzle','graphile_worker') ORDER BY schemaname,tablename",
    undefined,
    connection,
  );
  const snapshots: Array<{ table: string; count: number; sha256: string }> = [];
  for (const table of tables.rows) {
    const name = `${quote(table.schemaname)}.${quote(table.tablename)}`;
    const result = await staging.query(
      `SELECT row_to_json(t)::text AS value FROM ${name} t ORDER BY row_to_json(t)::text`,
      undefined,
      connection,
    );
    snapshots.push({
      table: name,
      count: result.rows.length,
      sha256: sha256(JSON.stringify(result.rows)),
    });
  }
  return snapshots;
}

/** Test-only offline snapshot and restore. Never accepts an external database, bucket or path. */
export async function restoreStagingIntoFreshResources(staging: Staging) {
  const startedAt = Date.now();
  await staging.compose('stop', '--timeout', '15', ...services);
  const running = () => staging.compose('ps', '--services', '--status', 'running');
  expect(await running()).toBe('');
  const sourceUrl = staging.databaseUrl();
  const sourceSnapshot = await databaseSnapshot(staging, sourceUrl);
  expect(sourceSnapshot.length).toBeGreaterThan(20);

  const listed = await staging.storage.client.send(
    new ListObjectsV2Command({ Bucket: staging.storage.bucket }),
  );
  // The bounded fixture has two objects; fail rather than silently omit pagination.
  expect(listed.IsTruncated).toBe(false);
  expect(listed.Contents).toHaveLength(2);
  const objects: Array<{
    key: string;
    contentType: string | undefined;
    byteSize: number;
    path: string;
    sha256: string;
  }> = [];
  for (const object of listed.Contents ?? []) {
    const response = await staging.storage.client.send(
      new GetObjectCommand({ Bucket: staging.storage.bucket, Key: object.Key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes || !object.Key) throw new Error('Snapshot object missing');
    const path = join(staging.directory, `object-${objects.length}.backup`);
    await writeFile(path, bytes, { mode: 0o600 });
    objects.push({
      key: object.Key,
      contentType: response.ContentType,
      byteSize: bytes.length,
      path,
      sha256: sha256(bytes),
    });
  }
  const pgCommand = async (...args: string[]) => {
    const result = await staging.postgres.exec(args);
    // Never print dump contents or credentials when reporting a command failure.
    if (result.exitCode !== 0) throw new Error(`Recovery ${args[0]} exited ${result.exitCode}`);
    return result;
  };
  const archive = '/tmp/v25-staging-recovery.dump';
  await pgCommand(
    'pg_dump',
    '--username',
    staging.postgres.getUsername(),
    '--dbname',
    'v25_staging',
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--file',
    archive,
  );
  const privateCopy = join(staging.directory, 'database.dump');
  await staging.docker('cp', `${staging.postgres.getId()}:${archive}`, privateCopy);
  await chmod(privateCopy, 0o600);
  const backupBytes = await readFile(privateCopy);
  expect(backupBytes.subarray(0, 5).toString()).toBe('PGDMP');
  const restoredArchive = '/tmp/v25-restored-input.dump';
  await staging.docker('cp', privateCopy, `${staging.postgres.getId()}:${restoredArchive}`);

  // A corrupt backup must not leave a partially restored schema or activate runtime services.
  const corruptCopy = join(staging.directory, 'corrupt-database.dump');
  await writeFile(corruptCopy, backupBytes.subarray(0, Math.floor(backupBytes.length / 2)), {
    mode: 0o600,
  });
  await staging.docker(
    'cp',
    corruptCopy,
    `${staging.postgres.getId()}:/tmp/v25-corrupt-input.dump`,
  );
  await staging.query(
    'CREATE DATABASE v25_recovery_failed OWNER musefold_v25_migration',
    undefined,
    staging.postgres.getConnectionUri(),
  );
  await expect(
    pgCommand(
      'pg_restore',
      '--username',
      staging.postgres.getUsername(),
      '--dbname',
      'v25_recovery_failed',
      '--role=musefold_v25_migration',
      '--no-owner',
      '--no-acl',
      '--single-transaction',
      '/tmp/v25-corrupt-input.dump',
    ),
  ).rejects.toThrow('Recovery pg_restore exited');
  expect(
    await databaseSnapshot(staging, staging.databaseUrl(undefined, false, 'v25_recovery_failed')),
  ).toEqual([]);
  expect(await running()).toBe('');

  await staging.query(
    'CREATE DATABASE v25_recovery OWNER musefold_v25_migration',
    undefined,
    staging.postgres.getConnectionUri(),
  );
  const targetUrl = staging.databaseUrl(undefined, false, 'v25_recovery');
  await pgCommand(
    'pg_restore',
    '--username',
    staging.postgres.getUsername(),
    '--dbname',
    'v25_recovery',
    '--role=musefold_v25_migration',
    '--no-owner',
    '--no-acl',
    '--single-transaction',
    restoredArchive,
  );
  expect(await databaseSnapshot(staging, targetUrl)).toEqual(sourceSnapshot);
  const recovered = await staging.createRecoveryStorage();
  async function copyObjects(interruptAfter?: number) {
    for (const [index, object] of objects.entries()) {
      const bytes = await readFile(object.path);
      expect(sha256(bytes)).toBe(object.sha256);
      await recovered.client.send(
        new PutObjectCommand({
          Bucket: recovered.bucket,
          Key: object.key,
          Body: bytes,
          ContentType: object.contentType,
        }),
      );
      if (index + 1 === interruptAfter) throw new Error('Controlled restore interruption');
    }
  }
  await expect(copyObjects(1)).rejects.toThrow('Controlled restore interruption');
  expect(
    (await recovered.client.send(new ListObjectsV2Command({ Bucket: recovered.bucket }))).KeyCount,
  ).toBe(1);
  expect(await running()).toBe('');
  // Resume by rewriting the exact snapshot, not by making missing assets "available" in SQL.
  await copyObjects();
  expect(
    (await recovered.client.send(new ListObjectsV2Command({ Bucket: recovered.bucket }))).KeyCount,
  ).toBe(2);
  for (const object of objects) {
    const restored = await recovered.client.send(
      new GetObjectCommand({ Bucket: recovered.bucket, Key: object.key }),
    );
    const bytes = await restored.Body?.transformToByteArray();
    if (!bytes) throw new Error('Restored object missing');
    expect(sha256(bytes)).toBe(object.sha256);
    expect(restored.ContentType).toBe(object.contentType);
  }
  expect(await databaseSnapshot(staging, sourceUrl)).toEqual(sourceSnapshot);
  expect(
    (
      await staging.storage.client.send(
        new ListObjectsV2Command({ Bucket: staging.storage.bucket }),
      )
    ).KeyCount,
  ).toBe(2);
  await staging.pointToRecoveryDatabase();
  await staging.compose('run', '--rm', '--no-deps', 'migrate');
  await staging.query(
    await readFile(new URL('../../../../infra/v2.5/runtime-grants.sql', import.meta.url), 'utf8'),
  );
  expect(await databaseSnapshot(staging, targetUrl)).toEqual(sourceSnapshot);
  await staging.compose(
    'up',
    '--detach',
    '--no-build',
    '--pull',
    'never',
    '--force-recreate',
    ...services,
  );
  return {
    databaseArchiveSha256: sha256(backupBytes),
    databaseTables: sourceSnapshot.length,
    databaseRows: sourceSnapshot.reduce((total, table) => total + table.count, 0),
    objects: objects.map(({ sha256: hash, byteSize }) => ({ sha256: hash, bytes: byteSize })),
    storage: recovered,
    elapsedMs: Date.now() - startedAt,
  };
}
