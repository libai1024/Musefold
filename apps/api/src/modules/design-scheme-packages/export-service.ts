import { PackageOperationBudget } from './operation-budget.js';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  beginDesignSchemePackageExportSchema,
  DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS,
  DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS,
  DESIGN_SCHEME_PACKAGE_LIMITS,
  type BeginDesignSchemePackageExport,
  type DesignSchemePackageExportHistoryQuery,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  type MusefoldTransaction,
  designSchemePackageExports as exports,
  generationReferenceUploads as uploads,
  enqueueObjectCleanup,
  executionDigest,
} from '@musefold/db';
import type { DesignSchemeService } from '../design-schemes/service.js';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import type { DesignSchemeAssetStorage } from '../design-scheme-assets/storage.js';
import { lockPackageAuthority } from './authority.js';
import { collectExportBasis, buildExportBytes, exportConflict } from './export-content.js';
import { packageHash } from './bytes.js';
import { AppError } from '../../lib/errors.js';
import { packageExportView as view, PACKAGE_EXPORT_MIN_IO_MS } from './export-view.js';
import { listPackageExports, recoverPackageExport } from './export-recovery.js';
import { packageDownloadBody } from './download-body.js';

type Row = typeof exports.$inferSelect;
const owned = (userId: string, id: string) => and(eq(exports.userId, userId), eq(exports.id, id));

