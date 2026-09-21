import {
  INVENTORY_PREFIXES,
  inventoryScanRequestSchema,
  inventoryScopeId,
  scanObjectInventoryPage,
} from './object-inventory.js';
import { findProtectedObjects } from './object-protection.js';
import { processObjectInventoryCandidates } from './object-inventory-delete.js';
import { retireUnprotectedObjects } from './object-retirement.js';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  type ParsedCloudGenerationRequest,
  cloudGenerationRequestSchema,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  MAX_OBJECT_CLEANUP_ATTEMPTS,
  acknowledgeObjectCleanup,
  collectObjectMaintenanceSnapshot,
  ExecutionAuthorityError,
  deferObjectCleanup,
  enqueueObjectCleanup,
  generationAssets,
  generationEvents,
  generationReferenceLinks,
  generationReferenceUploads,
  designSchemeGenerationReferences,
  generationRuns,
  generationExecutionReceipts,
  markObjectCleanupAttemptFailed,
  objectCleanupQueue,
  removeAcknowledgedReferenceUploads,
  retireDesignSchemeSourcePreparations,
  retireDesignSchemePackageStages,
  runRetentionTransaction,
} from '@musefold/db';
import { openJsonFromString } from '@musefold/server-crypto';
import { and, eq, gt, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import type { TaskList } from 'graphile-worker';
import type { WorkerEnv } from './env.js';
import type { GenerationPayload, UploadedGenerationAsset } from './generation-types.js';
import {
  assertSchemeGenerationRequest,
  downloadDesignSchemeReferences,
  synchronizeDesignSchemeRun,
} from './design-scheme-runs.js';
import {
  type GeneratedImage,
  type ImageDispatchSnapshot,
  type ReferenceImageInput,
  UpstreamImageError,
  generateImage,
  imageChecksum,
} from './image-gateway.js';
import { clearExpiredAccountRecoverySecretBatches } from './account-recovery-retention.js';
import { purgeExpiredSoftDeletedPrompts, purgeExpiredSoftDeletedRuns } from './retention.js';
import { trimExpiredSyncRecords } from './sync-retention.js';
import { purgeExpiredRateLimitBuckets } from './maintenance-retention.js';
import { claimGenerationExecution, synchronizeExecutionReceipt } from './generation-execution.js';

export type { GenerationPayload, UploadedGenerationAsset } from './generation-types.js';

export interface GenerationAttemptOwner extends GenerationPayload {
  epoch: number;
}

export interface AcquiredGenerationRun {
  request: unknown;
  attemptCount: number;
}

export type GenerationTransition = 'succeed' | 'cancel' | 'skip';

export interface GenerationLeaseHandle {
  readonly signal?: AbortSignal;
  start(): void;
  stop(): void;
  assertOwned(): Promise<void>;
  claimUpstreamRequest(): Promise<ImageDispatchSnapshot | null>;
  readonly dispatchClaimed: boolean;
}

export interface GenerationAttemptDependencies {
  s3: S3Client;
  bucket: string;
  owner: GenerationAttemptOwner;
  request: ParsedCloudGenerationRequest;
  references: ReferenceImageInput[];
  lease: GenerationLeaseHandle;
  markFailed: (code: string, message: string, confirmedNotSent?: boolean) => Promise<void>;
  finalize: (assets: UploadedGenerationAsset[]) => Promise<GenerationTransition>;
  generate?: typeof generateImage;
  upload?: (
    s3: S3Client,
    bucket: string,
    payload: GenerationPayload,
    images: GeneratedImage[],
    uploadedObjectKeys: string[],
    beforeUpload?: (objectKey: string) => Promise<void>,
  ) => Promise<UploadedGenerationAsset[]>;
  enqueueCleanup: (objectKeys: string[], nextAttemptAt?: Date) => Promise<void>;
  acknowledgeCleanup: (objectKeys: string[]) => Promise<void>;
}

class LeaseLostError extends Error {
  constructor() {
    super('生成任务租约已失效');
    this.name = 'LeaseLostError';
  }
}

function isObjectStorageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: string }).name) : '';
  const code = 'Code' in error ? String((error as { Code?: string }).Code) : '';
  const message = error instanceof Error ? error.message : '';
  return /ObjectStorageError|NoSuchBucket|NotFound|AccessDenied|TimeoutError|NetworkingError|ECONNREFUSED|S3/.test(
    `${name} ${code} ${message}`,
  );
}

export function mapGenerationError(error: unknown): UpstreamImageError {
  if (error instanceof UpstreamImageError) return error;
  if (error instanceof LeaseLostError) {
    return new UpstreamImageError('unknown', '生成任务租约已失效');
  }
  if (isObjectStorageError(error)) {
    return new UpstreamImageError('unknown', '成图保存失败，请重试');
  }
  return new UpstreamImageError('unknown', '生成执行失败');
}

function generationErrorCode(error: UpstreamImageError): string {
  return error.code === 'quota'
    ? 'ACCOUNT_QUOTA_INSUFFICIENT'
    : error.code === 'rejected'
      ? 'GENERATION_UPSTREAM_REJECTED'
      : 'GENERATION_UPSTREAM_UNKNOWN';
}

