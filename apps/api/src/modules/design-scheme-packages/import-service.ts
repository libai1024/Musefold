import { PackageOperationBudget } from './operation-budget.js';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  importDesignSchemeInputSchema,
  importDesignSchemeResultSchema,
  DESIGN_SCHEME_PACKAGE_PARSER_VERSION,
  DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS,
  type ImportDesignSchemeInput,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  type MusefoldTransaction,
  designSchemePackageStages as stages,
  designSchemePackageImports as imports,
  generationReferenceUploads as uploads,
  enqueueObjectCleanup,
  executionDigest,
} from '@musefold/db';
import { normalizedHash } from '@musefold/scheme-package';
import { AppError } from '../../lib/errors.js';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import type { DesignSchemeAssetStorage } from '../design-scheme-assets/storage.js';
import { lockPackageAuthority } from './authority.js';
import { packageHash } from './bytes.js';
import {
  packageConfirmationHash,
  PACKAGE_IMPORT_MAPPING_VERSION as MAPPING_VERSION,
  PACKAGE_IMPORT_MAX_ATTEMPTS,
  PACKAGE_IMPORT_MIN_IO_LIFETIME_MS as MIN_IO_LIFETIME,
} from './import-policy.js';
import { preparePackageImportContent } from './import-content.js';
import { persistPackageImport, sourceObjectId, assetObjectId } from './import-persistence.js';

type Row = typeof imports.$inferSelect;
type Stage = typeof stages.$inferSelect;
const owner = (userId: string, id: string) =>
  and(eq(imports.stageId, id), eq(imports.userId, userId));
const stageOwner = (userId: string, id: string) =>
  and(eq(stages.id, id), eq(stages.userId, userId));

