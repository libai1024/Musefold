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
  accountCredentials,
  deferObjectCleanup,
  enqueueObjectCleanup,
  generationAssets,
  generationEvents,
  generationReferenceLinks,
  generationReferenceUploads,
  generationRuns,
  markObjectCleanupAttemptFailed,
  objectCleanupQueue,
  rateLimitBuckets,
  removeAcknowledgedReferenceUploads,
} from '@musefold/db';
import { openJsonFromString } from '@musefold/server-crypto';
import { and, eq, gt, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import type { TaskList } from 'graphile-worker';
import type { WorkerEnv } from './env.js';
import {
  type GeneratedImage,
  type ReferenceImageInput,
  UpstreamImageError,
  generateImage,
  imageChecksum,
} from './image-gateway.js';

export interface GenerationPayload {
  userId: string;
  runId: string;
}

export interface GenerationAttemptOwner extends GenerationPayload {
  epoch: number;
}

export interface AcquiredGenerationRun {
  request: unknown;
  attemptCount: number;
}

export interface UploadedGenerationAsset extends GeneratedImage {
  id: string;
  objectKey: string;
  checksum: string;
}

export type GenerationTransition = 'succeed' | 'cancel' | 'skip';

export interface GenerationLeaseHandle {
  readonly signal?: AbortSignal;
  start(): void;
  stop(): void;
  assertOwned(): Promise<void>;
  markUpstreamRequestSent(): Promise<boolean>;
}

export interface GenerationAttemptDependencies {
  s3: S3Client;
  bucket: string;
  baseUrl: string;
  owner: GenerationAttemptOwner;
  request: ParsedCloudGenerationRequest;
  apiKey: string;
  references: ReferenceImageInput[];
  lease: GenerationLeaseHandle;
  markFailed: (code: string, message: string) => Promise<void>;
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
  remove?: (s3: S3Client, bucket: string, objectKeys: string[]) => Promise<void>;
  enqueueCleanup: (objectKeys: string[], nextAttemptAt?: Date) => Promise<void>;
  acknowledgeCleanup: (objectKeys: string[]) => Promise<void>;
  recordCleanupFailure: (objectKeys: string[], error: unknown) => Promise<void>;
}

function mapGenerationError(error: unknown): UpstreamImageError {
  if (error instanceof UpstreamImageError) return error;
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
  const remove = deps.remove ?? removeObjects;
  try {
    const images = await generate(deps.baseUrl, deps.apiKey, deps.request, deps.references, {
      signal: deps.lease.signal,
      beforeUpstreamRequest: () => deps.lease.markUpstreamRequestSent(),
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
    await deps.markFailed(generationErrorCode(mapped), mapped.message);
  } finally {
    deps.lease.stop();
    if (!committed && uploadedObjectKeys.length > 0) {
      await deps.enqueueCleanup(uploadedObjectKeys);
      try {
        await remove(deps.s3, deps.bucket, uploadedObjectKeys);
        await deps.acknowledgeCleanup(uploadedObjectKeys);
      } catch (error) {
        await deps.recordCleanupFailure(uploadedObjectKeys, error);
      }
    }
  }
}

const LEASE_DURATION_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
export const OBJECT_CLEANUP_BATCH_SIZE = 100;
const OBJECT_CLEANUP_CLAIM_MS = 10 * 60_000;

class LeaseLostError extends Error {
  constructor() {
    super('生成任务租约已失效');
    this.name = 'LeaseLostError';
  }
}

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

  constructor(
    private readonly db: MusefoldDatabase,
    private readonly userId: string,
    private readonly runId: string,
    readonly epoch: number,
    private readonly abortController: AbortController,
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

  async markUpstreamRequestSent(): Promise<boolean> {
    await this.assertOwned();
    const rows = await this.db
      .update(generationRuns)
      .set({ upstreamRequestSent: true })
      .where(
        and(
          eq(generationRuns.userId, this.userId),
          eq(generationRuns.id, this.runId),
          eq(generationRuns.status, 'running'),
          eq(generationRuns.attemptCount, this.epoch),
          gt(generationRuns.leaseExpiresAt, new Date()),
          eq(generationRuns.upstreamRequestSent, false),
        ),
      )
      .returning({ id: generationRuns.id });
    if (rows.length === 0) this.markLost();
    return rows.length > 0;
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
): GenerationLeaseHandle {
  return new GenerationLease(db, userId, runId, epoch, abortController);
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
  env: Pick<WorkerEnv, 'NEW_API_BASE_URL' | 'CREDENTIAL_ENCRYPTION_KEY' | 'S3_BUCKET'>;
  s3: S3Client;
  generate?: typeof generateImage;
  createLease?: (
    db: MusefoldDatabase,
    userId: string,
    runId: string,
    epoch: number,
    abortController: AbortController,
  ) => GenerationLeaseHandle;
  upload?: GenerationAttemptDependencies['upload'];
  remove?: GenerationAttemptDependencies['remove'];
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
  acknowledge(objectKeys: string[]): Promise<void>;
  discardProtected(objectKeys: string[]): Promise<void>;
  deferLeased(objectKeys: string[], now?: Date): Promise<void>;
  fail(objectKeys: string[], error: unknown, now?: Date): Promise<void>;
}

export class PostgresObjectCleanupStore implements ObjectCleanupStore {
  constructor(private readonly db: MusefoldDatabase) {}

  async queueExpiredReferences(now = new Date()): Promise<number> {
    return this.db.transaction(async (tx) => {
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
      const expired = rows.filter((row) => !linkedIds.has(row.id));
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
    return this.db.transaction(async (tx) => {
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
    if (objectKeys.length === 0) return { permanent: [], leased: [] };
    const result = await this.db.execute<{
      object_key: string;
      protection: 'permanent' | 'leased';
    }>(sql`
      WITH candidates(object_key) AS (
        VALUES ${sql.join(
          objectKeys.map((key) => sql`(${key})`),
          sql`, `,
        )}
      )
      SELECT DISTINCT object_key, protection
      FROM (
        SELECT ga.object_key, 'permanent'::text AS protection
        FROM generation_assets ga
        WHERE ga.object_key IN (${sql.join(
          objectKeys.map((key) => sql`${key}`),
          sql`, `,
        )})
        UNION ALL
        SELECT gru.object_key, 'permanent'::text AS protection
        FROM generation_reference_uploads gru
        WHERE gru.object_key IN (${sql.join(
          objectKeys.map((key) => sql`${key}`),
          sql`, `,
        )})
          AND EXISTS (
            SELECT 1
            FROM generation_reference_links grl
            WHERE grl.reference_id = gru.id AND grl.user_id = gru.user_id
          )
        UNION ALL
        SELECT candidate.object_key, 'leased'::text AS protection
        FROM candidates candidate
        JOIN generation_runs run
          ON left(
            candidate.object_key,
            length('users/' || run.user_id || '/generations/' || run.id || '/')
          ) = 'users/' || run.user_id || '/generations/' || run.id || '/'
        WHERE run.status IN ('queued', 'running', 'cancelling')
          AND (run.status = 'queued' OR run.lease_expires_at > ${now})
      ) protected
    `);
    const permanent = new Set<string>();
    const leased = new Set<string>();
    for (const row of result.rows) {
      if (row.protection === 'permanent') permanent.add(row.object_key);
      else leased.add(row.object_key);
    }
    for (const objectKey of permanent) leased.delete(objectKey);
    return { permanent: [...permanent], leased: [...leased] };
  }

  async acknowledge(objectKeys: string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    await this.db.transaction(async (tx) => {
      await removeAcknowledgedReferenceUploads(tx, objectKeys);
      await acknowledgeObjectCleanup(tx, objectKeys);
    });
  }

  async discardProtected(objectKeys: string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    await this.db.transaction(async (tx) => {
      await tx
        .update(generationReferenceUploads)
        .set({ status: 'available', cleanupQueuedAt: null })
        .where(
          and(
            inArray(generationReferenceUploads.objectKey, objectKeys),
            eq(generationReferenceUploads.status, 'cleanup_pending'),
          ),
        );
      await acknowledgeObjectCleanup(tx, objectKeys);
    });
  }

  async deferLeased(objectKeys: string[], now = new Date()): Promise<void> {
    await deferObjectCleanup(this.db, objectKeys, now);
  }

  async fail(objectKeys: string[], error: unknown, now = new Date()): Promise<void> {
    await markObjectCleanupAttemptFailed(this.db, objectKeys, error, now, true);
  }
}

export async function processObjectCleanupBatch(
  store: ObjectCleanupStore,
  s3: S3Client,
  bucket: string,
  remove: NonNullable<GenerationAttemptDependencies['remove']> = removeObjects,
  now = new Date(),
): Promise<{ expiredReferences: number; deleted: number; protected: number; failed: number }> {
  const expiredReferences = await store.queueExpiredReferences(now);
  const claimed = await store.claimDue(now);
  const objectKeys = claimed.map((row) => row.objectKey);
  if (objectKeys.length === 0) {
    return { expiredReferences, deleted: 0, protected: 0, failed: 0 };
  }
  const protection = await store.findProtected(objectKeys, now);
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
  remove: NonNullable<GenerationAttemptDependencies['remove']> = removeObjects,
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
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ status: generationRuns.status, attemptCount: generationRuns.attemptCount })
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
        if (updated.length > 0)
          await appendEvent(tx, userId, runId, 'generation.cancelled', { code });
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
      if (updated.length > 0) await appendEvent(tx, userId, runId, 'generation.failed', { code });
    });
  }

  async function finalizeGeneration(
    owner: GenerationAttemptOwner,
    uploaded: UploadedGenerationAsset[],
  ): Promise<GenerationTransition> {
    return db.transaction(async (tx) => {
      const current = await tx
        .select({
          status: generationRuns.status,
          attemptCount: generationRuns.attemptCount,
          leaseExpiresAt: generationRuns.leaseExpiresAt,
        })
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
      await appendEvent(tx, owner.userId, owner.runId, 'generation.succeeded', {
        assetCount: uploaded.length,
      });
      return transition;
    });
  }

  return {
    'maintenance.cleanup': async () => {
      await db
        .delete(rateLimitBuckets)
        .where(lte(rateLimitBuckets.updatedAt, sql`now() - interval '2 days'`));
      await processObjectCleanupBatches(cleanupStore, s3, env.S3_BUCKET, deps.remove);
    },

    // 防卡死巡检(crontab 每分钟):租约过期的 running/cancelling 与超时 queued 重新入队,
    // 恢复动作由 generate 任务 acquire 阶段的 decideLeaseRecovery 裁决(mark_unknown/mark_cancelled/continue)。
    'generation.reconcile': async () => {
      await reconcileStaleRuns(db);
    },

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
        if (run.status !== 'queued') {
          const action = decideLeaseRecovery(run);
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
            await appendEvent(tx, payload.userId, payload.runId, 'generation.cancelled', {
              reason: 'lease_expired_before_upstream',
            });
            return null;
          }
          if (action !== 'continue') return null;
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
        await appendEvent(tx, payload.userId, payload.runId, 'generation.running', {
          attemptCount: nextEpoch,
        });
        return { ...run, attemptCount: nextEpoch };
      });
      if (!acquired) return;

      const abortController = new AbortController();
      const lease = (deps.createLease ?? defaultCreateLease)(
        db,
        payload.userId,
        payload.runId,
        acquired.attemptCount,
        abortController,
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
        const credentialRows = await db
          .select({ ciphertext: accountCredentials.ciphertext })
          .from(accountCredentials)
          .where(
            and(
              eq(accountCredentials.userId, payload.userId),
              eq(accountCredentials.provider, 'new-api'),
            ),
          );
        const credentialRow = credentialRows[0];
        if (!credentialRow) {
          throw new UpstreamImageError('rejected', '账号生图凭据不存在，请重新登录');
        }
        const credential = openJsonFromString<{ apiKey: string }>(
          credentialRow.ciphertext,
          env.CREDENTIAL_ENCRYPTION_KEY,
        );
        const references = await downloadReferences(s3, env.S3_BUCKET, payload.userId, request);
        await executeGenerationAttempt({
          s3,
          bucket: env.S3_BUCKET,
          baseUrl: env.NEW_API_BASE_URL,
          owner: {
            userId: payload.userId,
            runId: payload.runId,
            epoch: acquired.attemptCount,
          },
          request,
          apiKey: credential.apiKey,
          references,
          lease,
          markFailed: (code, message) =>
            markFailed(payload.userId, payload.runId, acquired.attemptCount, code, message),
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
          remove: deps.remove,
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
          recordCleanupFailure: (objectKeys, error) =>
            markObjectCleanupAttemptFailed(db, objectKeys, error),
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
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: image.bytes,
        ContentType: image.mimeType,
        Metadata: { runId: payload.runId },
      }),
    );
    uploaded.push({ ...image, id, objectKey, checksum: imageChecksum(image.bytes) });
  }
  return uploaded;
}
