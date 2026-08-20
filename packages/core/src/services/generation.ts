// GenerationService（V04-CORE-05）：全 App 生图唯一汇聚点，自 electron/main/ipc/images.ts
// 主库账本（history + generation_runs）、进度回调、
// 取消句柄都在此收口；IPC 与控制面（API-03）都是它的薄壳。

import { resolve } from 'path';
import { ulid } from 'ulid';
import { MAX_REFERENCE_IMAGES } from '@musefold/desktop-contracts/providers';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
  LocalImageReference,
  PromptReference,
} from '@musefold/desktop-contracts/providers';
import type { ProviderType } from '@musefold/desktop-contracts/enums';
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
  retryOfRunId?: string,
): RunContext | null {
  const shouldCreateRun = Boolean(req.workbench || retryOfRunId || req.sourceAssetId || req.refinementInstruction);
  if (!shouldCreateRun) return null;

  const db = getDb();
  const repositories = createWorkbenchRepositories(db);
  return db.transaction(() => {
    const retrySource = retryOfRunId ? repositories.runs.get(retryOfRunId) : null;
    const workbench = req.workbench;
    if (workbench) {
      if (
        !workbench.sessionId.trim()
        || !workbench.turnId.trim()
        || !Number.isInteger(workbench.turnIndex)
        || workbench.turnIndex < 0
        || !Number.isInteger(workbench.resultIndex)
        || workbench.resultIndex < 0
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
    const refinementParent = !retryOf && req.parentHistoryId
      ? repositories.runs.get(req.parentHistoryId)
      : null;
    const basePrompt = retrySource?.basePrompt
      ?? (refinementInstruction ? refinementParent?.finalPrompt : null)
      ?? req.prompt;
    const params = {
      schemaVersion: 1 as const,
      size: req.size,
      aspectRatio: req.aspectRatio,
      quality: req.quality,
      n: req.n,
      background: req.background,
      moderation: req.moderation,
      ...(req.referenceImages?.length ? { referenceImages: req.referenceImages } : {}),
      ...(req.skillRuntime ? { skillRuntime: req.skillRuntime } : {}),
      sourceKind: req.promptId || req.promptReferences?.length ? 'prompt' : 'chat',
    };
    const promptSnapshot = {
      schemaVersion: 1 as const,
      userPrompt: workbench?.userPrompt ?? retrySource?.userPrompt ?? '',
      basePrompt,
      refinementInstruction,
      finalPrompt: req.prompt,
      negativePrompt: req.negative ?? null,
    };

    // Refinement runs must be created through the repository aggregate so the
    // parent terminal state and source Asset ownership/availability are checked
    // before any Provider request is sent.
    if (!retryOf && (req.sourceAssetId || refinementInstruction)) {
      if (!req.parentHistoryId || !req.sourceAssetId || !refinementInstruction) {
        throw new Error('微调请求缺少父运行、来源图片或微调说明');
      }
      if (!sourceAsset || sourceAsset.status !== 'available' || sourceAsset.runId !== req.parentHistoryId) {
        throw new Error('微调来源图片不存在或不可用');
      }
      const run = repositories.runs.create({
        id: req.jobId,
        runKind: 'refinement',
        parentRunId: req.parentHistoryId,
        sourceAssetId: req.sourceAssetId,
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

    const parentRunId = retrySource
      ? (retrySource.parentRunId ?? retrySource.id)
      : null;
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

function writeHistoryWithReferences(
  db: ReturnType<typeof getDb>,
  historyId: string,
  references: PromptReference[] | undefined,
  insertHistory: () => void,
): void {
  db.transaction(() => {
    insertHistory();
    if (!references?.length) return;

    const promptExists = db.prepare('SELECT 1 FROM prompts WHERE id = ?');
    const insertReference = db.prepare(
      `INSERT INTO history_prompt_references
         (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    references.forEach((reference, index) => {
      const promptId = reference.promptId && promptExists.get(reference.promptId)
        ? reference.promptId
        : null;
      insertReference.run(
        historyId,
        promptId,
        reference.title,
        reference.text,
        reference.scope,
        index,
      );
    });
  })();
}

function withGenerationMetadata(
  base: Record<string, unknown>,
  req: GenerateImageRequest,
): string {
  return JSON.stringify({
    ...base,
    ...(req.parentHistoryId ? { parentHistoryId: req.parentHistoryId } : {}),
    ...(req.sourceAssetId ? { sourceAssetId: req.sourceAssetId } : {}),
    ...(req.refinementInstruction ? { refinementInstruction: req.refinementInstruction } : {}),
    ...(req.referenceImages?.length ? { referenceImages: req.referenceImages } : {}),
    ...(req.skillRuntime ? { skillRuntime: req.skillRuntime } : {}),
  });
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
        asset?.status === 'available'
        && asset.mediaPath
        && resolve(asset.mediaPath) === resolve(reference.path)
      ) {
        return { ...reference, path: asset.mediaPath };
      }
      const error = new Error('上一张图片已不可用，请重新选择');
      (error as { code?: string }).code = 'IMAGE_HISTORY_MISSING';
      throw error;
    }
    const row = db.prepare('SELECT image_path FROM history WHERE id = ?').get(reference.historyId) as
      | { image_path: string | null }
      | undefined;
    if (!row?.image_path || resolve(row.image_path) !== resolve(reference.path)) {
      const error = new Error('上一张图片已不可用，请重新选择');
      (error as { code?: string }).code = 'IMAGE_HISTORY_MISSING';
      throw error;
    }
    return { ...reference, path: row.image_path };
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
    return { historyId, status: 'failed', error: { code, message }, durationMs: Date.now() - startTs };
  }
  /** 记账单位快照（FR-COST-03）：托管 Provider 以「点」入账；providerRow 加载后回填 */
  const costUnit = 'point' as const;

  /** 写一条失败/取消历史并返回结构化结果（见下方"为什么不 throw"） */
  const fail = (
    status: 'failed' | 'cancelled',
    code: string,
    message: string,
    model: string,
    paramsJson: string | null
  ): GenerateImageResult => {
    writeHistoryWithReferences(db, historyId, req.promptReferences, () => {
      db.prepare(
        `INSERT INTO history
          (id, prompt_id, provider_id, model, prompt_text, negative_text, params,
           status, error_code, error_message, cost_unit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        historyId,
        req.promptId ?? null,
        req.providerId,
        model,
        req.prompt,
        req.negative ?? null,
        paramsJson,
        status,
        code,
        message,
        costUnit,
        Date.now(),
      );
    });
    return { historyId, status, error: { code, message }, durationMs: Date.now() - startTs, costUnit };
  };

  // 读 Provider 配置
  const providerRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.providerId) as
    | Record<string, unknown>
    | undefined;
  if (!providerRow) {
    // 选中的服务商已被删除。同样走返回值而非 throw，否则渲染层只能看到
    // "Error invoking remote method ..." 这种没法给用户看的字符串。
    logger.error('generate 失败', `history=${historyId}`, 'code=NO_PROVIDER', 'Provider 不存在');
    return fail('failed', 'NO_PROVIDER', 'Provider 不存在或已被删除', req.model ?? 'unknown', null);
  }

  const provider = createProvider(
    providerRow.type as ProviderType,
    providerRow.id as string,
    providerRow.base_url as string,
    providerRow.model as string,
    providerRow.name as string
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
    effectiveReq.referenceImages?.length ? `mode=image-edit(${effectiveReq.referenceImages.length})` : 'mode=image-generation',
  );

  // 参数快照：重试要靠它重建请求，所以两种 Provider 的形状字段都得留下 ——
  // aspectRatio 少存一个，悟空的重试就会丢掉比例、出一张形状不同的图。
  const paramsJson = withGenerationMetadata({
    size: effectiveReq.size,
    aspectRatio: effectiveReq.aspectRatio,
    quality: effectiveReq.quality,
    n: effectiveReq.n,
    background: effectiveReq.background,
    moderation: effectiveReq.moderation,
  }, effectiveReq);
  let runContext: RunContext | null = null;
  try {
    runContext = createRunContext(effectiveReq, startTs, options.retryOfRunId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('generation run 创建失败', `history=${historyId}`, message);
    return fail(
      'failed',
      'GENERATION_RUN_CREATE_FAILED',
      '生成运行记录创建失败，已停止本次生成',
      req.model ?? (providerRow.model as string),
      paramsJson,
    );
  }

  try {
    if (runContext) {
      runContext.repositories.runs.start(runContext.runId, jobId, startTs);
    }
    const result: GenerateImageResult = await provider.generateImage(effectiveReq, controller.signal, (progress) => {
      sendProgress?.({ ...progress, jobId });
    });
    const rawImages = result.images?.filter((image) => Boolean(image.imagePath)) ?? [];
    const providerImages = rawImages.length > 0
      ? rawImages
      : result.imagePath
        ? [{ imagePath: result.imagePath, actualSize: result.actualSize }]
        : [];
    const assetIdBase = runContext?.runId ?? historyId;
    const images = providerImages.map((image, index) => ({
      ...image,
      ...(runContext
        ? { assetId: index === 0 ? assetIdBase : `${assetIdBase}-${index + 1}` }
        : {}),
    }));
    const normalizedResult: GenerateImageResult = {
      ...result,
      imagePath: images[0]?.imagePath ?? result.imagePath,
      ...(images.length > 0 ? { images } : {}),
    };
    const completedParamsJson = normalizedResult.providerResponse
      ? JSON.stringify({
          ...parseJsonColumn<Record<string, unknown>>(paramsJson, {}),
          providerResponse: normalizedResult.providerResponse,
        })
      : paramsJson;
    writeHistoryWithReferences(db, historyId, req.promptReferences, () => {
      db.prepare(
        `INSERT INTO history
          (id, prompt_id, provider_id, model, prompt_text, negative_text, params,
           status, image_path, cost, cost_unit, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        historyId,
        req.promptId ?? null,
        req.providerId,
        req.model ?? (providerRow.model as string),
        req.prompt,
        req.negative ?? null,
        completedParamsJson,
        normalizedResult.status,
        normalizedResult.imagePath ?? null,
        normalizedResult.cost ?? null,
        costUnit,
        normalizedResult.durationMs ?? null,
        Date.now(),
      );
    });
    if (runContext) {
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
    }
    logger.info(
      'generate 成功',
      `history=${historyId}`,
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
    const code = providerRow.managed_by === 'account'
      ? upstreamCode === 'NO_BALANCE'
        ? 'ACCOUNT/QUOTA'
        : upstreamCode === 'AUTH'
          ? 'ACCOUNT/AUTH'
          : upstreamCode === 'MODEL_NOT_FOUND'
            ? 'ACCOUNT/MODEL_NOT_FOUND'
            : upstreamCode
      : upstreamCode;
    const message = (err as Error).message || 'Unknown error';
    // 取消不算失败：历史状态记 cancelled，日志降级为 info
    const cancelled = code === 'CANCELLED';
    const histStatus = cancelled ? 'cancelled' : 'failed';
    if (cancelled) logger.info('generate 取消', `history=${historyId}`);
    else logger.error('generate 失败', `history=${historyId}`, `code=${code}`, message);
    if (runContext) {
      const finishedAt = Date.now();
      if (cancelled) {
        runContext.repositories.runs.cancel(runContext.runId, finishedAt);
      } else {
        runContext.repositories.runs.fail(runContext.runId, code, message, finishedAt);
      }
    }
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
    return fail(
      histStatus,
      code,
      message,
      req.model ?? (providerRow.model as string),
      paramsJson
    );
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
