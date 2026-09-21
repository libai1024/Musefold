import { randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createDatabase, enqueueObjectCleanup, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresObjectCleanupStore, processObjectCleanupBatch } from '../tasks.js';
import { createDisposableObjectStorage } from './fixtures/disposable-object-storage.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('object retirement serializes canonical publication with real storage deletion', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let storage: Awaited<ReturnType<typeof createDisposableObjectStorage>>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    storage = await createDisposableObjectStorage();
    await database.pool.query(
      `INSERT INTO "user"(id,name,email) VALUES ('publication-owner','Owned','publication@example.test')`,
    );
  }, 180000);
  afterAll(async () => {
    await storage?.close();
    await database?.pool.end();
    await container?.stop();
  });

  it('rejects publication after the final cleanup authorization instead of leaving a dangling asset', async () => {
    const runId = randomUUID();
    const assetId = randomUUID();
    const key = `users/publication-owner/generations/${runId}/${assetId}`;
    await database.pool.query(
      `INSERT INTO generation_runs(id,user_id,status,request) VALUES ($1,'publication-owner','succeeded','{}')`,
      [runId],
    );
    await storage.client.send(
      new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: 'owned-output' }),
    );
    await enqueueObjectCleanup(
      database.db,
      [
        {
          objectKey: key,
          ownerId: 'publication-owner',
          objectType: 'generation_asset',
          reason: 'generation_compensation',
        },
      ],
      new Date(0),
    );
    let publicationError: unknown;
    const result = await processObjectCleanupBatch(
      new PostgresObjectCleanupStore(database.db),
      storage.client,
      storage.bucket,
      async (s3, bucket, keys) => {
        // This independent SQL writer runs after final authorization. The real
        // database guard must cover callers without relying on their preflight.
        try {
          await database.pool.query(
            `INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,checksum_sha256)
              VALUES($1,$2,'publication-owner',$3,'image/png',1,1,repeat('a',64))`,
            [assetId, runId, key],
          );
        } catch (error) {
          publicationError = error;
        }
        const response = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (response.Errors?.length) throw new Error('Owned fixture deletion failed');
      },
    );
    expect(publicationError).toMatchObject({ code: 'P0001', message: 'ObjectStorageKeyRetired' });
    expect(result).toMatchObject({ deleted: 1, protected: 0, failed: 0 });
    expect(
      (await database.pool.query('SELECT id FROM generation_assets WHERE id=$1', [assetId])).rows,
    ).toEqual([]);
    await expect(
      storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key })),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(
      (
        await database.pool.query(
          'SELECT object_key FROM object_cleanup_queue WHERE object_key=$1',
          [key],
        )
      ).rows,
    ).toEqual([]);
  });
});