export class DesignSchemePackageExportService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly storage: DesignSchemeAssetStorage,
    private readonly schemes: DesignSchemeService,
    private readonly assets: DesignSchemeAssetService,
    private readonly budget = new PackageOperationBudget(),
  ) {}

  async begin(
    userId: string,
    sessionId: string,
    raw: BeginDesignSchemePackageExport,
    signal?: AbortSignal,
  ) {
    const input = beginDesignSchemePackageExportSchema.parse(raw);
    const release = this.budget.acquire('方案包导出繁忙，请稍后重试');
    let claimed: Row | undefined;
    try {
      const admission = await this.db.transaction(async (tx) => {
        const authorityHash = await lockPackageAuthority(tx, userId, sessionId);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`scheme-export:${userId}`}, 0))`,
        );
        const [previous] = await tx
          .select()
          .from(exports)
          .where(and(eq(exports.userId, userId), eq(exports.requestId, input.requestId)))
          .for('update');
        if (previous) {
          if (
            previous.requestHash !== executionDigest(input) ||
            previous.authorityHash !== authorityHash
          )
            throw exportConflict();
          return { row: previous, basis: null };
        }
        const count = await tx.execute<{
          count: string;
        }>(sql`SELECT count(*) FROM design_scheme_package_exports
          WHERE user_id=${userId} AND expires_at>now() AND (status='ready' OR (status='preparing' AND lease_until>now()))`);
        if (Number(count.rows[0].count) >= 3)
          throw new AppError('VALIDATION_FAILED', '请先完成或取消已有导出', 429, true);
        const basis = await collectExportBasis(tx, userId, input, this.schemes, this.assets);
        const now = new Date();
        const id = randomUUID();
        const expiresAt = new Date(now.getTime() + DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS);
        const [row] = await tx
          .insert(exports)
          .values({
            id,
            userId,
            requestId: input.requestId,
            requestHash: executionDigest(input),
            authorityHash,
            schemeId: input.schemeId,
            revisionId: input.revisionId,
            expectedVersion: input.expectedVersion,
            basisHash: basis.hash,
            objectKey: `scheme-exports/${id}`,
            status: 'preparing',
            expiresAt,
            leaseUntil: new Date(now.getTime() + DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS),
          })
          .returning();
        // Before any write: durable cleanup survives account deletion and API termination.
        await tx.insert(uploads).values({
          id,
          userId,
          objectKey: row.objectKey,
          originalName: 'scheme.musefold.design',
          mimeType: 'application/octet-stream',
          byteSize: 0,
          status: 'cleanup_pending',
          cleanupQueuedAt: now,
          expiresAt,
        });
        await enqueueObjectCleanup(tx, [intent(row)], now, expiresAt);
        return { row, basis };
      });
      if (!admission.basis) return view(admission.row);
      claimed = admission.row;
      const renew = async () => {
        aborted(signal);
        await this.current(userId, sessionId, admission.row.id, 'preparing', async () => {});
        aborted(signal);
      };
      const bytes = await buildExportBytes(claimed.id, admission.basis, this.storage, renew);
      await renew();
      // No independent actor resumes this object's writer. A new request always gets a new key.
      await this.storage.put(claimed.objectKey, bytes, 'application/octet-stream');
      aborted(signal);
      return await this.current(userId, sessionId, claimed.id, 'preparing', async (tx, row) => {
        const [ready] = await tx
          .update(exports)
          .set({ status: 'ready', packageHash: packageHash(bytes), sizeBytes: bytes.length })
          .where(owned(userId, row.id))
          .returning();
        await tx
          .update(uploads)
          .set({ byteSize: bytes.length })
          .where(and(eq(uploads.id, row.id), eq(uploads.userId, userId)));
        return view(ready);
      });
    } catch (error) {
      if (claimed)
        await this.db
          .update(exports)
          .set({ status: 'failed' })
          .where(and(owned(userId, claimed.id), eq(exports.status, 'preparing')))
          .catch(() => undefined);
      if (error instanceof AppError) throw error;
      throw new AppError(
        'INTERNAL_ERROR',
        '方案包导出未完成，请查询原请求或重新发起导出',
        503,
        true,
      );
    } finally {
      release();
    }
  }

  listRecovery(userId: string, sessionId: string, query: DesignSchemePackageExportHistoryQuery) {
    return listPackageExports(this.db, userId, sessionId, query);
  }

  recovery(userId: string, sessionId: string, id: string) {
    return recoverPackageExport(this.db, userId, sessionId, id, this.schemes, this.assets);
  }

  async get(userId: string, sessionId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await lockPackageAuthority(tx, userId, sessionId);
      return view(await row(tx, userId, id));
    });
  }

  async cancel(userId: string, sessionId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await lockPackageAuthority(tx, userId, sessionId);
      const current = await row(tx, userId, id);
      const [cancelled] = await tx
        .update(exports)
        .set({ status: 'cancelled' })
        .where(owned(userId, id))
        .returning();
      // Retain the write lease when cancelling an in-flight PUT.
      await enqueueObjectCleanup(tx, [intent(current)]);
      return view(cancelled);
    });
  }

  async content(userId: string, sessionId: string, id: string, signal?: AbortSignal) {
    const release = this.budget.acquire('方案包导出繁忙，请稍后重试');
    let transferred = false;
    try {
      aborted(signal);
      const frozen = await this.current(
        userId,
        sessionId,
        id,
        'ready',
        async (_tx, current) => current,
      );
      const bytes = await this.storage.read(
        frozen.objectKey,
        DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes,
      );
      if (bytes.length !== frozen.sizeBytes || packageHash(bytes) !== frozen.packageHash)
        throw exportConflict();
      aborted(signal);
      // Revoke/delete/version changes while reading cannot return stale authorized bytes.
      await this.current(userId, sessionId, id, 'ready', async () => {});
      aborted(signal);
      const body = packageDownloadBody(bytes, release, signal);
      transferred = true;
      return {
        body,
        sizeBytes: bytes.byteLength,
        packageHash: frozen.packageHash as string,
        filename: `scheme-${id}.musefold.design`,
      };
    } finally {
      if (!transferred) release();
    }
  }

  private async current<T>(
    userId: string,
    sessionId: string,
    id: string,
    status: 'preparing' | 'ready',
    action: (tx: MusefoldTransaction, row: Row) => Promise<T>,
  ) {
    return this.db.transaction(async (tx) => {
      const authority = await lockPackageAuthority(tx, userId, sessionId);
      const current = await row(tx, userId, id);
      if (
        current.status !== status ||
        current.authorityHash !== authority ||
        current.expiresAt.getTime() - Date.now() < PACKAGE_EXPORT_MIN_IO_MS ||
        (status === 'preparing' && current.leaseUntil <= new Date())
      )
        throw exportConflict();
      const basis = await collectExportBasis(
        tx,
        userId,
        {
          requestId: current.requestId,
          schemeId: current.schemeId,
          revisionId: current.revisionId,
          expectedVersion: current.expectedVersion,
          formatVersion: 2,
        },
        this.schemes,
        this.assets,
      );
      if (basis.hash !== current.basisHash) throw exportConflict();
      const leaseUntil = new Date(
        Math.min(Date.now() + DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS, current.expiresAt.getTime()),
      );
      await tx.update(exports).set({ leaseUntil }).where(owned(userId, id));
      return action(tx, { ...current, leaseUntil });
    });
  }
}
async function row(tx: MusefoldTransaction, userId: string, id: string) {
  const [found] = await tx.select().from(exports).where(owned(userId, id)).for('update');
  if (!found) throw new AppError('VALIDATION_FAILED', '导出请求不存在', 404);
  return found;
}
function intent(row: Row) {
  return {
    ownerId: row.userId,
    objectKey: row.objectKey,
    objectType: 'generation_reference' as const,
    reason: 'reference_expired' as const,
  };
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new AppError('VALIDATION_FAILED', '导出已中断，请查询请求状态', 409, true);
}
