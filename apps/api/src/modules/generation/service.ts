import { randomUUID } from 'node:crypto';
import {
  type CreateGenerationInput,
  type GenerationHistoryPage,
  type GenerationJob,
  type GenerationReferenceImage,
  type ParsedGenerationHistoryQuery,
  type UploadReferenceImageInput,
  cloudGenerationRequestSchema,
  createGenerationInputSchema,
  generationHistoryQuerySchema,
  generationJobSchema,
  generationReferenceImageSchema,
  uploadReferenceImageInputSchema,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  generationAssets,
  generationEvents,
  generationRuns,
  prompts,
  workbenchSessions,
} from '@musefold/db';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import type { DbLike } from '../sync/change-log.js';
import type { AssetUrlSigner, SignedAssetUrl } from './s3-signer.js';

type Tx = DbLike;
type RunRow = typeof generationRuns.$inferSelect;
type AssetRow = typeof generationAssets.$inferSelect;

export const PROVIDER_MODEL = 'musefold-image-pro';
/** 生图任务的终态集合(取消/失败/成功等不可再变的状态)。 */
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'rejected', 'expired']);

/**
 * 生图运行编排(v2.5:云端 MCP 为只读白名单,审批/花费预留流程不迁移)。
 * 排队用 graphile_worker.add_job 与创建同事务提交,保证运行与任务原子一致。
 */
