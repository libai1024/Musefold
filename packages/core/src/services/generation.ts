import { enqueueLocalAssetCleanup, drainLocalAssetCleanup } from './local-asset-cleanup';
import { assertLocalAssetWriteOutputs, withLocalAssetWriteScope } from './local-asset-writes';
// GenerationService（V04-CORE-05）：全 App 生图唯一汇聚点，自 electron/main/ipc/images.ts
// 单账本（generation_runs + generated_assets）、进度回调、
// 取消句柄都在此收口；IPC 与控制面（API-03）都是它的薄壳。
// 所有生成(工作台/自由生成/automation/Skill)一律落 generation_runs——旧 history 双账本已随迁移 0002/0003 退役。

import { resolve, sep } from 'node:path';
import { ulid } from 'ulid';
import { composeGenerationPrompt } from '@musefold/domain/generation-prompt';
import type { ResolvedPromptReferenceSnapshot } from '@musefold/contracts';
import { resolvedPromptReferenceSnapshotSchema } from '@musefold/contracts';
import { MAX_REFERENCE_IMAGES } from '@musefold/desktop-contracts/providers';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
  ImageProgressHandler,
  LocalImageReference,
} from '@musefold/desktop-contracts/providers';
import type { ProviderType } from '@musefold/desktop-contracts/enums';
import type {
  GenerationParamsSnapshot,
  GenerationRun,
  PromptSnapshot,
} from '@musefold/desktop-contracts/workbench';
import type Database from 'better-sqlite3';
import { getDb } from '../db/index';
import { createWorkbenchRepositories } from '../db/repositories/workbench';
import { createProvider } from '../providers/registry';
import { OpenAICompatibleProvider } from '../providers/openai-compatible';
import type { GenerationExecution, GenerationTransportExecution } from '../providers/execution';
import { isManagedUploadPath } from '../providers/local-image';
import { sanitizeProviderErrorMessage } from '../providers/sanitize-error';
import { createLogger, getPaths } from '../runtime';
import { assertLocalRetryModel } from './generation-retry';

const logger = createLogger('image');
const abortControllers = new Map<string, AbortController>();
const RETRYABLE_SOURCE_STATUSES = new Set(['failed', 'cancelled']);

export function hasActiveImageJobs(): boolean {
  return abortControllers.size > 0;
}

function cleanupUncommittedImages(
  images: Array<{ imagePath: string }>,
  db: Database.Database,
): void {
  const root = resolve(getPaths().pictures);
  const candidates = images
    .map((image) => resolve(image.imagePath))
    .filter((path) => path !== root && path.startsWith(`${root}${sep}`));
  if (!candidates.length) return;
  try {
    enqueueLocalAssetCleanup(candidates, db);
    const counts = drainLocalAssetCleanup(Date.now(), db);
    if (counts.failed || counts.blocked) logger.warn('未入账图片清理待处理', counts);
  } catch {
    logger.warn('未入账图片清理暂未完成');
  }
}

export interface GenerationOptions {
  /** Main-process callers may bind generation to an explicit primary database. */
  db?: Database.Database;
  retryOfRunId?: string;
  /** Host already resolved and composed the immutable prompt request. */
  promptAlreadyComposed?: boolean;
  /** Raw user text captured before host composition. */
  userPrompt?: string;
  /** Caller-owned cancellation signal, linked before the provider request starts. */
  signal?: AbortSignal;
  /** Host-only durable dispatch port; never spread into the request or persisted metadata. */
  execution?: GenerationExecution;
  /** Host-only remote execution, exclusive with the local Provider dispatch port. */
  transport?: GenerationTransportExecution;
}

function immutableReferences(
  references: GenerateImageRequest['promptReferences'] | undefined,
): ResolvedPromptReferenceSnapshot[] {
  if (!references?.length) return [];
  return references.map((reference) => {
    const candidate = reference as unknown as Record<string, unknown>;
    const parsed = resolvedPromptReferenceSnapshotSchema.safeParse({
      promptId: candidate.promptId || null,
      title: candidate.title,
      text: candidate.text ?? candidate.excerpt,
      scope: candidate.scope,
      sourceVersion:
        typeof candidate.sourceVersion === 'number' && candidate.sourceVersion > 0
          ? candidate.sourceVersion
          : 1,
    });
    if (!parsed.success) throw new Error('提示词引用快照无效');
    return parsed.data;
  });
}

