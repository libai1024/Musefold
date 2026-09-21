import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  type MusefoldDatabase,
  generationReferenceUploads,
  generationRuns,
  designSchemeGenerationReferences,
  createDatabase,
  designSchemeAssets,
  designSchemeRevisions,
  designSchemes,
  enqueueObjectCleanup,
  migrateDatabase,
  objectCleanupQueue,
  user,
  designSchemeSourcePackages,
  designSchemeSourceSnapshots,
  designSchemeSourceFiles,
  designSchemeSourcePreparations,
  retireDesignSchemeSourcePreparations,
} from '@musefold/db';
import { eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  OBJECT_CLEANUP_BATCH_SIZE,
  PostgresObjectCleanupStore,
  processObjectCleanupBatch,
} from '../tasks.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'scheme-gc-owner';

describeDb('PG cleanup protects promoted design-scheme assets until physical purge', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    ({ db, pool } = createDatabase(container.getConnectionUri()));
    await migrateDatabase(db);
    await db.insert(user).values({ id: OWNER, name: 'GC test', email: 'gc@example.test' });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it.each(['uploading', 'available'])(
    'keeps unlinked %s reference and scheme uploads while their TTL is live',
    async (status) => {
      const now = new Date();
      const rows = ['references', 'design-scheme-uploads'].map((prefix) => {
        const id = randomUUID();
        return {
          id,
          userId: OWNER,
          objectKey: `users/${OWNER}/${prefix}/${id}`,
          originalName: 'live.png',
          mimeType: 'image/png',
          byteSize: 4,
          status,
          expiresAt: new Date(now.getTime() + 1),
        };
      });
      const keys = rows.map((row) => row.objectKey);
      try {
        await db.insert(generationReferenceUploads).values(rows);
        await enqueueObjectCleanup(
          db,
          rows.map((row) => ({
            objectKey: row.objectKey,
            ownerId: OWNER,
            objectType: 'generation_reference' as const,
            reason: 'reference_expired' as const,
          })),
          now,
        );
        const store = new PostgresObjectCleanupStore(db);
        const remove = vi.fn(async () => {});
        const s3 = {} as S3Client;
        expect(await processObjectCleanupBatch(store, s3, 'fixture', remove, now)).toEqual({
          expiredReferences: 0,
          deleted: 0,
          protected: 2,
          failed: 0,
        });
        expect(remove).not.toHaveBeenCalled();
        expect(
          await db
            .select()
            .from(generationReferenceUploads)
            .where(inArray(generationReferenceUploads.objectKey, keys)),
        ).toEqual(expect.arrayContaining(rows.map((row) => expect.objectContaining(row))));
        const pending = await db
          .select()
          .from(objectCleanupQueue)
          .where(inArray(objectCleanupQueue.objectKey, keys));
        expect(pending).toHaveLength(2);
        expect(pending.every((row) => row.attemptCount === 0 && row.abandonedAt === null)).toBe(
          true,
        );
        // Exact expiry is reclaimable. Retirement requeues a previously deferred intent.
        expect(
          await processObjectCleanupBatch(
            store,
            s3,
            'fixture',
            remove,
            new Date(now.getTime() + 1),
          ),
        ).toEqual({
          expiredReferences: 2,
          deleted: 2,
          protected: 0,
          failed: 0,
        });
        expect(remove).toHaveBeenCalledExactlyOnceWith(s3, 'fixture', expect.arrayContaining(keys));
      } finally {
        await db
          .delete(generationReferenceUploads)
          .where(inArray(generationReferenceUploads.objectKey, keys));
        await db.delete(objectCleanupQueue).where(inArray(objectCleanupQueue.objectKey, keys));
      }
    },
  );

  it('does not spend the candidate batch on adopted scheme references and reclaims them after purge', async () => {
    const references = Array.from({ length: OBJECT_CLEANUP_BATCH_SIZE + 1 }, () => {
      const id = randomUUID();
      return {
        id,
        userId: OWNER,
        objectKey: `users/${OWNER}/references/${id}`,
        originalName: 'reference.png',
        mimeType: 'image/png',
        byteSize: 80,
        status: 'available',
        expiresAt: new Date(0),
      };
    });
    const runIds = references.map(() => randomUUID());
    const orphanId = randomUUID();
    const orphan = {
      ...references[0],
      id: orphanId,
      objectKey: `users/${OWNER}/references/${orphanId}`,
    };
    const keys = [...references, orphan].map((row) => row.objectKey);
    try {
      // Store-level persisted-reference fixtures, not product trial authorization.
      // One input per run respects the database's per-run input position bound.
      await db
        .insert(generationRuns)
        .values(runIds.map((id) => ({ id, userId: OWNER, request: {} })));
      await db.insert(generationReferenceUploads).values([...references, orphan]);
      await db.insert(designSchemeGenerationReferences).values(
        references.map((reference, index) => ({
          generationRunId: runIds[index],
          userId: OWNER,
          assetId: reference.id,
          position: 0,
          objectKey: reference.objectKey,
          name: reference.originalName,
          mimeType: reference.mimeType,
          byteSize: reference.byteSize,
          contentHash: 'a'.repeat(64),
        })),
      );
      const store = new PostgresObjectCleanupStore(db);
      expect(await store.queueExpiredReferences()).toBe(1);
      expect((await db.select().from(objectCleanupQueue)).map((row) => row.objectKey)).toEqual([
        orphan.objectKey,
      ]);
      expect(await store.queueExpiredReferences()).toBe(0);
      const remove = vi.fn(async () => {});
      const s3 = {} as S3Client;
      expect(await processObjectCleanupBatch(store, s3, 'fixture', remove)).toMatchObject({
        deleted: 1,
        protected: 0,
      });
      expect(remove).toHaveBeenCalledExactlyOnceWith(s3, 'fixture', [orphan.objectKey]);
      await db.delete(generationRuns).where(inArray(generationRuns.id, runIds));
      // Physical run purge drops canonical references; expired uploads become reclaimable.
      expect(await store.queueExpiredReferences()).toBe(OBJECT_CLEANUP_BATCH_SIZE);
      expect(await store.queueExpiredReferences()).toBe(1);
      expect(await store.queueExpiredReferences()).toBe(0);
      expect(await processObjectCleanupBatch(store, s3, 'fixture', remove)).toMatchObject({
        deleted: OBJECT_CLEANUP_BATCH_SIZE,
        failed: 0,
      });
      expect(await processObjectCleanupBatch(store, s3, 'fixture', remove)).toMatchObject({
        deleted: 1,
        failed: 0,
      });
      expect(await db.select().from(generationReferenceUploads)).toEqual([]);
    } finally {
      await db.delete(generationRuns).where(inArray(generationRuns.id, runIds));
      await db
        .delete(generationReferenceUploads)
        .where(inArray(generationReferenceUploads.objectKey, keys));
      await db.delete(objectCleanupQueue).where(inArray(objectCleanupQueue.objectKey, keys));
    }
  });

  it('protects frozen source bytes until preparation retirement, then deletes through the existing outbox', async () => {
    const snapshotId = randomUUID();
    const packageId = randomUUID();
    const objectKey = `scheme-sources/${randomUUID()}`;
    await db
      .insert(designSchemeSourcePackages)
      .values({ id: packageId, userId: OWNER, kind: 'github' });
    await db
      .insert(designSchemeSourceSnapshots)
      .values({ id: snapshotId, userId: OWNER, packageId, resolvedRef: 'a'.repeat(40) });
    await db.insert(designSchemeSourceFiles).values({
      snapshotId,
      userId: OWNER,
      relativePath: 'README.md',
      kind: 'text',
      sizeBytes: 3,
      contentHash: 'a'.repeat(64),
      objectKey,
    });
    const executionId = randomUUID();
    await db.insert(designSchemeSourcePreparations).values({
      userId: OWNER,
      executionId,
      confirmationId: randomUUID(),
      requestHash: 'a'.repeat(64),
      request: {},
      status: 'ready',
      snapshotId,
      contentHash: 'a'.repeat(64),
      confirmation: {},
      expiresAt: new Date(Date.now() + 60_000),
    });
    await enqueueObjectCleanup(db, [
      {
        objectKey,
        ownerId: OWNER,
        objectType: 'generation_reference',
        reason: 'reference_expired',
      },
    ]);
    const store = new PostgresObjectCleanupStore(db);
    const remove = vi.fn(async () => {});
    const s3 = {} as S3Client;
    expect(await processObjectCleanupBatch(store, s3, 'fixture', remove)).toMatchObject({
      protected: 1,
      deleted: 0,
    });
    expect(remove).not.toHaveBeenCalled();
    await db
      .update(designSchemeSourcePreparations)
      .set({ expiresAt: new Date(0) })
      .where(eq(designSchemeSourcePreparations.executionId, executionId));
    expect(await retireDesignSchemeSourcePreparations(db)).toBe(1);
    expect(await retireDesignSchemeSourcePreparations(db)).toBe(0);
    expect(await processObjectCleanupBatch(store, s3, 'fixture', remove)).toMatchObject({
      protected: 0,
      deleted: 1,
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith(s3, 'fixture', [objectKey]);
  });

  it.each([false, true])(
    'keeps promoted asset when scheme is soft-deleted=%s, then permits physical purge',
    async (deleted) => {
      const schemeId = randomUUID();
      const revisionId = randomUUID();
      const objectKey = `users/${OWNER}/design-scheme-uploads/${randomUUID()}`;
      const orphanKey = `users/${OWNER}/design-scheme-uploads/${randomUUID()}`;
      await db.insert(designSchemes).values({
        id: schemeId,
        userId: OWNER,
        name: 'Protected scheme',
        sourcePresentation: 'musefold-created',
        currentRevisionId: revisionId,
        fidelity: 'faithful',
        deletedAt: deleted ? new Date() : null,
      });
      await db.insert(designSchemeRevisions).values({
        revisionId,
        schemeId,
        userId: OWNER,
        schemaVersion: 1,
        document: { schemeId, revisionId },
        createdBy: 'user',
      });
      await db.insert(designSchemeAssets).values({
        id: randomUUID(),
        userId: OWNER,
        revisionId,
        objectKey,
        role: 'reference',
        origin: 'repository',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        contentHash: 'a'.repeat(64),
      });
      // Promotion already removed the reference-upload staging row. An old
      // reference cleanup intent must still be fenced by the canonical asset.
      const queue = (keys: string[]) =>
        enqueueObjectCleanup(
          db,
          keys.map((key) => ({
            objectKey: key,
            ownerId: OWNER,
            objectType: 'generation_reference' as const,
            reason: 'reference_expired' as const,
          })),
        );
      await queue([objectKey, orphanKey]);
      const store = new PostgresObjectCleanupStore(db);
      expect(await store.findProtected([objectKey, orphanKey])).toEqual({
        permanent: [objectKey],
        leased: [],
      });
      const remove = vi.fn(async () => {});
      const s3 = {} as S3Client;
      expect(await processObjectCleanupBatch(store, s3, 'fixture', remove)).toMatchObject({
        protected: 1,
        deleted: 1,
        failed: 0,
      });
      expect(remove).toHaveBeenCalledExactlyOnceWith(s3, 'fixture', [orphanKey]);
      expect(
        await db
          .select()
          .from(designSchemeAssets)
          .where(eq(designSchemeAssets.objectKey, objectKey)),
      ).toHaveLength(1);
      expect(await db.select().from(objectCleanupQueue)).toHaveLength(0);

      await db.delete(designSchemes).where(eq(designSchemes.id, schemeId));
      await queue([objectKey]);
      remove.mockClear();
      expect(await processObjectCleanupBatch(store, s3, 'fixture', remove)).toMatchObject({
        protected: 0,
        deleted: 1,
      });
      expect(remove).toHaveBeenCalledExactlyOnceWith(s3, 'fixture', [objectKey]);
    },
  );
  it('retires unpromoted Agent copy/orphan uploads after the staging TTL through the existing outbox', async () => {
    const now = new Date();
    const keys = [randomUUID(), randomUUID()].map((id) => ({
      id,
      objectKey: `users/${OWNER}/design-scheme-uploads/${id}`,
    }));
    await db.insert(generationReferenceUploads).values(
      keys.map((item) => ({
        ...item,
        userId: OWNER,
        originalName: 'agent-copy.png',
        mimeType: 'image/png',
        byteSize: 80,
        status: 'available',
        expiresAt: new Date(now.getTime() + 24 * 3600_000),
      })),
    );
    const store = new PostgresObjectCleanupStore(db);
    // Cloud Agent session TTL is one hour; fresh copies outlive all active executions.
    expect(await store.queueExpiredReferences(new Date(now.getTime() + 2 * 3600_000))).toBe(0);
    const cleanupAt = new Date(now.getTime() + 25 * 3600_000);
    expect(await store.queueExpiredReferences(cleanupAt)).toBe(2);
    expect(await store.queueExpiredReferences(cleanupAt)).toBe(0);
    const remove = vi.fn(async () => {});
    const s3 = {} as S3Client;
    // One explicit maintenance instant across enqueue/claim avoids comparing PG's
    // microsecond now() to a same-millisecond JS Date rounded down. No natural TTL claim.
    expect(await processObjectCleanupBatch(store, s3, 'fixture', remove, cleanupAt)).toMatchObject({
      deleted: 2,
      failed: 0,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(
      (
        await pool.query('SELECT id FROM generation_reference_uploads WHERE id=ANY($1::text[])', [
          keys.map((item) => item.id),
        ])
      ).rows,
    ).toHaveLength(0);
  });
});