export async function executeGenerationAttempt(deps: GenerationAttemptDependencies): Promise<void> {
  const uploadedObjectKeys: string[] = [];
  let committed = false;
  const generate = deps.generate ?? generateImage;
  const upload = deps.upload ?? uploadImagesForGeneration;
  try {
    const images = await generate(deps.request, deps.references, {
      signal: deps.lease.signal,
      claimUpstreamRequest: () => deps.lease.claimUpstreamRequest(),
    });
    await deps.lease.assertOwned();
    const uploaded = await upload(
      deps.s3,
      deps.bucket,
      deps.owner,
      images,
      uploadedObjectKeys,
      (objectKey) => deps.enqueueCleanup([objectKey], new Date(Date.now() + 60 * 60_000)),
    );
    const transition = await deps.finalize(uploaded);
    if (transition === 'skip') throw new LeaseLostError();
    committed = transition === 'succeed';
    if (committed) await deps.acknowledgeCleanup(uploadedObjectKeys).catch(() => undefined);
  } catch (error) {
    const mapped = mapGenerationError(error);
    console.error('[worker] generation attempt failed', {
      code: mapped.code,
      name: error instanceof Error ? error.name : typeof error,
      message: mapped.message,
    });
    await deps.markFailed(
      generationErrorCode(mapped),
      mapped.message,
      mapped.dispatch === 'not_sent' && deps.lease.dispatchClaimed,
    );
  } finally {
    deps.lease.stop();
    if (!committed && uploadedObjectKeys.length > 0) {
      // A lost commit response can hide a successful transaction. Maintenance is
      // the only deletion entry point, and rechecks canonical owners and leases.
      await deps.enqueueCleanup(uploadedObjectKeys);
    }
  }
}

const LEASE_DURATION_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
export const OBJECT_CLEANUP_BATCH_SIZE = 100;
const OBJECT_CLEANUP_CLAIM_MS = 10 * 60_000;

export function ownsGenerationLease(
  run: { attemptCount: number; leaseExpiresAt: Date | null },
  epoch: number,
  now = Date.now(),
): boolean {
  return (
    run.attemptCount === epoch && run.leaseExpiresAt !== null && run.leaseExpiresAt.getTime() > now
  );
}

export function decideGenerationCommit(
  run: { status: string; attemptCount: number; leaseExpiresAt: Date | null },
  epoch: number,
  now = Date.now(),
): 'succeed' | 'cancel' | 'skip' {
  if (!ownsGenerationLease(run, epoch, now)) return 'skip';
  return decideFinishTransition(run.status);
}

export class GenerationLease {
  private timer: NodeJS.Timeout | undefined;
  private renewing = false;
  private lost = false;
  private claimed = false;

  constructor(
    private readonly db: MusefoldDatabase,
    private readonly userId: string,
    private readonly runId: string,
    readonly epoch: number,
    private readonly abortController: AbortController,
    private readonly execution: { env: TaskDependencies['env']; request: unknown },
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.renew();
    }, HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async assertOwned(): Promise<void> {
    if (this.lost) throw new LeaseLostError();
  }

  get isLost(): boolean {
    return this.lost;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get dispatchClaimed(): boolean {
    return this.claimed;
  }

  async claimUpstreamRequest(): Promise<ImageDispatchSnapshot | null> {
    await this.assertOwned();
    try {
      const snapshot = await claimGenerationExecution(this.db, this.execution.env, {
        userId: this.userId,
        runId: this.runId,
        epoch: this.epoch,
        request: this.execution.request,
      });
      if (!snapshot) {
        this.markLost();
        return null;
      }
      this.claimed = true;
      // This is the ciphertext returned by the successful authority/claim
      // transaction. Never read the current account key after releasing it.
      const credential = openJsonFromString<{ apiKey?: unknown }>(
        snapshot.encryptedCredential.ciphertext,
        this.execution.env.CREDENTIAL_ENCRYPTION_KEY,
      );
      if (
        typeof credential.apiKey !== 'string' ||
        !credential.apiKey ||
        credential.apiKey.length > 8192
      )
        throw new Error('Invalid credential envelope');
      return Object.freeze({
        baseUrl: snapshot.baseUrl,
        apiKey: credential.apiKey,
        model: snapshot.model,
      });
    } catch (error) {
      throw new UpstreamImageError(
        'rejected',
        error instanceof ExecutionAuthorityError
          ? '账号执行授权已失效，请重新登录后重新提交'
          : '账号生图凭据不可用，请重新登录',
        'not_sent',
      );
    }
  }

  async renewNow(): Promise<void> {
    await this.renew();
  }

  private async renew(): Promise<void> {
    if (this.lost || this.renewing) return;
    this.renewing = true;
    try {
      const rows = await this.db
        .update(generationRuns)
        .set({ leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS) })
        .where(
          and(
            eq(generationRuns.userId, this.userId),
            eq(generationRuns.id, this.runId),
            inArray(generationRuns.status, ['running', 'cancelling']),
            eq(generationRuns.attemptCount, this.epoch),
            gt(generationRuns.leaseExpiresAt, new Date()),
          ),
        )
        .returning({ id: generationRuns.id, status: generationRuns.status });
      if (rows.length === 0) this.markLost();
      else if (rows[0]?.status === 'cancelling') this.abortController.abort();
    } catch {
      this.markLost();
    } finally {
      this.renewing = false;
    }
  }

  private markLost(): void {
    this.lost = true;
    this.abortController.abort();
  }
}

export function generationJobKey(runId: string): string {
  return `generation:${runId}`;
}

function defaultCreateLease(
  db: MusefoldDatabase,
  userId: string,
  runId: string,
  epoch: number,
  abortController: AbortController,
  execution: { env: TaskDependencies['env']; request: unknown },
): GenerationLeaseHandle {
  return new GenerationLease(db, userId, runId, epoch, abortController, execution);
}

export type LeaseRecoveryAction = 'continue' | 'mark_unknown' | 'mark_cancelled' | 'skip';

/**
 * 计费安全:上游请求一旦发出就绝不盲目重试——
 * provider 可能在 worker 掉线期间已受理并扣费。
 * cancelling 且未发出上游请求 → 直接收敛为 cancelled(取消意图优先,不再重跑)。
 */
