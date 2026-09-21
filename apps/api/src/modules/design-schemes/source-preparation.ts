import { createHash, randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { z } from 'zod';
import {
  prepareGithubSchemeSourceInputSchema,
  decideSchemeSourcePreparationInputSchema,
  schemeSourcePreparationSchema,
  sourceSnapshotSchema,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  designSchemeSourcePreparations as preparations,
  designSchemeSourcePackages as packages,
  designSchemeSourceSnapshots as snapshots,
  designSchemeSourceFiles as files,
  executionDigest,
  enqueueObjectCleanup,
  retireDesignSchemeSourcePreparations,
} from '@musefold/db';
import { AppError } from '../../lib/errors.js';
import type { DesignSchemeAssetStorage } from '../design-scheme-assets/storage.js';
import { GithubDesignSchemeSourceReader } from './github-source-reader.js';

const TTL = 60 * 60_000;
const UPLOAD_LEASE = 2 * 60_000;
type Row = typeof preparations.$inferSelect;
type Tx = Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];
const terminal = new Set(['cancelled', 'rejected', 'expired', 'failed']);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Internal source preparation only. No Agent/model invocation or public pending-create DTO. */
export class DesignSchemeSourcePreparationService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly storage: DesignSchemeAssetStorage,
    private readonly reader = new GithubDesignSchemeSourceReader(),
  ) {}

  /** Registers cancellation identity in the same transaction as its parent Agent and queue job. */
  async registerQueued(
    tx: Tx,
    userId: string,
    raw: z.input<typeof prepareGithubSchemeSourceInputSchema>,
    expiresAt: Date,
  ) {
    const input = prepareGithubSchemeSourceInputSchema.parse(raw);
    await tx.insert(preparations).values({
      userId,
      executionId: input.executionId,
      confirmationId: randomUUID(),
      requestHash: executionDigest(input),
      request: input,
      status: 'queued',
      expiresAt,
    });
  }

  async prepare(userId: string, raw: z.input<typeof prepareGithubSchemeSourceInputSchema>) {
    const input = prepareGithubSchemeSourceInputSchema.parse(raw);
    const now = new Date();
    const requestHash = executionDigest(input);
    let [claimed] = await this.db
      .insert(preparations)
      .values({
        userId,
        executionId: input.executionId,
        confirmationId: randomUUID(),
        requestHash,
        request: input,
        status: 'reading',
        expiresAt: new Date(now.getTime() + TTL),
        uploadLeaseUntil: new Date(now.getTime() + UPLOAD_LEASE),
      })
      .onConflictDoNothing()
      .returning();
    if (!claimed) {
      const row = await this.row(this.db, userId, input.executionId);
      if (row.requestHash !== requestHash) throw failure('SOURCE_PREPARATION_CONFLICT');
      // A parent registered this source before enqueueing. Only one worker may start its IO.
      if (row.status === 'queued') {
        [claimed] = await this.db
          .update(preparations)
          .set({
            status: 'reading',
            uploadLeaseUntil: new Date(now.getTime() + UPLOAD_LEASE),
            updatedAt: now,
          })
          .where(
            and(
              this.identity(userId, input.executionId),
              eq(preparations.status, 'queued'),
              gt(preparations.expiresAt, now),
            ),
          )
          .returning();
      }
      if (!claimed) return this.view(await this.row(this.db, userId, input.executionId));
    }
    const writtenKeys: string[] = [];
    try {
      const source = await this.reader.read({
        repositoryUrl: input.repositoryUrl,
        requestedRef: input.requestedRef,
      });
      const packageId = randomUUID();
      const snapshotId = randomUUID();
      const snapshot = sourceSnapshotSchema.parse({
        id: snapshotId,
        packageId,
        kind: 'github',
        repositoryUrl: source.confirmation.repositoryUrl,
        resolvedRef: source.resolvedRef,
        commitHash: source.commitHash,
        contentHash: source.contentHash,
        totalBytes: source.totalBytes,
        files: source.files.map((f) => f.metadata),
        createdAt: now.toISOString(),
      });
      const entries = source.files.map((file) => ({
        ...file,
        objectKey: `scheme-sources/${hash(Buffer.from(userId))}/${snapshotId}/${randomUUID()}`,
      }));
      await this.db.transaction(async (tx) => {
        await this.assertReading(tx, userId, input.executionId);
        await tx.insert(packages).values({
          id: packageId,
          userId,
          kind: 'github',
          repositoryUrl: source.confirmation.repositoryUrl,
          license: null,
        });
        await tx.insert(snapshots).values({
          id: snapshotId,
          userId,
          packageId,
          resolvedRef: source.resolvedRef,
          commitHash: source.commitHash,
          contentHash: source.contentHash,
          totalBytes: source.totalBytes,
          scan: snapshot,
        });
        if (entries.length)
          await tx.insert(files).values(
            entries.map((f) => ({
              ...f.metadata,
              snapshotId,
              userId,
              objectKey: f.objectKey,
            })),
          );
        await tx
          .update(preparations)
          .set({
            snapshotId,
            contentHash: source.contentHash,
            confirmation: source.confirmation,
            evidence: {
              repositoryId: source.repositoryId,
              requestedRef: source.requestedRef,
              treeHash: source.treeHash,
              archiveHash: source.archiveHash,
              warnings: source.warnings,
              ignoredFiles: source.ignoredFiles,
            },
            updatedAt: new Date(),
            uploadLeaseUntil: new Date(Date.now() + UPLOAD_LEASE),
          })
          .where(this.identity(userId, input.executionId));
      });
      for (const entry of entries) {
        await this.db.transaction(async (tx) => {
          await this.assertReading(tx, userId, input.executionId);
          await tx
            .update(preparations)
            .set({ uploadLeaseUntil: new Date(Date.now() + UPLOAD_LEASE) })
            .where(this.identity(userId, input.executionId));
        });
        writtenKeys.push(entry.objectKey); // Persisted registry already exists before a possibly ambiguous PUT.
        await this.storage.put(
          entry.objectKey,
          entry.bytes,
          entry.metadata.mimeType ?? 'application/octet-stream',
        );
      }
      return await this.db.transaction(async (tx) => {
        await this.assertReading(tx, userId, input.executionId);
        const [row] = await tx
          .update(preparations)
          .set({ status: 'ready', uploadLeaseUntil: null, updatedAt: new Date() })
          .where(this.identity(userId, input.executionId))
          .returning();
        return this.view(row);
      });
    } catch (error) {
      await this.db.transaction(async (tx) => {
        const row = await this.row(tx, userId, input.executionId, true);
        await tx
          .update(preparations)
          .set({
            status: row.status === 'reading' ? 'failed' : row.status,
            uploadLeaseUntil: null,
            updatedAt: new Date(),
          })
          .where(this.identity(userId, input.executionId));
        // A PUT completing after lease loss must recreate its cleanup intent, even after prior GC.
        await enqueueObjectCleanup(
          tx,
          writtenKeys.map((objectKey) => ({
            objectKey,
            ownerId: userId,
            objectType: 'generation_reference',
            reason: 'reference_upload_failed',
          })),
        );
      });
      await retireDesignSchemeSourcePreparations(this.db);
      if (error instanceof AppError) throw error;
      throw failure('SOURCE_PREPARATION_FAILED', 502);
    }
  }

  async get(userId: string, executionId: string) {
    return this.view(await this.row(this.db, userId, executionId));
  }

  async decide(userId: string, raw: z.input<typeof decideSchemeSourcePreparationInputSchema>) {
    const input = decideSchemeSourcePreparationInputSchema.parse(raw);
    const result = await this.db.transaction(async (tx) => {
      const row = await this.row(tx, userId, input.executionId, true);
      if (row.confirmationId !== input.confirmationId)
        throw failure('SOURCE_CONFIRMATION_MISMATCH');
      const desired = input.decision === 'install' ? 'confirmed' : 'rejected';
      const status = this.view(row).status;
      if (status === desired) return this.view(row);
      if (status !== 'ready') throw failure('SOURCE_CONFIRMATION_UNAVAILABLE');
      const [changed] = await tx
        .update(preparations)
        .set({ status: desired, updatedAt: new Date() })
        .where(this.identity(userId, input.executionId))
        .returning();
      return this.view(changed);
    });
    if (result.status === 'rejected') await retireDesignSchemeSourcePreparations(this.db);
    return result;
  }

  async cancel(userId: string, executionId: string) {
    const result = await this.db.transaction(async (tx) => {
      const row = await this.row(tx, userId, executionId, true);
      if (terminal.has(this.view(row).status)) return this.view(row);
      const [changed] = await tx
        .update(preparations)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(this.identity(userId, executionId))
        .returning();
      return this.view(changed);
    });
    await retireDesignSchemeSourcePreparations(this.db);
    return result;
  }

  /** Loads confirmed immutable bytes only; downstream Agent must still acquire its own execution authorization. */
  async readConfirmed(userId: string, executionId: string) {
    const row = await this.row(this.db, userId, executionId);
    if (this.view(row).status !== 'confirmed' || !row.snapshotId)
      throw failure('SOURCE_NOT_CONFIRMED');
    const [stored] = await this.db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.id, row.snapshotId), eq(snapshots.userId, userId)));
    const snapshot = sourceSnapshotSchema.parse(stored?.scan);
    if (snapshot.contentHash !== row.contentHash) throw failure('SOURCE_BYTES_CHANGED');
    const listed = await this.db
      .select()
      .from(files)
      .where(and(eq(files.snapshotId, row.snapshotId), eq(files.userId, userId)))
      .orderBy(files.relativePath);
    if (listed.length !== snapshot.files.length) throw failure('SOURCE_BYTES_CHANGED');
    const result = [];
    for (const file of listed) {
      const metadata = snapshot.files.find((item) => item.relativePath === file.relativePath);
      if (
        !file.objectKey ||
        !metadata ||
        metadata.contentHash !== file.contentHash ||
        metadata.sizeBytes !== file.sizeBytes
      )
        throw failure('SOURCE_BYTES_CHANGED');
      let bytes: Uint8Array;
      try {
        bytes = await this.storage.read(file.objectKey);
      } catch {
        throw failure('SOURCE_BYTES_UNAVAILABLE', 502);
      }
      if (bytes.length !== metadata.sizeBytes || hash(bytes) !== metadata.contentHash)
        throw failure('SOURCE_BYTES_CHANGED');
      result.push({ metadata, bytes });
    }
    const current = await this.row(this.db, userId, executionId);
    if (this.view(current).status !== 'confirmed' || current.snapshotId !== row.snapshotId)
      throw failure('SOURCE_NOT_CONFIRMED');
    return { snapshot, files: result };
  }

  private identity(userId: string, executionId: string) {
    return and(eq(preparations.userId, userId), eq(preparations.executionId, executionId));
  }

  private async row(tx: MusefoldDatabase | Tx, userId: string, executionId: string, lock = false) {
    const query = tx.select().from(preparations).where(this.identity(userId, executionId));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw failure('SOURCE_PREPARATION_NOT_FOUND', 404);
    return row;
  }

  private async assertReading(tx: Tx, userId: string, executionId: string) {
    const row = await this.row(tx, userId, executionId, true);
    if (this.view(row).status !== 'reading') throw failure('SOURCE_PREPARATION_STOPPED');
  }

  private view(row: Row) {
    const expired =
      !terminal.has(row.status) &&
      (row.expiresAt.getTime() <= Date.now() ||
        (row.status === 'reading' && (row.uploadLeaseUntil?.getTime() ?? 0) <= Date.now()));
    return schemeSourcePreparationSchema.parse({
      executionId: row.executionId,
      confirmationId: row.confirmationId,
      status: expired ? 'expired' : row.status,
      source: row.confirmation,
      snapshotId: row.snapshotId,
      contentHash: row.contentHash,
      expiresAt: row.expiresAt.toISOString(),
    });
  }
}

function failure(code: string, status = 409) {
  return new AppError(
    status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
    '来源准备不可继续，请重新核对来源状态',
    status,
    false,
    { sourceError: code },
  );
}
