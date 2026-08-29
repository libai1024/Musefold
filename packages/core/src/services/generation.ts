// GenerationService（V04-CORE-05）：全 App 生图唯一汇聚点，自 electron/main/ipc/images.ts
// 单账本（generation_runs + generated_assets）、进度回调、
// 取消句柄都在此收口；IPC 与控制面（API-03）都是它的薄壳。
// 所有生成(工作台/自由生成/automation/Skill)一律落 generation_runs——旧 history 双账本已随迁移 0002/0003 退役。

import { resolve } from 'path';
import { ulid } from 'ulid';
import { MAX_REFERENCE_IMAGES } from '@musefold/desktop-contracts/providers';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
  LocalImageReference,
} from '@musefold/desktop-contracts/providers';
import type { ProviderType } from '@musefold/desktop-contracts/enums';
import type { GenerationParamsSnapshot } from '@musefold/desktop-contracts/workbench';
import { getDb } from '../db/index';
import { createWorkbenchRepositories } from '../db/repositories/workbench';
import { parseJsonColumn } from '../db/json';
import { createProvider } from '../providers/registry';
import { isManagedUploadPath } from '../providers/local-image';
import { createLogger } from '../runtime';

const logger = createLogger('image');
const abortControllers = new Map<string, AbortController>();