export function decideLeaseRecovery(
  run: { status: string; upstreamRequestSent: boolean; leaseExpiresAt: Date | null },
  now = Date.now(),
): LeaseRecoveryAction {
  if (!run.leaseExpiresAt || run.leaseExpiresAt.getTime() > now) return 'skip';
  if (run.upstreamRequestSent) return 'mark_unknown';
  return run.status === 'cancelling' ? 'mark_cancelled' : 'continue';
}

/** 成功落库前的终局裁决:running 才允许提交;cancelling 收敛为 cancelled 并丢弃产物。 */
export function decideFinishTransition(status: string | undefined): 'succeed' | 'cancel' | 'skip' {
  if (status === 'running') return 'succeed';
  if (status === 'cancelling') return 'cancel';
  return 'skip';
}

/** 失败路径终局裁决:cancelling 时用户取消意图优先,收敛为 cancelled 而不是 failed。 */
export function decideFailureTransition(status: string | undefined): 'fail' | 'cancel' | 'skip' {
  if (status === 'running') return 'fail';
  if (status === 'cancelling') return 'cancel';
  return 'skip';
}

/** 重新入队卡死运行(队列自身 max_attempts=1,靠 acquire 阶段的租约守卫防重复执行)。 */
export async function reconcileStaleRuns(
  db: Pick<MusefoldDatabase, 'select' | 'execute'>,
  now = new Date(),
): Promise<number> {
  const staleRows = (await db
    .select({ id: generationRuns.id, userId: generationRuns.userId })
    .from(generationRuns)
    .where(
      or(
        and(
          inArray(generationRuns.status, ['running', 'cancelling']),
          lte(generationRuns.leaseExpiresAt, now),
        ),
        // queued 卡死:入队即有任务,但 worker 在执行前崩溃时任务已被消耗。
        and(
          eq(generationRuns.status, 'queued'),
          lte(generationRuns.createdAt, new Date(now.getTime() - 5 * 60_000)),
        ),
      ),
    )
    .limit(100)) as Array<{ id: string; userId: string }>;
  for (const run of staleRows) {
    await db.execute(sql`
      SELECT graphile_worker.add_job(
        'generation.generate',
        json_build_object('userId', ${run.userId}::text, 'runId', ${run.id}::text),
        max_attempts := 1,
        job_key := ${generationJobKey(run.id)},
        job_key_mode := 'replace'
      )
    `);
  }
  return staleRows.length;
}

export interface TaskDependencies {
  db: MusefoldDatabase;
  env: Pick<
    WorkerEnv,
    'PUBLIC_BASE_URL' | 'NEW_API_BASE_URL' | 'CREDENTIAL_ENCRYPTION_KEY' | 'S3_BUCKET'
  > &
    Partial<Pick<WorkerEnv, 'MAINTENANCE_CLEANUP_PAUSED' | 'S3_ENDPOINT' | 'S3_REGION'>>;
  s3: S3Client;
  generate?: typeof generateImage;
  createLease?: (
    db: MusefoldDatabase,
    userId: string,
    runId: string,
    epoch: number,
    abortController: AbortController,
    execution: { env: TaskDependencies['env']; request: unknown },
  ) => GenerationLeaseHandle;
  upload?: GenerationAttemptDependencies['upload'];
  remove?: (s3: S3Client, bucket: string, objectKeys: string[]) => Promise<void>;
  cleanupStore?: ObjectCleanupStore;
}

export interface ClaimedObjectCleanup {
  objectKey: string;
  objectType: string;
}

export interface ObjectCleanupProtection {
  permanent: string[];
  leased: string[];
}

export interface ObjectCleanupStore {
  queueExpiredReferences(now?: Date): Promise<number>;
  claimDue(now?: Date): Promise<ClaimedObjectCleanup[]>;
  findProtected(objectKeys: string[], now?: Date): Promise<ObjectCleanupProtection>;
  authorizeDeletion(objectKeys: string[], now?: Date): Promise<ObjectCleanupProtection>;
  acknowledge(objectKeys: string[]): Promise<void>;
  discardProtected(objectKeys: string[]): Promise<void>;
  deferLeased(objectKeys: string[], now?: Date): Promise<void>;
  fail(objectKeys: string[], error: unknown, now?: Date): Promise<void>;
}

/** PostgreSQL lock_not_available from the retention transaction's bounded lock wait. */
function isStorageKeyLockContention(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  return code === '55P03' || cause?.code === '55P03';
}