type LegacyPromptReference = NonNullable<PromptSnapshot['promptReferences']>[number];
type PromptReferenceWithSnapshot = LegacyPromptReference & {
  text?: string;
  sourceVersion?: number;
};

type ImmutablePromptSnapshot = Omit<PromptSnapshot, 'promptReferences'> & {
  promptReferences?: ResolvedPromptReferenceSnapshot[];
};

function toImmutablePromptSnapshot(snapshot: PromptSnapshot): ImmutablePromptSnapshot {
  const references = snapshot.promptReferences ?? [];
  const normalized = references.map((reference) => {
    const value = reference as PromptReferenceWithSnapshot;
    return resolvedPromptReferenceSnapshotSchema.parse({
      promptId: value.promptId || null,
      title: value.title,
      text: value.text ?? value.excerpt,
      scope: value.scope,
      sourceVersion: value.sourceVersion ?? 1,
    });
  });
  return {
    ...snapshot,
    ...(normalized.length > 0 ? { promptReferences: normalized } : {}),
  } as ImmutablePromptSnapshot;
}

function immutableReferencesFromSnapshot(
  snapshot: PromptSnapshot,
): ResolvedPromptReferenceSnapshot[] {
  return toImmutablePromptSnapshot(snapshot).promptReferences ?? [];
}

function requireComposedPrompt(result: ReturnType<typeof composeGenerationPrompt>): {
  finalPrompt: string;
  promptReferences: ResolvedPromptReferenceSnapshot[];
} {
  if (result.ok) return result.data;
  throw new Error(result.error.message);
}

interface RunContext {
  runId: string;
  repositories: ReturnType<typeof createWorkbenchRepositories>;
}

