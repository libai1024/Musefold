import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  beginDesignSchemePackageUploadSchema,
  decideDesignSchemePackageStageSchema,
  DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS,
  DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS,
  DESIGN_SCHEME_PACKAGE_PARSER_VERSION,
  type BeginDesignSchemePackageUpload,
  type DecideDesignSchemePackageStage,
  type DesignSchemePackageRecoveryQuery,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  type MusefoldTransaction,
  designSchemePackageStages as stages,
  generationReferenceUploads as uploads,
  enqueueObjectCleanup,
  executionDigest,
} from '@musefold/db';
import type { DesignSchemeAssetStorage } from '../design-scheme-assets/storage.js';
import { AppError } from '../../lib/errors.js';
import { lockPackageAuthority } from './authority.js';
import { packageStageView as view } from './stage-view.js';
import { packageConfirmationHash } from './import-policy.js';
import { getPackageRecovery, listPackageRecovery } from './recovery.js';
import { inspectPackage, invalidPackage, packageHash, readPackageUpload } from './bytes.js';
import { PackageOperationBudget } from './operation-budget.js';

type Row = typeof stages.$inferSelect;
const identity = (userId: string, id: string) => and(eq(stages.id, id), eq(stages.userId, userId));

/** Durable free upload and review. Import authority is private; confirming never authorizes a model call. */
export class DesignSchemePackageService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly storage: DesignSchemeAssetStorage,
    private readonly budget = new PackageOperationBudget(),
  ) {}

  async begin(userId: string, sessionId: string, raw: BeginDesignSchemePackageUpload) {
    const input = beginDesignSchemePackageUploadSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const authorityHash = await lockPackageAuthority(tx, userId, sessionId);
      // Serial admission per owner across API processes; unrelated owners retain concurrency.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`scheme-package:${userId}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.userId, userId), eq(stages.requestId, input.requestId)))
        .for('update');
      if (existing) {
        if (
          existing.requestHash !== executionDigest(input) ||
          existing.authorityHash !== authorityHash
        )
          throw conflict();
        return view(existing);
      }
      const count = await tx.execute<{
        count: string;
      }>(sql`SELECT count(*) FROM design_scheme_package_stages
        WHERE user_id = ${userId} AND status IN ('awaiting_upload','uploading','ready','confirmed') AND expires_at > now()`);
      if (Number(count.rows[0].count) >= 3)
        throw new AppError('VALIDATION_FAILED', '请先完成或取消已有的方案包上传', 429, true);
      const id = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS);
      const objectKey = `scheme-packages/${packageHash(Buffer.from(userId))}/${id}`;
      const [row] = await tx
        .insert(stages)
        .values({
          id,
          userId,
          requestId: input.requestId,
          requestHash: executionDigest(input),
          packageHash: input.packageHash,
          byteSize: input.sizeBytes,
          formatVersion: input.formatVersion,
          parserVersion: DESIGN_SCHEME_PACKAGE_PARSER_VERSION,
          objectKey,
          authorityHash,
          status: 'awaiting_upload',
          expiresAt,
        })
        .returning();
      await tx.insert(uploads).values({
        id,
        userId,
        objectKey,
        originalName: 'scheme.musefold.design',
        mimeType: 'application/octet-stream',
        byteSize: input.sizeBytes,
        status: 'uploading',
        expiresAt,
      });
      // The outbox intentionally outlives both account and upload rows, even before the first PUT.
      await enqueueObjectCleanup(tx, [intent(row)], now, expiresAt);
      return view(row);
    });
  }

  async get(userId: string, id: string) {
    return view(await this.row(this.db, userId, id));
  }

  listRecovery(userId: string, sessionId: string, input: DesignSchemePackageRecoveryQuery) {
    return listPackageRecovery(this.db, userId, sessionId, input);
  }

  recovery(userId: string, sessionId: string, id: string) {
    return getPackageRecovery(this.db, userId, sessionId, id);
  }

  async upload(
    userId: string,
    sessionId: string,
    id: string,
    body: ReadableStream<Uint8Array> | null,
    signal?: AbortSignal,
  ) {
    // Bound ZIP decompression and upload memory per API process; never queue retained request bodies.
    let release: () => void;
    try {
      release = this.budget.acquire('上传繁忙，请稍后重试');
    } catch (error) {
      void body?.cancel().catch(() => undefined);
      throw error;
    }
    let claimed: Row | undefined;
    try {
      const row = await this.db.transaction(async (tx) => {
        const authorityHash = await lockPackageAuthority(tx, userId, sessionId);
        const row = await this.row(tx, userId, id, true);
        assertAuthority(row, authorityHash);
        if (['ready', 'confirmed'].includes(row.status)) return row;
        if (row.status !== 'awaiting_upload') throw conflict();
        const [updated] = await tx
          .update(stages)
          .set({ status: 'uploading', uploadLeaseUntil: lease(), updatedAt: new Date() })
          .where(identity(userId, id))
          .returning();
        claimed = updated;
        return updated;
      });
      if (!claimed) return view(row);
      const bytes = await readPackageUpload(body, row.byteSize, signal);
      if (packageHash(bytes) !== row.packageHash) throw invalidPackage();
      const preview = await inspectPackage(bytes, row.formatVersion as 1 | 2);
      await this.db.transaction(async (tx) => {
        const authorityHash = await lockPackageAuthority(tx, userId, sessionId);
        const current = await this.row(tx, userId, id, true);
        assertUploading(current, authorityHash);
        if (current.expiresAt.getTime() - Date.now() < 35_000) throw conflict();
        const [renewed] = await tx
          .update(stages)
          .set({ uploadLeaseUntil: lease() })
          .where(identity(userId, id))
          .returning();
        claimed = renewed;
      });
      if (signal?.aborted) throw invalidPackage();
      await this.storage.put(row.objectKey, bytes, 'application/octet-stream');
      return await this.db.transaction(async (tx) => {
        const authorityHash = await lockPackageAuthority(tx, userId, sessionId);
        const current = await this.row(tx, userId, id, true);
        assertUploading(current, authorityHash);
        if (signal?.aborted) throw invalidPackage();
        const confirmationHash = packageConfirmationHash({ ...row, preview, authorityHash });
        const [updated] = await tx
          .update(stages)
          .set({
            status: 'ready',
            preview,
            confirmationHash,
            uploadLeaseUntil: null,
            updatedAt: new Date(),
          })
          .where(identity(userId, id))
          .returning();
        const registered = await tx
          .update(uploads)
          .set({ status: 'available', uploadedAt: new Date() })
          .where(
            and(eq(uploads.id, id), eq(uploads.userId, userId), eq(uploads.status, 'uploading')),
          )
          .returning();
        if (!registered.length) throw conflict();
        return view(updated);
      });
    } catch (error) {
      if (claimed) await this.failed(claimed);
      if (error instanceof AppError) throw error;
      throw new AppError('INTERNAL_ERROR', '方案包上传未完成，请查询状态后重新选择文件', 503, true);
    } finally {
      void body?.cancel().catch(() => undefined);
      release();
    }
  }

  async decide(userId: string, sessionId: string, id: string, raw: DecideDesignSchemePackageStage) {
    const input = decideDesignSchemePackageStageSchema.parse(raw);
    if (input.decision === 'confirm') {
      const stored = await this.row(this.db, userId, id);
      if (!['ready', 'confirmed'].includes(stored.status) || stored.expiresAt <= new Date())
        throw conflict();
      const release = this.budget.acquire('上传繁忙，请稍后重试');
      try {
        const bytes = await this.storage.read(stored.objectKey).catch(() => {
          throw invalidPackage();
        });
        if (bytes.byteLength !== stored.byteSize || packageHash(bytes) !== stored.packageHash)
          throw invalidPackage();
      } finally {
        release();
      }
    }
    return this.db.transaction(async (tx) => {
      const authorityHash = await lockPackageAuthority(tx, userId, sessionId);
      const row = await this.row(tx, userId, id, true);
      assertAuthority(row, authorityHash);
      if (
        row.packageHash !== input.packageHash ||
        row.formatVersion !== input.formatVersion ||
        row.parserVersion !== input.parserVersion ||
        row.confirmationHash !== input.confirmationHash
      )
        throw conflict();
      const status = input.decision === 'confirm' ? 'confirmed' : 'rejected';
      if (row.status === status) return view(row);
      if (row.status !== 'ready') throw conflict();
      const [updated] = await tx
        .update(stages)
        .set({ status, updatedAt: new Date() })
        .where(identity(userId, id))
        .returning();
      if (status === 'rejected') {
        await retireRegistry(tx, row);
        await enqueueObjectCleanup(
          tx,
          [intent(row)],
          new Date(),
          row.uploadLeaseUntil ?? new Date(),
        );
      }
      return view(updated);
    });
  }

  async cancel(userId: string, sessionId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await lockPackageAuthority(tx, userId, sessionId);
      const row = await this.row(tx, userId, id, true);
      if (row.status === 'cancelled') return view(row);
      if (row.status === 'imported') throw conflict();
      const [updated] = await tx
        .update(stages)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(identity(userId, id))
        .returning();
      await retireRegistry(tx, row);
      // Keep an in-flight lease: deleting first and allowing a late PUT would leak the object.
      await enqueueObjectCleanup(tx, [intent(row)], new Date(), row.uploadLeaseUntil ?? new Date());
      return view(updated);
    });
  }

  private async failed(row: Row) {
    // No authorization check here: compensate even if the session/account was deleted mid-PUT.
    await this.db
      .transaction(async (tx) => {
        await tx
          .update(stages)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(and(identity(row.userId, row.id), eq(stages.status, 'uploading')));
        await retireRegistry(tx, row);
        await enqueueObjectCleanup(
          tx,
          [intent(row)],
          new Date(),
          row.uploadLeaseUntil ?? new Date(),
        );
      })
      .catch(() => undefined); // Original registration/outbox still survives a DB outage.
  }
  private async row(
    db: MusefoldDatabase | MusefoldTransaction,
    userId: string,
    id: string,
    lock = false,
  ) {
    const query = db.select().from(stages).where(identity(userId, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new AppError('VALIDATION_FAILED', '方案包不存在', 404);
    return row;
  }
}
function lease() {
  return new Date(Date.now() + DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS);
}
function assertAuthority(row: Row, hash: string) {
  if (
    row.authorityHash !== hash ||
    row.parserVersion !== DESIGN_SCHEME_PACKAGE_PARSER_VERSION ||
    row.expiresAt <= new Date()
  )
    throw conflict();
}
function assertUploading(row: Row, hash: string) {
  assertAuthority(row, hash);
  if (row.status !== 'uploading' || !row.uploadLeaseUntil || row.uploadLeaseUntil <= new Date())
    throw conflict();
}
function intent(row: Row) {
  return {
    objectKey: row.objectKey,
    ownerId: row.userId,
    objectType: 'generation_reference' as const,
    reason: 'reference_expired' as const,
  };
}
function conflict() {
  return new AppError('VALIDATION_FAILED', '方案包状态或确认已变化，请重新选择文件', 409, false, {
    reason: 'SCHEME_PACKAGE_CONFLICT',
  });
}

async function retireRegistry(tx: MusefoldTransaction, row: Row) {
  await tx
    .update(uploads)
    .set({ status: 'cleanup_pending', cleanupQueuedAt: new Date() })
    .where(and(eq(uploads.id, row.id), eq(uploads.userId, row.userId)));
}
