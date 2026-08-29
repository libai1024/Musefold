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
  accountCredentials,
  generationAssets,
  generationEvents,
  generationRuns,
  rateLimitBuckets,
} from '@musefold/db';
import { openJsonFromString } from '@musefold/server-crypto';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { TaskList } from 'graphile-worker';
import type { WorkerEnv } from './env.js';
import {
  type GeneratedImage,
  type ReferenceImageInput,
  UpstreamImageError,
  generateImage,
  imageChecksum,
} from './image-gateway.js';

interface GenerationPayload {
  userId: string;
  runId: string;
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
        max_attempts := 1
      )
    `);
  }
  return staleRows.length;
}

export interface TaskDependencies {
  db: MusefoldDatabase;
  env: Pick<WorkerEnv, 'NEW_API_BASE_URL' | 'CREDENTIAL_ENCRYPTION_KEY' | 'S3_BUCKET'>;
  s3: S3Client;
}

export function createTaskList(deps: TaskDependencies): TaskList {
  const { db, env, s3 } = deps;

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
    code: string,
    message: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ status: generationRuns.status })
        .from(generationRuns)
        .where(and(eq(generationRuns.userId, userId), eq(generationRuns.id, runId)))
        .for('update');
      const transition = decideFailureTransition(rows[0]?.status);
      if (transition === 'skip') return;
      if (transition === 'cancel') {
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
              eq(generationRuns.userId, userId),
              eq(generationRuns.id, runId),
              eq(generationRuns.status, 'cancelling'),
            ),
          );
        await appendEvent(tx, userId, runId, 'generation.cancelled', { code });
        return;
      }
      await tx
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
          ),
        );
      await appendEvent(tx, userId, runId, 'generation.failed', { code });
    });
  }

  return {
    'maintenance.cleanup': async () => {
      await db
        .delete(rateLimitBuckets)
        .where(lte(rateLimitBuckets.updatedAt, sql`now() - interval '2 days'`));
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
              .where(eq(generationRuns.id, run.id));
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
              .where(eq(generationRuns.id, run.id));
            await appendEvent(tx, payload.userId, payload.runId, 'generation.cancelled', {
              reason: 'lease_expired_before_upstream',
            });
            return null;
          }
          if (action !== 'continue') return null;
        }
        await tx
          .update(generationRuns)
          .set({
            status: 'running',
            progress: 5,
            attemptCount: sql`${generationRuns.attemptCount} + 1`,
            upstreamRequestSent: true,
            startedAt: run.startedAt ?? new Date(),
            leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
          })
          .where(eq(generationRuns.id, run.id));
        await appendEvent(tx, payload.userId, payload.runId, 'generation.running', {});
        return run;
      });
      if (!acquired) return;

      let request: ParsedCloudGenerationRequest;
      try {
        request = cloudGenerationRequestSchema.parse(acquired.request);
      } catch {
        await markFailed(
          payload.userId,
          payload.runId,
          'GENERATION_UPSTREAM_REJECTED',
          '生成请求数据无效',
        );
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
        const images = await generateImage(
          env.NEW_API_BASE_URL,
          credential.apiKey,
          request,
          references,
        );
        const uploaded = await uploadImages(s3, env.S3_BUCKET, payload, images);

        // 终局提交带状态守卫:执行期间用户可能已请求取消(cancelling),此时丢弃产物收敛为 cancelled。
        const transition = await db.transaction(async (tx) => {
          const current = await tx
            .select({ status: generationRuns.status })
            .from(generationRuns)
            .where(
              and(eq(generationRuns.userId, payload.userId), eq(generationRuns.id, payload.runId)),
            )
            .for('update');
          const decided = decideFinishTransition(current[0]?.status);
          if (decided === 'cancel') {
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
                  eq(generationRuns.id, payload.runId),
                  eq(generationRuns.status, 'cancelling'),
                ),
              );
            await appendEvent(tx, payload.userId, payload.runId, 'generation.cancelled', {
              reason: 'cancelled_during_run',
            });
            return decided;
          }
          if (decided !== 'succeed') return decided;
          for (const [position, asset] of uploaded.entries()) {
            await tx.insert(generationAssets).values({
              id: asset.id,
              runId: payload.runId,
              userId: payload.userId,
              objectKey: asset.objectKey,
              mimeType: asset.mimeType,
              width: asset.width,
              height: asset.height,
              byteSize: asset.bytes.length,
              checksumSha256: asset.checksum,
              position,
            });
          }
          await tx
            .update(generationRuns)
            .set({
              status: 'succeeded',
              progress: 100,
              finishedAt: new Date(),
              leaseExpiresAt: null,
            })
            .where(
              and(
                eq(generationRuns.userId, payload.userId),
                eq(generationRuns.id, payload.runId),
                eq(generationRuns.status, 'running'),
              ),
            );
          await appendEvent(tx, payload.userId, payload.runId, 'generation.succeeded', {
            assetCount: uploaded.length,
          });
          return decided;
        });
        if (transition !== 'succeed') {
          // 已上传的对象不再被任何行引用,尽力清理;失败交由存储保留策略兜底。
          await removeObjects(
            s3,
            env.S3_BUCKET,
            uploaded.map((asset) => asset.objectKey),
          ).catch(() => undefined);
        }
      } catch (error) {
        const mapped =
          error instanceof UpstreamImageError
            ? error
            : new UpstreamImageError('unknown', '生成执行失败');
        const code =
          mapped.code === 'quota'
            ? 'ACCOUNT_QUOTA_INSUFFICIENT'
            : mapped.code === 'rejected'
              ? 'GENERATION_UPSTREAM_REJECTED'
              : 'GENERATION_UPSTREAM_UNKNOWN';
        await markFailed(payload.userId, payload.runId, code, mapped.message);
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
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: objectKeys.map((key) => ({ Key: key })), Quiet: true },
    }),
  );
}

async function uploadImages(
  s3: S3Client,
  bucket: string,
  payload: GenerationPayload,
  images: GeneratedImage[],
): Promise<Array<GeneratedImage & { id: string; objectKey: string; checksum: string }>> {
  const uploaded: Array<GeneratedImage & { id: string; objectKey: string; checksum: string }> = [];
  for (const image of images) {
    const id = randomUUID();
    const objectKey = `users/${payload.userId}/generations/${payload.runId}/${id}`;
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