function createRunContext(
  req: GenerateImageRequest,
  createdAt: number,
  params: GenerationParamsSnapshot,
  retryOfRunId?: string,
  originalPrompt = req.prompt,
  options: GenerationOptions = {},
): RunContext {
  const db = options.db ?? getDb();
  const repositories = createWorkbenchRepositories(db);
  return db.transaction(() => {
    const retrySource = retryOfRunId ? repositories.runs.get(retryOfRunId) : null;
    if (retryOfRunId && !retrySource) throw new Error('重试来源运行不存在');
    if (retrySource && !RETRYABLE_SOURCE_STATUSES.has(retrySource.status)) {
      throw new Error('只有失败或取消的运行可以重试');
    }
    const workbench = retrySource ? undefined : req.workbench;
    if (workbench) {
      if (
        !workbench.sessionId.trim() ||
        !workbench.turnId.trim() ||
        !Number.isInteger(workbench.turnIndex) ||
        workbench.turnIndex < 0 ||
        !Number.isInteger(workbench.resultIndex) ||
        workbench.resultIndex < 0
      ) {
        throw new Error('工作台会话快照无效');
      }
      repositories.sessions.ensure({
        id: workbench.sessionId,
        title: workbench.sessionTitle,
        createdAt,
      });
    }
    const workbenchSessionId = retrySource?.workbenchSessionId ?? workbench?.sessionId ?? null;
    const workbenchTurnId = retrySource?.workbenchTurnId ?? workbench?.turnId ?? null;
    const turnIndex = retrySource?.turnIndex ?? workbench?.turnIndex ?? null;
    const resultIndex = retrySource?.resultIndex ?? workbench?.resultIndex ?? null;
    const sourceAsset = retrySource
      ? retrySource.sourceAssetId
        ? repositories.runs.getAsset(retrySource.sourceAssetId)
        : null
      : req.sourceAssetId
        ? repositories.runs.getAsset(req.sourceAssetId)
        : null;
    const retryOf = retrySource?.id ?? null;
    const sourceAssetId = retrySource?.sourceAssetId ?? sourceAsset?.id ?? null;
    const refinementInstruction = retrySource
      ? retrySource.refinementInstruction
      : req.refinementInstruction?.trim() || null;
    const refinementParent =
      !retryOf && req.parentHistoryId ? repositories.runs.get(req.parentHistoryId) : null;
    const basePrompt =
      retrySource?.basePrompt ??
      (refinementInstruction ? refinementParent?.finalPrompt : null) ??
      req.prompt;
    const userPrompt =
      retrySource?.userPrompt ?? options.userPrompt ?? workbench?.userPrompt ?? originalPrompt;
    // Retry lineage must retain the original source even if that source was
    // itself a retry. Refinements keep their parent; free generations use the
    // first source run as the lineage root.
    const parentRunId = retrySource
      ? (retrySource.parentRunId ?? retrySource.id)
      : req.parentHistoryId
        ? (refinementParent?.id ?? null)
        : null;
    const requestedPromptId = req.promptId ?? null;
    const promptId = retrySource ? retrySource.promptId : requestedPromptId;
    const promptReferences = retrySource
      ? immutableReferencesFromSnapshot(retrySource.promptSnapshot)
      : immutableReferences(req.promptReferences);
    const snapshotReferences = promptReferences;

    const promptSnapshot = retrySource
      ? (toImmutablePromptSnapshot(retrySource.promptSnapshot) as unknown as PromptSnapshot)
      : ({
          schemaVersion: 1 as const,
          userPrompt,
          basePrompt,
          refinementInstruction,
          finalPrompt: req.prompt,
          negativePrompt: req.negative ?? null,
          ...(snapshotReferences.length > 0 ? { promptReferences: snapshotReferences } : {}),
        } as unknown as PromptSnapshot);
    const runParams = retrySource?.params ?? params;
    const providerId = retrySource?.providerId ?? req.providerId;
    const model = retrySource?.model ?? req.model ?? 'unknown';
    const finalPrompt = retrySource?.finalPrompt ?? req.prompt;
    const negativePrompt = retrySource?.negativePrompt ?? req.negative ?? null;

    // Refinement runs must be created through the repository aggregate so the
    // parent terminal state and source Asset ownership/availability are checked
    // before any Provider request is sent.
    if (!retryOf && (req.sourceAssetId || refinementInstruction)) {
      if (!req.parentHistoryId || !req.sourceAssetId || !refinementInstruction) {
        throw new Error('微调请求缺少父运行、来源图片或微调说明');
      }
      if (sourceAsset?.status !== 'available' || sourceAsset.runId !== req.parentHistoryId) {
        throw new Error('微调来源图片不存在或不可用');
      }
      const run = repositories.runs.create({
        id: req.jobId,
        runKind: 'refinement',
        parentRunId: req.parentHistoryId,
        sourceAssetId: req.sourceAssetId,
        promptId,
        refinementInstruction,
        finalPrompt,
        basePrompt,
        userPrompt,
        negativePrompt,
        providerId,
        model,
        params: retrySource?.params ?? params,
        promptSnapshot,
        workbenchSessionId,
        workbenchTurnId,
        turnIndex,
        resultIndex,
        createdAt,
      });
      if (workbenchSessionId) repositories.sessions.touch(workbenchSessionId, createdAt);
      return { runId: run.id, repositories };
    }

    const run = repositories.runs.create({
      id: req.jobId,
      runKind: retryOf ? 'retry' : 'free_generation',
      workbenchSessionId,
      workbenchTurnId,
      turnIndex,
      resultIndex,
      parentRunId,
      retryOfRunId: retryOf,
      sourceAssetId,
      promptId,
      providerId,
      model,
      userPrompt,
      basePrompt,
      refinementInstruction,
      finalPrompt,
      negativePrompt,
      params: runParams,
      promptSnapshot,
      createdAt,
    });
    if (workbenchSessionId) repositories.sessions.touch(workbenchSessionId, createdAt);
    return { runId: run.id, repositories };
  })();
}