export class PostgresObjectCleanupStore implements ObjectCleanupStore {
  constructor(private readonly db: MusefoldDatabase) {}
  async queueExpiredReferences(now = new Date()): Promise<number> {
    return runRetentionTransaction(this.db, async (tx) => {
      const rows = await tx
        .select({
          id: generationReferenceUploads.id,
          userId: generationReferenceUploads.userId,
          objectKey: generationReferenceUploads.objectKey,
        })
        .from(generationReferenceUploads)
        .where(
          and(
            inArray(generationReferenceUploads.status, ['uploading', 'available']),
            lte(generationReferenceUploads.expiresAt, now),
            notExists(
              tx
                .select({ value: sql`1` })
                .from(generationReferenceLinks)
                .where(
                  and(
                    eq(generationReferenceLinks.referenceId, generationReferenceUploads.id),
                    eq(generationReferenceLinks.userId, generationReferenceUploads.userId),
                  ),
                ),
            ),
            notExists(
              tx
                .select({ value: sql`1` })
                .from(designSchemeGenerationReferences)
                .where(
                  eq(
                    designSchemeGenerationReferences.objectKey,
                    generationReferenceUploads.objectKey,
                  ),
                ),
            ),
          ),
        )
        .limit(OBJECT_CLEANUP_BATCH_SIZE)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return 0;
      const linked = await tx
        .select({ referenceId: generationReferenceLinks.referenceId })
        .from(generationReferenceLinks)
        .where(
          inArray(
            generationReferenceLinks.referenceId,
            rows.map((row) => row.id),
          ),
        );
      const linkedIds = new Set(linked.map((row) => row.referenceId));
      // Adoption takes this upload's row lock before writing its immutable scheme reference.
      // Re-read after acquiring locks: the candidate SELECT may predate that commit.
      const schemeReferences = await tx
        .select({ objectKey: designSchemeGenerationReferences.objectKey })
        .from(designSchemeGenerationReferences)
        .where(
          inArray(
            designSchemeGenerationReferences.objectKey,
            rows.map((row) => row.objectKey),
          ),
        );
      const schemeKeys = new Set(schemeReferences.map((row) => row.objectKey));
      const expired = rows.filter(
        (row) => !linkedIds.has(row.id) && !schemeKeys.has(row.objectKey),
      );
      if (expired.length === 0) return 0;
      const objectKeys = expired.map((row) => row.objectKey);
      await tx
        .update(generationReferenceUploads)
        .set({ status: 'cleanup_pending', cleanupQueuedAt: now })
        .where(inArray(generationReferenceUploads.objectKey, objectKeys));
      await enqueueObjectCleanup(
        tx,
        expired.map((row) => ({
          objectKey: row.objectKey,
          ownerId: row.userId,
          objectType: 'generation_reference' as const,
          reason: 'reference_expired' as const,
        })),
        now,
      );
      return expired.length;
    });
  }

  async claimDue(now = new Date()): Promise<ClaimedObjectCleanup[]> {
    return runRetentionTransaction(this.db, async (tx) => {
      const rows = await tx
        .select({
          objectKey: objectCleanupQueue.objectKey,
          objectType: objectCleanupQueue.objectType,
        })
        .from(objectCleanupQueue)
        .where(
          and(lte(objectCleanupQueue.nextAttemptAt, now), isNull(objectCleanupQueue.abandonedAt)),
        )
        .orderBy(objectCleanupQueue.nextAttemptAt, objectCleanupQueue.createdAt)
        .limit(OBJECT_CLEANUP_BATCH_SIZE)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return [];
      const objectKeys = rows.map((row) => row.objectKey);
      await tx
        .update(objectCleanupQueue)
        .set({
          attemptCount: sql`${objectCleanupQueue.attemptCount} + 1`,
          abandonedAt: sql`CASE
            WHEN ${objectCleanupQueue.attemptCount} + 1 >= ${MAX_OBJECT_CLEANUP_ATTEMPTS}
            THEN ${now}::timestamptz
            ELSE NULL
          END`,
          lastAttemptAt: now,
          nextAttemptAt: new Date(now.getTime() + OBJECT_CLEANUP_CLAIM_MS),
          updatedAt: now,
        })
        .where(inArray(objectCleanupQueue.objectKey, objectKeys));
      return rows;
    });
  }

  async findProtected(objectKeys: string[], now = new Date()): Promise<ObjectCleanupProtection> {
    return findProtectedObjects(this.db, objectKeys, now);
  }

  async authorizeDeletion(
    objectKeys: string[],
    now = new Date(),
  ): Promise<ObjectCleanupProtection> {
    try {
      return await retireUnprotectedObjects(this.db, objectKeys, now);
    } catch (error) {
      if (!isStorageKeyLockContention(error) || objectKeys.length === 1) throw error;
      // A key whose advisory lock is held has an in-flight publication or retirement.
      // It must not roll back co-claimed keys: retire key-by-key and defer the
      // contested one as if leased; its serialized writer resolves the next round.
      const merged: ObjectCleanupProtection = { permanent: [], leased: [] };
      for (const objectKey of objectKeys) {
        try {
          const protection = await retireUnprotectedObjects(this.db, [objectKey], now);
          merged.permanent.push(...protection.permanent);
          merged.leased.push(...protection.leased);
        } catch (error) {
          if (!isStorageKeyLockContention(error)) throw error;
          merged.leased.push(objectKey);
        }
      }
      return merged;
    }
  }

  async acknowledge(objectKeys: string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    await runRetentionTransaction(this.db, async (tx) => {
      await removeAcknowledgedReferenceUploads(tx, objectKeys);
      await acknowledgeObjectCleanup(tx, objectKeys);
    });
  }

  async discardProtected(objectKeys: string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    // Import source/asset objects must retain a durable cleanup intent after promotion, including
    // after an account cascade removes their registry. Revisit while canonical references protect them.
    const imported = objectKeys.filter((key) => key.startsWith('scheme-imports/'));
    const ordinary = objectKeys.filter((key) => !key.startsWith('scheme-imports/'));
    if (!objectKeys.length) return;
    await runRetentionTransaction(this.db, async (tx) => {
      if (imported.length) await deferObjectCleanup(tx, imported);
      if (!ordinary.length) return;
      await tx
        .update(generationReferenceUploads)
        .set({ status: 'available', cleanupQueuedAt: null })
        .where(
          and(
            inArray(generationReferenceUploads.objectKey, ordinary),
            eq(generationReferenceUploads.status, 'cleanup_pending'),
          ),
        );
      await acknowledgeObjectCleanup(tx, ordinary);
    });
  }

  async deferLeased(objectKeys: string[], now = new Date()): Promise<void> {
    if (!objectKeys.length) return;
    await runRetentionTransaction(this.db, (tx) => deferObjectCleanup(tx, objectKeys, now));
  }

  async fail(objectKeys: string[], error: unknown, now = new Date()): Promise<void> {
    if (!objectKeys.length) return;
    await runRetentionTransaction(this.db, (tx) =>
      markObjectCleanupAttemptFailed(tx, objectKeys, error, now, true),
    );
  }
}

