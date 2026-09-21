import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  S3Client,
  DeleteBucketPolicyCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createDatabase, enqueueObjectCleanup, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PostgresObjectCleanupStore,
  processObjectCleanupBatch,
  uploadImagesForGeneration,
} from '../tasks.js';
import { createLostStorageResponseProxy } from './fixtures/lost-storage-response.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('asset cleanup against disposable PostgreSQL and actual MinIO', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    storage = await createDisposableObjectStorage();
    await database.pool.query(`INSERT INTO "user" (id,name,email)
      VALUES ('gc-owner','GC','gc-owner@example.test')`);
    console.info('[gc fixture]', { imageId: storage.imageId, version: storage.version });
  }, 180000);
  afterAll(async () => {
    await storage?.close();
    await database?.pool.end();
    await container?.stop();
  });
  const queue = async (key: string, now: Date) =>
    enqueueObjectCleanup(
      database.db,
      [
        {
          objectKey: key,
          ownerId: 'gc-owner',
          objectType: 'generation_reference',
          reason: 'reference_expired',
        },
      ],
      now,
    );
  const read = async (key: string) =>
    (
      await storage.client.send(
        new GetObjectCommand({
          Bucket: storage.bucket,
          Key: key,
        }),
      )
    ).Body?.transformToString();
  const put = async (key: string) =>
    storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: 'original-owned-by-fixture',
      }),
    );
  const cleanup = (now: Date) =>
    processObjectCleanupBatch(
      new PostgresObjectCleanupStore(database.db),
      storage.client,
      storage.bucket,
      undefined,
      now,
    );

  it('retains unlinked live upload bytes, then deletes at exact expiry and remains idempotent', async () => {
    const now = new Date();
    const id = randomUUID();
    const key = `users/gc-owner/references/${id}`;
    await database.pool.query(
      `INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      VALUES ($1,'gc-owner',$2,'owned.png','image/png',25,'available',$3)`,
      [id, key, new Date(now.getTime() + 1000)],
    );
    await put(key);
    await queue(key, now);
    expect(await cleanup(now)).toEqual({
      expiredReferences: 0,
      deleted: 0,
      protected: 1,
      failed: 0,
    });
    expect(await read(key)).toBe('original-owned-by-fixture');
    expect(await cleanup(new Date(now.getTime() + 1000))).toEqual({
      expiredReferences: 1,
      deleted: 1,
      protected: 0,
      failed: 0,
    });
    await expect(
      storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key })),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await cleanup(new Date(now.getTime() + 2000))).toEqual({
      expiredReferences: 0,
      deleted: 0,
      protected: 0,
      failed: 0,
    });
    expect((await database.pool.query('SELECT id FROM generation_reference_uploads')).rows).toEqual(
      [],
    );
  });

  it('preserves retirement and denied-delete intent through attempt 12 and an explicit retry', async () => {
    const now = new Date();
    const key = `users/gc-owner/references/${randomUUID()}`;
    await put(key);
    await queue(key, now);
    await storage.client.send(
      new PutBucketPolicyCommand({
        Bucket: storage.bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Deny',
              Principal: '*',
              Action: ['s3:DeleteObject'],
              Resource: [`arn:aws:s3:::${storage.bucket}/${key}`],
            },
          ],
        }),
      }),
    );
    const restricted = storage.anonymousClient();
    try {
      const denied = await restricted.send(
        new DeleteObjectsCommand({
          Bucket: storage.bucket,
          Delete: { Objects: [{ Key: key }], Quiet: true },
        }),
      );
      expect(denied.$metadata.httpStatusCode).toBe(200);
      expect(denied.Errors).toEqual([expect.objectContaining({ Key: key, Code: 'AccessDenied' })]);
      for (let attempt = 1; attempt <= 12; attempt++) {
        // Accelerate only next_attempt_at; preserve actual attempt/abandonment accounting.
        await database.pool.query(
          'UPDATE object_cleanup_queue SET next_attempt_at=$2 WHERE object_key=$1',
          [key, now],
        );
        expect(
          await processObjectCleanupBatch(
            new PostgresObjectCleanupStore(database.db),
            restricted,
            storage.bucket,
            undefined,
            now,
          ),
        ).toEqual({
          expiredReferences: 0,
          deleted: 0,
          protected: 0,
          failed: 1,
        });
        const row = (
          await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [key])
        ).rows[0];
        expect(row.attempt_count).toBe(attempt);
        expect(row.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
        expect(row.last_error).toBe('S3DeleteObjectsError');
        expect(Boolean(row.abandoned_at)).toBe(attempt === 12);
        expect(await read(key)).toBe('original-owned-by-fixture');
      }
    } finally {
      restricted.destroy();
      await storage.client.send(new DeleteBucketPolicyCommand({ Bucket: storage.bucket }));
    }
    expect(await cleanup(new Date(now.getTime() + 86400000))).toEqual({
      expiredReferences: 0,
      deleted: 0,
      protected: 0,
      failed: 0,
    });
    // Committed retirement survives failed storage IO; this key cannot become live again.
    await expect(
      database.pool.query(
        `INSERT INTO generation_reference_uploads
        (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
        VALUES ($1,'gc-owner',$2,'owned.png','image/png',25,'available',$3)`,
        [randomUUID(), key, new Date(now.getTime() + 1000)],
      ),
    ).rejects.toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
    await database.pool.query(
      `UPDATE object_cleanup_queue SET abandoned_at=NULL,
      attempt_count=0,next_attempt_at=$2 WHERE object_key=$1`,
      [key, now],
    );
    expect(await cleanup(now)).toEqual({
      expiredReferences: 0,
      deleted: 1,
      protected: 0,
      failed: 0,
    });
    await expect(
      storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key })),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(
      (await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [key]))
        .rows,
    ).toEqual([]);
    expect(
      (
        await database.pool.query(
          "SELECT * FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
          [key],
        )
      ).rowCount,
    ).toBe(1);
    expect(await cleanup(now)).toEqual({
      expiredReferences: 0,
      deleted: 0,
      protected: 0,
      failed: 0,
    });
  }, 30000);

  it('rechecks references when an operator retries an abandoned intent from before retirement guards', async () => {
    const now = new Date();
    const key = `users/gc-owner/references/${randomUUID()}`;
    await put(key);
    await queue(key, now);
    // Owned legacy persisted state: old workers did not write retirement hashes.
    await database.pool.query(
      `UPDATE object_cleanup_queue SET abandoned_at=$2,attempt_count=12,
      last_error='S3DeleteObjectsError' WHERE object_key=$1`,
      [key, now],
    );
    expect(
      (
        await database.pool.query(
          "SELECT * FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
          [key],
        )
      ).rows,
    ).toEqual([]);
    expect(await cleanup(now)).toEqual({
      expiredReferences: 0,
      deleted: 0,
      protected: 0,
      failed: 0,
    });
    // Simulated operator requeue must respect a newly committed valid reference.
    const id = randomUUID();
    await database.pool.query(
      `INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      VALUES ($1,'gc-owner',$2,'owned.png','image/png',25,'available',$3)`,
      [id, key, new Date(now.getTime() + 1000)],
    );
    await database.pool.query(
      `UPDATE object_cleanup_queue SET abandoned_at=NULL,
      attempt_count=0,next_attempt_at=$2 WHERE object_key=$1`,
      [key, now],
    );
    expect(await cleanup(now)).toEqual({
      expiredReferences: 0,
      deleted: 0,
      protected: 1,
      failed: 0,
    });
    expect(await read(key)).toBe('original-owned-by-fixture');
    expect(await cleanup(new Date(now.getTime() + 1000))).toEqual({
      expiredReferences: 1,
      deleted: 1,
      protected: 0,
      failed: 0,
    });
  }, 30000);

  it('reclaims an ambiguous PUT whose bytes reached MinIO before the client timed out', async () => {
    const now = new Date();
    const proxy = await createLostStorageResponseProxy(storage.endpoint);
    const client = new S3Client({
      endpoint: proxy.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'gc-fixture-owner',
        secretAccessKey: 'synthetic-gc-storage-password',
      },
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 1000, requestTimeout: 500, throwOnRequestTimeout: true },
    });
    const keys: string[] = [];
    const bytes = Buffer.from('owned-generated-object');
    try {
      await expect(
        uploadImagesForGeneration(
          client,
          storage.bucket,
          { userId: 'gc-owner', runId: randomUUID() },
          [{ bytes, mimeType: 'image/png', width: 1, height: 1 }],
          keys,
          (objectKey) =>
            enqueueObjectCleanup(
              database.db,
              [
                {
                  objectKey,
                  ownerId: 'gc-owner',
                  objectType: 'generation_asset',
                  reason: 'generation_compensation',
                },
              ],
              now,
            ),
        ),
      ).rejects.toMatchObject({ name: 'ObjectStorageError', cause: { name: 'TimeoutError' } });
      expect(proxy.accepted).toEqual([200]);
      expect(keys).toHaveLength(1);
      expect(await read(keys[0])).toBe(bytes.toString());
      const row = (
        await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', keys)
      ).rows[0];
      expect(row.reason).toBe('generation_compensation');
      expect(row.attempt_count).toBe(0);
      expect(await cleanup(now)).toEqual({
        expiredReferences: 0,
        deleted: 1,
        protected: 0,
        failed: 0,
      });
      await expect(
        storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: keys[0] })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    } finally {
      client.destroy();
      await proxy.close();
    }
  });

  it('keeps objects and retry facts across an actual storage stop and restart', async () => {
    const now = new Date();
    const key = `users/gc-owner/references/${randomUUID()}`;
    await put(key);
    await queue(key, now);
    await storage.stop();
    try {
      expect(await cleanup(now)).toEqual({
        expiredReferences: 0,
        deleted: 0,
        protected: 0,
        failed: 1,
      });
      const row = (
        await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [key])
      ).rows[0];
      expect(row.attempt_count).toBe(1);
      expect(row.abandoned_at).toBeNull();
      expect(row.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
    } finally {
      await storage.start();
    }
    expect(await read(key)).toBe('original-owned-by-fixture');
    // Waiting is explicit simulated time; the container stop/restart and bytes are real.
    expect(await cleanup(new Date(now.getTime() + 300000))).toEqual({
      expiredReferences: 0,
      deleted: 1,
      protected: 0,
      failed: 0,
    });
    expect((await database.pool.query('SELECT * FROM object_cleanup_queue')).rows).toEqual([]);
  }, 30000);
});