/** 参数快照:重试要靠它重建请求,请求形状字段 + 渠道快照都要留下。 */
function buildParamsSnapshot(
  req: GenerateImageRequest,
  providerRow: Record<string, unknown> | undefined,
): GenerationParamsSnapshot {
  return {
    schemaVersion: 1 as const,
    size: req.size,
    aspectRatio: req.aspectRatio,
    quality: req.quality,
    n: req.n,
    background: req.background,
    moderation: req.moderation,
    usageChannel: !providerRow
      ? 'provider'
      : providerRow.managed_by === 'account'
        ? 'account'
        : providerRow.type === 'doubao-web'
          ? 'doubao'
          : 'provider',
    ...(providerRow ? { providerNameSnapshot: providerRow.name as string } : {}),
    ...(providerRow ? { providerTypeSnapshot: providerRow.type as string } : {}),
    sourceKind: req.promptId || req.promptReferences?.length ? 'prompt' : 'chat',
    ...(req.parentHistoryId ? { parentHistoryId: req.parentHistoryId } : {}),
    ...(req.sourceAssetId ? { sourceAssetId: req.sourceAssetId } : {}),
    ...(req.refinementInstruction ? { refinementInstruction: req.refinementInstruction } : {}),
    ...(req.referenceImages?.length ? { referenceImages: req.referenceImages } : {}),
    ...(req.skillRuntime ? { skillRuntime: req.skillRuntime } : {}),
  };
}

function authorizeReferenceImages(
  db: ReturnType<typeof getDb>,
  references: LocalImageReference[] | undefined,
): LocalImageReference[] | undefined {
  if (!references?.length) return undefined;
  if (references.length > MAX_REFERENCE_IMAGES) {
    const error = new Error(`参考图不能超过 ${MAX_REFERENCE_IMAGES} 张`);
    (error as { code?: string }).code = 'IMAGE_LIMIT_EXCEEDED';
    throw error;
  }
  return references.map((reference) => {
    if (reference.source === 'upload') {
      if (!isManagedUploadPath(reference.path)) {
        const error = new Error('图片读取失败，请重新选择');
        (error as { code?: string }).code = 'IMAGE_PATH_NOT_ALLOWED';
        throw error;
      }
      return reference;
    }
    if (!reference.historyId) {
      const error = new Error('上一张图片已不可用，请重新选择');
      (error as { code?: string }).code = 'IMAGE_HISTORY_MISSING';
      throw error;
    }
    if (reference.assetId) {
      const asset = createWorkbenchRepositories(db).runs.getAsset(reference.assetId);
      if (
        asset?.status === 'available' &&
        asset.mediaPath &&
        resolve(asset.mediaPath) === resolve(reference.path)
      ) {
        return { ...reference, path: asset.mediaPath };
      }
      const error = new Error('上一张图片已不可用，请重新选择');
      (error as { code?: string }).code = 'IMAGE_HISTORY_MISSING';
      throw error;
    }
    // 未带 assetId 的旧引用:按运行 id 在资产账本里找可用图并核对路径。
    const assetRows = db
      .prepare(
        `SELECT media_path FROM generated_assets
       WHERE run_id = ? AND status = 'available' AND media_path IS NOT NULL`,
      )
      .all(reference.historyId) as Array<{ media_path: string }>;
    const matched = assetRows.find((row) => resolve(row.media_path) === resolve(reference.path));
    if (!matched) {
      const error = new Error('上一张图片已不可用，请重新选择');
      (error as { code?: string }).code = 'IMAGE_HISTORY_MISSING';
      throw error;
    }
    return { ...reference, path: matched.media_path };
  });
}

function composeFinalPrompt(
  prompt: string,
  aspectRatio: string | undefined,
  referenceImageCount: number,
  promptReferences: readonly ResolvedPromptReferenceSnapshot[] = [],
): string {
  return requireComposedPrompt(
    composeGenerationPrompt({
      userPrompt: prompt,
      promptReferences,
      imageCount: referenceImageCount,
      ratioId: aspectRatio,
    }),
  ).finalPrompt;
}

function snapshotReferenceImages(
  params: GenerationParamsSnapshot | undefined,
): LocalImageReference[] | undefined {
  const references = params?.referenceImages;
  return Array.isArray(references) ? (references as LocalImageReference[]) : undefined;
}

function requestFromRetrySnapshot(
  req: GenerateImageRequest,
  retrySource: GenerationRun | null,
): GenerateImageRequest {
  if (!retrySource) return req;
  const params = retrySource.params;
  return {
    ...req,
    providerId: retrySource.providerId,
    model: retrySource.model,
    prompt: retrySource.finalPrompt,
    negative: retrySource.negativePrompt ?? undefined,
    size: (params.size as GenerateImageRequest['size']) ?? 'auto',
    aspectRatio: params.aspectRatio,
    quality: (params.quality as GenerateImageRequest['quality']) ?? 'auto',
    n: params.n ?? 1,
    background: params.background,
    moderation: params.moderation,
    referenceImages: snapshotReferenceImages(params),
  };
}