export async function processObjectCleanupBatch(
  store: ObjectCleanupStore,
  s3: S3Client,
  bucket: string,
  remove: NonNullable<TaskDependencies['remove']> = removeObjects,
  now = new Date(),
): Promise<{ expiredReferences: number; deleted: number; protected: number; failed: number }> {
  const expiredReferences = await store.queueExpiredReferences(now);
  const claimed = await store.claimDue(now);
  const objectKeys = claimed.map((row) => row.objectKey);
  if (objectKeys.length === 0) {
    return { expiredReferences, deleted: 0, protected: 0, failed: 0 };
  }
  const protection = await store.authorizeDeletion(objectKeys, now);
  const permanentSet = new Set(protection.permanent);
  const leasedSet = new Set(protection.leased);
  const deletable = objectKeys.filter(
    (objectKey) => !permanentSet.has(objectKey) && !leasedSet.has(objectKey),
  );
  if (protection.permanent.length > 0) await store.discardProtected(protection.permanent);
  if (protection.leased.length > 0) await store.deferLeased(protection.leased, now);
  const protectedCount = protection.permanent.length + protection.leased.length;
  if (deletable.length === 0) {
    return { expiredReferences, deleted: 0, protected: protectedCount, failed: 0 };
  }
  try {
    await remove(s3, bucket, deletable);
    await store.acknowledge(deletable);
    return {
      expiredReferences,
      deleted: deletable.length,
      protected: protectedCount,
      failed: 0,
    };
  } catch (error) {
    await store.fail(deletable, error, now);
    return {
      expiredReferences,
      deleted: 0,
      protected: protectedCount,
      failed: deletable.length,
    };
  }
}

export async function processObjectCleanupBatches(
  store: ObjectCleanupStore,
  s3: S3Client,
  bucket: string,
  remove: NonNullable<TaskDependencies['remove']> = removeObjects,
  now = new Date(),
  maxBatches = 10,
): Promise<{ expiredReferences: number; deleted: number; protected: number; failed: number }> {
  const total = { expiredReferences: 0, deleted: 0, protected: 0, failed: 0 };
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await processObjectCleanupBatch(store, s3, bucket, remove, now);
    total.expiredReferences += result.expiredReferences;
    total.deleted += result.deleted;
    total.protected += result.protected;
    total.failed += result.failed;
    if (
      result.expiredReferences === 0 &&
      result.deleted === 0 &&
      result.protected === 0 &&
      result.failed === 0
    ) {
      break;
    }
  }
  return total;
}

