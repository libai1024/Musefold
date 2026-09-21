// 生图闭环路由（V04-API-03/04）：策略闸门 + 任务注册表 + 确认回执 + 上传转存。
//
// 策略闸门四分支（V04-ARCHITECTURE §5.4，服务端强制）：
//   a. Idempotency-Key 命中相同请求 → 返回原任务或等待同一次确认，不重复执行
//   b. 预算覆盖估算 → 记账并执行
//   c. 需确认 → 202 + confirmationId（App 确认卡 / MCP elicitation 回执到 /v1/confirmations）
//   d. 超时未确认 → 409 CONFIRMATION_TIMEOUT
// 宿主注入 GenerationHost：Electron 主进程与 headless 守护各自实现。

import { createHash, randomUUID } from 'node:crypto';
import type { EventHub } from '@musefold/core';
import type { AutomationSpendRequest } from '@musefold/desktop-contracts/automation-spend';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
  LocalImageReference,
} from '@musefold/desktop-contracts/providers';
import { resolveRatioOptionById } from '@musefold/domain/constants';
import {
  AutomationError,
  type AutomationRouteContext,
  type AutomationRouteHandler,
} from './server';

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
  estimatedPoints: number | null;
  actualPoints: number | null;
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
  /** 估算成本（积分）；非托管 Provider 不计费时为 null。 */
  points: number | null;
  /** 官方账号托管 Provider；仅此类价格未知时仍需确认。 */
  managedByAccount: boolean;
  providerId: string;
  providerName: string;
  model: string;
  n: number;
}

export interface GenerationBudget {
  /** 剩余额度（积分）；预算未配置视为 0（Q1 拍板：默认一切须确认） */
  remainingPoints(): number;
  /** 按实际成本冲销（估算只用于闸门） */
  settle(actualPoints: number): void | Promise<void>;
  /** 宿主可共享跨生图/方案/Skill 的预留；finish 必须幂等，null 保持费用待核对。 */
  reserve?(estimatedPoints: number | null): (actualPoints: number | null) => void | Promise<void>;
}

