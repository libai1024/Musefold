// 生图闭环路由（V04-API-03/04）：策略闸门 + 任务注册表 + 确认回执 + 上传转存。
//
// 策略闸门四分支（V04-ARCHITECTURE §5.4，服务端强制）：
//   a. Idempotency-Key 命中已放行记录 → 直接执行
//   b. 预算覆盖估算 → 记账并执行
//   c. 需确认 → 202 + confirmationId（App 确认卡 / MCP elicitation 回执到 /v1/confirmations）
//   d. 超时未确认 → 409 CONFIRMATION_TIMEOUT
// 宿主注入 GenerationHost：Electron 主进程与 headless 守护各自实现。

import { randomUUID } from 'node:crypto';
import type { EventHub } from '@musefold/core';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
  LocalImageReference,
} from '@shared/types/providers';
import { resolveRatioOptionById } from '@shared/constants';
import { AutomationError, type AutomationRouteContext, type AutomationRouteHandler } from './server';

export const CONFIRMATION_TIMEOUT_MS = 120_000;
export const MAX_GENERATION_N = 4;
export const DEFAULT_BREAKER_THRESHOLD = 3;
export const DEFAULT_BREAKER_COOLDOWN_MS = 10 * 60_000;

/** 花钱审计草稿（宿主负责落库，V04-SEC-01；提示词全文按 Q5 完整记录） */
export interface SpendAuditDraft {
  at: number;
  action: 'generate_image';
  promptText: string | null;
  params: Record<string, unknown>;
  estimatedCents: number | null;
  actualCents: number | null;
  approvedVia: 'budget' | 'confirmation' | 'consent' | 'idempotent-replay' | 'denied' | 'timeout';
  status: 'success' | 'failed' | 'cancelled' | 'denied' | 'timeout';
  jobId: string | null;
}

export interface GenerationGateOptions {
  onSpendAudit?: (entry: SpendAuditDraft) => void;
  /** 连续失败熔断（SECURITY §3.3）：默认 3 次失败停 10 分钟 */
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  clock?: () => number;
}

export interface GenerationEstimate {
  /** 估算成本（分）；null = 无单价配置 → 必须确认 */
  cents: number | null;
  providerId: string;
  providerName: string;
  model: string;
  n: number;
}

export interface GenerationBudget {
  /** 剩余额度（分）；预算未配置视为 0（Q1 拍板：默认一切须确认） */
  remainingCents(): number;
  /** 按实际成本冲销（估算只用于闸门） */
  settle(actualCents: number): void;
}

export interface GenerationHost {
  run(
    req: GenerateImageRequest,
    onProgress: (progress: ImageGenerationProgress) => void,
  ): Promise<GenerateImageResult>;
  cancel(jobId: string): boolean;
  estimate(req: GenerationRequestBody): GenerationEstimate;
  budget: GenerationBudget;
  /**
   * 请求用户确认（App 确认卡）；headless/无人值守实现应直接返回 'denied'。
   * 实现负责自身的 UI 展示；网关只等待结论或超时。
   */
  requestConfirmation(request: ConfirmationSummary): Promise<'approved' | 'denied'>;
  /** 参考图路径白名单（V04-SECURITY §5）：canonicalize 后必须落在受管目录 */
  authorizeReferencePath(path: string): boolean;
  /** 上传转存（POST /v1/uploads）：写入受管暂存目录 */
  stageUpload(bytes: Buffer, name: string, mimeType: string): Promise<LocalImageReference>;
  /** 历史 id → 产物路径（referenceHistoryIds 精修垫图） */
  resolveHistoryImage(historyId: string): { path: string } | null;
}

export interface ConfirmationSummary {
  confirmationId: string;
  providerName: string;
  model: string;
  n: number;
  estimatedCents: number | null;
  promptPreview: string;
}