/** 实际生图 + 写历史（成功/失败都写）。Skill Agent 的 generate_image 工具也直接调用它。 */
export async function generate(
  req: GenerateImageRequest,
  sendProgress?: (progress: ImageGenerationProgress) => void,
  options: GenerationOptions = {},
): Promise<GenerateImageResult> {
  return withLocalAssetWriteScope(() => generateWithWrites(req, sendProgress, options), {
    db: options.db,
    assertCurrent: () => options.transport?.assertCurrent(),
  });
}

async function generateWithWrites(
  req: GenerateImageRequest,
  sendProgress?: (progress: ImageGenerationProgress) => void,
  options: GenerationOptions = {},
): Promise<GenerateImageResult> {
  const db = options.db ?? getDb();
  const transport = options.transport;
  transport?.assertCurrent();
  if (
    transport &&
    (options.execution ||
      transport.providerId !== req.providerId ||
      transport.retryOfRunId !== options.retryOfRunId)
  ) {
    return {
      historyId: req.jobId ?? ulid(),
      status: 'failed',
      error: {
        code: 'GENERATION_TRANSPORT_MISMATCH',
        message: '托管执行与当前请求不匹配，请核对原任务',
      },
    };
  }
  // 取消句柄：优先用渲染进程传入的 jobId（渲染进程据此在出图前即可取消），否则自生成
  const jobId = req.jobId ?? ulid();
  const historyId = jobId;
  const startTs = Date.now();
  const retrySource = options.retryOfRunId
    ? createWorkbenchRepositories(db).runs.get(options.retryOfRunId)
    : null;
  // Provider 负责把结果落盘，因此也必须收到主进程最终采用的 id。
  // 否则未传 jobId（例如重试兼容路径）时，历史行与图片文件名会各用一套 ULID。
  let effectiveReq: GenerateImageRequest;
  try {
    // A host-owned remote transport independently freezes/authorizes its request.
    // Local retries only have the original row, never a caller-supplied replacement model.
    if (retrySource && !transport) assertLocalRetryModel(retrySource.model);
    const sourceReq = requestFromRetrySnapshot(req, retrySource);
    const aspectRatio = sourceReq.aspectRatio;
    const referenceImages = authorizeReferenceImages(db, sourceReq.referenceImages);
    effectiveReq = {
      ...sourceReq,
      jobId,
      // Retries replay the frozen final prompt. Fresh requests compose once at
      // the local core boundary so every provider receives the same constraints.
      prompt: retrySource
        ? sourceReq.prompt
        : options.promptAlreadyComposed
          ? sourceReq.prompt
          : composeFinalPrompt(
              sourceReq.prompt,
              aspectRatio,
              referenceImages?.length ?? 0,
              immutableReferences(sourceReq.promptReferences),
            ),
      referenceImages,
    };
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'IMAGE_READ_FAILED';
    const message = sanitizeProviderErrorMessage(
      error instanceof Error ? error.message : '',
      '图片读取失败，请重新选择',
    );
    return {
      historyId,
      status: 'failed',
      error: { code, message },
      durationMs: Date.now() - startTs,
    };
  }
  /** 记账单位快照（FR-COST-03）：托管 Provider 以「点」入账 */
  const costUnit = 'point' as const;

  // 读 Provider 配置(可能已删除;此时仍要在账本留下失败运行)。
  const providerRow = db
    .prepare('SELECT * FROM providers WHERE id = ?')
    .get(effectiveReq.providerId) as Record<string, unknown> | undefined;

  // Resolve the default before persisting the run, so retries replay the model
  // actually sent upstream even after the connection's default model changes.
  if (effectiveReq.model == null && typeof providerRow?.model === 'string') {
    effectiveReq = { ...effectiveReq, model: providerRow.model };
  }

  const params = retrySource?.params ?? buildParamsSnapshot(effectiveReq, providerRow);

  // 单账本:任何被受理的生成请求先落 generation_runs,成功/失败/取消都在同一行收敛。
  let runContext: RunContext;
  try {
    runContext = createRunContext(
      effectiveReq,
      startTs,
      params,
      options.retryOfRunId,
      req.prompt,
      options,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('generation run 创建失败', `run=${historyId}`, message);
    return {
      historyId,
      status: 'failed',
      error: {
        code: 'GENERATION_RUN_CREATE_FAILED',
        message: '生成运行记录创建失败，已停止本次生成',
      },
      durationMs: Date.now() - startTs,
      costUnit,
    };
  }

  /**
   * 把失败/取消收敛进账本并返回结构化结果（见下方"为什么不 throw"）。
   * message 在此统一脱敏：Provider 已脱敏一层，这里对账本 error_message 与
   * 渲染层 GenerateImageResult.error.message 做幂等兜底（sanitize 本身幂等）。
   */
  const fail = (
    status: 'failed' | 'cancelled',
    code: string,
    message: string,
  ): GenerateImageResult => {
    transport?.assertCurrent();
    const safeMessage = sanitizeProviderErrorMessage(message);
    const finishedAt = Date.now();
    const terminalRun =
      status === 'cancelled'
        ? runContext.repositories.runs.cancel(runContext.runId, finishedAt)
        : runContext.repositories.runs.fail(runContext.runId, code, safeMessage, finishedAt);
    const finalStatus = terminalRun.status === 'cancelled' ? 'cancelled' : 'failed';
    return {
      historyId,
      status: finalStatus,
      error:
        finalStatus === 'cancelled'
          ? { code: 'CANCELLED', message: '已取消' }
          : {
              code: terminalRun.errorCode ?? code,
              message: sanitizeProviderErrorMessage(terminalRun.errorMessage ?? '', safeMessage),
            },
      durationMs: Date.now() - startTs,
      costUnit,
    };
  };

  if (!providerRow) {
    // 选中的服务商已被删除。同样走返回值而非 throw，否则渲染层只能看到
    // "Error invoking remote method ..." 这种没法给用户看的字符串。
    logger.error('generate 失败', `run=${historyId}`, 'code=NO_PROVIDER', 'Provider 不存在');
    return fail('failed', 'NO_PROVIDER', 'Provider 不存在或已被删除');
  }

  if (providerRow.type === 'musefold-cloud' && !transport)
    return fail('failed', 'MANAGED_TRANSPORT_REQUIRED', '请通过账号云图像连接重新准备请求');

  // Old account-managed keys have no verified payer binding. Every local caller
  // (workbench, retries, schemes and Skill) reaches this boundary, including those
  // that do not use the Automation gate. Only the host-owned cloud transport may
  // execute for an account; a retained key or interactive click cannot establish it.
  if (providerRow.managed_by === 'account' && !transport)
    return fail(
      'failed',
      'PAYMENT_IDENTITY_UNBOUND',
      '旧账号连接尚未绑定可信付款身份，请在连接设置中检查账号云连接，或选择自备连接',
    );

  const provider = transport
    ? null
    : createProvider(
        providerRow.type as ProviderType,
        providerRow.id as string,
        providerRow.base_url as string,
        providerRow.model as string,
        providerRow.name as string,
      );

  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromCaller = () => controller.abort();
  let detachExternalAbort: () => void = () => undefined;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else {
      externalSignal.addEventListener('abort', abortFromCaller, { once: true });
      detachExternalAbort = () => externalSignal.removeEventListener('abort', abortFromCaller);
    }
  }
  abortControllers.set(jobId, controller);
  let returnedImages: Array<{ imagePath: string }> = [];

  logger.info(
    'generate 请求',
    `provider=${providerRow.name}(${providerRow.type})`,
    `model=${effectiveReq.model ?? providerRow.model}`,
    `size=${effectiveReq.size}`,
    effectiveReq.aspectRatio ? `ratio=${effectiveReq.aspectRatio}` : '',
    `quality=${effectiveReq.quality}`,
    effectiveReq.referenceImages?.length
      ? `mode=image-edit(${effectiveReq.referenceImages.length})`
      : 'mode=image-generation',
  );

  try {
    if (controller.signal.aborted) {
      return fail('cancelled', 'CANCELLED', '已取消');
    }
    const startedRun = runContext.repositories.runs.start(runContext.runId, jobId, startTs);
    if (startedRun.status !== 'running') {
      return {
        historyId,
        status: startedRun.status === 'cancelled' ? 'cancelled' : 'failed',
        error: {
          code:
            startedRun.errorCode ?? (startedRun.status === 'cancelled' ? 'CANCELLED' : 'UNKNOWN'),
          message: sanitizeProviderErrorMessage(
            startedRun.errorMessage ?? '',
            startedRun.status === 'cancelled' ? '已取消' : '生成未启动',
          ),
        },
        durationMs: Date.now() - startTs,
        costUnit,
      };
    }
    const onProviderProgress: ImageProgressHandler = (progress) => {
      transport?.assertCurrent();
      sendProgress?.({ ...progress, jobId });
    };
    const execution = options.execution;
    if (execution && !(provider instanceof OpenAICompatibleProvider)) {
      // Frozen Doubao/browser automation and other provider adapters have no durable HTTP claim port.
      return fail('failed', 'AUTOMATION_DURABLE_UNSUPPORTED', '此连接暂不支持持久费用登记');
    }
    if (execution && providerRow.type !== execution.binding.providerType) {
      return fail('failed', 'AUTOMATION_BINDING_CHANGED', '生图连接已变化，请重新发起请求');
    }
    const result: GenerateImageResult = transport
      ? await transport.generate(
          structuredClone({ ...req, jobId }),
          controller.signal,
          onProviderProgress,
        )
      : execution && provider instanceof OpenAICompatibleProvider
        ? await provider.generateImage(
            effectiveReq,
            controller.signal,
            onProviderProgress,
            execution,
          )
        : provider
          ? await provider.generateImage(effectiveReq, controller.signal, onProviderProgress)
          : {
              historyId,
              status: 'failed',
              error: { code: 'NO_PROVIDER', message: '生图连接不可用' },
            };
    transport?.assertCurrent();
    const rawImages = result.images?.filter((image) => Boolean(image.imagePath)) ?? [];
    const providerImages =
      rawImages.length > 0
        ? rawImages
        : result.imagePath
          ? [{ imagePath: result.imagePath, actualSize: result.actualSize }]
          : [];
    assertLocalAssetWriteOutputs(providerImages);
    returnedImages = providerImages;
    // Cancellation wins over a provider response that races with the abort.
    // Clean up any managed files returned by the late response before returning.
    if (controller.signal.aborted) {
      cleanupUncommittedImages(providerImages, db);
      returnedImages = [];
      return fail('cancelled', 'CANCELLED', '已取消');
    }
    const assetIdBase = runContext.runId;
    const images = providerImages.map((image, index) => ({
      ...image,
      assetId: index === 0 ? assetIdBase : `${assetIdBase}-${index + 1}`,
    }));
    const normalizedResult: GenerateImageResult = {
      ...result,
      imagePath: images[0]?.imagePath ?? result.imagePath,
      ...(images.length > 0 ? { images } : {}),
    };
    const finishedAt = Date.now();
    // Provider 以「返回 failed 结果」而非 throw 表达失败时，同样要在入账前脱敏。
    const providerFailureMessage = sanitizeProviderErrorMessage(
      normalizedResult.error?.message ?? '',
      '生成失败',
    );
    const terminalRun =
      normalizedResult.status === 'cancelled'
        ? runContext.repositories.runs.cancel(runContext.runId, finishedAt)
        : normalizedResult.status === 'failed'
          ? runContext.repositories.runs.fail(
              runContext.runId,
              normalizedResult.error?.code ?? 'UNKNOWN',
              providerFailureMessage,
              finishedAt,
            )
          : runContext.repositories.runs.complete(runContext.runId, {
              actualCost: normalizedResult.cost ?? null,
              durationMs: normalizedResult.durationMs ?? null,
              finishedAt,
              // providerResponse 追加进参数快照(旧 history.params 的等价信息面)。
              params: normalizedResult.providerResponse
                ? { ...params, providerResponse: normalizedResult.providerResponse }
                : undefined,
              assets: images.map((image, position) => ({
                id: image.assetId,
                position,
                status: 'available',
                mediaPath: image.imagePath,
                width: image.actualSize?.width ?? null,
                height: image.actualSize?.height ?? null,
                createdAt: finishedAt,
              })),
            });
    returnedImages = [];
    if (terminalRun.status !== 'success') {
      cleanupUncommittedImages(images, db);
    }
    const terminalResult: GenerateImageResult =
      terminalRun.status === 'cancelled'
        ? {
            historyId,
            status: 'cancelled',
            error: { code: 'CANCELLED', message: '已取消' },
            durationMs: Date.now() - startTs,
            costUnit,
          }
        : terminalRun.status === 'failed'
          ? {
              ...normalizedResult,
              historyId,
              status: 'failed',
              error: {
                code: terminalRun.errorCode ?? normalizedResult.error?.code ?? 'UNKNOWN',
                message: sanitizeProviderErrorMessage(
                  terminalRun.errorMessage ?? '',
                  providerFailureMessage,
                ),
              },
              costUnit,
              costPoints: normalizedResult.cost,
            }
          : {
              ...normalizedResult,
              historyId,
              status: 'success',
              costUnit,
              costPoints: normalizedResult.cost,
            };
    if (terminalResult.status === 'success') {
      logger.info(
        'generate 成功',
        `run=${historyId}`,
        `status=${terminalResult.status}`,
        images.length > 1 ? `images=${images.length}` : '',
        normalizedResult.durationMs ? `${normalizedResult.durationMs}ms` : '',
      );
    }
    return terminalResult;
  } catch (err) {
    transport?.assertCurrent();
    cleanupUncommittedImages(returnedImages, db);
    const upstreamCode = (err as { code?: string })?.code ?? 'UNKNOWN';
    const code =
      providerRow.managed_by === 'account'
        ? upstreamCode === 'NO_BALANCE'
          ? 'ACCOUNT/QUOTA'
          : upstreamCode === 'AUTH'
            ? 'ACCOUNT/AUTH'
            : upstreamCode === 'MODEL_NOT_FOUND'
              ? 'ACCOUNT/MODEL_NOT_FOUND'
              : upstreamCode
        : upstreamCode;
    // 上游异常消息可能携带凭据/签名 URL/路径：日志与账本都不允许落入原文，
    // 在进入日志与 fail()（写账本 + 返回渲染层）之前统一脱敏。
    const message = sanitizeProviderErrorMessage((err as Error)?.message, 'Unknown error');
    // 取消不算失败：运行状态记 cancelled，日志降级为 info
    const cancelled = code === 'CANCELLED';
    const runStatus = cancelled ? 'cancelled' : 'failed';
    if (cancelled) logger.info('generate 取消', `run=${historyId}`);
    else logger.error('generate 失败', `run=${historyId}`, `code=${code}`, message);
    // 用**返回值**而不是 throw 把失败交回渲染层。
    //
    // ipcRenderer.invoke 在 handler 抛错时只把 error.message 序列化过去（还会包上
    // "Error invoking remote method ..." 前缀），挂在 Error 上的 code / historyId
    // 全部丢在主进程这一侧。结果是：取消在 UI 上显示成"失败"、错误分类全变
    // UNKNOWN（friendlyError 失效）、historyId 丢了让重试退化成"按当前面板重发"
    // 而不是按快照重发。
    //
    // GenerateImageResult 本来就有 status: 'failed' | 'cancelled' + error{code,message}
    // 这套形状，渲染层的 applyResult 也早已按它分流 —— 走返回值才是这份契约的原意。
    return fail(runStatus, code, message);
  } finally {
    detachExternalAbort();
    abortControllers.delete(jobId);
  }
}

/** 取消生图（幂等）：先原子收敛账本，再中止已存在的 Provider 请求。 */
export function cancelGeneration(jobId: string, db: Database.Database = getDb()): boolean {
  const run = createWorkbenchRepositories(db).runs.get(jobId);
  const wasCancellable = run?.status === 'queued' || run?.status === 'running';
  if (wasCancellable) createWorkbenchRepositories(db).runs.cancel(jobId);
  const controller = abortControllers.get(jobId);
  if (controller) {
    controller.abort();
    abortControllers.delete(jobId);
  }
  if (wasCancellable || controller) logger.info('generate 取消', `job=${jobId}`);
  return Boolean(wasCancellable || controller);
}