export function createTaskList(deps: TaskDependencies): TaskList {
  const { db, env, s3 } = deps;
  const cleanupStore = deps.cleanupStore ?? new PostgresObjectCleanupStore(db);

  async function appendEvent(
    tx: Pick<MusefoldDatabase, 'insert'>,
    userId: string,
    runId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(generationEvents).values({ userId, runId, eventType, payload });
  }

  async function markFailed(
    userId: string,
    runId: string,
    epoch: number,
    code: string,
    message: string,
    confirmedNotSent = false,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.userId, userId),
            eq(generationRuns.id, runId),
            eq(generationRuns.attemptCount, epoch),
            gt(generationRuns.leaseExpiresAt, new Date()),
          ),
        )
        .for('update');
      const current = rows[0];
      if (!current || current.status === 'queued') return;
      const transition = decideFailureTransition(current.status);
      if (transition === 'skip') return;
      if (transition === 'cancel') {
        const updated = await tx
          .update(generationRuns)
          .set({
            status: 'cancelled',
            progress: 100,
            finishedAt: new Date(),
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(generationRuns.userId, userId),
              eq(generationRuns.id, runId),
              eq(generationRuns.status, 'cancelling'),
              eq(generationRuns.attemptCount, epoch),
              gt(generationRuns.leaseExpiresAt, new Date()),
            ),
          )
          .returning({ id: generationRuns.id });
        if (updated.length > 0) {
          await synchronizeExecutionReceipt(tx, current, 'cancelled', { confirmedNotSent });
          await synchronizeDesignSchemeRun(
            tx,
            { id: runId, userId, designSchemeRunId: current.designSchemeRunId },
            'cancelled',
            { now: new Date() },
          );
          await appendEvent(tx, userId, runId, 'generation.cancelled', { code });
        }
        return;
      }
      const updated = await tx
        .update(generationRuns)
        .set({
          status: 'failed',
          progress: 100,
          errorCode: code,
          errorMessage: message.slice(0, 500),
          finishedAt: new Date(),
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(generationRuns.userId, userId),
            eq(generationRuns.id, runId),
            eq(generationRuns.status, 'running'),
            eq(generationRuns.attemptCount, epoch),
            gt(generationRuns.leaseExpiresAt, new Date()),
          ),
        )
        .returning({ id: generationRuns.id });
      if (updated.length > 0) {
        await synchronizeExecutionReceipt(tx, current, 'failed', { confirmedNotSent });
        await synchronizeDesignSchemeRun(
          tx,
          { id: runId, userId, designSchemeRunId: current.designSchemeRunId },
          'failed',
          {
            now: new Date(),
            error: {
              code,
              message: message.trim().slice(0, 500) || '生成执行失败',
              retryable: false,
              recoveryAction: 'none',
            },
          },
        );
        await appendEvent(tx, userId, runId, 'generation.failed', { code });
      }
    });
  }

  async function finalizeGeneration(
    owner: GenerationAttemptOwner,
    uploaded: UploadedGenerationAsset[],
  ): Promise<GenerationTransition> {
    return db.transaction(async (tx) => {
      const current = await tx
        .select()
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.userId, owner.userId),
            eq(generationRuns.id, owner.runId),
            eq(generationRuns.attemptCount, owner.epoch),
            gt(generationRuns.leaseExpiresAt, new Date()),
          ),
        )
        .for('update');
      const currentRun = current[0];
      if (!currentRun) return 'skip';
      const transition = decideGenerationCommit(currentRun, owner.epoch);
      if (transition === 'skip') return transition;
      if (transition === 'cancel') {
        const updated = await tx
          .update(generationRuns)
          .set({
            status: 'cancelled',
            progress: 100,
            finishedAt: new Date(),
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(generationRuns.userId, owner.userId),
              eq(generationRuns.id, owner.runId),
              eq(generationRuns.status, 'cancelling'),
              eq(generationRuns.attemptCount, owner.epoch),
              gt(generationRuns.leaseExpiresAt, new Date()),
            ),
          )
          .returning({ id: generationRuns.id });
        if (updated.length === 0) return 'skip';
        await synchronizeExecutionReceipt(tx, currentRun, 'cancelled');
        await synchronizeDesignSchemeRun(
          tx,
          {
            id: owner.runId,
            userId: owner.userId,
            designSchemeRunId: currentRun.designSchemeRunId,
          },
          'cancelled',
          { now: new Date() },
        );
        await appendEvent(tx, owner.userId, owner.runId, 'generation.cancelled', {
          reason: 'cancelled_during_run',
        });
        return transition;
      }
      for (const [position, asset] of uploaded.entries()) {
        await tx.insert(generationAssets).values({
          id: asset.id,
          runId: owner.runId,
          userId: owner.userId,
          objectKey: asset.objectKey,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          byteSize: asset.bytes.length,
          checksumSha256: asset.checksum,
          position,
        });
      }
      const updated = await tx
        .update(generationRuns)
        .set({
          status: 'succeeded',
          progress: 100,
          finishedAt: new Date(),
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(generationRuns.userId, owner.userId),
            eq(generationRuns.id, owner.runId),
            eq(generationRuns.status, 'running'),
            eq(generationRuns.attemptCount, owner.epoch),
            gt(generationRuns.leaseExpiresAt, new Date()),
          ),
        )
        .returning({ id: generationRuns.id });
      if (updated.length === 0) throw new LeaseLostError();
      await synchronizeExecutionReceipt(tx, currentRun, 'succeeded');
      await synchronizeDesignSchemeRun(
        tx,
        { id: owner.runId, userId: owner.userId, designSchemeRunId: currentRun.designSchemeRunId },
        'completed',
        { now: new Date(), uploaded },
      );
      await appendEvent(tx, owner.userId, owner.runId, 'generation.succeeded', {
        assetCount: uploaded.length,
      });
      return transition;
    });
  }

  const cleanup: TaskList[string] = async (_payload, helpers) => {
    if (env.MAINTENANCE_CLEANUP_PAUSED) {
      helpers?.logger?.info('[maintenance] paused');
      return;
    }
    let stage = 'package_stages';
    // Only explicitly selected counters enter logs; no row IDs, content, object
    // keys or raw SQL errors. Completed stages remain committed if a later one fails.
    const report = (counts: Record<string, number>) =>
      helpers?.logger?.info(`[maintenance] ${JSON.stringify({ stage, ...counts })}`);
    try {
      report({ retired: await retireDesignSchemePackageStages(db) });
      stage = 'source_preparations';
      report({ retired: await retireDesignSchemeSourcePreparations(db) });
      stage = 'account_recovery';
      report(await clearExpiredAccountRecoverySecretBatches(db));
      stage = 'rate_limits';
      report(await purgeExpiredRateLimitBuckets(db));
      stage = 'generation_runs';
      const runs = await purgeExpiredSoftDeletedRuns(db);
      report({ purged: runs.purged, queuedObjects: runs.objectKeys.length });
      stage = 'prompts';
      report(await purgeExpiredSoftDeletedPrompts(db));
      stage = 'sync';
      report(await trimExpiredSyncRecords(db));
      stage = 'objects';
      report(await processObjectCleanupBatches(cleanupStore, s3, env.S3_BUCKET, deps.remove));
    } catch {
      // Graphile persists and logs thrown errors. Keep retries without persisting
      // database query parameters or storage credentials in the job error field.
      throw new Error(`Maintenance stage failed: ${stage}`);
    }
  };
  // 防卡死巡检(crontab 每分钟):租约过期的 running/cancelling 与超时 queued 重新入队,
  // 恢复动作由 generate 任务 acquire 阶段的 decideLeaseRecovery 裁决(mark_unknown/mark_cancelled/continue)。
  const reconcile = async () => {
    await reconcileStaleRuns(db);
  };

  const inventory: TaskList[string] = async (payload, helpers) => {
    if (env.MAINTENANCE_CLEANUP_PAUSED) {
      helpers?.logger?.info('[inventory] paused');
      return;
    }
    const request = inventoryScanRequestSchema.safeParse(payload ?? {});
    if (!request.success) throw new Error('InvalidInventoryRequest');
    const scopeId = inventoryScopeId(
      env.S3_BUCKET,
      env.S3_ENDPOINT ?? `aws:${env.S3_REGION ?? 'auto'}`,
    );
    try {
      for (const prefix of INVENTORY_PREFIXES) {
        const counts = await scanObjectInventoryPage(
          { db, s3, bucket: env.S3_BUCKET, scopeId },
          prefix,
          request.data.mode,
        );
        helpers?.logger?.info(
          `[inventory] ${JSON.stringify({ prefix, mode: request.data.mode, ...counts })}`,
        );
      }
      const deleted = await processObjectInventoryCandidates(
        { db, s3, bucket: env.S3_BUCKET, scopeId },
        request.data.mode,
      );
      helpers?.logger?.info(`[inventory-delete] ${JSON.stringify(deleted)}`);
    } catch {
      throw new Error('ObjectInventoryScanFailed');
    }
  };

  // D02.7 read-only observation seam. Intentionally NOT gated by
  // MAINTENANCE_CLEANUP_PAUSED: a paused executor is exactly when operators
  // watch these counters. Pure SELECT aggregation; logs counts only — object
  // identities stay as SHA-256 hashes inside the snapshot, never in logs.
  const safetySnapshot: TaskList[string] = async (_payload, helpers) => {
    const snapshot = await collectObjectMaintenanceSnapshot(db);
    helpers?.logger?.info(
      `[maintenance-safety] ${JSON.stringify({
        outbox: snapshot.outbox,
        inventory: snapshot.inventory,
        retired: snapshot.retired,
        totals: snapshot.totals,
      })}`,
    );
  };

  return {
    'maintenance.safety-snapshot': safetySnapshot,
    'maintenance/safety-snapshot': safetySnapshot,
    'maintenance.inventory': inventory,
    'maintenance/inventory': inventory,
    'maintenance.cleanup': cleanup,
    'maintenance/cleanup': cleanup,
    'generation.reconcile': reconcile,
    'generation/reconcile': reconcile,

    'generation.generate': async (rawPayload) => {
      const payload = rawPayload as GenerationPayload;

      // 认领阶段:queued 或租约过期的 running/cancelling 才可进入;已发出上游请求的过期租约标 unknown。
      const acquired = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(generationRuns)
          .where(
            and(
              eq(generationRuns.userId, payload.userId),
              eq(generationRuns.id, payload.runId),
              or(
                eq(generationRuns.status, 'queued'),
                and(
                  inArray(generationRuns.status, ['running', 'cancelling']),
                  lte(generationRuns.leaseExpiresAt, new Date()),
                ),
              ),
            ),
          )
          .for('update');
        const run = rows[0];
        if (!run) return null;
        const [receipt] = run.executionReceiptId
          ? await tx
              .select()
              .from(generationExecutionReceipts)
              .where(
                and(
                  eq(generationExecutionReceipts.id, run.executionReceiptId),
                  eq(generationExecutionReceipts.principalId, run.userId),
                ),
              )
              .for('update')
          : [];
        if (run.status !== 'queued' || run.upstreamRequestSent || receipt?.dispatch === 'claimed') {
          const action =
            run.upstreamRequestSent || receipt?.dispatch === 'claimed'
              ? 'mark_unknown'
              : decideLeaseRecovery(run);
          if (action === 'mark_unknown') {
            await tx
              .update(generationRuns)
              .set({
                status: 'failed',
                progress: 100,
                errorCode: 'GENERATION_UPSTREAM_UNKNOWN',
                errorMessage: 'worker 在上游请求完成前退出，结果无法确认',
                finishedAt: new Date(),
                leaseExpiresAt: null,
              })
              .where(
                and(
                  eq(generationRuns.userId, payload.userId),
                  eq(generationRuns.id, run.id),
                  eq(generationRuns.attemptCount, run.attemptCount),
                ),
              );
            await synchronizeExecutionReceipt(tx, run, 'failed');
            await synchronizeDesignSchemeRun(tx, run, 'failed', {
              now: new Date(),
              error: {
                code: 'GENERATION_UPSTREAM_UNKNOWN',
                message: 'worker 在上游请求完成前退出，结果无法确认',
                retryable: false,
                recoveryAction: 'none',
              },
            });
            await appendEvent(tx, payload.userId, payload.runId, 'generation.failed', {
              code: 'GENERATION_UPSTREAM_UNKNOWN',
            });
            return null;
          }
          if (action === 'mark_cancelled') {
            await tx
              .update(generationRuns)
              .set({
                status: 'cancelled',
                progress: 100,
                finishedAt: new Date(),
                leaseExpiresAt: null,
              })
              .where(
                and(
                  eq(generationRuns.userId, payload.userId),
                  eq(generationRuns.id, run.id),
                  eq(generationRuns.attemptCount, run.attemptCount),
                ),
              );
            await synchronizeExecutionReceipt(tx, run, 'cancelled');
            await synchronizeDesignSchemeRun(tx, run, 'cancelled', { now: new Date() });
            await appendEvent(tx, payload.userId, payload.runId, 'generation.cancelled', {
              reason: 'lease_expired_before_upstream',
            });
            return null;
          }
          if (action !== 'continue') return null;
        }
        if (
          receipt?.bindingState !== 'bound' ||
          !receipt.binding ||
          receipt.originalRunId !== run.id ||
          !receipt.authorizingSessionId ||
          !receipt.authRevision ||
          receipt.dispatch !== 'not_started' ||
          receipt.purgedAt
        ) {
          await tx
            .update(generationRuns)
            .set({
              status: 'failed',
              progress: 100,
              errorCode: 'ACCOUNT_IDENTITY_UNVERIFIED',
              errorMessage: '历史任务缺少可信执行授权，请重新登录后重新提交',
              finishedAt: new Date(),
              leaseExpiresAt: null,
            })
            .where(eq(generationRuns.id, run.id));
          await synchronizeExecutionReceipt(tx, run, 'failed');
          await synchronizeDesignSchemeRun(tx, run, 'failed', {
            now: new Date(),
            error: {
              code: 'ACCOUNT_IDENTITY_UNVERIFIED',
              message: '历史任务缺少可信执行授权，请重新提交',
              retryable: false,
              recoveryAction: 'none',
            },
          });
          await appendEvent(tx, run.userId, run.id, 'generation.failed', {
            code: 'ACCOUNT_IDENTITY_UNVERIFIED',
          });
          return null;
        }
        const nextEpoch = run.attemptCount + 1;
        const updated = await tx
          .update(generationRuns)
          .set({
            status: 'running',
            progress: 5,
            attemptCount: nextEpoch,
            upstreamRequestSent: false,
            startedAt: run.startedAt ?? new Date(),
            leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
          })
          .where(
            and(
              eq(generationRuns.userId, payload.userId),
              eq(generationRuns.id, run.id),
              eq(generationRuns.attemptCount, run.attemptCount),
            ),
          )
          .returning({ id: generationRuns.id });
        if (updated.length === 0) return null;
        await synchronizeExecutionReceipt(tx, run, 'running');
        const schemeContext = await synchronizeDesignSchemeRun(tx, run, 'executing', {
          now: new Date(),
        });
        await appendEvent(tx, payload.userId, payload.runId, 'generation.running', {
          attemptCount: nextEpoch,
        });
        return { ...run, attemptCount: nextEpoch, schemeContext };
      });
      if (!acquired) return;

      const abortController = new AbortController();
      const lease = (deps.createLease ?? defaultCreateLease)(
        db,
        payload.userId,
        payload.runId,
        acquired.attemptCount,
        abortController,
        { env, request: acquired.request },
      );
      lease.start();

      let request: ParsedCloudGenerationRequest;
      try {
        request = cloudGenerationRequestSchema.parse(acquired.request);
      } catch {
        await markFailed(
          payload.userId,
          payload.runId,
          acquired.attemptCount,
          'GENERATION_UPSTREAM_REJECTED',
          '生成请求数据无效',
        );
        lease.stop();
        return;
      }

      try {
        if (acquired.schemeContext) assertSchemeGenerationRequest(acquired.schemeContext, request);
        const references = acquired.designSchemeRunId
          ? await downloadDesignSchemeReferences(db, s3, env.S3_BUCKET, payload, request)
          : await downloadReferences(s3, env.S3_BUCKET, payload.userId, request);
        await executeGenerationAttempt({
          s3,
          bucket: env.S3_BUCKET,
          owner: {
            userId: payload.userId,
            runId: payload.runId,
            epoch: acquired.attemptCount,
          },
          request,
          references,
          lease,
          markFailed: (code, message, confirmedNotSent) =>
            markFailed(
              payload.userId,
              payload.runId,
              acquired.attemptCount,
              code,
              message,
              confirmedNotSent,
            ),
          finalize: (uploaded) =>
            finalizeGeneration(
              {
                userId: payload.userId,
                runId: payload.runId,
                epoch: acquired.attemptCount,
              },
              uploaded,
            ),
          generate: deps.generate,
          upload: deps.upload,
          enqueueCleanup: (objectKeys, nextAttemptAt) => {
            const now = new Date();
            return enqueueObjectCleanup(
              db,
              objectKeys.map((objectKey) => ({
                objectKey,
                ownerId: payload.userId,
                objectType: 'generation_asset' as const,
                reason: 'generation_compensation' as const,
              })),
              now,
              nextAttemptAt ?? now,
            );
          },
          acknowledgeCleanup: (objectKeys) => acknowledgeObjectCleanup(db, objectKeys),
        });
      } catch (error) {
        const mapped = mapGenerationError(error);
        await markFailed(
          payload.userId,
          payload.runId,
          acquired.attemptCount,
          generationErrorCode(mapped),
          mapped.message,
        );
        lease.stop();
      }
    },
  };
}

