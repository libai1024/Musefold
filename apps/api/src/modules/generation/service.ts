import { createHash, randomUUID } from 'node:crypto';
import { CLOUD_GENERATION_MODEL } from '@musefold/domain/cloud-generation-policy';
import { advanceCloudRunResult } from '@musefold/domain/design-scheme/run-result';
import {
  type CreateGenerationInput,
  type ExecutionBinding,
  type RetryGenerationInput,
  type ParsedCloudGenerationRequest,
  type ParsedDesignSchemeRunInput,
  workbenchDraftSchema,
  runResultSchema,
  type GenerationCleanupInput,
  type GenerationCleanupResult,
  type GenerationHistoryPage,
  type GenerationJob,
  type GenerationReferenceImage,
  type ParsedCreateGenerationInput,
  type ParsedGenerationHistoryQuery,
  type ResolvedPromptReferenceSnapshot,
  type UploadReferenceImageInput,
  type ReleaseReferenceImageInput,
  releaseReferenceImageInputSchema,
  cloudGenerationRequestSchema,
  createGenerationInputSchema,
  generationCleanupInputSchema,
  generationHistoryQuerySchema,
  generationJobSchema,
  generationAssetSchema,
  generationReferenceImageSchema,
  resolvedPromptReferenceSnapshotSchema,
  uploadReferenceImageInputSchema,
  retryGenerationInputSchema,
} from '@musefold/contracts';
import {
  composeGenerationPrompt,
  isValidUtf16SliceRange,
  type PromptReferenceCompositionResult,
} from '@musefold/domain/generation-prompt';
import {
  type MusefoldDatabase,
  type MusefoldTransaction,
  executionDigest,
  generationExecutionReceipts,
  enqueueObjectCleanup,
  generationAssets,
  designSchemeGenerationReferences,
  designSchemeRuns,
  designSchemeRunExecutions,
  designSchemeRunSteps,
  generationEvents,
  generationReferenceLinks,
  generationReferenceUploads,
  generationRuns,
  prompts,
  SOFT_DELETE_RETENTION_MS,
  workbenchSessions,
} from '@musefold/db';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { normalizeNewApiUrl } from '@musefold/new-api-client';
import { AppError } from '../../lib/errors.js';
import type { DbLike } from '../sync/change-log.js';
import type { AssetUrlSigner, SignedAssetUrl } from './s3-signer.js';
import { inspectSchemeImage } from '../design-scheme-assets/image.js';
import {
  MAX_DESIGN_SCHEME_IMAGE_DIMENSION,
  MAX_DESIGN_SCHEME_IMAGE_PIXELS,
} from '@musefold/contracts/design-scheme-assets';
import {
  MAX_GENERATION_ASSET_BYTES,
  missingAssetContent,
  unavailableAssetContent,
} from './asset-content.js';
import {
  GenerationReceiptService,
  cleanedResult,
  type ExecutionAuthority,
  type ReceiptIntent,
} from './execution-receipts.js';
import {
  type AccountModelCatalogReader,
  assertModelAuthorizationIdentity,
  readGenerationModelAuthorization,
} from './model-authorization.js';

type Tx = DbLike;
type RunRow = typeof generationRuns.$inferSelect;
type AssetRow = typeof generationAssets.$inferSelect;
type QueuedRunOptions = {
  sessionId?: string;
  parentRunId?: string;
  runKind: 'free_generation' | 'refinement' | 'retry';
};

type PromptSourceSnapshot = {
  id: string;
  title: string;
  content: string;
  negative: string | null;
  version: number;
};

type GenerationPromptSnapshot = {
  schemaVersion: 1;
  userPrompt: string;
  logicalRequest: Record<string, unknown>;
  logicalRequestFingerprint: string;
  directPrompt: PromptSourceSnapshot | null;
  promptReferences: ResolvedPromptReferenceSnapshot[];
  finalPrompt: string;
  negative: string | null;
};

type FreshQueuedRun = QueuedRunOptions & {
  kind: 'fresh';
  input: ParsedCreateGenerationInput;
  legacyRequest: ReturnType<typeof cloudGenerationRequestSchema.parse> | null;
  logicalRequest: Record<string, unknown>;
  logicalRequestFingerprint: string;
};

type RetryQueuedRun = QueuedRunOptions & {
  kind: 'retry';
  sourceRunId: string;
};

type QueuedRun = FreshQueuedRun | RetryQueuedRun;

export const PROVIDER_MODEL = CLOUD_GENERATION_MODEL;
/** 生图任务的终态集合(取消/失败/成功等不可再变的状态)。 */
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'rejected', 'expired']);
/** Unlinked successful uploads expire after 24 hours; linked runs retain them until all links disappear. */
export const REFERENCE_UPLOAD_TTL_MS = 24 * 60 * 60_000;
/** 「清 30 天前」的窗口(承旧 HistoryCleanupMenu);与 D02 软删保留期同一数字。 */

/**
 * 生图运行编排(v2.5:云端 MCP 为只读白名单,审批/花费预留流程不迁移)。
 * 排队用 graphile_worker.add_job 与创建同事务提交,保证运行与任务原子一致。
 */
