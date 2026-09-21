import { createHash, randomUUID } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createDatabase, enqueueObjectCleanup, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVENTORY_GRACE_MS,
  INVENTORY_PREFIXES,
  inventoryScopeId,
  scanObjectInventoryPage,
} from '../object-inventory.js';
import { processObjectInventoryCandidates } from '../object-inventory-delete.js';
import { PostgresObjectCleanupStore, processObjectCleanupBatch } from '../tasks.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';
import { createDelayedPutProxy } from './fixtures/lost-storage-response.js';
import { waitUntil } from './fixtures/process-runtime.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'late-put-owner';
const h64 = (char: string) => char.repeat(64);

/**
 * D02.3 S2 matrix: a server-relayed PUT whose bytes reach object storage only after
 * the retirement + deletion completed. Recovery must converge through inventory
 * rediscovery with the persisted grace, never through shortened or fabricated clocks.
 */
describeDb('late PUT recovery against actual PostgreSQL and MinIO', () => {
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
  const head = (objectKey: string) =>
    storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
  const putDirect = (objectKey: string, body = 'owned-first-bytes') =>
    storage.client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: body }),
    );
  const rows = async () =>
    (await database.pool.query('SELECT * FROM object_inventory_candidates ORDER BY object_key'))
      .rows;
  const outbox = async (objectKey: string) =>
    (
      await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
        objectKey,
      ])
    ).rows;
  const retired = async (objectKey: string) =>
    (
      await database.pool.query(
        `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [objectKey],
      )
    ).rows;
  /** §5.80.1 discipline: advance the injected clock to the persisted grace deadline. */
  const expireGrace = async () => {
    const latest = (
      await database.pool.query(
        'SELECT max(eligible_at) AS deadline FROM object_inventory_candidates',
      )
    ).rows[0].deadline as Date | null;
    now = new Date(Math.max(now.getTime() + INVENTORY_GRACE_MS, latest?.getTime() ?? 0));
  };
  async function scan() {
    for (const prefix of INVENTORY_PREFIXES)
      for (;;) {
        if ((await scanObjectInventoryPage(deps(), prefix)).completed) break;
      }
  }
  const cleanupPass = () =>
    processObjectCleanupBatch(
      new PostgresObjectCleanupStore(database.db),
      storage.client,
      storage.bucket,
      undefined,
      now,
    );

  /** A signed PUT held at the relay until released; nothing reaches upstream before. */
  async function startHeldPut(objectKey: string, body: string) {
    const proxy = await createDelayedPutProxy(storage.endpoint);
    const client = new S3Client({
      endpoint: proxy.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'gc-fixture-owner',
        secretAccessKey: 'synthetic-gc-storage-password',
      },
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 1000, requestTimeout: 20000 },
    });
    const promise = client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: body }),
    );
    void promise.catch(() => undefined);
    await waitUntil(() => proxy.held === 1, 'relayed PUT buffered before upstream');
    return { proxy, client, promise };
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    storage = await createDisposableObjectStorage();
    scopeId = inventoryScopeId(storage.bucket, storage.endpoint);
  }, 180000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    now = new Date(Date.now() + 1000);
    await database.pool.query(
      'TRUNCATE "user",object_inventory_candidates,object_inventory_cursors,object_key_retirements,object_cleanup_queue CASCADE',
    );
    await database.pool.query(
      `INSERT INTO "user"(id,name,email) VALUES($1,'Late','late-put@example.test')`,
      [OWNER],
    );
    for (;;) {
      const page = await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket }));
      if (!page.Contents?.length) break;
      await storage.client.send(
        new DeleteObjectsCommand({
          Bucket: storage.bucket,
          Delete: { Objects: page.Contents.map(({ Key }) => ({ Key })) },
        }),
      );
    }
  });
  afterAll(async () => {
    await storage?.close();
    await database?.pool.end();
    await container?.stop();
  });

  /**
   * First-pass retirement + deletion through the durable outbox while the relayed PUT
   * is still in flight, then rediscovery, persisted grace and a second real deletion.
   */
  async function expectLatePutConverges(objectKey: string) {
    const held = await startHeldPut(objectKey, `late-bytes-${objectKey}`);
    try {
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      // The upload-failure compensation already ran: outbox intent drives the first pass.
      await enqueueObjectCleanup(
        database.db,
        [
          {
            objectKey,
            ownerId: OWNER,
            objectType: 'generation_reference',
            reason: 'reference_upload_failed',
          },
        ],
        now,
      );
      expect(await cleanupPass()).toMatchObject({ deleted: 1, protected: 0, failed: 0 });
      expect(await outbox(objectKey)).toEqual([]);
      expect(await retired(objectKey)).toHaveLength(1);
      expect(held.proxy.release()).toBe(1);
      await held.promise;
      // The deletion completed before these bytes landed: the orphan is back.
      expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);
      await scan();
      expect(await rows()).toHaveLength(1);
      await expireGrace();
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 1,
        deleted: 1,
        failed: 0,
      });
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      expect(await rows()).toEqual([]);
      expect(await retired(objectKey)).toHaveLength(1);
    } finally {
      held.client.destroy();
      await held.proxy.close();
    }
  }

  it.each([
    ['generation asset', () => `users/${OWNER}/generations/${randomUUID()}/${randomUUID()}`],
    ['reference upload', () => `users/${OWNER}/references/${randomUUID()}`],
    ['scheme asset upload', () => `users/${OWNER}/design-scheme-uploads/${randomUUID()}`],
    ['scheme source file', () => `scheme-sources/${h64('a')}/${randomUUID()}/${randomUUID()}`],
    ['scheme package stage', () => `scheme-packages/${h64('b')}/${randomUUID()}`],
    ['scheme import object', () => `scheme-imports/${randomUUID()}/${randomUUID()}/${h64('c')}`],
    ['scheme export', () => `scheme-exports/${randomUUID()}`],
  ] as Array<[string, () => string]>)(
    'reconverges a %s whose PUT bytes land after the completed deletion',
    async (_label, keyFor) => {
      await expectLatePutConverges(keyFor());
    },
    60000,
  );

  it('fences republication of the retired key and converges a further late PUT after the second deletion', async () => {
    const objectKey = `users/${OWNER}/references/${randomUUID()}`;
    const held = await startHeldPut(objectKey, 'first-late-bytes');
    try {
      await enqueueObjectCleanup(
        database.db,
        [
          {
            objectKey,
            ownerId: OWNER,
            objectType: 'generation_reference',
            reason: 'reference_upload_failed',
          },
        ],
        now,
      );
      expect(await cleanupPass()).toMatchObject({ deleted: 1, failed: 0 });
      // Retired before the bytes landed: re-registration is fenced forever.
      await expect(
        database.pool.query(
          `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
           VALUES($1,$2,$3,'late.png','image/png',17,'uploading',$4)`,
          [randomUUID(), OWNER, objectKey, new Date(now.getTime() + INVENTORY_GRACE_MS)],
        ),
      ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
      held.proxy.release();
      await held.promise;
    } finally {
      held.client.destroy();
      await held.proxy.close();
    }
    await scan();
    await expireGrace();
    expect(await processObjectInventoryCandidates(deps())).toMatchObject({ deleted: 1 });
    await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });

    // Another relayed PUT lands after that second deletion; recovery converges again.
    const again = await startHeldPut(objectKey, 'third-arriving-bytes');
    try {
      await scan();
      expect(await rows()).toEqual([]);
      again.proxy.release();
      await again.promise;
      expect((await head(objectKey)).ContentLength).toBeGreaterThan(0);
    } finally {
      again.client.destroy();
      await again.proxy.close();
    }
    await scan();
    expect(await rows()).toHaveLength(1);
    await expireGrace();
    expect(await processObjectInventoryCandidates(deps())).toMatchObject({
      claimed: 1,
      deleted: 1,
      failed: 0,
    });
    await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await retired(objectKey)).toHaveLength(1);
  }, 60000);

  it('deletes bytes that land after the retirement commit but before the storage delete call', async () => {
    const objectKey = `users/${OWNER}/references/${randomUUID()}`;
    await putDirect(objectKey);
    await scan();
    await expireGrace();
    const held = await startHeldPut(objectKey, 'gap-window-bytes');
    const send = storage.client.send.bind(storage.client);
    const spy = vi.spyOn(storage.client, 'send');
    spy.mockImplementation(async (command, options) => {
      if (
        command instanceof DeleteObjectsCommand &&
        command.input.Delete?.Objects?.some(({ Key }) => Key === objectKey)
      ) {
        // The authorization transaction already committed the retirement; the
        // relayed PUT lands inside the delete window and must be removed by it.
        expect(held.proxy.release()).toBe(1);
        await held.promise;
      }
      return send(command, options);
    });
    try {
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 1,
        deleted: 1,
        failed: 0,
      });
    } finally {
      spy.mockRestore();
      held.client.destroy();
      await held.proxy.close();
    }
    await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await retired(objectKey)).toHaveLength(1);
    expect(await rows()).toEqual([]);
  }, 30000);

  it('never lists, records or deletes an incomplete multipart upload', async () => {
    const objectKey = `users/${OWNER}/references/${randomUUID()}`;
    const multipart = await storage.client.send(
      new CreateMultipartUploadCommand({ Bucket: storage.bucket, Key: objectKey }),
    );
    if (!multipart.UploadId) throw new Error('Multipart upload id missing');
    try {
      await storage.client.send(
        new UploadPartCommand({
          Bucket: storage.bucket,
          Key: objectKey,
          UploadId: multipart.UploadId,
          PartNumber: 1,
          Body: 'dangling-part',
        }),
      );
      // Probe record: the bucket genuinely carries a dangling upload.
      const uploads = await storage.client.send(
        new ListMultipartUploadsCommand({ Bucket: storage.bucket }),
      );
      expect(uploads.Uploads?.some((upload) => upload.Key === objectKey)).toBe(true);
      await scan();
      expect(await rows()).toEqual([]);
      await expireGrace();
      expect(await processObjectInventoryCandidates(deps())).toMatchObject({
        claimed: 0,
        deleted: 0,
        failed: 0,
      });
      const surviving = await storage.client.send(
        new ListMultipartUploadsCommand({ Bucket: storage.bucket }),
      );
      expect(surviving.Uploads?.some((upload) => upload.Key === objectKey)).toBe(true);
      await expect(head(objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    } finally {
      await storage.client.send(
        new AbortMultipartUploadCommand({
          Bucket: storage.bucket,
          Key: objectKey,
          UploadId: multipart.UploadId,
        }),
      );
    }
  }, 30000);

  it('keeps the declared registry size exact when a dropped PUT response drives the SDK retry overwrite', async () => {
    const objectKey = `users/${OWNER}/references/${randomUUID()}`;
    const body = Buffer.from('retry-overwrite-payload');
    const proxy = await createDelayedPutProxy(storage.endpoint);
    proxy.release(); // Forward immediately; only the first success response is withheld.
    proxy.dropNextResponses(1);
    const client = new S3Client({
      endpoint: proxy.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'gc-fixture-owner',
        secretAccessKey: 'synthetic-gc-storage-password',
      },
      // SDK default retry policy: the retried PUT resends the identical buffered body.
      requestHandler: {
        connectionTimeout: 1000,
        requestTimeout: 1200,
        throwOnRequestTimeout: true,
      },
    });
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: objectKey,
          Body: body,
          ContentType: 'image/png',
        }),
      );
      expect(proxy.dropped).toEqual([objectKey]);
      expect(proxy.forwarded.length).toBeGreaterThanOrEqual(2);
      const object = await head(objectKey);
      expect(object.ContentLength).toBe(body.length);
      // MinIO reports the content MD5 as ETag for plain PUTs: identical bytes, zero drift.
      expect(object.ETag).toBe(`"${createHash('md5').update(body).digest('hex')}"`);
      const stored = await storage.client.send(
        new GetObjectCommand({ Bucket: storage.bucket, Key: objectKey }),
      );
      if (!stored.Body) throw new Error('Missing retried object body');
      expect(Buffer.from(await stored.Body.transformToByteArray()).equals(body)).toBe(true);
      // uploadReferenceImage persists input.bytes.byteLength; it matches the retried object.
      await database.pool.query(
        `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
         VALUES($1,$2,$3,'retry.png','image/png',$4,'available',$5)`,
        [randomUUID(), OWNER, objectKey, body.length, new Date(now.getTime() + INVENTORY_GRACE_MS)],
      );
      const [registry] = (
        await database.pool.query(
          'SELECT byte_size FROM generation_reference_uploads WHERE object_key=$1',
          [objectKey],
        )
      ).rows;
      expect(registry.byte_size).toBe(object.ContentLength);
    } finally {
      client.destroy();
      await proxy.close();
    }
  }, 30000);
});
