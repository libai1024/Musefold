import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresObjectCleanupStore, processObjectCleanupBatch } from '../tasks.js';
import { createProcessTestServer } from './fixtures/process-runtime.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const now = new Date('2026-09-14T00:00:00Z');
describeDb('reference upload cleanup drains a 1001-object backlog through real HTTP', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let server: Awaited<ReturnType<typeof createProcessTestServer>>;
  let s3: S3Client;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    server = await createProcessTestServer();
    s3 = new S3Client({
      endpoint: server.url,
      region: 'owned',
      forcePathStyle: true,
      credentials: { accessKeyId: 'owned', secretAccessKey: 'owned' },
    });
  }, 180000);
  afterAll(async () => {
    s3?.destroy();
    await server?.close();
    await database?.pool.end();
    await container?.stop();
  });
  it('preserves a future owner peer, removes only 100 objects per batch and ends with an empty outbox/no-op', async () => {
    await database.pool.query(
      `INSERT INTO "user"(id,name,email) VALUES ('owned','Owned','owned@example.test'),('peer','Peer','peer@example.test')`,
    );
    await database.pool.query(`INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      SELECT 'ref-'||n,'owned','owned/reference/'||n,'Owned','image/png',4,'available','2026-01-01Z' FROM generate_series(1,1001) n`);
    await database.pool.query(`INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      VALUES ('future','peer','owned/future','Owned','image/png',4,'available','2027-01-01Z')`);
    const peer = (
      await database.pool.query("SELECT * FROM generation_reference_uploads WHERE id='future'")
    ).rows;
    const keys = [
      ...Array.from({ length: 1001 }, (_, i) => `owned/reference/${i + 1}`),
      'owned/future',
    ];
    // Real AWS SDK PUT/DeleteObjects to owned HTTP storage, not production S3 or natural TTL.
    for (let offset = 0; offset < keys.length; offset += 20) {
      await Promise.all(
        keys
          .slice(offset, offset + 20)
          .map((Key) =>
            s3.send(
              new PutObjectCommand({ Bucket: 'test-bucket', Key, Body: Buffer.from('test') }),
            ),
          ),
      );
    }
    expect(server.objects.size).toBe(1002);
    const store = new PostgresObjectCleanupStore(database.db);
    for (let batch = 0; batch < 11; batch++) {
      const count = batch === 10 ? 1 : 100;
      expect(await processObjectCleanupBatch(store, s3, 'test-bucket', undefined, now)).toEqual({
        expiredReferences: count,
        deleted: count,
        protected: 0,
        failed: 0,
      });
      expect(server.objects.size).toBe(1002 - Math.min((batch + 1) * 100, 1001));
      expect(
        (await database.pool.query("SELECT * FROM generation_reference_uploads WHERE id='future'"))
          .rows,
      ).toEqual(peer);
      expect(
        Number(
          (await database.pool.query('SELECT count(*) AS n FROM object_cleanup_queue')).rows[0].n,
        ),
      ).toBe(0);
    }
    expect(await processObjectCleanupBatch(store, s3, 'test-bucket', undefined, now)).toEqual({
      expiredReferences: 0,
      deleted: 0,
      protected: 0,
      failed: 0,
    });
    expect([...server.objects.keys()]).toEqual(['owned/future']);
    expect(server.objects.get('owned/future')).toEqual(Buffer.from('test'));
    expect((await database.pool.query('SELECT id FROM generation_reference_uploads')).rows).toEqual(
      [{ id: 'future' }],
    );
    expect(server.calls.size).toBe(0);
  }, 30000);
});