export class GenerationService {
  readonly receipts: GenerationReceiptService;
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly signer: AssetUrlSigner,
    issuers: { apiIssuer: string; upstreamIssuer: string },
    private readonly readModelCatalog?: AccountModelCatalogReader,
  ) {
    this.receipts = new GenerationReceiptService({
      apiIssuer: normalizeNewApiUrl(issuers.apiIssuer),
      upstreamIssuer: normalizeNewApiUrl(issuers.upstreamIssuer),
    });
  }

  /** Server-only admission shared by ordinary and scheme image intents, after replay lookup. */
  async authorizeImageExecution(
    tx: MusefoldTransaction,
    userId: string,
    authorizingSessionId: string,
    expectedBinding?: ExecutionBinding,
    model?: string,
  ) {
    const authorization =
      model === undefined
        ? null
        : await readGenerationModelAuthorization(
            this.readModelCatalog,
            authorizingSessionId,
            model,
          );
    const authority = await this.receipts.authorize(
      tx,
      userId,
      authorizingSessionId,
      expectedBinding,
      authorization?.model,
    );
    if (authorization) assertModelAuthorizationIdentity(authorization, authority.binding);
    return authority;
  }

  /** Internal transaction seam: only a host-verified scheme run may call this. */
  async enqueueSchemeRun(
    tx: MusefoldTransaction,
    userId: string,
    input: {
      generationRunId: string;
      designSchemeRunId: string;
      executionId: string;
      request: ParsedCloudGenerationRequest;
      userPrompt: string;
      promptReferences: ResolvedPromptReferenceSnapshot[];
      sessionId?: string;
      authorizingSessionId: string;
      authority: ExecutionAuthority;
      logicalInputDigest: string;
    },
  ): Promise<string> {
    const request = cloudGenerationRequestSchema.parse(input.request);
    if (
      (request.providerId && request.providerId !== input.authority.binding.providerId) ||
      (request.model ?? PROVIDER_MODEL) !== input.authority.binding.model
    )
      throw new AppError('VALIDATION_FAILED', '方案模型与已核对的执行身份不一致');
    let sessionId = input.sessionId;
    if (sessionId) {
      const [session] = await tx
        .select({ id: workbenchSessions.id })
        .from(workbenchSessions)
        .where(
          and(
            eq(workbenchSessions.id, sessionId),
            eq(workbenchSessions.userId, userId),
            isNull(workbenchSessions.deletedAt),
            isNull(workbenchSessions.archivedAt),
          ),
        )
        .for('share');
      if (!session) throw new AppError('WORKBENCH_SESSION_NOT_FOUND', '工作台会话不存在或已归档');
    } else {
      sessionId = randomUUID();
      await tx.insert(workbenchSessions).values({
        id: sessionId,
        userId,
        title: input.userPrompt.trim().slice(0, 120) || '方案生成',
        draft: workbenchDraftSchema.parse({
          prompt: input.userPrompt,
          negative: '',
          params: {},
          promptReferenceIds: [],
          promptReferenceSelections: [],
        }) as unknown as Record<string, unknown>,
      });
    }
    const receipt = await this.receipts.insert(
      tx,
      userId,
      `scheme:${input.executionId}`,
      { operation: 'scheme_run', sourceRunId: null, logicalInputDigest: input.logicalInputDigest },
      {
        originalRunId: input.generationRunId,
        request,
        authorizingSessionId: input.authorizingSessionId,
        authority: input.authority,
      },
    );
    await tx.insert(generationRuns).values({
      id: input.generationRunId,
      userId,
      sessionId,
      designSchemeRunId: input.designSchemeRunId,
      executionReceiptId: receipt.id,
      runKind: 'free_generation',
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'queued',
      request: request as unknown as Record<string, unknown>,
      promptSnapshot: {
        logicalRequest: request,
        logicalRequestFingerprint: fingerprintLogicalRequest(
          request as unknown as Record<string, unknown>,
        ),
        schemaVersion: 1,
        userPrompt: input.userPrompt,
        promptReferences: input.promptReferences,
        finalPrompt: request.prompt,
        directPrompt: null,
        negative: request.negative ?? null,
      },
      idempotencyKey: `scheme:${input.executionId}`,
      providerModel: input.authority.binding.model,
    });
    await appendEvent(tx, userId, input.generationRunId, 'generation.requested', {
      runKind: 'free_generation',
      actorType: 'web',
      designSchemeRunId: input.designSchemeRunId,
    });
    await tx.execute(
      sql`SELECT graphile_worker.add_job('generation.generate', json_build_object('userId', ${userId}::text, 'runId', ${input.generationRunId}::text), max_attempts := 1, job_key := ${generationJobKey(input.generationRunId)}, job_key_mode := 'replace')`,
    );
    return input.generationRunId;
  }

  resolveSchemePromptReferences(
    tx: Tx,
    userId: string,
    selections: ParsedDesignSchemeRunInput['executionSettings']['promptReferenceSelections'],
  ) {
    return this.resolvePromptReferences(tx, userId, { promptReferenceSelections: selections });
  }

  async create(
    userId: string,
    rawInput: CreateGenerationInput,
    idempotencyKey: string,
    authorizingSessionId: string,
  ): Promise<GenerationJob> {
    const input = createGenerationInputSchema.parse(rawInput);
    const canonicalInput = canonicalizeCreateReferenceUrls(input);
    const logicalRequest = canonicalLogicalRequest(canonicalInput);
    const legacyRequest = canonicalInput.prompt
      ? cloudGenerationRequestSchema.parse(canonicalInput)
      : null;
    return this.createQueued(
      userId,
      idempotencyKey,
      {
        kind: 'fresh',
        input: canonicalInput,
        legacyRequest,
        logicalRequest,
        logicalRequestFingerprint: fingerprintLogicalRequest(logicalRequest),
        sessionId: input.sessionId,
        parentRunId: input.parentRunId,
        runKind: input.runKind,
      },
      authorizingSessionId,
      input.expectedBinding,
    );
  }

  async getReceipt(userId: string, key: string) {
    const row = await this.receipts.find(this.db, userId, key);
    if (!row) throw new AppError('GENERATION_RECEIPT_NOT_FOUND', '执行记录不存在', 404);
    return this.receipts.toPublic(row);
  }

  async get(userId: string, id: string): Promise<GenerationJob> {
    return this.db.transaction(
      async (tx) => {
        const { run, assets } = await this.getRunAndAssets(tx, userId, id);
        return this.toJob(run, assets);
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  async history(
    userId: string,
    rawQuery: ParsedGenerationHistoryQuery,
  ): Promise<GenerationHistoryPage> {
    const query = generationHistoryQuerySchema.parse(rawQuery);
    return this.db.transaction(
      async (tx) => {
        const conditions = [sql`r.user_id = ${userId}`, sql`r.purge_started_at IS NULL`];
        if (query.deletedOnly) conditions.push(sql`r.deleted_at IS NOT NULL`);
        else if (!query.includeDeleted) conditions.push(sql`r.deleted_at IS NULL`);
        if (query.sessionId) conditions.push(sql`r.session_id = ${query.sessionId}`);
        if (query.status) conditions.push(sql`r.status = ${query.status}`);
        if (query.from) conditions.push(sql`r.created_at >= ${new Date(query.from)}`);
        if (query.to) conditions.push(sql`r.created_at <= ${new Date(query.to)}`);
        if (query.providerModel) conditions.push(sql`r.provider_model = ${query.providerModel}`);
        if (query.promptId) conditions.push(sql`r.prompt_id = ${query.promptId}`);
        if (query.search) {
          const pattern = `%${query.search}%`;
          conditions.push(sql`(r.request->>'prompt') ILIKE ${pattern}`);
        }
        if (query.cursor) {
          const cursor = decodeCursor(query.cursor);
          conditions.push(
            sql`(r.created_at, r.id) < (${new Date(cursor.createdAt)}, ${cursor.id})`,
          );
        }

        const result = await tx.execute(sql`
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
          ? await tx
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
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  async cancel(userId: string, id: string): Promise<GenerationJob> {
    const outcome = await this.db.transaction((tx) => this.cancelInTransaction(tx, userId, id));
    return this.toJob(outcome.run, outcome.assets);
  }

  async cancelInTransaction(tx: Tx, userId: string, id: string) {
    // One guarded UPDATE owns the transition after any competing worker update
    // commits, so a queued run cannot be cancelled using stale state.
    const transitioned = await tx
      .update(generationRuns)
      .set({
        status: sql`CASE WHEN ${generationRuns.status} = 'running' THEN 'cancelling' ELSE 'cancelled' END`,
        progress: sql`CASE WHEN ${generationRuns.status} = 'running' THEN ${generationRuns.progress} ELSE 100 END`,
        finishedAt: sql`CASE WHEN ${generationRuns.status} = 'running' THEN ${generationRuns.finishedAt} ELSE now() END`,
      })
      .where(
        and(
          eq(generationRuns.userId, userId),
          eq(generationRuns.id, id),
          inArray(generationRuns.status, ['running', 'pending_approval', 'queued']),
        ),
      )
      .returning();
    if (transitioned[0]) {
      const status = transitioned[0].status === 'cancelled' ? 'cancelled' : 'cancelling';
      await tx
        .update(generationExecutionReceipts)
        .set({
          status,
          ...(status === 'cancelled'
            ? {
                terminalAt: new Date(),
                dispatch: sql`CASE WHEN ${generationExecutionReceipts.dispatch} = 'not_started' THEN 'confirmed_not_sent' ELSE ${generationExecutionReceipts.dispatch} END`,
                // Only a bound, never-dispatched receipt proves zero spending. Preserve
                // unknown historical receipts and any already claimed provider accounting.
                costProvenance: sql`CASE WHEN ${generationExecutionReceipts.bindingState} = 'bound' AND ${generationExecutionReceipts.dispatch} = 'not_started' THEN 'not_sent' ELSE ${generationExecutionReceipts.costProvenance} END`,
                costPoints: sql`CASE WHEN ${generationExecutionReceipts.bindingState} = 'bound' AND ${generationExecutionReceipts.dispatch} = 'not_started' THEN 0 ELSE ${generationExecutionReceipts.costPoints} END`,
              }
            : {}),
          updatedAt: new Date(),
          revision: sql`${generationExecutionReceipts.revision} + 1`,
        })
        .where(
          and(
            eq(generationExecutionReceipts.principalId, userId),
            eq(generationExecutionReceipts.originalRunId, id),
          ),
        );
      if (transitioned[0].status === 'cancelled')
        await this.cancelSchemeLedger(tx, transitioned[0]);
      await appendEvent(tx, userId, id, `generation.${transitioned[0].status}`, {});
      return this.getRunAndAssets(tx, userId, id);
    }

    const current = await this.getRunAndAssets(tx, userId, id);
    if (current.run.status === 'cancelling' || current.run.status === 'cancelled') return current;
    throw new AppError('GENERATION_ALREADY_TERMINAL', '生成任务已经结束');
  }

  async retry(
    userId: string,
    id: string,
    idempotencyKey: string,
    authorizingSessionId: string,
    rawInput: RetryGenerationInput = {},
  ): Promise<GenerationJob> {
    const input = retryGenerationInputSchema.parse(rawInput);
    return this.createQueued(
      userId,
      idempotencyKey,
      { kind: 'retry', sourceRunId: id, parentRunId: id, runKind: 'retry' },
      authorizingSessionId,
      input.expectedBinding,
    );
  }

  async remove(userId: string, id: string): Promise<GenerationJob> {
    return this.changeDeleted(userId, id, true);
  }

  async restore(userId: string, id: string): Promise<GenerationJob> {
    return this.changeDeleted(userId, id, false);
  }

  /** 回收站内永久删除:同事务记录对象清理意图并硬删行,worker 检查共享引用后删除。 */
  async purge(userId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.userId, userId),
            eq(generationRuns.id, id),
            isNull(generationRuns.purgeStartedAt),
          ),
        )
        .for('update');
      if (!run) throw new AppError('GENERATION_NOT_FOUND', '生成任务不存在');
      if (run.deletedAt == null) {
        throw new AppError('VALIDATION_FAILED', '只能永久删除回收站中的记录');
      }
      if (!TERMINAL_STATUSES.has(run.status)) {
        throw new AppError('VALIDATION_FAILED', '任务仍在进行中,请先取消');
      }
      const assets = await this.getAssets(tx, id);
      await this.enqueueSchemeReferenceCleanup(tx, userId, [id]);
      const keys = assets.map((asset) => asset.objectKey);
      await enqueueObjectCleanup(
        tx,
        keys.map((objectKey) => ({
          objectKey,
          ownerId: userId,
          objectType: 'generation_asset' as const,
          reason: 'generation_purge' as const,
        })),
      );
      await tx
        .update(generationExecutionReceipts)
        .set({
          purgedAt: new Date(),
          updatedAt: new Date(),
          revision: sql`${generationExecutionReceipts.revision} + 1`,
        })
        .where(
          and(
            eq(generationExecutionReceipts.principalId, userId),
            eq(generationExecutionReceipts.originalRunId, id),
          ),
        );
      await tx
        .delete(generationRuns)
        .where(
          and(
            eq(generationRuns.userId, userId),
            eq(generationRuns.id, id),
            isNull(generationRuns.purgeStartedAt),
          ),
        );
    });
  }

  /**
   * 批量清理(ui-parity 05 §7):前两种范围只软删入回收站(资产保留,可恢复);
   * empty-trash 复用 purge 语义硬删回收站全部终态行并清理对象存储。
   * 进行中的运行永不参与清理(避免把在跑的任务清掉)。
   */
  async cleanup(userId: string, input: GenerationCleanupInput): Promise<GenerationCleanupResult> {
    const { scope } = generationCleanupInputSchema.parse(input);
    const terminal = [...TERMINAL_STATUSES];
    if (scope === 'empty-trash') return this.emptyTrash(userId);

    const filter =
      scope === 'older-than-30d'
        ? sql`${generationRuns.createdAt} < ${new Date(Date.now() - SOFT_DELETE_RETENTION_MS)}`
        : inArray(generationRuns.status, ['failed', 'cancelled']);
    const affected = await this.db
      .update(generationRuns)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(generationRuns.userId, userId),
          isNull(generationRuns.deletedAt),
          inArray(generationRuns.status, terminal),
          filter,
        ),
      )
      .returning({ id: generationRuns.id });
    return { affected: affected.length };
  }

  /** 清空回收站:与单条 purge 相同,事务内写清理意图,交由 worker 检查引用后删除。 */
  private async emptyTrash(userId: string): Promise<GenerationCleanupResult> {
    const outcome = await this.db.transaction(async (tx) => {
      const doomed = await tx
        .select({ id: generationRuns.id })
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.userId, userId),
            sql`${generationRuns.deletedAt} IS NOT NULL`,
            isNull(generationRuns.purgeStartedAt),
            inArray(generationRuns.status, [...TERMINAL_STATUSES]),
          ),
        )
        .orderBy(asc(generationRuns.id))
        .for('update');
      const ids = doomed.map((row) => row.id);
      if (ids.length === 0) return { affected: 0, objectKeys: [] as string[] };
      const assets = await tx
        .select({ objectKey: generationAssets.objectKey })
        .from(generationAssets)
        .where(inArray(generationAssets.runId, ids));
      await this.enqueueSchemeReferenceCleanup(tx, userId, ids);
      const objectKeys = assets.map((asset) => asset.objectKey);
      await enqueueObjectCleanup(
        tx,
        objectKeys.map((objectKey) => ({
          objectKey,
          ownerId: userId,
          objectType: 'generation_asset' as const,
          reason: 'generation_purge' as const,
        })),
      );
      await tx
        .update(generationExecutionReceipts)
        .set({
          purgedAt: new Date(),
          updatedAt: new Date(),
          revision: sql`${generationExecutionReceipts.revision} + 1`,
        })
        .where(
          and(
            eq(generationExecutionReceipts.principalId, userId),
            inArray(generationExecutionReceipts.originalRunId, ids),
          ),
        );
      await tx
        .delete(generationRuns)
        .where(and(eq(generationRuns.userId, userId), inArray(generationRuns.id, ids)));
      return { affected: ids.length, objectKeys };
    });
    return { affected: outcome.affected };
  }

  private async enqueueSchemeReferenceCleanup(tx: Tx, userId: string, runIds: string[]) {
    const references = await tx
      .select({ objectKey: designSchemeGenerationReferences.objectKey })
      .from(designSchemeGenerationReferences)
      .where(
        and(
          eq(designSchemeGenerationReferences.userId, userId),
          inArray(designSchemeGenerationReferences.generationRunId, runIds),
        ),
      );
    await enqueueObjectCleanup(
      tx,
      [...new Set(references.map((reference) => reference.objectKey))].map((objectKey) => ({
        objectKey,
        ownerId: userId,
        objectType: 'generation_reference' as const,
        reason: 'generation_purge' as const,
      })),
    );
  }

  async assetSignedUrl(userId: string, assetId: string): Promise<SignedAssetUrl> {
    const rows = await this.db
      .select({ objectKey: generationAssets.objectKey })
      .from(generationAssets)
      .innerJoin(
        generationRuns,
        and(eq(generationRuns.id, generationAssets.runId), isNull(generationRuns.purgeStartedAt)),
      )
      .where(and(eq(generationAssets.userId, userId), eq(generationAssets.id, assetId)));
    if (!rows[0]) throw new AppError('GENERATION_NOT_FOUND', '生成资产不存在');
    return this.signer.sign(rows[0].objectKey);
  }

  /** Same owner-visible history policy as signed URLs, including soft-deleted runs. */
  async assetContent(userId: string, assetId: string, signal?: AbortSignal) {
    const before = await this.assetContentMetadata(userId, assetId);
    if (
      !generationAssetSchema
        .pick({ mimeType: true, width: true, height: true, byteSize: true })
        .safeParse(before).success ||
      before.byteSize < 1 ||
      before.byteSize > MAX_GENERATION_ASSET_BYTES ||
      before.width > MAX_DESIGN_SCHEME_IMAGE_DIMENSION ||
      before.height > MAX_DESIGN_SCHEME_IMAGE_DIMENSION ||
      before.width * before.height > MAX_DESIGN_SCHEME_IMAGE_PIXELS ||
      !/^[a-f0-9]{64}$/i.test(before.checksumSha256)
    )
      throw unavailableAssetContent();
    let bytes: Uint8Array;
    try {
      bytes = await this.signer.readObject(before.objectKey, signal);
    } catch (error) {
      if (error instanceof AppError && error.code === 'GENERATION_NOT_FOUND')
        throw missingAssetContent();
      throw unavailableAssetContent();
    }
    let image: Awaited<ReturnType<typeof inspectSchemeImage>>;
    try {
      signal?.throwIfAborted();
      image = await inspectSchemeImage(bytes, { maxBytes: MAX_GENERATION_ASSET_BYTES });
      signal?.throwIfAborted();
    } catch {
      throw unavailableAssetContent();
    }
    if (
      image.mimeType !== before.mimeType ||
      image.width !== before.width ||
      image.height !== before.height ||
      image.byteSize !== before.byteSize ||
      image.contentHash !== before.checksumSha256.toLowerCase()
    )
      throw unavailableAssetContent();
    // No locks are held across S3/decode. This last read is the access/metadata
    // linearization point; a later purge cannot retract bytes already delivered.
    const after = await this.assetContentMetadata(userId, assetId);
    if (
      before.runId !== after.runId ||
      before.objectKey !== after.objectKey ||
      before.mimeType !== after.mimeType ||
      before.width !== after.width ||
      before.height !== after.height ||
      before.byteSize !== after.byteSize ||
      before.checksumSha256 !== after.checksumSha256 ||
      before.createdAt.getTime() !== after.createdAt.getTime()
    )
      throw missingAssetContent();
    return { bytes, mimeType: image.mimeType };
  }

  private async assetContentMetadata(userId: string, assetId: string) {
    const [row] = await this.db
      .select({ asset: generationAssets })
      .from(generationAssets)
      .innerJoin(
        generationRuns,
        and(
          eq(generationRuns.id, generationAssets.runId),
          eq(generationRuns.userId, userId),
          isNull(generationRuns.purgeStartedAt),
        ),
      )
      .where(and(eq(generationAssets.userId, userId), eq(generationAssets.id, assetId)));
    if (!row) throw missingAssetContent();
    return row.asset;
  }

  /**
   * Register-before-upload makes incomplete S3 writes discoverable. Successful unlinked
   * uploads are retained for 24 hours; linking to a run transactionally extends liveness.
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
    const objectKey = referenceObjectKey(userId, id);
    const now = new Date();
    await this.db.insert(generationReferenceUploads).values({
      id,
      userId,
      objectKey,
      originalName: input.name,
      mimeType,
      byteSize: input.bytes.byteLength,
      status: 'uploading',
      createdAt: now,
      expiresAt: new Date(now.getTime() + REFERENCE_UPLOAD_TTL_MS),
    });
    try {
      await this.signer.putObject(objectKey, input.bytes, mimeType);
      const uploaded = await this.db
        .update(generationReferenceUploads)
        .set({ status: 'available', uploadedAt: new Date() })
        .where(
          and(
            eq(generationReferenceUploads.id, id),
            eq(generationReferenceUploads.userId, userId),
            eq(generationReferenceUploads.status, 'uploading'),
          ),
        )
        .returning({ id: generationReferenceUploads.id });
      if (!uploaded[0]) throw new Error('Reference upload row disappeared during finalization');
    } catch (error) {
      // A failed PUT may still have reached S3. Queue the deterministic key before returning.
      await this.db
        .transaction(async (tx) => {
          await tx
            .update(generationReferenceUploads)
            .set({ status: 'cleanup_pending', cleanupQueuedAt: new Date() })
            .where(
              and(
                eq(generationReferenceUploads.id, id),
                eq(generationReferenceUploads.userId, userId),
              ),
            );
          await enqueueObjectCleanup(tx, [
            {
              objectKey,
              ownerId: userId,
              objectType: 'generation_reference',
              reason: 'reference_upload_failed',
            },
          ]);
        })
        .catch(() => undefined);
      // The publication fence rejected the confirm because the key was retired while
      // the PUT was in flight. Surface a conflict (like the package stage confirm)
      // instead of an opaque retryable 500; the client simply re-uploads.
      if (isStorageKeyRetired(error)) {
        throw new AppError('VALIDATION_FAILED', '上传已失效，请重新上传', 409, false, {
          reason: 'REFERENCE_UPLOAD_RETIRED',
        });
      }
      throw error;
    }
    return generationReferenceImageSchema.parse({
      id,
      url: referenceImageUrl(id),
      name: input.name,
      mimeType,
      byteSize: input.bytes.byteLength,
    });
  }

  /** Idempotent relinquishment, not a physical deletion or a revocation of accepted work. */
  async releaseReferenceImage(userId: string, rawInput: ReleaseReferenceImageInput): Promise<void> {
    const parsed = releaseReferenceImageInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', '参考图标识无效');
    // A single UPDATE takes the same registry row lock as generation/plan adoption.
    // Keep status and all references intact; ordinary GC still rechecks liveness.
    await this.db
      .update(generationReferenceUploads)
      .set({ expiresAt: sql`LEAST(${generationReferenceUploads.expiresAt}, CURRENT_TIMESTAMP)` })
      .where(
        and(
          eq(generationReferenceUploads.id, parsed.data.id),
          eq(generationReferenceUploads.userId, userId),
          eq(generationReferenceUploads.objectKey, referenceObjectKey(userId, parsed.data.id)),
          eq(generationReferenceUploads.status, 'available'),
        ),
      );
  }

  /** Reference signing requires an available owner-scoped registry row; keys never leave the API. */
  async referenceImageSignedUrl(userId: string, referenceId: string): Promise<SignedAssetUrl> {
    const id = generationReferenceImageSchema.shape.id.safeParse(referenceId);
    if (!id.success) throw new AppError('VALIDATION_FAILED', '参考图标识无效');
    const rows = await this.db
      .select({ objectKey: generationReferenceUploads.objectKey })
      .from(generationReferenceUploads)
      .where(
        and(
          eq(generationReferenceUploads.userId, userId),
          eq(generationReferenceUploads.id, id.data),
          eq(generationReferenceUploads.status, 'available'),
          sql`(${generationReferenceUploads.expiresAt} > now() OR EXISTS (
            SELECT 1 FROM ${generationReferenceLinks}
            WHERE ${generationReferenceLinks.referenceId} = ${generationReferenceUploads.id}
              AND ${generationReferenceLinks.userId} = ${generationReferenceUploads.userId}
          ))`,
        ),
      );
    if (!rows[0]) throw new AppError('GENERATION_NOT_FOUND', '参考图不存在');
    return this.signer.sign(rows[0].objectKey);
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
    idempotencyKey: string,
    queued: QueuedRun,
    authorizingSessionId: string,
    expectedBinding?: ExecutionBinding,
  ): Promise<GenerationJob> {
    if (!/^[\x20-\x7e]{8,128}$/.test(idempotencyKey)) {
      throw new AppError('VALIDATION_FAILED', 'Idempotency-Key 无效');
    }
    const intent: ReceiptIntent = {
      operation: queued.kind === 'fresh' ? 'ordinary_create' : 'explicit_retry',
      sourceRunId: queued.kind === 'retry' ? queued.sourceRunId : null,
      logicalInputDigest:
        queued.kind === 'fresh'
          ? queued.logicalRequestFingerprint
          : executionDigest({ sourceRunId: queued.sourceRunId }),
      expectedBinding,
    };
    const outcome = await this.db.transaction(async (tx) => {
      await this.receipts.lockKey(tx, userId, idempotencyKey);
      const receipt = await this.receipts.find(tx, userId, idempotencyKey);
      if (receipt) {
        if (receipt.operation === 'legacy_unknown' && receipt.purgedAt)
          throw cleanedResult(receipt.id, receipt.bindingState);
        this.receipts.assertIntent(receipt, intent);
        this.receipts.requireResult(receipt);
        const prior = await this.findIdempotentRun(tx, userId, idempotencyKey);
        if (!prior) throw cleanedResult(receipt.id);
        if (receipt.logicalInputDigest === null) assertSameGenerationInput(prior, queued);
        return { run: prior, assets: await this.getAssets(tx, prior.id) };
      }
      // Pre-migration rows without receipts stay replay-only; never assign
      // today's payer or authorize a second submission for an accepted key.
      const duplicate = await this.findIdempotentRun(tx, userId, idempotencyKey);
      if (duplicate) {
        if (expectedBinding)
          throw new AppError('GENERATION_BINDING_CHANGED', '旧执行没有可验证的账号绑定', 409);
        assertSameGenerationInput(duplicate, queued);
        return { run: duplicate, assets: await this.getAssets(tx, duplicate.id) };
      }
      if (idempotencyKey.startsWith('scheme:')) throw generationIdempotencyConflict();
      // Legacy omitted-model clients retain the original default. An explicit choice,
      // including a retry of such a request, always requires a fresh account catalog.
      const selectedModel =
        queued.kind === 'fresh'
          ? queued.input.model
          : await this.retryModelChoice(tx, userId, queued.sourceRunId);
      const authority = await this.authorizeImageExecution(
        tx,
        userId,
        authorizingSessionId,
        expectedBinding,
        selectedModel,
      );

      if (queued.kind === 'fresh') {
        if (queued.sessionId) await this.requireSession(tx, userId, queued.sessionId);
        if (queued.parentRunId) await this.requireRun(tx, userId, queued.parentRunId);
      }
      const prepared =
        queued.kind === 'fresh'
          ? await this.prepareFreshRun(tx, userId, queued)
          : await this.prepareRetryRun(tx, userId, queued, authority.binding);
      // A retry may have read its source just before Session cleanup detached it.
      // Lock/revalidate the inherited association before inserting another run.
      if (queued.kind === 'retry' && prepared.sessionId) {
        await this.requireSession(tx, userId, prepared.sessionId);
      }
      // New cloud intents must agree with the actual frozen provider. Historical
      // keys returned above retain their original replay semantics.
      if (
        (prepared.request.providerId &&
          prepared.request.providerId !== authority.binding.providerId) ||
        (prepared.request.model ?? PROVIDER_MODEL) !== authority.binding.model
      )
        throw new AppError('VALIDATION_FAILED', '当前云端生图不支持所选供应商');
      const id = randomUUID();
      const accepted = await this.receipts.insert(tx, userId, idempotencyKey, intent, {
        originalRunId: id,
        request: prepared.request,
        authorizingSessionId,
        authority,
      });
      const inserted = await tx
        .insert(generationRuns)
        .values({
          id,
          userId,
          sessionId: prepared.sessionId ?? null,
          parentRunId: queued.parentRunId ?? null,
          executionReceiptId: accepted.id,
          promptId: prepared.promptId,
          runKind: queued.runKind,
          actorType: 'web',
          approvalStatus: 'not_required',
          status: 'queued',
          request: prepared.request as unknown as Record<string, unknown>,
          promptSnapshot: prepared.promptSnapshot,
          idempotencyKey,
          providerModel: authority.binding.model,
        })
        .returning();
      const run = inserted[0];
      if (!run) throw new Error('Generation insertion returned no row');

      await this.linkRunReferences(tx, userId, id, prepared.referenceIds);
      await appendEvent(tx, userId, id, 'generation.requested', {
        runKind: queued.runKind,
        actorType: 'web',
      });
      await tx.execute(sql`
        SELECT graphile_worker.add_job(
          'generation.generate',
          json_build_object('userId', ${userId}::text, 'runId', ${id}::text),
          max_attempts := 1,
          job_key := ${generationJobKey(id)},
          job_key_mode := 'replace'
        )
      `);
      return this.getRunAndAssets(tx, userId, id);
    });
    return this.toJob(outcome.run, outcome.assets);
  }

  private async findIdempotentRun(
    tx: Tx,
    userId: string,
    idempotencyKey: string,
  ): Promise<RunRow | null> {
    const rows = await tx
      .select()
      .from(generationRuns)
      .where(
        and(eq(generationRuns.userId, userId), eq(generationRuns.idempotencyKey, idempotencyKey)),
      )
      // Keep the already accepted result intact until its asset query finishes.
      // A purge that acquired FOR UPDATE first wins and is rechecked below.
      .for('key share');
    if (rows[0]?.purgeStartedAt) throw cleanedResult(rows[0].executionReceiptId ?? rows[0].id);
    return rows[0] ?? null;
  }

  private async prepareFreshRun(
    tx: Tx,
    userId: string,
    queued: FreshQueuedRun,
  ): Promise<{
    request: ReturnType<typeof cloudGenerationRequestSchema.parse>;
    promptId: string | null;
    promptSnapshot: GenerationPromptSnapshot;
    referenceIds: string[];
    sessionId?: string;
  }> {
    const directPrompt = queued.input.promptId
      ? await this.resolvePromptSource(tx, userId, queued.input.promptId)
      : null;
    const resolvedReferences = await this.resolvePromptReferences(tx, userId, queued.input);
    const acceptedReferenceImages = await this.resolveImageReferences(
      tx,
      userId,
      queued.input.referenceImages,
    );
    const composed = requireComposedPrompt(
      composeGenerationPrompt({
        userPrompt: queued.input.prompt,
        promptReferences: resolvedReferences,
        imageCount: acceptedReferenceImages.length,
        ratioId: queued.input.aspectRatio,
      }),
    );
    const request = canonicalizeReferenceUrls(
      cloudGenerationRequestSchema.parse({
        ...queued.input,
        referenceImages: acceptedReferenceImages,
        prompt: composed.finalPrompt,
      }),
    );
    return {
      sessionId: queued.sessionId,
      request,
      promptId: queued.input.promptId ?? null,
      promptSnapshot: {
        schemaVersion: 1,
        userPrompt: queued.input.prompt,
        logicalRequest: queued.logicalRequest,
        logicalRequestFingerprint: queued.logicalRequestFingerprint,
        directPrompt,
        promptReferences: composed.promptReferences,
        finalPrompt: request.prompt,
        negative: request.negative ?? null,
      },
      referenceIds: acceptedReferenceImages.map((reference) => reference.id),
    };
  }

  private async retryModelChoice(tx: Tx, userId: string, sourceRunId: string) {
    const [source] = await tx
      .select({ request: generationRuns.request })
      .from(generationRuns)
      .where(
        and(
          eq(generationRuns.userId, userId),
          eq(generationRuns.id, sourceRunId),
          isNull(generationRuns.purgeStartedAt),
        ),
      );
    if (!source) throw new AppError('GENERATION_NOT_FOUND', '生成任务不存在');
    return cloudGenerationRequestSchema.parse(source.request).model;
  }

  private async prepareRetryRun(
    tx: Tx,
    userId: string,
    queued: RetryQueuedRun,
    binding: ExecutionBinding,
  ): Promise<{
    request: ReturnType<typeof cloudGenerationRequestSchema.parse>;
    promptId: string | null;
    promptSnapshot: Record<string, unknown> | null;
    referenceIds: string[];
    sessionId?: string;
  }> {
    const sourceRows = await tx
      .select({ id: generationRuns.id })
      .from(generationRuns)
      .where(
        and(
          eq(generationRuns.userId, userId),
          eq(generationRuns.id, queued.sourceRunId),
          isNull(generationRuns.purgeStartedAt),
        ),
      )
      // Retention's FOR UPDATE / DELETE must wait, but Session cleanup may
      // detach this source while the receipt is locked. Revalidate that Session
      // before admission below; SHARE here would reverse Session→run lock order.
      .for('key share');
    if (!sourceRows[0]) throw new AppError('GENERATION_NOT_FOUND', '生成任务不存在');
    const { run: source } = await this.getRunAndAssets(tx, userId, queued.sourceRunId);
    if (source.designSchemeRunId)
      throw new AppError(
        'VALIDATION_FAILED',
        '设计方案任务需要重新准备运行计划后重试',
        409,
        false,
        { designSchemeCode: 'DESIGN_SCHEME_RETRY_REQUIRES_PLAN' },
      );
    if (source.status !== 'failed' && source.status !== 'cancelled')
      throw new AppError('VALIDATION_FAILED', '只有失败或取消的任务可以重试', 409);
    const [receipt] = await tx
      .select()
      .from(generationExecutionReceipts)
      .where(
        and(
          eq(generationExecutionReceipts.principalId, userId),
          eq(generationExecutionReceipts.originalRunId, source.id),
        ),
      )
      .for('update');
    // Retry is a new authorization; an unknown or legacy-unbound charge cannot be
    // silently replaced by today's payer. Accepted keys replay before this check.
    if (
      !receipt ||
      receipt.bindingState !== 'bound' ||
      !receipt.binding ||
      receipt.purgedAt ||
      !receipt.terminalAt ||
      receipt.status !== source.status ||
      !(
        (receipt.costProvenance === 'provider_reported' && receipt.costPoints !== null) ||
        (receipt.costProvenance === 'not_sent' && receipt.dispatch !== 'claimed')
      )
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        '原任务或费用尚未核对完成，暂时不能重试',
        409,
        false,
        { reason: 'GENERATION_RETRY_UNRESOLVED' },
      );
    }
    if (
      receipt.binding.apiIssuer !== binding.apiIssuer ||
      receipt.binding.principalId !== binding.principalId ||
      receipt.binding.payer.issuer !== binding.payer.issuer ||
      receipt.binding.payer.ownerId !== binding.payer.ownerId
    ) {
      throw new AppError('GENERATION_BINDING_CHANGED', '原任务付款账号已变化，无法重试', 409);
    }
    const request = cloudGenerationRequestSchema.parse(source.request);
    if (
      receipt.binding.model !== binding.model ||
      source.providerModel !== binding.model ||
      (request.model ?? PROVIDER_MODEL) !== binding.model
    )
      throw new AppError('GENERATION_BINDING_CHANGED', '原任务模型不一致，无法重试', 409);
    const referenceImages = await this.resolveImageReferences(tx, userId, request.referenceImages);
    return {
      sessionId: source.sessionId ?? undefined,
      request: canonicalizeReferenceUrls({ ...request, referenceImages }),
      promptId: source.promptId,
      promptSnapshot: source.promptSnapshot,
      referenceIds: referenceImages.map((reference) => reference.id),
    };
  }

  private async resolveImageReferences(
    tx: Tx,
    userId: string,
    references: ParsedCreateGenerationInput['referenceImages'],
  ): Promise<ParsedCreateGenerationInput['referenceImages']> {
    if (references.length === 0) return [];
    const referenceIds = [...new Set(references.map((reference) => reference.id))];
    if (referenceIds.length !== references.length) {
      throw new AppError('VALIDATION_FAILED', '参考图不能重复');
    }
    const rows = await tx
      .select({
        upload: generationReferenceUploads,
        linkedRunId: generationReferenceLinks.runId,
      })
      .from(generationReferenceUploads)
      .leftJoin(
        generationReferenceLinks,
        and(
          eq(generationReferenceLinks.referenceId, generationReferenceUploads.id),
          eq(generationReferenceLinks.userId, generationReferenceUploads.userId),
        ),
      )
      .where(
        and(
          eq(generationReferenceUploads.userId, userId),
          inArray(generationReferenceUploads.id, referenceIds),
          eq(generationReferenceUploads.status, 'available'),
          sql`(${generationReferenceUploads.expiresAt} > now() OR ${generationReferenceLinks.runId} IS NOT NULL)`,
        ),
      )
      .for('update', { of: generationReferenceUploads });
    const byId = new Map(rows.map((row) => [row.upload.id, row.upload]));
    return references.map((reference) => {
      const stored = byId.get(reference.id);
      if (!stored || stored.objectKey !== referenceObjectKey(userId, reference.id)) {
        throw new AppError('GENERATION_NOT_FOUND', '参考图不存在或已过期');
      }
      return generationReferenceImageSchema.parse({
        id: stored.id,
        url: referenceImageUrl(stored.id),
        name: stored.originalName,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
      });
    });
  }

  private async linkRunReferences(
    tx: Tx,
    userId: string,
    runId: string,
    referenceIds: string[],
  ): Promise<void> {
    if (referenceIds.length === 0) return;
    await tx
      .insert(generationReferenceLinks)
      .values(referenceIds.map((referenceId) => ({ runId, referenceId, userId })))
      .onConflictDoNothing();
  }

  private async resolvePromptSource(
    tx: Tx,
    userId: string,
    promptId: string,
  ): Promise<PromptSourceSnapshot> {
    const rows = await tx
      .select({
        id: prompts.id,
        title: prompts.title,
        content: prompts.content,
        negative: prompts.negative,
        version: prompts.version,
      })
      .from(prompts)
      .where(and(eq(prompts.userId, userId), eq(prompts.id, promptId), isNull(prompts.deletedAt)));
    if (!rows[0]) throw new AppError('PROMPT_NOT_FOUND', '提示词不存在');
    return rows[0];
  }

  private async resolvePromptReferences(
    tx: Tx,
    userId: string,
    input: Pick<ParsedCreateGenerationInput, 'promptReferenceSelections'>,
  ): Promise<ResolvedPromptReferenceSnapshot[]> {
    if (input.promptReferenceSelections.length === 0) return [];
    const promptIds = [...new Set(input.promptReferenceSelections.map((item) => item.promptId))];
    const rows = await tx
      .select({
        id: prompts.id,
        title: prompts.title,
        content: prompts.content,
        version: prompts.version,
      })
      .from(prompts)
      .where(
        and(eq(prompts.userId, userId), inArray(prompts.id, promptIds), isNull(prompts.deletedAt)),
      )
      .orderBy(asc(prompts.id))
      .for('share');
    const byId = new Map(rows.map((row) => [row.id, row]));
    return input.promptReferenceSelections.map((selection, index) => {
      const prompt = byId.get(selection.promptId);
      if (!prompt) throw new AppError('PROMPT_NOT_FOUND', '引用的提示词不存在');
      if (prompt.version !== selection.expectedVersion) {
        throw new AppError(
          'PROMPT_VERSION_CONFLICT',
          '引用的提示词已更新，请重新选择',
          409,
          false,
          {
            promptId: selection.promptId,
            expectedVersion: selection.expectedVersion,
            currentVersion: prompt.version,
          },
        );
      }
      const text =
        selection.scope === 'full'
          ? prompt.content
          : excerptPromptContent(prompt.content, selection.range, index);
      const trimmed = text.trim();
      if (!trimmed) {
        throw new AppError('VALIDATION_FAILED', '引用的提示词片段不能为空', 400, false, {
          fieldPath: `promptReferenceSelections.${index}.range`,
        });
      }
      if (trimmed.length > 4_000) {
        throw new AppError('VALIDATION_FAILED', '引用提示词不能超过 4000 个字符', 400, false, {
          fieldPath: `promptReferenceSelections.${index}`,
          max: 4_000,
          actual: trimmed.length,
        });
      }
      return resolvedPromptReferenceSnapshotSchema.parse({
        promptId: prompt.id,
        title: prompt.title,
        text: trimmed,
        scope: selection.scope,
        sourceVersion: prompt.version,
      });
    });
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
        .where(
          and(
            eq(generationRuns.userId, userId),
            eq(generationRuns.id, id),
            isNull(generationRuns.purgeStartedAt),
          ),
        );
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
      .where(
        and(
          eq(generationRuns.userId, userId),
          eq(generationRuns.id, id),
          isNull(generationRuns.purgeStartedAt),
        ),
      );
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

  private async cancelSchemeLedger(tx: Tx, run: RunRow) {
    if (!run.designSchemeRunId) return;
    const [scheme] = await tx
      .select()
      .from(designSchemeRuns)
      .where(
        and(
          eq(designSchemeRuns.runId, run.designSchemeRunId),
          eq(designSchemeRuns.userId, run.userId),
        ),
      )
      .for('update');
    if (!scheme) throw new Error('Scheme execution link is missing');
    const previous = runResultSchema.parse(scheme.result);
    const result = advanceCloudRunResult(previous, 'cancelled', { now: new Date().toISOString() });
    await tx
      .update(designSchemeRuns)
      .set({
        status: result.status,
        result: result as unknown as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(designSchemeRuns.runId, scheme.runId));
    for (const step of result.steps) {
      await tx
        .update(designSchemeRunSteps)
        .set({
          status: step.status,
          startedAt: step.startedAt ? new Date(step.startedAt) : null,
          completedAt: step.completedAt ? new Date(step.completedAt) : null,
          output: { outputIds: step.outputRefs, error: step.error },
        })
        .where(
          and(
            eq(designSchemeRunSteps.runId, scheme.runId),
            eq(designSchemeRunSteps.stepId, step.id),
            eq(designSchemeRunSteps.userId, run.userId),
          ),
        );
    }
    const [execution] = await tx
      .select()
      .from(designSchemeRunExecutions)
      .where(
        and(
          eq(designSchemeRunExecutions.runId, scheme.runId),
          eq(designSchemeRunExecutions.userId, run.userId),
        ),
      );
    if (!execution) throw new Error('Scheme execution identity is missing');
    await appendEvent(tx, run.userId, run.id, 'design-scheme', {
      kind: 'cancelled',
      executionId: execution.executionId,
      runId: scheme.runId,
    });
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
      )
      .for('share');
    if (!rows[0]) throw new AppError('WORKBENCH_SESSION_NOT_FOUND', '工作台会话不存在');
  }

  private async requireRun(tx: Tx, userId: string, id: string): Promise<void> {
    const rows = await tx
      .select({ id: generationRuns.id })
      .from(generationRuns)
      .where(
        and(
          eq(generationRuns.userId, userId),
          eq(generationRuns.id, id),
          isNull(generationRuns.purgeStartedAt),
        ),
      );
    if (!rows[0]) throw new AppError('GENERATION_NOT_FOUND', '生成任务不存在');
  }

  private toJob(run: RunRow, assets: AssetRow[]): GenerationJob {
    const promptSnapshot = readGenerationPromptSnapshot(run.promptSnapshot);
    return generationJobSchema.parse({
      id: run.id,
      sessionId: run.sessionId,
      parentRunId: run.parentRunId,
      promptId: run.promptId,
      ...(promptSnapshot
        ? {
            userPrompt: promptSnapshot.userPrompt,
            promptReferences: promptSnapshot.promptReferences,
          }
        : {}),
      actorType: run.actorType,
      approvalStatus: run.approvalStatus,
      status: run.status,
      progress: run.progress,
      request: cloudGenerationRequestSchema.parse(run.request),
      providerModel: run.providerModel,
      costPoints: run.costPoints,
      durationMs: runDurationMs(run.startedAt, run.finishedAt),
      // 云端上游当前不回报种子;保持 null 而不是伪造值(ui-parity 05 §7)。
      seed: null,
      assets: assets.map((asset) => ({
        id: asset.id,
        url: `/api/v1/assets/${encodeURIComponent(asset.id)}/url`,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        byteSize: asset.byteSize,
        expiresAt: new Date(Date.now() + this.signer.urlTtlSeconds * 1_000).toISOString(),
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

/** 终态用时:开始或结束时刻缺失(未开跑/时钟回拨)一律 null,不伪造 0。 */
function runDurationMs(startedAt: Date | null, finishedAt: Date | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const elapsed = finishedAt.getTime() - startedAt.getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null;
}

function canonicalLogicalRequest(input: ParsedCreateGenerationInput): Record<string, unknown> {
  return stripUndefined({
    prompt: input.prompt,
    negative: input.negative,
    promptId: input.promptId,
    size: input.size,
    aspectRatio: input.aspectRatio,
    quality: input.quality,
    count: input.count,
    providerId: input.providerId,
    model: input.model,
    referenceImages: input.referenceImages,
    promptReferenceSelections: input.promptReferenceSelections,
    sessionId: input.sessionId,
    parentRunId: input.parentRunId,
    runKind: input.runKind,
  });
}

function fingerprintLogicalRequest(logicalRequest: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(logicalRequest)).digest('hex');
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortJsonValue(record[key])]),
    );
  }
  return value;
}

function canonicalRequestJson(value: unknown): string | null {
  const parsed = cloudGenerationRequestSchema.safeParse(value);
  return parsed.success ? canonicalJson(parsed.data) : null;
}

function assertSameGenerationInput(existing: RunRow, queued: QueuedRun): void {
  if (queued.kind === 'retry') {
    if (existing.runKind !== 'retry' || existing.parentRunId !== queued.sourceRunId)
      throw generationIdempotencyConflict();
    return;
  }
  const sameRunOptions =
    existing.sessionId === (queued.sessionId ?? null) &&
    existing.parentRunId === (queued.parentRunId ?? null) &&
    existing.runKind === queued.runKind;
  if (!sameRunOptions) throw generationIdempotencyConflict();

  {
    const snapshot = readGenerationPromptSnapshot(existing.promptSnapshot);
    if (snapshot) {
      if (
        snapshot.logicalRequestFingerprint !== queued.logicalRequestFingerprint ||
        canonicalJson(snapshot.logicalRequest) !== canonicalJson(queued.logicalRequest)
      ) {
        throw generationIdempotencyConflict();
      }
      return;
    }
    // Legacy rows have no logical envelope. Preserve the old persisted-request
    // comparison rather than resolving current Prompt records for a replay.
    const existingRequestJson = canonicalRequestJson(existing.request);
    if (
      queued.legacyRequest === null ||
      existingRequestJson === null ||
      existingRequestJson !== canonicalRequestJson(queued.legacyRequest)
    ) {
      throw generationIdempotencyConflict();
    }
    return;
  }
}

function generationIdempotencyConflict(): AppError {
  return new AppError('GENERATION_IDEMPOTENCY_CONFLICT', 'Idempotency-Key 已用于不同的生成请求');
}

/** Walks the cause chain for the publication fence's PostgreSQL raise (0026). */
function isStorageKeyRetired(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ((current as { code?: unknown }).code === 'P0001') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function requireComposedPrompt(
  result: ReturnType<typeof composeGenerationPrompt>,
): PromptReferenceCompositionResult {
  if (result.ok) return result.data;
  throw new AppError('VALIDATION_FAILED', result.error.message, 400, false, {
    domainCode: result.error.code,
    ...(result.error.fieldPath ? { fieldPath: result.error.fieldPath } : {}),
    ...(result.error.recoveryAction ? { recoveryAction: result.error.recoveryAction } : {}),
    ...(result.error.details ?? {}),
  });
}

function excerptPromptContent(
  content: string,
  range: { start: number; end: number },
  index: number,
): string {
  // String#slice indexes UTF-16 code units, matching browser selection offsets.
  if (!isValidUtf16SliceRange(content, range)) {
    throw new AppError('VALIDATION_FAILED', '引用的提示词片段范围无效', 400, false, {
      fieldPath: `promptReferenceSelections.${index}.range`,
      start: range.start,
      end: range.end,
      length: content.length,
    });
  }
  return content.slice(range.start, range.end);
}

function readGenerationPromptSnapshot(
  value: Record<string, unknown> | null,
): GenerationPromptSnapshot | null {
  if (value?.schemaVersion !== 1) return null;
  const userPrompt = value.userPrompt;
  const logicalRequest = value.logicalRequest;
  const logicalRequestFingerprint = value.logicalRequestFingerprint;
  const promptReferences = value.promptReferences;
  if (
    typeof userPrompt !== 'string' ||
    !logicalRequest ||
    typeof logicalRequest !== 'object' ||
    typeof logicalRequestFingerprint !== 'string' ||
    !Array.isArray(promptReferences) ||
    typeof value.finalPrompt !== 'string'
  ) {
    return null;
  }
  const resolvedReferences = promptReferences.flatMap((reference) => {
    const parsed = resolvedPromptReferenceSnapshotSchema.safeParse(reference);
    return parsed.success ? [parsed.data] : [];
  });
  if (resolvedReferences.length !== promptReferences.length) return null;
  return {
    schemaVersion: 1,
    userPrompt,
    logicalRequest: logicalRequest as Record<string, unknown>,
    logicalRequestFingerprint,
    directPrompt: isPromptSourceSnapshot(value.directPrompt) ? value.directPrompt : null,
    promptReferences: resolvedReferences,
    finalPrompt: value.finalPrompt,
    negative: typeof value.negative === 'string' ? value.negative : null,
  };
}

function isPromptSourceSnapshot(value: unknown): value is PromptSourceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.id === 'string' &&
    typeof source.title === 'string' &&
    typeof source.content === 'string' &&
    (source.negative === null || typeof source.negative === 'string') &&
    typeof source.version === 'number'
  );
}

function generationJobKey(runId: string): string {
  return `generation:${runId}`;
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

function canonicalizeCreateReferenceUrls(
  input: ParsedCreateGenerationInput,
): ParsedCreateGenerationInput {
  if (input.referenceImages.length === 0) return input;
  return {
    ...input,
    referenceImages: input.referenceImages.map((reference) => ({
      ...reference,
      url: referenceImageUrl(reference.id),
    })),
  };
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
    designSchemeRunId: (raw.design_scheme_run_id as string | null) ?? null,
    executionReceiptId: (raw.execution_receipt_id as string | null) ?? null,
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
    purgeStartedAt: toDateOrNull(raw.purge_started_at),
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
    'GENERATION_BINDING_CHANGED',
    'ACCOUNT_IDENTITY_UNVERIFIED',
    'AUTH_SESSION_EXPIRED',
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
