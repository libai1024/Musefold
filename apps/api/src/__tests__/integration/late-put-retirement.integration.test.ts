import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { generationRoutes } from '../../modules/generation/routes.js';
import type { AssetUrlSigner } from '../../modules/generation/s3-signer.js';
import { GenerationService } from '../../modules/generation/service.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import { packageHash } from '../../modules/design-scheme-packages/bytes.js';
import { packageFixture } from '../../modules/design-scheme-packages/__tests__/fixture.js';
import { DesignSchemePackageService } from '../../modules/design-scheme-packages/service.js';
import {
  GENERATION_TEST_ISSUERS,
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const OWNER = 'late-put-owner';
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4aQAAAAASUVORK5CYII=',
  'base64',
);

/**
 * D02.3 S1 confirm path: the PUT already landed (or its response is held) while the
 * DB confirmation runs against a key the GC has since retired. The publication
 * trigger must reject the confirm (P0001) and each path's own compensation must
 * persist cleanup_pending + outbox intent.
 */
describeDb('late PUT confirmation against a retired key', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let server: ReturnType<typeof serve> | undefined;
  let base = '';

  /** SQL twin of worker retireUnprotectedObjects for a key verified unprotected. */
  async function retireKeySql(objectKey: string) {
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query('SELECT musefold_lock_storage_key($1)', [objectKey]);
      await client.query(
        `INSERT INTO object_key_retirements(key_hash) VALUES(encode(sha256(convert_to($1,'UTF8')),'hex')) ON CONFLICT DO NOTHING`,
        [objectKey],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const retired = async (objectKey: string) =>
    (
      await database.pool.query(
        `SELECT key_hash FROM object_key_retirements WHERE key_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,
        [objectKey],
      )
    ).rows;
  const outbox = async (objectKey: string) =>
    (
      await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
        objectKey,
      ])
    ).rows;
  const registry = async (objectKey: string) =>
    (
      await database.pool.query('SELECT * FROM generation_reference_uploads WHERE object_key=$1', [
        objectKey,
      ])
    ).rows;
  const insertRegistry = (objectKey: string, status: 'uploading' | 'cleanup_pending') =>
    database.pool.query(
      `INSERT INTO generation_reference_uploads(id,user_id,object_key,original_name,mime_type,byte_size,status,expires_at)
       VALUES($1,$2,$3,'late.png','image/png',17,$4,now()+interval '1 hour')`,
      [randomUUID(), OWNER, objectKey, status],
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 10 });
    await migrateDatabase(database.db);
    await database.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [
      OWNER,
      `${OWNER}@example.test`,
    ]);
    await seedGenerationAuthority(database.db, { principalId: OWNER, ownerId: OWNER });
    s3 = await startS3Fixture(256 * 1024 * 1024);
  }, 180000);
  beforeEach(async () => {
    await database.pool.query('DELETE FROM design_scheme_package_stages');
    await database.pool.query('DELETE FROM generation_reference_uploads');
    await database.pool.query('DELETE FROM object_cleanup_queue');
    await database.pool.query('DELETE FROM object_key_retirements');
    s3.objects.clear();
    s3.writes.length = 0;
    await database.pool.query(
      "UPDATE account_session_authorizations SET mode='normal', revision=1",
    );
  });
  afterAll(async () => {
    const running = server;
    if (running) {
      if ('closeAllConnections' in running) running.closeAllConnections();
      await new Promise<void>((resolve) => running.close(() => resolve()));
    }
    await s3?.close();
    await database?.pool.end();
    await container?.stop();
  });

  it('rejects the reference-upload confirm with P0001 after retirement and persists its compensation', async () => {
    // The PUT completes against storage; before UPDATE→available the registry lease
    // is cleared (24h TTL passed) and the inventory executor retires the orphan key.
    const putKeys: string[] = [];
    const signer: AssetUrlSigner = {
      urlTtlSeconds: 60,
      sign: () => Promise.reject(new Error('unexpected sign')),
      readObject: () => Promise.reject(new Error('unexpected read')),
      removeObjects: () => Promise.reject(new Error('unexpected remove')),
      putObject: async (objectKey) => {
        putKeys.push(objectKey);
        await database.pool.query(
          `UPDATE generation_reference_uploads SET expires_at=now()-interval '1 second' WHERE object_key=$1`,
          [objectKey],
        );
        await retireKeySql(objectKey);
      },
    };
    const generation = new GenerationService(database.db, signer, GENERATION_TEST_ISSUERS);
    const error = await generation
      .uploadReferenceImage(OWNER, { name: 'late.png', bytes: new Uint8Array(PNG) })
      .then(
        () => null,
        (caught) => caught,
      );
    // The fenced confirm maps to a 409 conflict like the package stage confirm path.
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 409,
      retryable: false,
      details: { reason: 'REFERENCE_UPLOAD_RETIRED' },
    });
    expect(putKeys).toHaveLength(1);
    const objectKey = putKeys[0];
    const [row] = await registry(objectKey);
    expect(row.status).toBe('cleanup_pending');
    expect(row.cleanup_queued_at).not.toBeNull();
    expect(await outbox(objectKey)).toHaveLength(1);
    expect((await outbox(objectKey))[0].reason).toBe('reference_upload_failed');
    expect(await retired(objectKey)).toHaveLength(1);
  }, 30000);

  it('surfaces the fenced confirm over HTTP as a 409 conflict and still compensates', async () => {
    const signer: AssetUrlSigner = {
      urlTtlSeconds: 60,
      sign: () => Promise.reject(new Error('unexpected sign')),
      readObject: () => Promise.reject(new Error('unexpected read')),
      removeObjects: () => Promise.reject(new Error('unexpected remove')),
      putObject: async (objectKey) => {
        await database.pool.query(
          `UPDATE generation_reference_uploads SET expires_at=now()-interval '1 second' WHERE object_key=$1`,
          [objectKey],
        );
        await retireKeySql(objectKey);
      },
    };
    const generation = new GenerationService(database.db, signer, GENERATION_TEST_ISSUERS);
    const app = new OpenAPIHono<AuthedEnv>();
    app.use('*', async (c, next) => {
      c.set('userId', OWNER);
      c.set('sessionId', generationAuthSession(OWNER));
      await next();
    });
    // Mirrors app.ts: unmapped database errors become a retryable 500.
    app.onError((error, c) => {
      if (error instanceof AppError)
        return c.json(toErrorBody(error, 'late-put-test'), error.status as 400);
      return c.json(
        toErrorBody(new AppError('INTERNAL_ERROR', '服务内部错误', 500, true), 'late-put-test'),
        500,
      );
    });
    app.route('/', generationRoutes(generation));
    const http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    server = http;
    await new Promise<void>((resolve) => http.once('listening', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    base = `http://127.0.0.1:${address.port}`;
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'late.png');
    const response = await fetch(`${base}/reference-images`, { method: 'POST', body: form });
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { code: string; retryable: boolean; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.retryable).toBe(false);
    expect(body.error.details).toMatchObject({ reason: 'REFERENCE_UPLOAD_RETIRED' });
    const rows = await database.pool.query(
      `SELECT object_key, status FROM generation_reference_uploads`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe('cleanup_pending');
    expect(await outbox(rows.rows[0].object_key)).toHaveLength(1);
    expect(await retired(rows.rows[0].object_key)).toHaveLength(1);
  }, 30000);

  it('fails the package stage confirm after retirement and keeps registry cleanup_pending plus outbox intent', async () => {
    const service = new DesignSchemePackageService(database.db, s3.storage);
    const bytes = await packageFixture();
    const stage = await service.begin(OWNER, generationAuthSession(OWNER), {
      requestId: randomUUID(),
      packageHash: packageHash(bytes),
      sizeBytes: bytes.length,
      formatVersion: 2,
    });
    const [stored] = (
      await database.pool.query('SELECT * FROM design_scheme_package_stages WHERE id=$1', [
        stage.stagedPackageId,
      ])
    ).rows;
    s3.holdNext('PUT');
    const upload = service.upload(
      OWNER,
      generationAuthSession(OWNER),
      stage.stagedPackageId,
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    const rejected = expect(upload).rejects.toMatchObject({ status: 409 });
    await expect.poll(() => s3.barriers.length, { timeout: 5000, interval: 20 }).toBe(1);
    // The upload lease lapses while the PUT response is held; the orphan key retires.
    await database.pool.query(
      `UPDATE design_scheme_package_stages SET upload_lease_until=now()-interval '1 second' WHERE id=$1`,
      [stage.stagedPackageId],
    );
    await retireKeySql(stored.object_key);
    s3.releaseHolds();
    await rejected;
    expect((await service.get(OWNER, stage.stagedPackageId)).status).toBe('failed');
    const [row] = await registry(stored.object_key);
    expect(row.status).toBe('cleanup_pending');
    const [intent] = await outbox(stored.object_key);
    expect(intent.reason).toBe('reference_expired');
    expect(intent.abandoned_at).toBeNull();
    expect(await retired(stored.object_key)).toHaveLength(1);
    // The held PUT did land in storage after retirement; the outbox owns its collection.
    expect(s3.objects.get(stored.object_key)?.equals(bytes)).toBe(true);
    // Re-registration of the retired key stays fenced.
    await expect(insertRegistry(stored.object_key, 'uploading')).rejects.toMatchObject({
      code: 'P0001',
      message: 'ObjectStorageKeyRetired',
    });
  }, 30000);

  it('records retirement-hash versus registry uniqueness semantics for re-registration', async () => {
    const retiredKey = `users/${OWNER}/references/${randomUUID()}`;
    await retireKeySql(retiredKey);
    // A guarded status hits the publication fence before any uniqueness check.
    await expect(insertRegistry(retiredKey, 'uploading')).rejects.toMatchObject({
      code: 'P0001',
      message: 'ObjectStorageKeyRetired',
    });
    // An unguarded status is outside the fence (compensation path) and inserts.
    await insertRegistry(retiredKey, 'cleanup_pending');
    // Its duplicate then surfaces the object_key uniqueness violation, not P0001.
    await expect(insertRegistry(retiredKey, 'cleanup_pending')).rejects.toMatchObject({
      code: '23505',
    });
    expect(await registry(retiredKey)).toHaveLength(1);
  }, 30000);
});