export interface GenerationHost {
  run(
    req: GenerateImageRequest,
    onProgress: (progress: ImageGenerationProgress) => void,
    spendRequest?: AutomationSpendRequest,
  ): Promise<GenerateImageResult>;
  cancel(jobId: string): boolean;
  estimate(req: GenerationRequestBody): GenerationEstimate;
  budget: GenerationBudget;
  /** Desktop durable adapter; absent on legacy/frozen hosts until they are explicitly migrated. */
  persistence?: GenerationPersistence;
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

export interface GenerationPersistence {
  /** Finished/in-flight requests can be read without re-opening inputs or current credentials. */
  replay(body: GenerationRequestBody, key: string): AutomationSpendRequest | null;
  register(
    body: GenerationRequestBody,
    estimate: GenerationEstimate,
    references: LocalImageReference[],
    key: string | null,
    now: number,
  ): AutomationSpendRequest | null;
  get(jobId: string): AutomationSpendRequest | null;
  result(request: AutomationSpendRequest): GenerateImageResult | undefined;
  begin(requestId: string): boolean;
  confirm(confirmationId: string, approved: boolean, now: number): boolean;
  finish(requestId: string, result: GenerateImageResult, now: number): void;
}

export interface ConfirmationSummary {
  confirmationId: string;
  providerName: string;
  model: string;
  n: number;
  estimatedPoints: number | null;
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
  /** 调用方声明的一次性预算（积分）；须 ≤ 设置页预算剩余（§5.4 b） */
  declaredBudgetPoints?: number;
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
  estimatedPoints: number | null;
}

interface PendingConfirmation {
  id: string;
  body: GenerationRequestBody;
  idempotencyKey: string | null;
  resolve: (outcome: 'approved' | 'denied' | 'timeout') => boolean;
  outcome: Promise<'approved' | 'denied' | 'timeout'>;
  summary: ConfirmationSummary;
  createdAt: number;
}

function generationAssets(result: GenerateImageResult): Array<{ path: string }> {
  const images = result.images?.filter((image) => Boolean(image.imagePath)) ?? [];
  if (images.length > 0) return images.map((image) => ({ path: image.imagePath }));
  return result.imagePath ? [{ path: result.imagePath }] : [];
}

function assertDurableOutcome(request: AutomationSpendRequest): void {
  if (request.errorCode === 'PAYMENT_IDENTITY_UNBOUND')
    throw new AutomationError(
      'PAYMENT_IDENTITY_UNBOUND',
      '所选连接缺少可验证的付款身份，请重新配置连接；不会猜测当前登录账号',
      409,
    );
  if (request.outcome === 'denied')
    throw new AutomationError(
      'CONFIRMATION_DENIED',
      '用户已拒绝本次请求；请使用新的请求键发起新的尝试',
      403,
    );
  if (request.outcome === 'timeout')
    throw new AutomationError(
      'CONFIRMATION_TIMEOUT',
      '本次确认已过期；请使用新的请求键发起新的尝试',
      409,
    );
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
  const submissions = new Map<string, { fingerprint: string; result: Promise<JobRecord> }>();
  const pending = new Map<string, PendingConfirmation>();
  // 在同一 gate 生命周期内保留飞行中成本，避免并发请求重复消费同一份预算。
  // 持久化与跨方案/Skill 的全局预留由宿主负责，不能把本 Map 当作重启保障。
  const reservations = new Map<string, number | null>();
  let unresolvedManagedSpend = false;
  const remainingPoints = () =>
    [...reservations.values()].includes(null)
      ? 0
      : Math.max(
          0,
          host.budget.remainingPoints() -
            [...reservations.values()].reduce((sum: number, points) => sum + (points ?? 0), 0),
        );
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
      throw new AutomationError(
        'INVALID_PARAMS',
        `n 必须是 1–${MAX_GENERATION_N} 的整数（T1 限制）`,
        400,
        { n },
      );
    }
    if (
      parsed.declaredBudgetPoints != null &&
      (!Number.isFinite(parsed.declaredBudgetPoints) || parsed.declaredBudgetPoints < 0)
    ) {
      throw new AutomationError('INVALID_PARAMS', 'declaredBudgetPoints 必须是非负有限数值', 400);
    }
    if (parsed.consent != null && parsed.consent !== 'interactive') {
      throw new AutomationError('INVALID_PARAMS', 'consent 只接受 interactive', 400);
    }
    // 确认期间使用不可被调用方改写的快照；同幂等键随后绑定此快照。
    return structuredClone(parsed);
  }

  function authorizeReferences(body: GenerationRequestBody): LocalImageReference[] {
    const references: LocalImageReference[] = [];
    for (const path of body.referenceImagePaths ?? []) {
      if (!host.authorizeReferencePath(path)) {
        throw new AutomationError(
          'PATH_NOT_ALLOWED',
          '参考图路径不在允许范围内（请先经 /v1/uploads 转存）',
          403,
          { path },
        );
      }
      references.push({
        path,
        name: path.split('/').pop() ?? 'reference',
        source: 'upload',
        mimeType: 'image/png',
        sizeBytes: 0,
      });
    }
    for (const historyId of body.referenceHistoryIds ?? []) {
      const resolved = host.resolveHistoryImage(historyId);
      if (!resolved) {
        throw new AutomationError('NOT_FOUND', '引用的历史产物不存在', 404, { historyId });
      }
      references.push({
        path: resolved.path,
        name: `history-${historyId}`,
        source: 'history',
        historyId,
        mimeType: 'image/png',
        sizeBytes: 0,
      });
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
    spendRequest?: AutomationSpendRequest,
  ): JobRecord {
    const jobId =
      spendRequest?.executionId ?? randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase();
    if (spendRequest && !host.persistence?.begin(spendRequest.id)) {
      return restoreJob(host.persistence?.get(jobId) ?? spendRequest);
    }
    const record: JobRecord = {
      jobId,
      status: 'running',
      startedAt: clock(),
      estimatedPoints: estimate.points,
    };
    jobs.set(jobId, record);
    const finishSpend =
      !spendRequest && estimate.managedByAccount
        ? host.budget.reserve?.(estimate.points)
        : undefined;
    if (!spendRequest && estimate.managedByAccount && !finishSpend) {
      reservations.set(jobId, estimate.points);
    }
    const request = toGenerateRequest(body, estimate, jobId, references);
    void Promise.resolve()
      .then(() =>
        host.run(
          request,
          (progress) => {
            hub.sink.emit({ type: 'generation.progress', payload: { ...progress, jobId } });
          },
          spendRequest,
        ),
      )
      .then(async (result) => {
        if (spendRequest && host.persistence) {
          host.persistence.finish(spendRequest.id, result, clock());
          const stored = host.persistence.get(jobId);
          const evidence = stored ? host.persistence.result(stored) : undefined;
          // The durable call ledger retains evidence even when a late cancel discards output.
          result = { ...result, cost: evidence?.cost, costPoints: evidence?.costPoints };
        }
        const rawPoints = result.costPoints ?? result.cost ?? null;
        const actualPoints =
          rawPoints != null && Number.isFinite(rawPoints) && rawPoints >= 0 ? rawPoints : null;
        try {
          if (!spendRequest && estimate.managedByAccount) {
            if (finishSpend) {
              await finishSpend(actualPoints);
            } else if (actualPoints == null) {
              // 未知费用不能按 0 冲销并重新放出预算；后续请求仍可逐次明确确认。
              unresolvedManagedSpend = true;
            } else {
              await host.budget.settle(actualPoints);
              reservations.delete(jobId);
            }
          }
        } catch (error) {
          // A failed durable settlement cannot reopen automatic budget for another request.
          unresolvedManagedSpend = true;
          throw error;
        }
        record.status =
          result.status === 'success'
            ? 'success'
            : result.status === 'cancelled'
              ? 'cancelled'
              : 'failed';
        record.result = result;
        noteOutcome(record.status);
        if (!spendRequest)
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
            estimatedPoints: estimate.points,
            actualPoints,
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
            costPoints: result.costPoints ?? result.cost ?? null,
            cost: result.cost ?? null,
            costUnit: 'point',
            durationMs: result.durationMs ?? null,
            assets: generationAssets(result),
            error: result.error ?? null,
            actualSize: result.actualSize ?? null,
            sizeMismatch: result.sizeMismatch ?? null,
          },
        });
      })
      .catch(async (error) => {
        if (!spendRequest && estimate.managedByAccount) {
          unresolvedManagedSpend = true;
          try {
            if (finishSpend) await finishSpend(null);
          } catch {
            // Settlement already failed; keep the original failure and unknown protection.
          }
        }
        record.status = 'failed';
        record.result = {
          historyId: jobId,
          status: 'failed',
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        };
        if (spendRequest) {
          try {
            host.persistence?.finish(spendRequest.id, record.result, clock());
          } catch {
            // Durable state/cost remain recoverable; never resend to repair an audit failure.
          }
        }
        noteOutcome('failed');
        if (!spendRequest)
          audit({
            at: clock(),
            action: 'generate_image',
            promptText: body.prompt ?? null,
            params: { providerId: estimate.providerId, n: estimate.n },
            estimatedPoints: estimate.points,
            actualPoints: null,
            approvedVia,
            status: 'failed',
            jobId,
          });
        hub.sink.emit({
          type: 'generation.failed',
          payload: { jobId, status: 'failed', error: record.result.error },
        });
      });
    return record;
  }

  function restoreJob(request: AutomationSpendRequest): JobRecord {
    const existing = jobs.get(request.executionId);
    const result = host.persistence?.result(request);
    if (existing) {
      if (result) {
        existing.status = result.status;
        existing.result = {
          ...result,
          ...existing.result,
          status: result.status,
          cost: result.cost,
          costPoints: result.costPoints,
        };
      }
      return existing;
    }
    const record: JobRecord = {
      jobId: request.executionId,
      status: result?.status ?? 'running',
      startedAt: request.authorizedAt ?? request.createdAt,
      estimatedPoints: request.estimatedPoints,
      ...(result ? { result } : {}),
    };
    jobs.set(record.jobId, record);
    return record;
  }

  function jobPayload(record: JobRecord) {
    return {
      jobId: record.jobId,
      status: record.status,
      startedAt: record.startedAt,
      estimatedPoints: record.estimatedPoints,
      ...(record.result
        ? {
            historyId: record.result.historyId,
            costPoints: record.result.costPoints ?? record.result.cost ?? null,
            cost: record.result.cost ?? null,
            costUnit: 'point',
            durationMs: record.result.durationMs ?? null,
            assets: generationAssets(record.result),
            error: record.result.error ?? null,
            actualSize: record.result.actualSize ?? null,
            sizeMismatch: record.result.sizeMismatch ?? null,
          }
        : {}),
    };
  }

  async function submitGeneration(
    body: GenerationRequestBody,
    idempotencyKey: string | null,
  ): Promise<JobRecord> {
    const restored = idempotencyKey ? host.persistence?.replay(body, idempotencyKey) : null;
    if (restored && (restored.state === 'running' || restored.state === 'terminal')) {
      assertDurableOutcome(restored);
      return restoreJob(restored);
    }
    // 熔断打开期间拒绝花钱提交（只读/轮询不受影响）
    if (clock() < breakerOpenUntil) {
      throw new AutomationError('BREAKER_OPEN', '连续失败过多，生成已临时熔断，请稍后再试', 429, {
        retryAfterMs: breakerOpenUntil - clock(),
      });
    }
    const references = authorizeReferences(body);
    const estimate = host.estimate(body);
    const durable =
      host.persistence?.register(body, estimate, references, idempotencyKey, clock()) ?? undefined;
    if (durable?.state === 'terminal') {
      assertDurableOutcome(durable);
      return restoreJob(durable);
    }
    if (durable?.state === 'running') return restoreJob(durable);
    // b. 非托管 Provider 不计费，自动放行；托管 Provider 按预算覆盖估算；
    //    托管价格未知时不可走预算，必须确认。调用方声明的一次性预算须同时 ≤ 剩余额度。
    const remaining = remainingPoints();
    const declared = body.declaredBudgetPoints;
    const unmeteredProvider = !estimate.managedByAccount;
    const budgetCovered =
      !unresolvedManagedSpend &&
      remaining > 0 &&
      estimate.points != null &&
      estimate.points <= remaining &&
      (declared == null || (estimate.points <= declared && declared <= remaining));
    // 交互同意：人已在本机确认（CLI TTY / --yes），等价 App 卡片放行
    const covered = durable
      ? durable.state === 'authorized'
      : unmeteredProvider || budgetCovered || body.consent === 'interactive';

    if (!covered) {
      // c. 需确认：挂起 + 202
      const confirmationId = durable?.confirmationId ?? randomUUID();
      const summary: ConfirmationSummary = {
        confirmationId,
        providerName: estimate.providerName,
        model: estimate.model,
        n: estimate.n,
        estimatedPoints: estimate.points,
        promptPreview: (body.prompt ?? '').slice(0, 120),
      };
      let resolveOutcome!: (outcome: 'approved' | 'denied' | 'timeout') => void;
      const outcome = new Promise<'approved' | 'denied' | 'timeout'>((resolve) => {
        resolveOutcome = resolve;
      });
      // 一次性 settle：App 卡片、HTTP 回执、超时三路竞争，先到先得；
      // 广播 resolved 事件让其他确认通道（如仍显示的卡片）同步关闭。
      let settled = false;
      const expiresAt = durable?.confirmationExpiresAt ?? clock() + CONFIRMATION_TIMEOUT_MS;
      const settle = (verdict: 'approved' | 'denied' | 'timeout') => {
        if (settled) return false;
        if (clock() >= expiresAt) verdict = 'timeout';
        if (durable && !host.persistence?.confirm(confirmationId, verdict === 'approved', clock()))
          verdict = 'timeout';
        settled = true;
        pending.delete(confirmationId);
        hub.sink.emit({
          type: 'confirmation.resolved',
          payload: { confirmationId, outcome: verdict },
        });
        resolveOutcome(verdict);
        return verdict !== 'timeout';
      };
      const entry: PendingConfirmation = {
        id: confirmationId,
        body,
        idempotencyKey: null,
        resolve: settle,
        outcome,
        summary,
        createdAt: clock(),
      };
      pending.set(confirmationId, entry);
      const timeout = setTimeout(() => settle('timeout'), Math.max(0, expiresAt - clock()));
      hub.sink.emit({ type: 'confirmation.required', payload: summary });
      // 宿主的确认通道（App 卡片）与 HTTP 回执并行竞争，先到先得
      void Promise.resolve()
        .then(() => (settled ? null : host.requestConfirmation(summary)))
        .then((verdict) => {
          if (verdict) settle(verdict);
        })
        .catch(() => {});

      const verdict = await outcome;
      clearTimeout(timeout);
      pending.delete(confirmationId);
      if (!durable && verdict !== 'approved') {
        audit({
          at: clock(),
          action: 'generate_image',
          promptText: body.prompt ?? null,
          params: { providerId: estimate.providerId, n: estimate.n },
          estimatedPoints: estimate.points,
          actualPoints: null,
          approvedVia: verdict,
          status: verdict,
          jobId: null,
        });
      }
      if (verdict === 'timeout') {
        throw new AutomationError(
          'CONFIRMATION_TIMEOUT',
          '等待确认超时（120s），本次生成未执行',
          409,
          { confirmationId },
        );
      }
      if (verdict === 'denied') {
        throw new AutomationError('CONFIRMATION_DENIED', '用户拒绝了本次生成', 403, {
          confirmationId,
        });
      }
    }

    const approvedVia =
      body.consent === 'interactive'
        ? 'consent'
        : unmeteredProvider || budgetCovered
          ? 'budget'
          : 'confirmation';
    const record = launch(body, estimate, references, approvedVia, durable);
    return record;
  }

  const routes: Record<string, AutomationRouteHandler> = {
    // 估算预览（🟢 零成本）：CLI TTY 确认前展示 Provider/模型/张数/预估费用
    'POST /v1/generations/estimate': (context) => {
      const body = validateBody(context);
      const estimate = host.estimate(body);
      return { ...estimate, remainingBudgetPoints: remainingPoints() };
    },

    'POST /v1/generations': async (context) => {
      const body = validateBody(context);
      const idempotencyKey = firstHeader(context, 'idempotency-key');
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify(
            Object.fromEntries(Object.entries(body).sort(([a], [b]) => a.localeCompare(b))),
          ),
        )
        .digest('hex');
      const previous = idempotencyKey ? submissions.get(idempotencyKey) : undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          throw new AutomationError(
            'IDEMPOTENCY_CONFLICT',
            '同一幂等键不能用于不同的生成请求',
            409,
          );
        }
        const record = await previous.result;
        context.json({ ...jobPayload(record), idempotentReplay: true }, 200);
        return;
      }
      // 先冻结幂等条目，再触发确认事件；事件监听器重入也不能二次发送。
      const result = Promise.resolve().then(() => submitGeneration(body, idempotencyKey));
      if (idempotencyKey) submissions.set(idempotencyKey, { fingerprint, result });
      context.json(jobPayload(await result), 202);
    },

    'GET /v1/generations/:jobId': (context) => {
      const persisted = host.persistence?.get(context.params.jobId);
      const record = persisted ? restoreJob(persisted) : jobs.get(context.params.jobId);
      if (!record)
        throw new AutomationError('NOT_FOUND', '生成任务不存在（或已随重启失效）', 404, {
          jobId: context.params.jobId,
        });
      return jobPayload(record);
    },

    'DELETE /v1/generations/:jobId': (context) => {
      const persisted = host.persistence?.get(context.params.jobId);
      const record = persisted ? restoreJob(persisted) : jobs.get(context.params.jobId);
      if (!record)
        throw new AutomationError('NOT_FOUND', '生成任务不存在', 404, {
          jobId: context.params.jobId,
        });
      host.cancel(record.jobId);
      return { jobId: record.jobId, cancelling: true };
    },

    'POST /v1/confirmations/:id': (context) => {
      const body = context.body as { approved?: unknown } | null;
      if (!body || typeof body.approved !== 'boolean') {
        throw new AutomationError('INVALID_PARAMS', 'approved 必须是明确的布尔值', 400);
      }
      const ok = gate.resolveConfirmation(context.params.id, body.approved);
      if (!ok)
        throw new AutomationError('NOT_FOUND', '确认请求不存在或已处理', 404, {
          id: context.params.id,
        });
      return { ok: true };
    },

    'POST /v1/uploads': async (context) => {
      if (!Buffer.isBuffer(context.body)) {
        throw new AutomationError(
          'INVALID_PARAMS',
          '上传体必须是原始图片字节（content-type: image/*）',
          400,
        );
      }
      const contentType = String(context.request.headers['content-type'] ?? '');
      if (!/^image\/(png|jpeg|webp)/.test(contentType)) {
        throw new AutomationError('INVALID_PARAMS', '仅支持 PNG / JPEG / WebP', 400, {
          contentType,
        });
      }
      const name =
        firstHeader(context, 'x-musefold-filename') ??
        `upload.${contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'}`;
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
      return entry.resolve(approved ? 'approved' : 'denied');
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