export class DesignSchemePackageImportService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly storage: DesignSchemeAssetStorage,
    private readonly assets: DesignSchemeAssetService,
    private readonly budget = new PackageOperationBudget(),
  ) {}

  async execute(
    userId: string,
    sessionId: string,
    raw: ImportDesignSchemeInput,
    signal?: AbortSignal,
  ) {
    const parsed = importDesignSchemeInputSchema.parse(raw);
    const input = { ...parsed, packageHash: normalizedHash(parsed.packageHash) };
    const release = this.budget.acquire('方案包导入繁忙，请稍后重试');
    let claim: Row | undefined;
    try {
      const admitted = await this.claim(userId, sessionId, input);
      if (admitted.row.result) return importDesignSchemeResultSchema.parse(admitted.row.result);
      claim = admitted.row;
      aborted(signal);
      const rawBytes = await this.storage.read(admitted.stage.objectKey);
      if (
        rawBytes.byteLength !== admitted.stage.byteSize ||
        packageHash(rawBytes) !== input.packageHash
      )
        throw new AppError('VALIDATION_FAILED', '已确认的方案包内容已变化，请重新选择文件');
      const plan = await preparePackageImportContent(rawBytes, {
        seed: claim.seed,
        createdAt: claim.createdAt.toISOString(),
      }).catch((error: unknown) => {
        if (error instanceof AppError) throw error;
        throw new AppError(
          'VALIDATION_FAILED',
          '方案包内容无法导入，请重新选择有效方案包',
          400,
          false,
          { reason: 'SCHEME_PACKAGE_IMPORT_CONTENT_INVALID' },
        );
      });
      const planHash = executionDigest({
        document: plan.document,
        sourcePackages: plan.sourcePackages,
        sourceSnapshots: plan.sourceSnapshots,
        assets: plan.assets.map((item) => item.metadata),
        provenance: plan.provenance,
      });
      const prefix = `scheme-imports/${claim.stageId}/${claim.attemptId}/`;
      await this.current(userId, sessionId, claim, async (tx, row) => {
        if (row.planHash && row.planHash !== planHash) throw conflict();
        await tx.update(imports).set({ planHash }).where(owner(userId, row.stageId));
      });
      const objects = [
        ...plan.files.map((file) => ({
          objectKey: prefix + sourceObjectId(file.snapshotId, file.metadata.relativePath),
          bytes: file.bytes,
          mimeType: file.metadata.mimeType ?? 'application/octet-stream',
        })),
        ...plan.assets.map((asset) => ({
          objectKey: prefix + assetObjectId(asset.metadata.id),
          bytes: asset.bytes,
          mimeType: asset.metadata.mimeType,
        })),
      ];
      for (const object of objects) {
        aborted(signal);
        // Registry and independent outbox commit before any PUT. An abandoned attempt never
        // shares object keys with its successor, so stale writes cannot change published bytes.
        const deadline = await this.current(userId, sessionId, claim, async (tx, row) => {
          await tx.insert(uploads).values({
            id: randomUUID(),
            userId,
            objectKey: object.objectKey,
            originalName: 'scheme-import-content',
            mimeType: 'application/octet-stream',
            byteSize: object.bytes.length,
            status: 'cleanup_pending',
            cleanupQueuedAt: new Date(),
            expiresAt: row.leaseUntil,
          });
          await enqueueObjectCleanup(
            tx,
            [intent(userId, object.objectKey)],
            new Date(),
            row.leaseUntil,
          );
          return row.leaseUntil;
        });
        if (deadline.getTime() - Date.now() < MIN_IO_LIFETIME) throw conflict();
        aborted(signal);
        await this.storage.put(object.objectKey, object.bytes, object.mimeType);
      }
      aborted(signal);
      return await this.current(userId, sessionId, claim, async (tx, row, stage) => {
        if (row.planHash !== planHash) throw conflict();
        aborted(signal);
        const result = await persistPackageImport(tx, userId, plan, prefix, this.assets);
        aborted(signal);
        if (row.leaseUntil <= new Date()) throw conflict();
        // This response snapshot is immutable, even if the resulting scheme is later edited/deleted.
        await tx
          .update(imports)
          .set({ status: 'completed', result, provenance: plan.provenance, updatedAt: new Date() })
          .where(owner(userId, row.stageId));
        await tx
          .update(stages)
          .set({ status: 'imported', uploadLeaseUntil: null, updatedAt: new Date() })
          .where(stageOwner(userId, row.stageId));
        await tx
          .update(uploads)
          .set({ status: 'cleanup_pending', cleanupQueuedAt: new Date() })
          .where(and(eq(uploads.id, row.stageId), eq(uploads.userId, userId)));
        await enqueueObjectCleanup(tx, [intent(userId, stage.objectKey)]);
        return result;
      });
    } catch (error) {
      if (claim) {
        // Do not touch a successor or a committed result after an ambiguous transaction response.
        await this.db
          .update(imports)
          .set({ status: 'retryable', updatedAt: new Date() })
          .where(
            and(
              owner(userId, claim.stageId),
              eq(imports.epoch, claim.epoch),
              eq(imports.status, 'running'),
            ),
          )
          .catch(() => undefined);
      }
      if (error instanceof AppError) throw error;
      throw new AppError('INTERNAL_ERROR', '导入未完成，可使用同一方案包重试', 503, true);
    } finally {
      release();
    }
  }

  private async claim(userId: string, sessionId: string, input: ImportDesignSchemeInput) {
    return this.db.transaction(async (tx) => {
      const authorityHash = await lockPackageAuthority(tx, userId, sessionId);
      const stage = await lockedStage(tx, userId, input.stagedPackageId);
      const [existing] = await tx
        .select()
        .from(imports)
        .where(owner(userId, stage.id))
        .for('update');
      const requestHash = executionDigest(input);
      if (existing && existing.requestHash !== requestHash) throw conflict();
      // Replays are reads under current normal owner authority. They never revive a deleted scheme
      // or reuse the original session to perform a fresh mutation.
      if (existing?.status === 'completed') return { stage, row: existing };
      assertStage(stage, authorityHash);
      if (stage.packageHash !== input.packageHash || stage.formatVersion !== input.formatVersion)
        throw conflict();
      if (existing) {
        if (
          existing.authorityHash !== authorityHash ||
          existing.confirmationHash !== stage.confirmationHash ||
          existing.mappingVersion !== MAPPING_VERSION ||
          existing.parserVersion !== stage.parserVersion
        )
          throw conflict();
        if (existing.status === 'running' && existing.leaseUntil > new Date()) throw inProgress();
        if (existing.epoch >= PACKAGE_IMPORT_MAX_ATTEMPTS)
          throw new AppError('VALIDATION_FAILED', '此方案包重试次数已达上限，请重新上传', 409);
      }
      const now = new Date();
      const leaseUntil = deadline(stage);
      const values = { status: 'running', leaseUntil, attemptId: randomUUID(), updatedAt: now };
      const [row] = existing
        ? await tx
            .update(imports)
            .set({ ...values, epoch: existing.epoch + 1 })
            .where(owner(userId, stage.id))
            .returning()
        : await tx
            .insert(imports)
            .values({
              ...values,
              stageId: stage.id,
              userId,
              requestHash,
              authorityHash,
              confirmationHash: stage.confirmationHash ?? '',
              parserVersion: stage.parserVersion,
              mappingVersion: MAPPING_VERSION,
              seed: randomUUID(),
              epoch: 1,
              createdAt: now,
            })
            .returning();
      await tx
        .update(stages)
        .set({ uploadLeaseUntil: leaseUntil })
        .where(stageOwner(userId, stage.id));
      return { stage, row };
    });
  }

  private async current<T>(
    userId: string,
    sessionId: string,
    claim: Row,
    action: (tx: MusefoldTransaction, row: Row, stage: Stage) => Promise<T>,
  ) {
    return this.db.transaction(async (tx) => {
      const authorityHash = await lockPackageAuthority(tx, userId, sessionId);
      const stage = await lockedStage(tx, userId, claim.stageId);
      const [row] = await tx.select().from(imports).where(owner(userId, stage.id)).for('update');
      assertStage(stage, authorityHash);
      if (
        row?.status !== 'running' ||
        row.epoch !== claim.epoch ||
        row.attemptId !== claim.attemptId ||
        row.leaseUntil <= new Date() ||
        row.authorityHash !== authorityHash ||
        row.confirmationHash !== stage.confirmationHash ||
        row.mappingVersion !== MAPPING_VERSION ||
        row.parserVersion !== stage.parserVersion
      )
        throw conflict();
      const leaseUntil = deadline(stage);
      await tx
        .update(imports)
        .set({ leaseUntil, updatedAt: new Date() })
        .where(owner(userId, stage.id));
      await tx
        .update(stages)
        .set({ uploadLeaseUntil: leaseUntil })
        .where(stageOwner(userId, stage.id));
      return action(tx, { ...row, leaseUntil }, stage);
    });
  }
}

