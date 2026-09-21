import { randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVENTORY_GRACE_MS,
  INVENTORY_PREFIXES,
  inventoryScopeId,
  scanObjectInventoryPage,
} from '../object-inventory.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';
import { waitUntil } from './fixtures/process-runtime.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('durable inventory discovers actual unregistered MinIO objects', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  let now: Date;
  let scopeId: string;
  const deps = () => ({
    db: database.db,
    s3: storage.client,
    bucket: storage.bucket,
    scopeId,
    now: () => now,
  });
  const put = (key: string, body = 'owned-by-inventory-fixture') =>
    storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: body }));
  const records = async () =>
    (await database.pool.query('SELECT * FROM object_inventory_candidates ORDER BY object_key'))
      .rows;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    storage = await createDisposableObjectStorage();
    scopeId = inventoryScopeId(storage.bucket, storage.endpoint);
    console.info('[inventory fixture]', { imageId: storage.imageId, version: storage.version });
  }, 180000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    now = new Date(Date.now() + 1000);
    await database.pool.query('TRUNCATE object_inventory_candidates, object_inventory_cursors');
    await database.pool.query('DELETE FROM "user"');
    for (;;) {
      const page = await storage.client.send(
        new ListObjectsV2Command({ Bucket: storage.bucket, MaxKeys: 1000 }),
      );
      if (!page.Contents?.length) break;
      await storage.client.send(
        new DeleteObjectsCommand({
          Bucket: storage.bucket,
          Delete: { Objects: page.Contents.map((item) => ({ Key: item.Key })) },
        }),
      );
    }
  });
  afterAll(async () => {
    await storage?.close();
    await database?.pool.end();
    await container?.stop();
  });

  it('discovers every managed orphan prefix while preserving an unlinked live upload and unmanaged objects', async () => {
    const id = randomUUID();
    const orphanKeys = [
      `users/owned/generations/${id}/${id}`,
      `users/owned/references/${id}`,
      `users/owned/design-scheme-uploads/${id}`,
      `scheme-sources/${'a'.repeat(64)}/${id}/${id}`,
      `scheme-packages/${'a'.repeat(64)}/${id}`,
      `scheme-imports/${id}/${id}/${'b'.repeat(64)}`,
      `scheme-exports/${id}`,
    ];
    const protectedId = randomUUID();
    const protectedKey = `users/owned/references/${protectedId}`;
    const unmanaged = ['users/owned/private-file', 'unmanaged/original'];
    await database.pool.query(
      `INSERT INTO "user"(id,name,email) VALUES ('owned','Owned','owned@example.test')`,
    );
    await database.pool.query(
      `INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      VALUES ($1,'owned',$2,'owned','image/png',4,'available',$3)`,
      [protectedId, protectedKey, new Date(now.getTime() + 60000)],
    );
    for (const key of [...orphanKeys, protectedKey, ...unmanaged]) await put(key);
    const results = [];
    for (const prefix of INVENTORY_PREFIXES)
      results.push(await scanObjectInventoryPage(deps(), prefix));
    expect(results.reduce((sum, r) => sum + r.recorded, 0)).toBe(7);
    expect(results.reduce((sum, r) => sum + r.protected, 0)).toBe(1);
    expect(results.reduce((sum, r) => sum + r.unmanaged, 0)).toBe(1);
    expect((await records()).map((row) => row.object_key).sort()).toEqual(orphanKeys.sort());
    expect(
      (await records()).every(
        (row) => row.eligible_at.getTime() >= now.getTime() + INVENTORY_GRACE_MS,
      ),
    ).toBe(true);
    // Discovery does not put unguarded deletions in the legacy outbox or remove S3 bytes.
    expect((await database.pool.query('SELECT * FROM object_cleanup_queue')).rows).toEqual([]);
    expect(
      (await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket }))).KeyCount,
    ).toBe(10);
    await database.pool.query('DELETE FROM "user"');
    expect((await scanObjectInventoryPage(deps(), 'users/')).recorded).toBe(4);
    expect((await records()).map((row) => row.object_key)).toContain(protectedKey);
  });

  it('drains 1001 objects over bounded pages, resumes through a new DB pool and rescans earlier new keys', async () => {
    const keys = Array.from(
      { length: 1001 },
      () => `users/zz-owner/references/${randomUUID()}`,
    ).sort();
    for (let offset = 0; offset < keys.length; offset += 25)
      await Promise.all(keys.slice(offset, offset + 25).map((key) => put(key)));
    expect(await scanObjectInventoryPage(deps(), 'users/')).toMatchObject({
      scanned: 100,
      recorded: 100,
      completed: 0,
    });
    const firstCursor = (
      await database.pool.query('SELECT continuation_token FROM object_inventory_cursors')
    ).rows[0].continuation_token;
    expect(firstCursor).toBeTruthy();
    const reopened = createDatabase(container.getConnectionUri());
    try {
      for (let page = 1; page < 11; page++) {
        const result = await scanObjectInventoryPage({ ...deps(), db: reopened.db }, 'users/');
        expect(result.scanned).toBe(page === 10 ? 1 : 100);
        expect(result.completed).toBe(page === 10 ? 1 : 0);
      }
    } finally {
      await reopened.pool.end();
    }
    expect(await records()).toHaveLength(1001);
    expect(
      (await database.pool.query('SELECT continuation_token FROM object_inventory_cursors')).rows[0]
        .continuation_token,
    ).toBeNull();
    const earlier = `users/aa-owner/references/${randomUUID()}`;
    await put(earlier);
    expect((await scanObjectInventoryPage(deps(), 'users/')).scanned).toBe(100);
    expect((await records()).map((row) => row.object_key)).toContain(earlier);
    expect(await records()).toHaveLength(1002);
  }, 60000);

  it('keeps dry-run observations separate and restarts grace only when the actual object changes', async () => {
    const key = `users/owned/references/${randomUUID()}`;
    await put(key);
    expect(await scanObjectInventoryPage(deps(), 'users/', 'dry-run')).toMatchObject({
      candidates: 1,
      recorded: 0,
    });
    expect(await records()).toEqual([]);
    await scanObjectInventoryPage(deps(), 'users/');
    const initial = (await records())[0];
    now = new Date(now.getTime() + INVENTORY_GRACE_MS);
    await scanObjectInventoryPage(deps(), 'users/');
    expect((await records())[0].eligible_at).toEqual(initial.eligible_at);
    expect((await records())[0].first_observed_at).toEqual(initial.first_observed_at);
    await put(key, 'new-owned-content');
    const beforeDryRun = await records();
    await scanObjectInventoryPage(deps(), 'users/', 'dry-run');
    expect(await records()).toEqual(beforeDryRun);
    await scanObjectInventoryPage(deps(), 'users/');
    const changed = (await records())[0];
    expect(changed.etag).not.toBe(initial.etag);
    expect(changed.first_observed_at).toEqual(now);
    expect(changed.eligible_at.getTime()).toBe(now.getTime() + INVENTORY_GRACE_MS);
    await waitUntil(
      () => Date.now() > changed.modified_at.getTime() + 1000,
      'next storage timestamp',
    );
    await put(key, 'new-owned-content');
    now = new Date(now.getTime() + 1000);
    await scanObjectInventoryPage(deps(), 'users/');
    const sameBytesOverwrite = (await records())[0];
    expect(sameBytesOverwrite.etag).toBe(changed.etag);
    expect(sameBytesOverwrite.modified_at.getTime()).toBeGreaterThan(changed.modified_at.getTime());
    expect(sameBytesOverwrite.first_observed_at).toEqual(now);
    expect(sameBytesOverwrite.eligible_at.getTime()).toBe(now.getTime() + INVENTORY_GRACE_MS);
    expect(
      (await database.pool.query('SELECT mode FROM object_inventory_cursors ORDER BY mode')).rows,
    ).toEqual([{ mode: 'dry-run' }, { mode: 'record' }]);
  });

  it('does not advance the page when candidate writes roll back and hides SQL/storage error details', async () => {
    for (let n = 0; n < 101; n++) await put(`users/owned/references/${randomUUID()}`);
    expect((await scanObjectInventoryPage(deps(), 'users/')).recorded).toBe(100);
    const beforeRecords = await records();
    const beforeCursor = (
      await database.pool.query('SELECT continuation_token FROM object_inventory_cursors')
    ).rows[0].continuation_token;
    expect(beforeCursor).toBeTruthy();
    await database.pool.query(
      `CREATE FUNCTION reject_inventory_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned-private-object-canary'; END $$`,
    );
    await database.pool.query(
      'CREATE TRIGGER inventory_fixture_failure BEFORE INSERT ON object_inventory_candidates FOR EACH ROW EXECUTE FUNCTION reject_inventory_fixture()',
    );
    try {
      await expect(scanObjectInventoryPage(deps(), 'users/')).rejects.toThrow(
        'ObjectInventoryScanFailed',
      );
    } finally {
      await database.pool.query(
        'DROP TRIGGER inventory_fixture_failure ON object_inventory_candidates',
      );
      await database.pool.query('DROP FUNCTION reject_inventory_fixture()');
    }
    expect(await records()).toEqual(beforeRecords);
    expect(
      (
        await database.pool.query(
          'SELECT continuation_token,lease_token FROM object_inventory_cursors',
        )
      ).rows,
    ).toEqual([{ continuation_token: beforeCursor, lease_token: null }]);
    const send = vi
      .spyOn(storage.client, 'send')
      .mockRejectedValueOnce(new Error('owned-private-storage-canary'));
    await expect(scanObjectInventoryPage(deps(), 'users/')).rejects.toThrow(
      'ObjectInventoryScanFailed',
    );
    send.mockRestore();
    expect((await scanObjectInventoryPage(deps(), 'users/')).recorded).toBe(1);
  }, 30000);

  it('fences a delayed page response after a new worker reclaims its expired scan lease', async () => {
    await put(`users/owned/references/${randomUUID()}`);
    const original = storage.client.send.bind(storage.client);
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(storage.client, 'send').mockImplementationOnce(async (command, options) => {
      started();
      await held;
      return original(command, options);
    });
    const delayed = scanObjectInventoryPage(deps(), 'users/');
    await ready;
    try {
      expect((await scanObjectInventoryPage(deps(), 'users/')).busy).toBe(1);
      now = new Date(now.getTime() + 11 * 60_000);
      expect((await scanObjectInventoryPage(deps(), 'users/')).recorded).toBe(1);
    } finally {
      release();
    }
    expect((await delayed).busy).toBe(1);
    expect((await records())[0].first_observed_at).toEqual(now);
    expect(
      (await database.pool.query('SELECT lease_token FROM object_inventory_cursors')).rows[0]
        .lease_token,
    ).toBeNull();
  });
});