/** 从对象存储取回参考图字节(对象键由 userId + 引用 id 推导,与 API 上传侧同构)。 */
export async function downloadReferences(
  s3: S3Client,
  bucket: string,
  userId: string,
  request: ParsedCloudGenerationRequest,
): Promise<ReferenceImageInput[]> {
  const references: ReferenceImageInput[] = [];
  for (const reference of request.referenceImages) {
    try {
      const result = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: `users/${userId}/references/${reference.id}` }),
      );
      const bytes = Buffer.from((await result.Body?.transformToByteArray()) ?? []);
      if (bytes.length === 0) throw new Error('empty');
      references.push({ bytes, mimeType: reference.mimeType, name: reference.name });
    } catch {
      throw new UpstreamImageError('rejected', `参考图「${reference.name}」已不可用,请重新上传`);
    }
  }
  return references;
}

async function removeObjects(s3: S3Client, bucket: string, objectKeys: string[]): Promise<void> {
  if (objectKeys.length === 0) return;
  const result = await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: objectKeys.map((key) => ({ Key: key })), Quiet: true },
    }),
  );
  if (result.Errors && result.Errors.length > 0) {
    throw Object.assign(new Error('S3 reported object deletion failures'), {
      name: 'S3DeleteObjectsError',
    });
  }
}

export async function uploadImagesForGeneration(
  s3: S3Client,
  bucket: string,
  payload: GenerationPayload,
  images: GeneratedImage[],
  uploadedObjectKeys: string[],
  beforeUpload?: (objectKey: string) => Promise<void>,
): Promise<Array<GeneratedImage & { id: string; objectKey: string; checksum: string }>> {
  const uploaded: Array<GeneratedImage & { id: string; objectKey: string; checksum: string }> = [];
  for (const image of images) {
    const id = randomUUID();
    const objectKey = `users/${payload.userId}/generations/${payload.runId}/${id}`;
    await beforeUpload?.(objectKey);
    uploadedObjectKeys.push(objectKey);
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: image.bytes,
          ContentType: image.mimeType,
          Metadata: { runId: payload.runId },
        }),
      );
    } catch (error) {
      throw Object.assign(new Error('成图保存失败，请重试'), {
        name: 'ObjectStorageError',
        cause: error,
      });
    }
    uploaded.push({ ...image, id, objectKey, checksum: imageChecksum(image.bytes) });
  }
  return uploaded;
}
