import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDesktopSyncApp } from '../../apps/api/src/__tests__/fixtures/desktop-sync-app';
import {
  purgeHttp,
  purgeLogin,
  seedPurgeScheme,
} from '../../apps/api/src/__tests__/fixtures/scheme-purge';
import { createDisposableObjectStorage } from '../../apps/worker/src/__tests__/fixtures/disposable-object-storage';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const exec = promisify(execFile);
describeDb('authenticated scheme purge to real MinIO cleanup across worker processes', () => {
  let app: Awaited<ReturnType<typeof startDesktopSyncApp>>;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  let owner: Awaited<ReturnType<typeof purgeLogin>>;
  beforeAll(async () => {
    app = await startDesktopSyncApp();
    storage = await createDisposableObjectStorage();
    owner = await purgeLogin(app, 'b67-alice');
  }, 180000);
  afterAll(async () => {
    await storage?.close();
    await app?.close();
  });
  const bytes = Buffer.from('synthetic-private-scheme-content');
  const put = (Key: string) =>
    storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key, Body: bytes }));
  const head = (Key: string) =>
    storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key }));
  async function worker(now = new Date()) {
    const out = await exec(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./fixtures/scheme-purge-cleanup.ts', import.meta.url)),
      ],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: app.database.pool.options.connectionString,
          PURGE_STORAGE_ENDPOINT: storage.endpoint,
          PURGE_MAINTENANCE_AT: now.toISOString(),
        },
        timeout: 20000,
      },
    );
    return JSON.parse(out.stdout) as {
      pid: number;
      deleted: number;
      protected: number;
      failed: number;
    };
  }

  it('commits logical deletion before physical IO, survives actual storage outage, and retries in a new worker PID', async () => {
    const f = await seedPurgeScheme(app.database, owner.id);
    await put(f.assetKey);
    await put(f.sourceKey);
    const response = await purgeHttp(app, owner.token, {
      schemeId: f.schemeId,
      expectedVersion: 2,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ retiredKeys: 2, deferredKeys: 0 });
    for (const Key of [f.assetKey, f.sourceKey]) {
      const result = await storage.client.send(
        new GetObjectCommand({ Bucket: storage.bucket, Key }),
      );
      if (!result.Body) throw new Error('Missing stored fixture bytes');
      expect(Buffer.from(await result.Body.transformToByteArray())).toEqual(bytes);
    }
    await storage.stop();
    const failed = await worker().catch(async (error) => {
      await storage.start();
      throw error;
    });
    expect(failed.failed).toBe(2);
    expect(failed.deleted).toBe(0);
    const queued = (
      await app.database.pool.query(
        'SELECT object_key,attempt_count,last_error,next_attempt_at FROM object_cleanup_queue WHERE object_key=ANY($1)',
        [[f.assetKey, f.sourceKey]],
      )
    ).rows;
    expect(queued).toHaveLength(2);
    for (const row of queued) expect(row.attempt_count).toBe(1);
    await storage.start();
    expect((await head(f.assetKey)).ContentLength).toBe(bytes.length);
    // Advance only the explicit maintenance clock to the persisted backoff deadline.
    const due = new Date(
      Math.max(...queued.map((row) => new Date(row.next_attempt_at).getTime())) + 1,
    );
    const done = await worker(due);
    expect(done.pid).not.toBe(failed.pid);
    expect(done.deleted).toBe(2);
    expect(done.failed).toBe(0);
    for (const key of [f.assetKey, f.sourceKey])
      await expect(head(key)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect((await worker(due)).deleted).toBe(0);
    const replay = await purgeHttp(app, owner.token, { schemeId: f.schemeId, expectedVersion: 2 });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ retiredKeys: 2 });
  }, 60000);

  it('preserves a live upload lease and deletes only after the real persisted expiry boundary', async () => {
    const f = await seedPurgeScheme(app.database, owner.id);
    await put(f.assetKey);
    await put(f.sourceKey);
    const until = new Date(Date.now() + 3600000);
    await app.database.pool.query(
      `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      VALUES($1,$2,$3,'Synthetic.png','image/png',5,'available',$4)`,
      [f.schemeId, owner.id, f.assetKey, until],
    );
    const response = await purgeHttp(app, owner.token, {
      schemeId: f.schemeId,
      expectedVersion: 2,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ retiredKeys: 1, deferredKeys: 1 });
    const first = await worker();
    expect(first.deleted).toBe(1);
    expect(first.protected).toBe(1);
    expect((await head(f.assetKey)).ContentLength).toBe(bytes.length);
    await expect(head(f.sourceKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    const row = (
      await app.database.pool.query(
        'SELECT next_attempt_at FROM object_cleanup_queue WHERE object_key=$1',
        [f.assetKey],
      )
    ).rows[0];
    const last = await worker(new Date(new Date(row.next_attempt_at).getTime() + 1));
    expect(last.deleted).toBe(1);
    await expect(head(f.assetKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
  }, 30000);

  it('retains shared asset bytes until the last referencing scheme is purged', async () => {
    const first = await seedPurgeScheme(app.database, owner.id),
      second = await seedPurgeScheme(app.database, owner.id);
    for (const key of [first.assetKey, first.sourceKey, second.assetKey, second.sourceKey])
      await put(key);
    await app.database.pool.query(
      `INSERT INTO design_scheme_assets(id,user_id,revision_id,object_key,role,origin,mime_type,width,height,content_hash)
      VALUES($1,$2,$3,$4,'reference','uploaded','image/png',1,1,$5)`,
      [first.schemeId, owner.id, second.revisionId, first.assetKey, 'a'.repeat(64)],
    );
    expect(
      (await purgeHttp(app, owner.token, { schemeId: first.schemeId, expectedVersion: 2 })).status,
    ).toBe(200);
    const protectedRun = await worker();
    expect(protectedRun.deleted).toBe(1);
    expect(protectedRun.protected).toBe(1);
    expect((await head(first.assetKey)).ContentLength).toBe(bytes.length);
    expect(
      (await purgeHttp(app, owner.token, { schemeId: second.schemeId, expectedVersion: 2 })).status,
    ).toBe(200);
    const final = await worker();
    expect(final.deleted).toBe(3);
    await expect(head(first.assetKey)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
  }, 30000);
});