export class GenerationService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly signer: AssetUrlSigner,
  ) {}

  async create(
    userId: string,
    rawInput: CreateGenerationInput,
    idempotencyKey: string,
  ): Promise<GenerationJob> {
    const input = createGenerationInputSchema.parse(rawInput);
    const request = canonicalizeReferenceUrls(cloudGenerationRequestSchema.parse(input));
    return this.createQueued(userId, request, idempotencyKey, {
      sessionId: input.sessionId,
      parentRunId: input.parentRunId,
      runKind: input.runKind,
    });
  }

  async get(userId: string, id: string): Promise<GenerationJob> {
    const { run, assets } = await this.getRunAndAssets(this.db, userId, id);
    return this.toJob(run, assets);
  }

  async history(
    userId: string,
    rawQuery: ParsedGenerationHistoryQuery,
  ): Promise<GenerationHistoryPage> {
    const query = generationHistoryQuerySchema.parse(rawQuery);
    const conditions = [sql`r.user_id = ${userId}`];
    if (query.deletedOnly) conditions.push(sql`r.deleted_at IS NOT NULL`);
    else if (!query.includeDeleted) conditions.push(sql`r.deleted_at IS NULL`);
    if (query.sessionId) conditions.push(sql`r.session_id = ${query.sessionId}`);
    if (query.status) conditions.push(sql`r.status = ${query.status}`);
    if (query.from) conditions.push(sql`r.created_at >= ${new Date(query.from)}`);
    if (query.to) conditions.push(sql`r.created_at <= ${new Date(query.to)}`);
    if (query.providerModel) conditions.push(sql`r.provider_model = ${query.providerModel}`);
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(sql`(r.request->>'prompt') ILIKE ${pattern}`);
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      conditions.push(sql`(r.created_at, r.id) < (${new Date(cursor.createdAt)}, ${cursor.id})`);
    }

    const result = await this.db.execute(sql`
      SELECT r.* FROM generation_runs r
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${query.limit + 1}
    `);
    const rawRows = result.rows as unknown as Array<Record<string, unknown>>;
    const hasMore = rawRows.length > query.limit;
    const pageRaw = hasMore ? rawRows.slice(0, query.limit) : rawRows;
    const rows = pageRaw.map(rowFromRaw);
    const assets = rows.length
      ? await this.db
          .select()
          .from(generationAssets)
          .where(
            inArray(
              generationAssets.runId,
              rows.map((run) => run.id),
            ),
          )
          .orderBy(
            asc(generationAssets.runId),
            asc(generationAssets.position),
            asc(generationAssets.id),
          )
      : [];
    const assetsByRunId = new Map<string, AssetRow[]>();
    for (const asset of assets) {
      const list = assetsByRunId.get(asset.runId) ?? [];
      list.push(asset);
      assetsByRunId.set(asset.runId, list);
    }
    const last = rows.at(-1);
    return {
      items: rows.map((run) => this.toJob(run, assetsByRunId.get(run.id) ?? [])),
      nextCursor:
        hasMore && last
          ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() })
          : null,
    };
  }

  async cancel(userId: string, id: string): Promise<GenerationJob> {
    const outcome = await this.db.transaction(async (tx) => {
      const { run } = await this.getRunAndAssets(tx, userId, id);
      if (TERMINAL_STATUSES.has(run.status)) {
        throw new AppError('GENERATION_ALREADY_TERMINAL', '生成任务已经结束');
      }
      const next = run.status === 'running' ? 'cancelling' : 'cancelled';
      await tx
        .update(generationRuns)
        .set({
          status: next,
          progress: next === 'cancelled' ? 100 : run.progress,
          finishedAt: next === 'cancelled' ? new Date() : null,
        })
        .where(and(eq(generationRuns.userId, userId), eq(generationRuns.id, id)));
      await appendEvent(tx, userId, id, `generation.${next}`, {});
      return this.getRunAndAssets(tx, userId, id);
    });
    return this.toJob(outcome.run, outcome.assets);
  }

  async retry(userId: string, id: string, idempotencyKey: string): Promise<GenerationJob> {
    const source = await this.get(userId, id);
    if (source.status !== 'failed' && source.status !== 'cancelled') {
      throw new AppError('VALIDATION_FAILED', '只有失败或取消的任务可以重试', 409);
    }
    return this.createQueued(
      userId,
      cloudGenerationRequestSchema.parse(source.request),
      idempotencyKey,
      { parentRunId: source.id, runKind: 'retry' },
    );
  }

  async remove(userId: string, id: string): Promise<GenerationJob> {
    return this.changeDeleted(userId, id, true);
  }

  async restore(userId: string, id: string): Promise<GenerationJob> {
    return this.changeDeleted(userId, id, false);
  }

  /** 回收站内永久删除:仅已软删行合法;先硬删行(资产/事件级联),再尽力清理对象存储。 */
  async purge(userId: string, id: string): Promise<void> {
    const objectKeys = await this.db.transaction(async (tx) => {
      const { run, assets } = await this.getRunAndAssets(tx, userId, id);
      if (run.deletedAt == null) {
        throw new AppError('VALIDATION_FAILED', '只能永久删除回收站中的记录');
      }
      if (!TERMINAL_STATUSES.has(run.status)) {
        throw new AppError('VALIDATION_FAILED', '任务仍在进行中,请先取消');
      }
      await tx
        .delete(generationRuns)
        .where(and(eq(generationRuns.userId, userId), eq(generationRuns.id, id)));
      return assets.map((asset) => asset.objectKey);
    });
    // 对象删除失败不回滚行删除:孤儿对象可由存储保留策略兜底,不阻塞用户操作。
    await this.signer.removeObjects(objectKeys).catch(() => undefined);
  }

  async assetSignedUrl(userId: string, assetId: string): Promise<SignedAssetUrl> {
    const rows = await this.db
      .select({ objectKey: generationAssets.objectKey })
      .from(generationAssets)
      .where(and(eq(generationAssets.userId, userId), eq(generationAssets.id, assetId)));
    if (!rows[0]) throw new AppError('GENERATION_NOT_FOUND', '生成资产不存在');
    return this.signer.sign(rows[0].objectKey);
  }

  /**
   * 参考图上传(ui-parity 03 §7 P0):魔数嗅探定 mime,对象键 users/{userId}/references/{id},
   * 无独立行表 —— run.request 里内联引用,worker 由 userId+id 推导对象键取字节。
   */
  async uploadReferenceImage(
    userId: string,
    rawInput: UploadReferenceImageInput,
  ): Promise<GenerationReferenceImage> {
    const parsed = uploadReferenceImageInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', '参考图无效:文件为空或超过 20 MiB');
    }
    const input = parsed.data;
    const mimeType = sniffImageMime(input.bytes);
    if (!mimeType) throw new AppError('VALIDATION_FAILED', '请选择 PNG、JPG 或 WebP 图片');
    const id = randomUUID();
    await this.signer.putObject(referenceObjectKey(userId, id), input.bytes, mimeType);
    return generationReferenceImageSchema.parse({
      id,
      url: referenceImageUrl(id),
      name: input.name,
      mimeType,
      byteSize: input.bytes.byteLength,
    });
  }

  /** 参考图展示 URL:按用户前缀重建对象键再签名,天然只允许访问自己的上传。 */
  async referenceImageSignedUrl(userId: string, referenceId: string): Promise<SignedAssetUrl> {
    const id = generationReferenceImageSchema.shape.id.safeParse(referenceId);
    if (!id.success) throw new AppError('VALIDATION_FAILED', '参考图标识无效');
    return this.signer.sign(referenceObjectKey(userId, id.data));
  }

  async events(
    userId: string,
    id: string,
    afterSeq = 0,
  ): Promise<
    Array<{ seq: number; type: string; payload: Record<string, unknown>; createdAt: string }>
  > {
    await this.requireRun(this.db, userId, id);
    const rows = await this.db
      .select()
      .from(generationEvents)
      .where(
        and(
          eq(generationEvents.userId, userId),
          eq(generationEvents.runId, id),
          gt(generationEvents.seq, afterSeq),
        ),
      )
      .orderBy(asc(generationEvents.seq))
      .limit(100);
    return rows.map((row) => ({
      seq: row.seq,
      type: row.eventType,
      payload: row.payload,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async createQueued(
    userId: string,
    request: ReturnType<typeof cloudGenerationRequestSchema.parse>,
    idempotencyKey: string,
    options: {
      sessionId?: string;
      parentRunId?: string;
      runKind: 'free_generation' | 'refinement' | 'retry';
    },
  ): Promise<GenerationJob> {
    if (!/^[\x20-\x7e]{8,128}$/.test(idempotencyKey)) {
      throw new AppError('VALIDATION_FAILED', 'Idempotency-Key 无效');
    }
    const outcome = await this.db.transaction(async (tx) => {
      const duplicate = await tx
        .select()
        .from(generationRuns)
        .where(
          and(eq(generationRuns.userId, userId), eq(generationRuns.idempotencyKey, idempotencyKey)),
        );
      if (duplicate[0]) {
        return { run: duplicate[0], assets: await this.getAssets(tx, duplicate[0].id) };
      }
      if (options.sessionId) await this.requireSession(tx, userId, options.sessionId);
      if (options.parentRunId) await this.requireRun(tx, userId, options.parentRunId);
      let promptSnapshot: Record<string, unknown> | null = null;
      if (request.promptId) {
        const prompt = await tx
          .select({
            id: prompts.id,
            title: prompts.title,
            content: prompts.content,
            negative: prompts.negative,
            version: prompts.version,
          })
          .from(prompts)
          .where(and(eq(prompts.userId, userId), eq(prompts.id, request.promptId)));
        if (!prompt[0]) throw new AppError('PROMPT_NOT_FOUND', '提示词不存在');
        promptSnapshot = prompt[0];
      }
      const id = randomUUID();
      await tx.insert(generationRuns).values({
        id,
        userId,
        sessionId: options.sessionId ?? null,
        parentRunId: options.parentRunId ?? null,
        promptId: request.promptId ?? null,
        runKind: options.runKind,
        actorType: 'web',
        approvalStatus: 'not_required',
        status: 'queued',
        request: request as unknown as Record<string, unknown>,
        promptSnapshot,
        idempotencyKey,
        providerModel: PROVIDER_MODEL,
      });
      await appendEvent(tx, userId, id, 'generation.requested', {
        runKind: options.runKind,
        actorType: 'web',
      });
      await tx.execute(sql`
        SELECT graphile_worker.add_job(
          'generation.generate',
          json_build_object('userId', ${userId}::text, 'runId', ${id}::text),
          max_attempts := 1
        )
      `);
      return this.getRunAndAssets(tx, userId, id);
    });
    return this.toJob(outcome.run, outcome.assets);
  }

  private async changeDeleted(
    userId: string,
    id: string,
    deleted: boolean,
  ): Promise<GenerationJob> {
    const outcome = await this.db.transaction(async (tx) => {
      await this.requireRun(tx, userId, id);
      await tx
        .update(generationRuns)
        .set({ deletedAt: deleted ? new Date() : null })
        .where(and(eq(generationRuns.userId, userId), eq(generationRuns.id, id)));
      return this.getRunAndAssets(tx, userId, id);
    });
    return this.toJob(outcome.run, outcome.assets);
  }

  private async getRunAndAssets(
    tx: Tx,
    userId: string,
    id: string,
  ): Promise<{ run: RunRow; assets: AssetRow[] }> {
    const rows = await tx
      .select()
      .from(generationRuns)
      .where(and(eq(generationRuns.userId, userId), eq(generationRuns.id, id)));
    if (!rows[0]) throw new AppError('GENERATION_NOT_FOUND', '生成任务不存在');
    return { run: rows[0], assets: await this.getAssets(tx, id) };
  }

  private async getAssets(tx: Tx, runId: string): Promise<AssetRow[]> {
    return tx
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, runId))
      .orderBy(asc(generationAssets.position), asc(generationAssets.id));
  }

  private async requireSession(tx: Tx, userId: string, id: string): Promise<void> {
    const rows = await tx
      .select({ id: workbenchSessions.id })
      .from(workbenchSessions)
      .where(
        and(
          eq(workbenchSessions.userId, userId),
          eq(workbenchSessions.id, id),
          isNull(workbenchSessions.deletedAt),
        ),
      );
    if (!rows[0]) throw new AppError('WORKBENCH_SESSION_NOT_FOUND', '工作台会话不存在');
  }

  private async requireRun(tx: Tx, userId: string, id: string): Promise<void> {
    const rows = await tx
      .select({ id: generationRuns.id })
      .from(generationRuns)
      .where(and(eq(generationRuns.userId, userId), eq(generationRuns.id, id)));
    if (!rows[0]) throw new AppError('GENERATION_NOT_FOUND', '生成任务不存在');
  }

  private toJob(run: RunRow, assets: AssetRow[]): GenerationJob {
    return generationJobSchema.parse({
      id: run.id,
      sessionId: run.sessionId,
      parentRunId: run.parentRunId,
      promptId: run.promptId,
      actorType: run.actorType,
      approvalStatus: run.approvalStatus,
      status: run.status,
      progress: run.progress,
      request: cloudGenerationRequestSchema.parse(run.request),
      providerModel: run.providerModel,
      costPoints: run.costPoints,
      assets: assets.map((asset) => ({
        id: asset.id,
        url: `/api/v1/assets/${encodeURIComponent(asset.id)}/url`,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        byteSize: asset.byteSize,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      })),
      error: run.errorCode
        ? {
            code: mapGenerationError(run.errorCode),
            message: run.errorMessage ?? '生成失败',
          }
        : null,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      deletedAt: run.deletedAt?.toISOString() ?? null,
    });
  }
}

async function appendEvent(
  tx: Tx,
  userId: string,
  runId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(generationEvents).values({ userId, runId, eventType, payload });
}

function referenceObjectKey(userId: string, referenceId: string): string {
  return `users/${userId}/references/${referenceId}`;
}

function referenceImageUrl(referenceId: string): string {
  return `/api/v1/reference-images/${encodeURIComponent(referenceId)}/url`;
}

/** 入库前把参考图展示 URL 归一为服务端路由,不透传客户端自报地址。 */
function canonicalizeReferenceUrls(
  request: ReturnType<typeof cloudGenerationRequestSchema.parse>,
): ReturnType<typeof cloudGenerationRequestSchema.parse> {
  if (request.referenceImages.length === 0) return request;
  return {
    ...request,
    referenceImages: request.referenceImages.map((reference) => ({
      ...reference,
      url: referenceImageUrl(reference.id),
    })),
  };
}

/** PNG/JPEG/WebP 魔数嗅探(与桌面 staging、worker 资产校验同口径);不识别返回 null。 */
export function sniffImageMime(
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** history 原生行(execute 返回 snake_case)→ drizzle 行形状。 */
function rowFromRaw(raw: Record<string, unknown>): RunRow {
  return {
    id: raw.id as string,
    userId: raw.user_id as string,
    sessionId: raw.session_id as string | null,
    parentRunId: raw.parent_run_id as string | null,
    promptId: raw.prompt_id as string | null,
    runKind: raw.run_kind as string,
    actorType: raw.actor_type as string,
    approvalStatus: raw.approval_status as string,
    status: raw.status as string,
    progress: raw.progress as number,
    request: raw.request as Record<string, unknown>,
    promptSnapshot: raw.prompt_snapshot as Record<string, unknown> | null,
    idempotencyKey: raw.idempotency_key as string | null,
    providerModel: raw.provider_model as string | null,
    costPoints: raw.cost_points as number | null,
    errorCode: raw.error_code as string | null,
    errorMessage: raw.error_message as string | null,
    attemptCount: raw.attempt_count as number,
    upstreamRequestSent: raw.upstream_request_sent as boolean,
    leaseExpiresAt: toDateOrNull(raw.lease_expires_at),
    createdAt: toDate(raw.created_at),
    startedAt: toDateOrNull(raw.started_at),
    finishedAt: toDateOrNull(raw.finished_at),
    deletedAt: toDateOrNull(raw.deleted_at),
  };
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toDateOrNull(value: unknown): Date | null {
  return value == null ? null : toDate(value);
}

function mapGenerationError(code: string): NonNullable<GenerationJob['error']>['code'] {
  const allowed = new Set([
    'ACCOUNT_QUOTA_INSUFFICIENT',
    'GENERATION_UPSTREAM_REJECTED',
    'GENERATION_UPSTREAM_UNKNOWN',
    'GENERATION_STORAGE_FAILED',
    'INTERNAL_ERROR',
  ]);
  return (allowed.has(code) ? code : 'INTERNAL_ERROR') as NonNullable<
    GenerationJob['error']
  >['code'];
}

function encodeCursor(value: { id: string; createdAt: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { id: string; createdAt: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      id?: unknown;
      createdAt?: unknown;
    };
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') {
      throw new Error('invalid');
    }
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    throw new AppError('VALIDATION_FAILED', '生成历史分页游标无效');
  }
}
