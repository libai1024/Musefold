import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase, retireDesignSchemePackageStages } from '@musefold/db';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresObjectCleanupStore } from '../tasks.js';
import { processObjectCleanupBatch } from '../tasks.js';
import { S3Client } from '@aws-sdk/client-s3';
import { createServer } from 'node:http';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('package staging uses existing object cleanup with durable upload fences', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let cleanup: PostgresObjectCleanupStore;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    await migrateDatabase(database.db);
    cleanup = new PostgresObjectCleanupStore(database.db);
  }, 180_000);
  beforeEach(async () => {
    await database.pool.query('DELETE FROM "user"');
    await database.pool.query('DELETE FROM object_cleanup_queue');
    await database.pool.query(
      "INSERT INTO \"user\" (id,name,email) VALUES ('package-gc','package-gc','package-gc@example.test')",
    );
    await database.pool.query(`INSERT INTO design_scheme_package_stages
      (id,user_id,request_id,request_hash,package_hash,byte_size,format_version,parser_version,object_key,status,authority_hash,expires_at,upload_lease_until)
      VALUES ('stage','package-gc','request',repeat('a',64),repeat('b',64),4,2,1,'packages/test','uploading',repeat('c',64),now()+interval '1 hour',now()+interval '2 minutes')`);
    await database.pool.query(`INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
      VALUES ('stage','package-gc','packages/test','scheme.musefold.design','application/octet-stream',4,'uploading',now()+interval '1 hour')`);
    await database.pool.query(`INSERT INTO object_cleanup_queue (object_key,owner_id,object_type,reason,next_attempt_at)
      VALUES ('packages/test','package-gc','generation_reference','reference_expired',now()+interval '1 hour')`);
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });
  it('protects in-flight PUT even after cancellation; expires the protection at the recorded lease', async () => {
    await database.pool.query("UPDATE design_scheme_package_stages SET status='cancelled'");
    expect(await cleanup.findProtected(['packages/test'])).toEqual({
      permanent: [],
      leased: ['packages/test'],
    });
    await database.pool.query(
      "UPDATE design_scheme_package_stages SET upload_lease_until=now()-interval '1 second'",
    );
    expect(await cleanup.findProtected(['packages/test'])).toEqual({ permanent: [], leased: [] });
  });
  it('retires a crashed uploader after its lease, queues cleanup and permits an idempotent acknowledgement', async () => {
    expect(await retireDesignSchemePackageStages(database.db)).toBe(0);
    await database.pool.query(
      "UPDATE design_scheme_package_stages SET upload_lease_until=now()-interval '1 second'",
    );
    expect(await retireDesignSchemePackageStages(database.db)).toBe(1);
    expect(await retireDesignSchemePackageStages(database.db)).toBe(0);
    expect(
      (await database.pool.query('SELECT status FROM design_scheme_package_stages')).rows[0].status,
    ).toBe('expired');
    expect(await cleanup.findProtected(['packages/test'])).toEqual({ permanent: [], leased: [] });
    const claimed = await cleanup.claimDue();
    expect(claimed.map((row) => row.objectKey)).toEqual(['packages/test']);
    await cleanup.acknowledge(['packages/test']);
    await cleanup.acknowledge(['packages/test']);
    expect(
      (await database.pool.query('SELECT count(*) FROM generation_reference_uploads')).rows[0]
        .count,
    ).toBe('0');
  });
  it('keeps cleanup intent after account cascade removes both stage and upload registry', async () => {
    await database.pool.query('DELETE FROM "user" WHERE id=\'package-gc\'');
    expect(
      (await database.pool.query('SELECT count(*) FROM design_scheme_package_stages')).rows[0]
        .count,
    ).toBe('0');
    expect((await database.pool.query('SELECT * FROM object_cleanup_queue')).rows).toHaveLength(1);
    expect(await cleanup.findProtected(['packages/test'])).toEqual({ permanent: [], leased: [] });
  });

  async function seedImport() {
    await database.pool.query(`INSERT INTO design_scheme_package_imports
      (stage_id,user_id,request_hash,authority_hash,confirmation_hash,parser_version,mapping_version,seed,attempt_id,epoch,status,lease_until)
      VALUES ('stage','package-gc',repeat('a',64),repeat('b',64),repeat('c',64),1,1,
        '713188f7-5410-488f-a849-5b736df58b45','8cb44d8b-f2a3-4f6c-87d8-e567ce90bfe5',1,'running',now()+interval '2 minutes')`);
  }
  const importedKey = 'scheme-imports/stage/8cb44d8b-f2a3-4f6c-87d8-e567ce90bfe5/file';
  it('protects only the current import attempt namespace until its durable lease expires', async () => {
    await seedImport();
    const stale = 'scheme-imports/stage/stale/file';
    expect(await cleanup.findProtected([importedKey, stale])).toEqual({
      permanent: [],
      leased: [importedKey],
    });
    await database.pool.query(
      "UPDATE design_scheme_package_imports SET lease_until=now()-interval '1 second'",
    );
    expect(await cleanup.findProtected([importedKey, stale])).toEqual({
      permanent: [],
      leased: [],
    });
  });

  it('keeps the promoted import outbox while referenced, then actually deletes through S3 after account cascade', async () => {
    await seedImport();
    await database.pool.query(`INSERT INTO design_schemes
      (id,user_id,name,status,source_presentation,current_revision_id,fidelity)
      VALUES ('scheme','package-gc','GC fixture','draft','musefold-created','revision','adapted')`);
    await database.pool.query(`INSERT INTO design_scheme_revisions(revision_id,scheme_id,user_id,schema_version,document,created_by)
      VALUES ('revision','scheme','package-gc',1,'{"schemeId":"scheme","revisionId":"revision"}','import')`);
    await database.pool.query(
      `INSERT INTO design_scheme_assets
      (id,user_id,revision_id,object_key,role,origin,mime_type,width,height,byte_size,content_hash)
      VALUES ('imported','package-gc','revision',$1,'example','uploaded','image/png',1,1,4,repeat('a',64))`,
      [importedKey],
    );
    await database.pool.query(
      `INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at,cleanup_queued_at)
      VALUES ('imported','package-gc',$1,'content','application/octet-stream',4,'cleanup_pending',now()+interval '2 minutes',now())`,
      [importedKey],
    );
    await database.pool.query(
      `INSERT INTO object_cleanup_queue(object_key,owner_id,object_type,reason,next_attempt_at)
      VALUES ($1,'package-gc','generation_reference','reference_expired','1970-01-01Z')`,
      [importedKey],
    );
    const objects = new Set([importedKey]);
    const deleted: string[] = [];
    const server = createServer(async (request, response) => {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.from(part));
      if (request.method !== 'POST' || !request.url?.includes('delete')) {
        response.writeHead(400);
        response.end();
        return;
      }
      const keys = [
        ...Buffer.concat(parts)
          .toString()
          .matchAll(/<Key>([^<]+)<\/Key>/g),
      ].map((match) => match[1]);
      for (const key of keys) {
        objects.delete(key);
        deleted.push(key);
      }
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end(
        `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${keys.map((key) => `<Deleted><Key>${key}</Key></Deleted>`).join('')}</DeleteResult>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const s3 = new S3Client({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'synthetic-key', secretAccessKey: 'synthetic-secret' },
    });
    try {
      const protectedBatch = await processObjectCleanupBatch(cleanup, s3, 'test');
      expect(protectedBatch).toMatchObject({ protected: 1, deleted: 0, failed: 0 });
      expect(deleted).toHaveLength(0);
      expect(
        (
          await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
            importedKey,
          ])
        ).rows,
      ).toHaveLength(1);
      await database.pool.query('DELETE FROM "user" WHERE id=\'package-gc\'');
      await database.pool.query(
        "UPDATE object_cleanup_queue SET next_attempt_at=now()-interval '1 second' WHERE object_key=$1",
        [importedKey],
      );
      const batch = await processObjectCleanupBatch(cleanup, s3, 'test');
      expect(batch).toMatchObject({ protected: 0, deleted: 1, failed: 0 });
      expect(deleted).toEqual([importedKey]);
      expect(objects.has(importedKey)).toBe(false);
      expect(
        (
          await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
            importedKey,
          ])
        ).rows,
      ).toHaveLength(0);
    } finally {
      s3.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  async function seedExport() {
    await database.pool.query(`INSERT INTO design_scheme_package_exports
      (id,user_id,request_id,request_hash,authority_hash,scheme_id,revision_id,expected_version,basis_hash,object_key,status,package_hash,size_bytes,lease_until,expires_at)
      VALUES ('export','package-gc','export-request',repeat('a',64),repeat('a',64),'scheme','revision',1,repeat('b',64),'scheme-exports/export','ready',repeat('c',64),4,now()+interval '2 minutes',now()+interval '1 hour')`);
    await database.pool.query(`INSERT INTO object_cleanup_queue(object_key,owner_id,object_type,reason,next_attempt_at)
      VALUES ('scheme-exports/export','package-gc','generation_reference','reference_expired','1970-01-01Z')`);
  }
  it('protects a ready export until TTL and cancelled in-flight writes until their lease, keeping the cleanup intent', async () => {
    await seedExport();
    expect(await cleanup.findProtected(['scheme-exports/export'])).toEqual({
      permanent: [],
      leased: ['scheme-exports/export'],
    });
    await database.pool.query(
      "UPDATE design_scheme_package_exports SET lease_until=now()-interval '1 second'",
    );
    expect((await cleanup.findProtected(['scheme-exports/export'])).leased).toEqual([
      'scheme-exports/export',
    ]);
    await database.pool.query(
      "UPDATE design_scheme_package_exports SET status='cancelled',lease_until=now()+interval '2 minutes'",
    );
    expect((await cleanup.findProtected(['scheme-exports/export'])).leased).toEqual([
      'scheme-exports/export',
    ]);
    await database.pool.query(
      "UPDATE design_scheme_package_exports SET lease_until=now()-interval '1 second'",
    );
    expect(await cleanup.findProtected(['scheme-exports/export'])).toEqual({
      permanent: [],
      leased: [],
    });
    expect(
      (
        await database.pool.query(
          "SELECT * FROM object_cleanup_queue WHERE object_key='scheme-exports/export'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it('keeps export cleanup independent after account cascade and actually deletes with the S3 protocol', async () => {
    await seedExport();
    const deleted: string[] = [];
    const server = createServer(async (request, response) => {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.from(part));
      const keys = [
        ...Buffer.concat(parts)
          .toString()
          .matchAll(/<Key>([^<]+)<\/Key>/g),
      ].map((m) => m[1]);
      deleted.push(...keys);
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end(
        `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${keys.map((key) => `<Deleted><Key>${key}</Key></Deleted>`).join('')}</DeleteResult>`,
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const s3 = new S3Client({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'synthetic-key', secretAccessKey: 'synthetic-secret' },
    });
    try {
      expect(await processObjectCleanupBatch(cleanup, s3, 'test')).toMatchObject({
        protected: 1,
        deleted: 0,
      });
      await database.pool.query('DELETE FROM "user"');
      expect(
        (await database.pool.query('SELECT * FROM design_scheme_package_exports')).rows,
      ).toHaveLength(0);
      await database.pool.query(
        "UPDATE object_cleanup_queue SET next_attempt_at=now()-interval '1 second' WHERE object_key='scheme-exports/export'",
      );
      expect(await processObjectCleanupBatch(cleanup, s3, 'test')).toMatchObject({
        protected: 0,
        deleted: 1,
        failed: 0,
      });
      expect(deleted).toEqual(['scheme-exports/export']);
      expect(
        (
          await database.pool.query(
            "SELECT * FROM object_cleanup_queue WHERE object_key='scheme-exports/export'",
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      s3.destroy();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