export interface GenerationRequestBody {
  prompt?: string;
  providerId?: string;
  model?: string;
  aspectRatio?: string;
  n?: number;
  quality?: string;
  negative?: string;
  /** gpt-image 系列支持 transparent / opaque / auto，透明素材图（如桌宠 sprite）依赖它 */
  background?: string;
  referenceImagePaths?: string[];
  referenceHistoryIds?: string[];
  /** 调用方声明的一次性预算（分）；须 ≤ 设置页预算剩余（§5.4 b） */
  declaredBudgetCents?: number;
  /**
   * 'interactive' = 人已在本机终端确认（CLI TTY y/N 或 --yes，D7 一等路径）。
   * MCP 工具面不暴露此字段；审计记录放行路径。
   */
  consent?: 'interactive';
}

interface JobRecord {
  jobId: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: number;
  result?: GenerateImageResult;
  estimatedCents: number | null;
}

interface PendingConfirmation {
  id: string;
  body: GenerationRequestBody;
  idempotencyKey: string | null;
  resolve: (outcome: 'approved' | 'denied' | 'timeout') => void;
  outcome: Promise<'approved' | 'denied' | 'timeout'>;
  summary: ConfirmationSummary;
  createdAt: number;
}

function generationAssets(result: GenerateImageResult): Array<{ path: string }> {
  const images = result.images?.filter((image) => Boolean(image.imagePath)) ?? [];
  if (images.length > 0) return images.map((image) => ({ path: image.imagePath }));
  return result.imagePath ? [{ path: result.imagePath }] : [];
}

export interface GenerationGate {
  routes: Record<string, AutomationRouteHandler>;
  /** App 确认卡回执入口（IPC 侧复用；MCP 走 HTTP 端点同源） */
  resolveConfirmation(id: string, approved: boolean): boolean;
  pendingConfirmations(): ConfirmationSummary[];
}

/** 把控制面请求体规整为 core 的 GenerateImageRequest（provider/model 缺省由宿主 estimate 补全）。 */
function toGenerateRequest(
  body: GenerationRequestBody,
  estimate: GenerationEstimate,
  jobId: string,
  references: LocalImageReference[],
): GenerateImageRequest {
  const ratio = body.aspectRatio ? resolveRatioOptionById(body.aspectRatio) : null;
  return {
    jobId,
    providerId: estimate.providerId,
    model: body.model ?? estimate.model,
    prompt: body.prompt ?? '',
    negative: body.negative,
    size: ratio?.size ?? '1024x1024',
    aspectRatio: ratio?.ratio ?? body.aspectRatio,
    quality: (body.quality as GenerateImageRequest['quality']) ?? 'auto',
    background: body.background as GenerateImageRequest['background'],
    n: estimate.n,
    ...(references.length > 0 ? { referenceImages: references } : {}),
  };
}