async function lockedStage(tx: MusefoldTransaction, userId: string, id: string) {
  const [stage] = await tx.select().from(stages).where(stageOwner(userId, id)).for('update');
  if (!stage) throw new AppError('VALIDATION_FAILED', '方案包不存在', 404);
  return stage;
}
function assertStage(stage: Stage, authorityHash: string) {
  if (
    stage.status !== 'confirmed' ||
    !stage.preview ||
    !stage.confirmationHash ||
    stage.authorityHash !== authorityHash ||
    stage.parserVersion !== DESIGN_SCHEME_PACKAGE_PARSER_VERSION ||
    stage.expiresAt <= new Date()
  )
    throw conflict();
  const expected = packageConfirmationHash(stage);
  if (stage.confirmationHash !== expected) throw conflict();
}
function deadline(stage: Stage) {
  const expiry = Math.min(
    Date.now() + DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS,
    stage.expiresAt.getTime(),
  );
  if (expiry - Date.now() < MIN_IO_LIFETIME) throw conflict();
  return new Date(expiry);
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new AppError('VALIDATION_FAILED', '导入已中断，请查询结果后重试', 409, true);
}
function intent(userId: string, objectKey: string) {
  return {
    ownerId: userId,
    objectKey,
    objectType: 'generation_reference' as const,
    reason: 'reference_expired' as const,
  };
}
function conflict() {
  return new AppError('VALIDATION_FAILED', '方案包或导入状态已变化，请查询状态后重试', 409, false, {
    reason: 'SCHEME_PACKAGE_IMPORT_CONFLICT',
  });
}
function inProgress() {
  return new AppError('VALIDATION_FAILED', '该方案包正在导入，请稍后查询或重试', 409, true, {
    reason: 'SCHEME_PACKAGE_IMPORT_IN_PROGRESS',
  });
}