export function hasActiveImageJobs(): boolean {
  return abortControllers.size > 0;
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
): RunContext {
  const db = getDb();
  const repositories = createWorkbenchRepositories(db);
  return db.transaction(() => {
    const retrySource = retryOfRunId ? repositories.runs.get(retryOfRunId) : null;
    const workbench = req.workbench;
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
    const workbenchSessionId = workbench?.sessionId ?? retrySource?.workbenchSessionId ?? null;
    const workbenchTurnId = workbench?.turnId ?? retrySource?.workbenchTurnId ?? null;
    const turnIndex = workbench?.turnIndex ?? retrySource?.turnIndex ?? null;
    const resultIndex = workbench?.resultIndex ?? retrySource?.resultIndex ?? null;
    const sourceAsset = req.sourceAssetId ? repositories.runs.getAsset(req.sourceAssetId) : null;
    const retryOf = retrySource?.id ?? null;
    const sourceAssetId = sourceAsset?.id ?? null;
    const refinementInstruction = req.refinementInstruction?.trim() || null;
    const refinementParent =
      !retryOf && req.parentHistoryId ? repositories.runs.get(req.parentHistoryId) : null;
    const basePrompt =
      retrySource?.basePrompt ??
      (refinementInstruction ? refinementParent?.finalPrompt : null) ??
      req.prompt;
    // 来源提示词与引用快照:只保留仍存在的提示词 id,避免落库即悬挂(prompt_id 无外键)。
    const promptExists = db.prepare('SELECT 1 FROM prompts WHERE id = ?');
    const requestedPromptId = req.promptId ?? retrySource?.promptId ?? null;
    const promptId =
      requestedPromptId && promptExists.get(requestedPromptId) ? requestedPromptId : null;
    const promptReferences = (req.promptReferences ?? []).map((reference) => ({
      promptId:
        reference.promptId && promptExists.get(reference.promptId) ? reference.promptId : null,
      title: reference.title,
      excerpt: reference.text,
      scope: reference.scope,
    }));
    const snapshotReferences =
      promptReferences.length > 0
        ? promptReferences
        : (retrySource?.promptSnapshot.promptReferences ?? []);
    const promptSnapshot = {
      schemaVersion: 1 as const,
      userPrompt: workbench?.userPrompt ?? retrySource?.userPrompt ?? '',
      basePrompt,
      refinementInstruction,
      finalPrompt: req.prompt,
      negativePrompt: req.negative ?? null,
      ...(snapshotReferences.length > 0 ? { promptReferences: snapshotReferences } : {}),
    };

    // Refinement runs must be created through the repository aggregate so the
    // parent terminal state and source Asset ownership/availability are checked
    // before any Provider request is sent.
    if (!retryOf && (req.sourceAssetId || refinementInstruction)) {
      if (!req.parentHistoryId || !req.sourceAssetId || !refinementInstruction) {
        throw new Error('微调请求缺少父运行、来源图片或微调说明');
      }
      if (
        !sourceAsset ||
        sourceAsset.status !== 'available' ||
        sourceAsset.runId !== req.parentHistoryId
      ) {
        throw new Error('微调来源图片不存在或不可用');
      }
      const run = repositories.runs.create({
        id: req.jobId,
        runKind: 'refinement',
        parentRunId: req.parentHistoryId,
        sourceAssetId: req.sourceAssetId,
        promptId,
        refinementInstruction,
        finalPrompt: req.prompt,
        basePrompt,
        userPrompt: workbench?.userPrompt ?? refinementInstruction,
        negativePrompt: req.negative ?? null,
        providerId: req.providerId,
        model: req.model ?? 'unknown',
        params,
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

    const parentRunId = retrySource ? (retrySource.parentRunId ?? retrySource.id) : null;
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
      providerId: req.providerId,
      model: req.model ?? 'unknown',
      userPrompt: workbench?.userPrompt ?? req.prompt,
      basePrompt,
      refinementInstruction,
      finalPrompt: req.prompt,
      negativePrompt: req.negative ?? null,
      params,
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

/** 实际生图 + 写历史（成功/失败都写）。Skill Agent 的 generate_image 工具也直接调用它。 */
export async function generate(
  req: GenerateImageRequest,
  sendProgress?: (progress: ImageGenerationProgress) => void,
  options: { retryOfRunId?: string } = {},
): Promise<GenerateImageResult> {
  const db = getDb();
  // 取消句柄：优先用渲染进程传入的 jobId（渲染进程据此在出图前即可取消），否则自生成
  const jobId = req.jobId ?? ulid();
  const historyId = jobId;
  const startTs = Date.now();
  // Provider 负责把结果落盘，因此也必须收到主进程最终采用的 id。
  // 否则未传 jobId（例如重试兼容路径）时，历史行与图片文件名会各用一套 ULID。
  let effectiveReq: GenerateImageRequest;
  try {
    effectiveReq = {
      ...req,
      jobId,
      referenceImages: authorizeReferenceImages(db, req.referenceImages),
    };
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'IMAGE_READ_FAILED';
    const message = error instanceof Error ? error.message : '图片读取失败，请重新选择';
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
  const providerRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.providerId) as
    | Record<string, unknown>
    | undefined;

  const params = buildParamsSnapshot(effectiveReq, providerRow);

  // 单账本:任何被受理的生成请求先落 generation_runs,成功/失败/取消都在同一行收敛。
  let runContext: RunContext;
  try {
    runContext = createRunContext(effectiveReq, startTs, params, options.retryOfRunId);
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

  /** 把失败/取消收敛进账本并返回结构化结果（见下方"为什么不 throw"） */
  const fail = (
    status: 'failed' | 'cancelled',
    code: string,
    message: string,
  ): GenerateImageResult => {
    const finishedAt = Date.now();
    if (status === 'cancelled') {
      runContext.repositories.runs.cancel(runContext.runId, finishedAt);
    } else {
      runContext.repositories.runs.fail(runContext.runId, code, message, finishedAt);
    }
    return {
      historyId,
      status,
      error: { code, message },
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

  const provider = createProvider(
    providerRow.type as ProviderType,
    providerRow.id as string,
    providerRow.base_url as string,
    providerRow.model as string,
    providerRow.name as string,
  );

  const controller = new AbortController();
  abortControllers.set(jobId, controller);

  logger.info(
    'generate 请求',
    `provider=${providerRow.name}(${providerRow.type})`,
    `model=${req.model ?? providerRow.model}`,
    `size=${req.size}`,
    req.aspectRatio ? `ratio=${req.aspectRatio}` : '',
    `quality=${req.quality}`,
    effectiveReq.referenceImages?.length
      ? `mode=image-edit(${effectiveReq.referenceImages.length})`
      : 'mode=image-generation',
  );

  try {
    runContext.repositories.runs.start(runContext.runId, jobId, startTs);
    const result: GenerateImageResult = await provider.generateImage(
      effectiveReq,
      controller.signal,
      (progress) => {
        sendProgress?.({ ...progress, jobId });
      },
    );
    const rawImages = result.images?.filter((image) => Boolean(image.imagePath)) ?? [];
    const providerImages =
      rawImages.length > 0
        ? rawImages
        : result.imagePath
          ? [{ imagePath: result.imagePath, actualSize: result.actualSize }]
          : [];
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
    if (normalizedResult.status === 'cancelled') {
      runContext.repositories.runs.cancel(runContext.runId, finishedAt);
    } else if (normalizedResult.status === 'failed') {
      runContext.repositories.runs.fail(
        runContext.runId,
        normalizedResult.error?.code ?? 'UNKNOWN',
        normalizedResult.error?.message ?? '生成失败',
        finishedAt,
      );
    } else {
      runContext.repositories.runs.complete(runContext.runId, {
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
    }
    logger.info(
      'generate 成功',
      `run=${historyId}`,
      `status=${normalizedResult.status}`,
      images.length > 1 ? `images=${images.length}` : '',
      normalizedResult.durationMs ? `${normalizedResult.durationMs}ms` : '',
    );
    return {
      ...normalizedResult,
      historyId,
      costUnit,
      costPoints: normalizedResult.cost,
    };
  } catch (err) {
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
    const message = (err as Error).message || 'Unknown error';
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
    abortControllers.delete(jobId);
  }
}

/** 取消生图（幂等）：中止对应任务的 AbortController。 */
export function cancelGeneration(jobId: string): boolean {
  const controller = abortControllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  abortControllers.delete(jobId);
  logger.info('generate 取消', `job=${jobId}`);
  return true;
}