export function createGenerationGate(
  host: GenerationHost,
  hub: Pick<EventHub, 'sink'>,
  gateOptions: GenerationGateOptions = {},
): GenerationGate {
  const jobs = new Map<string, JobRecord>();
  const approvedIdempotencyKeys = new Map<string, string>(); // key → jobId（重放返回原任务）
  const pending = new Map<string, PendingConfirmation>();
  const clock = gateOptions.clock ?? (() => Date.now());
  const audit = (entry: SpendAuditDraft) => {
    try {
      gateOptions.onSpendAudit?.(entry);
    } catch {
      // 审计失败不阻断业务
    }
  };

  // 熔断（防重试风暴）：连续失败达到阈值后，花钱提交停一段时间
  const breakerThreshold = gateOptions.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
  const breakerCooldownMs = gateOptions.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
  let consecutiveFailures = 0;
  let breakerOpenUntil = 0;
  const noteOutcome = (status: 'success' | 'failed' | 'cancelled') => {
    if (status === 'success') consecutiveFailures = 0;
    if (status === 'failed') {
      consecutiveFailures += 1;
      if (consecutiveFailures >= breakerThreshold) {
        breakerOpenUntil = clock() + breakerCooldownMs;
        consecutiveFailures = 0;
        hub.sink.emit({ type: 'breaker.opened', payload: { until: breakerOpenUntil } });
      }
    }
  };

  function validateBody(context: AutomationRouteContext): GenerationRequestBody {
    const body = context.body;
    if (body == null || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
      throw new AutomationError('INVALID_PARAMS', '请求体必须是 JSON 对象', 400);
    }
    const parsed = body as GenerationRequestBody;
    if (!parsed.prompt?.trim()) {
      throw new AutomationError('INVALID_PARAMS', 'prompt 不能为空', 400);
    }
    const n = parsed.n ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > MAX_GENERATION_N) {
      throw new AutomationError('INVALID_PARAMS', `n 必须是 1–${MAX_GENERATION_N} 的整数（T1 限制）`, 400, { n });
    }
    return parsed;
  }

  function authorizeReferences(body: GenerationRequestBody): LocalImageReference[] {
    const references: LocalImageReference[] = [];
    for (const path of body.referenceImagePaths ?? []) {
      if (!host.authorizeReferencePath(path)) {
        throw new AutomationError('PATH_NOT_ALLOWED', '参考图路径不在允许范围内（请先经 /v1/uploads 转存）', 403, { path });
      }
      references.push({ path, name: path.split('/').pop() ?? 'reference', source: 'upload', mimeType: 'image/png', sizeBytes: 0 });
    }
    for (const historyId of body.referenceHistoryIds ?? []) {
      const resolved = host.resolveHistoryImage(historyId);
      if (!resolved) {
        throw new AutomationError('NOT_FOUND', '引用的历史产物不存在', 404, { historyId });
      }
      references.push({ path: resolved.path, name: `history-${historyId}`, source: 'history', historyId, mimeType: 'image/png', sizeBytes: 0 });
    }
    if (references.length > 16) {
      throw new AutomationError('INVALID_PARAMS', '参考图不能超过 16 张', 400);
    }
    return references;
  }

  function launch(
    body: GenerationRequestBody,
    estimate: GenerationEstimate,
    references: LocalImageReference[],
    approvedVia: 'budget' | 'confirmation' | 'consent',
  ): JobRecord {
    const jobId = randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase();
    const record: JobRecord = { jobId, status: 'running', startedAt: Date.now(), estimatedCents: estimate.cents };
    jobs.set(jobId, record);
    const request = toGenerateRequest(body, estimate, jobId, references);
    void host
      .run(request, (progress) => {
        hub.sink.emit({ type: 'generation.progress', payload: { ...progress, jobId } });
      })
      .then((result) => {
        record.status = result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'failed';
        record.result = result;
        const actualCents = result.costCents ?? result.cost ?? 0;
        if (result.status === 'success') host.budget.settle(actualCents);
        noteOutcome(record.status);
        audit({
          at: clock(),
          action: 'generate_image',
          promptText: request.prompt || null,
          params: {
            providerId: estimate.providerId,
            model: request.model,
            n: estimate.n,
            aspectRatio: body.aspectRatio ?? null,
            references: references.length,
          },
          estimatedCents: estimate.cents,
          actualCents: result.costCents ?? result.cost ?? null,
          approvedVia,
          status: record.status,
          jobId,
        });
        hub.sink.emit({
          type: result.status === 'success' ? 'generation.completed' : 'generation.failed',
          payload: {
            jobId,
            historyId: result.historyId,
            status: result.status,
            costCents: result.costCents ?? result.cost ?? null,
            cost: result.cost ?? null,
            costUnit: result.costUnit ?? 'cny_cent',
            durationMs: result.durationMs ?? null,
            assets: generationAssets(result),
            error: result.error ?? null,
            actualSize: result.actualSize ?? null,
            sizeMismatch: result.sizeMismatch ?? null,
          },
        });
      })
      .catch((error) => {
        record.status = 'failed';
        record.result = {
          historyId: jobId,
          status: 'failed',
          error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
        };
        noteOutcome('failed');
        audit({
          at: clock(),
          action: 'generate_image',
          promptText: body.prompt ?? null,
          params: { providerId: estimate.providerId, n: estimate.n },
          estimatedCents: estimate.cents,
          actualCents: null,
          approvedVia,
          status: 'failed',
          jobId,
        });
        hub.sink.emit({ type: 'generation.failed', payload: { jobId, status: 'failed', error: record.result.error } });
      });
    return record;
  }

  function jobPayload(record: JobRecord) {
    return {
      jobId: record.jobId,
      status: record.status,
      startedAt: record.startedAt,
      estimatedCents: record.estimatedCents,
      ...(record.result
        ? {
            historyId: record.result.historyId,
            costCents: record.result.costCents ?? record.result.cost ?? null,
            cost: record.result.cost ?? null,
            costUnit: record.result.costUnit ?? 'cny_cent',
            durationMs: record.result.durationMs ?? null,
            assets: generationAssets(record.result),
            error: record.result.error ?? null,
            actualSize: record.result.actualSize ?? null,
            sizeMismatch: record.result.sizeMismatch ?? null,
          }
        : {}),
    };
  }

  const routes: Record<string, AutomationRouteHandler> = {
    // 估算预览（🟢 零成本）：CLI TTY 确认前展示 Provider/模型/张数/预估费用
    'POST /v1/generations/estimate': (context) => {
      const body = validateBody(context);
      const estimate = host.estimate(body);
      return { ...estimate, remainingBudgetCents: host.budget.remainingCents() };
    },

    'POST /v1/generations': async (context) => {
      // 熔断打开期间拒绝花钱提交（只读/轮询不受影响）
      if (clock() < breakerOpenUntil) {
        throw new AutomationError('BREAKER_OPEN', '连续失败过多，生成已临时熔断，请稍后再试', 429, {
          retryAfterMs: breakerOpenUntil - clock(),
        });
      }
      const body = validateBody(context);
      const references = authorizeReferences(body);
      const estimate = host.estimate(body);
      const idempotencyKey = firstHeader(context, 'idempotency-key');

      // a. Idempotency-Key 命中已放行记录 → 返回原任务（不重复扣预算、不重复确认）
      if (idempotencyKey) {
        const existingJobId = approvedIdempotencyKeys.get(idempotencyKey);
        const existing = existingJobId ? jobs.get(existingJobId) : undefined;
        if (existing) {
          context.json({ ...jobPayload(existing), idempotentReplay: true }, 200);
          return;
        }
      }

      // b. 预算覆盖估算 → 自动放行（估算未知成本不可走预算，必须确认）；
      //    调用方声明的一次性预算须同时 ≤ 剩余额度（§5.4 b）
      const remaining = host.budget.remainingCents();
      const declared = body.declaredBudgetCents;
      const budgetCovered =
        estimate.cents != null &&
        estimate.cents <= remaining &&
        (declared == null || (estimate.cents <= declared && declared <= remaining));
      // 交互同意：人已在本机确认（CLI TTY / --yes），等价 App 卡片放行
      const covered = budgetCovered || body.consent === 'interactive';

      if (!covered) {
        // c. 需确认：挂起 + 202
        const confirmationId = randomUUID();
        const summary: ConfirmationSummary = {
          confirmationId,
          providerName: estimate.providerName,
          model: estimate.model,
          n: estimate.n,
          estimatedCents: estimate.cents,
          promptPreview: body.prompt!.slice(0, 120),
        };
        let resolveOutcome!: (outcome: 'approved' | 'denied' | 'timeout') => void;
        const outcome = new Promise<'approved' | 'denied' | 'timeout'>((resolve) => {
          resolveOutcome = resolve;
        });
        // 一次性 settle：App 卡片、HTTP 回执、超时三路竞争，先到先得；
        // 广播 resolved 事件让其他确认通道（如仍显示的卡片）同步关闭。
        let settled = false;
        const settle = (verdict: 'approved' | 'denied' | 'timeout') => {
          if (settled) return;
          settled = true;
          hub.sink.emit({ type: 'confirmation.resolved', payload: { confirmationId, outcome: verdict } });
          resolveOutcome(verdict);
        };
        const entry: PendingConfirmation = {
          id: confirmationId,
          body,
          idempotencyKey,
          resolve: settle,
          outcome,
          summary,
          createdAt: Date.now(),
        };
        pending.set(confirmationId, entry);
        const timeout = setTimeout(() => settle('timeout'), CONFIRMATION_TIMEOUT_MS);
        hub.sink.emit({ type: 'confirmation.required', payload: summary });
        // 宿主的确认通道（App 卡片）与 HTTP 回执并行竞争，先到先得
        void host.requestConfirmation(summary).then((verdict) => settle(verdict)).catch(() => {});

        const verdict = await outcome;
        clearTimeout(timeout);
        pending.delete(confirmationId);
        if (verdict !== 'approved') {
          audit({
            at: clock(),
            action: 'generate_image',
            promptText: body.prompt ?? null,
            params: { providerId: estimate.providerId, n: estimate.n },
            estimatedCents: estimate.cents,
            actualCents: null,
            approvedVia: verdict,
            status: verdict,
            jobId: null,
          });
        }
        if (verdict === 'timeout') {
          throw new AutomationError('CONFIRMATION_TIMEOUT', '等待确认超时（120s），本次生成未执行', 409, { confirmationId });
        }
        if (verdict === 'denied') {
          throw new AutomationError('CONFIRMATION_DENIED', '用户拒绝了本次生成', 403, { confirmationId });
        }
      }

      const approvedVia = body.consent === 'interactive' ? 'consent' : budgetCovered ? 'budget' : 'confirmation';
      const record = launch(body, estimate, references, approvedVia);
      if (idempotencyKey) approvedIdempotencyKeys.set(idempotencyKey, record.jobId);
      context.json(jobPayload(record), 202);
    },

    'GET /v1/generations/:jobId': (context) => {
      const record = jobs.get(context.params.jobId);
      if (!record) throw new AutomationError('NOT_FOUND', '生成任务不存在（或已随重启失效）', 404, { jobId: context.params.jobId });
      return jobPayload(record);
    },

    'DELETE /v1/generations/:jobId': (context) => {
      const record = jobs.get(context.params.jobId);
      if (!record) throw new AutomationError('NOT_FOUND', '生成任务不存在', 404, { jobId: context.params.jobId });
      host.cancel(record.jobId);
      return { jobId: record.jobId, cancelling: true };
    },

    'POST /v1/confirmations/:id': (context) => {
      const body = (context.body ?? {}) as { approved?: boolean };
      const ok = gate.resolveConfirmation(context.params.id, body.approved !== false);
      if (!ok) throw new AutomationError('NOT_FOUND', '确认请求不存在或已处理', 404, { id: context.params.id });
      return { ok: true };
    },

    'POST /v1/uploads': async (context) => {
      if (!Buffer.isBuffer(context.body)) {
        throw new AutomationError('INVALID_PARAMS', '上传体必须是原始图片字节（content-type: image/*）', 400);
      }
      const contentType = String(context.request.headers['content-type'] ?? '');
      if (!/^image\/(png|jpeg|webp)/.test(contentType)) {
        throw new AutomationError('INVALID_PARAMS', '仅支持 PNG / JPEG / WebP', 400, { contentType });
      }
      const name = firstHeader(context, 'x-musefold-filename') ?? `upload.${contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'}`;
      try {
        const image = await host.stageUpload(context.body, name, contentType.split(';')[0]);
        context.json({ image }, 201);
      } catch (error) {
        throw new AutomationError(
          'UPLOAD_FAILED',
          error instanceof Error ? error.message : '图片转存失败',
          422,
        );
      }
    },
  };

  const gate: GenerationGate = {
    routes,
    resolveConfirmation(id, approved) {
      const entry = pending.get(id);
      if (!entry) return false;
      entry.resolve(approved ? 'approved' : 'denied');
      return true;
    },
    pendingConfirmations() {
      return [...pending.values()].map((entry) => entry.summary);
    },
  };
  return gate;
}

function firstHeader(context: AutomationRouteContext, name: string): string | null {
  const value = context.request.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
