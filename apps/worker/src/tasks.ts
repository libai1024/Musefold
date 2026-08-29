import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
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

export type LeaseRecoveryAction = 'continue' | 'mark_unknown' | 'skip';

/**
 * 计费安全:上游请求一旦发出就绝不盲目重试——
 * provider 可能在 worker 掉线期间已受理并扣费。
 */
export function decideLeaseRecovery(
  run: { status: string; upstreamRequestSent: boolean; leaseExpiresAt: Date | null },
  now = Date.now(),
): LeaseRecoveryAction {
  if (!run.leaseExpiresAt || run.leaseExpiresAt.getTime() > now) return 'skip';
  return run.upstreamRequestSent ? 'mark_unknown' : 'continue';
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
            inArray(generationRuns.status, ['running', 'cancelling']),
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

        await db.transaction(async (tx) => {
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
              and(eq(generationRuns.userId, payload.userId), eq(generationRuns.id, payload.runId)),
            );
          await appendEvent(tx, payload.userId, payload.runId, 'generation.succeeded', {
            assetCount: uploaded.length,
          });
        });
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
