// 控制面的方案/Skill 运行路由（V04 P3）：复用真实执行机器
// （runDesignScheme / executeSkillRuntime），花钱动作走与生图相同的
// 预算/确认/交互同意策略；运行注册表支撑轮询与取消。

import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import {
  AutomationError,
  type AutomationRouteHandler,
  type GenerationBudget,
} from '@musefold/automation-server';
import type { EventHub } from '@musefold/core';
import type { SpendAuditEntry } from '@musefold/core/services/audit';
import { getDb } from '@musefold/core/db/index';
import { getDesignSchemeDb } from '@musefold/core/db/design-scheme';
import type {
  GenerateImageRequest,
  GenerateImageResult,
} from '@musefold/desktop-contracts/providers';
import { estimateProviderCost } from '../settings/pricing';
import { resolveRatioOptionById } from '@musefold/domain/constants';
import { remainingAutomationBudgetPoints, settleAutomationBudget } from '../settings/automation';
import { getMusefoldCore } from './core-instance';
import { runDesignScheme } from './design-scheme/run-session';
import {
  cancelSkillRuntimeExecution,
  executeSkillRuntime,
  prepareGithubSkillRuntime,
} from './ipc/skill-runtime';

const MAX_RUN_N = 4;

interface ExternalRun {
  id: string;
  kind: 'scheme' | 'skill';
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: number;
  assets: Array<{ path: string }>;
  costPoints: number | null;
  error?: { code: string; message: string } | null;
  /** 方案运行的 dsr_ 运行号 / Skill 的执行轨迹摘要 */
  runId?: string;
  stepSummaries: string[];
  controller: AbortController;
  jobIds: string[];
}

const externalRuns = new Map<string, ExternalRun>();

type SpendAuthorizer = (summary: {
  providerName: string;
  model: string;
  n: number;
  estimatedPoints: number | null;
  managedByAccount: boolean;
  promptPreview: string;
}) => Promise<void>;

interface ProviderPick {
  id: string;
  name: string;
  model: string;
  managedBy: string | null;
}

function pickProvider(providerId?: string): ProviderPick {
  const db = getDb();
  const row = (
    providerId
      ? db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId)
      : db.prepare('SELECT * FROM providers WHERE is_active = 1 LIMIT 1').get()
  ) as Record<string, unknown> | undefined;
  if (!row) {
    throw new AutomationError(
      'INVALID_STATE',
      providerId ? '指定的 Provider 不存在' : '没有激活的图像 Provider',
      422,
    );
  }
  return {
    id: row.id as string,
    name: row.name as string,
    model: row.model as string,
    managedBy: (row.managed_by as string | null) ?? null,
  };
}

function estimatePointsFor(provider: ProviderPick, n: number): number | null {
  return estimateProviderCost(provider.id, { n });
}

function runPayload(run: ExternalRun) {
  return {
    jobId: run.id,
    kind: run.kind,
    status: run.status,
    startedAt: run.startedAt,
    assets: run.assets,
    costPoints: run.costPoints,
    stepSummaries: run.stepSummaries.slice(-12),
    ...(run.runId ? { runId: run.runId } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function buildTemplate(
  provider: ProviderPick,
  jobId: string,
  ratioId: string | undefined,
): GenerateImageRequest {
  const ratio = ratioId && ratioId !== 'auto' ? resolveRatioOptionById(ratioId) : null;
  return {
    jobId,
    providerId: provider.id,
    model: provider.model,
    prompt: '',
    size: ratio?.size ?? '1024x1024',
    ...(ratio ? { aspectRatio: ratio.ratio } : {}),
    quality: 'auto',
    n: 1,
  };
}

type ExternalAuditRecorder = (entry: Omit<SpendAuditEntry, 'caller'>) => void;

function aggregateCost(
  results: ReadonlyArray<Pick<GenerateImageResult, 'costPoints' | 'cost'>>,
): number | null {
  if (results.length === 0) return null;
  let sum = 0;
  for (const result of results) {
    const points = result.costPoints ?? result.cost;
    if (points == null || !Number.isFinite(points) || points < 0) return null;
    sum += points;
  }
  return sum;
}

function canonicalInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalInput);
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalInput(item)]),
    );
  }
  return value;
}

export function createExternalRunRoutes(
  hub: Pick<EventHub, 'sink'>,
  authorizeSpend: SpendAuthorizer,
  recordAudit: ExternalAuditRecorder = () => {},
  budget: GenerationBudget = {
    remainingPoints: remainingAutomationBudgetPoints,
    settle: settleAutomationBudget,
  },
): Record<string, AutomationRouteHandler> {
  const submissions = new Map<
    string,
    { fingerprint: string; response: Promise<{ payload: unknown; status: number }> }
  >();
  const audit = (entry: Parameters<ExternalAuditRecorder>[0]) => {
    try {
      recordAudit(entry);
    } catch {
      /* 审计持久化故障不得触发重复执行。 */
    }
  };
  const authorize = async (
    summary: Parameters<SpendAuthorizer>[0],
    entry: Pick<SpendAuditEntry, 'action' | 'promptText' | 'params'>,
  ) => {
    try {
      await authorizeSpend(summary);
    } catch (error) {
      const outcome =
        error instanceof AutomationError && error.code === 'CONFIRMATION_TIMEOUT'
          ? 'timeout'
          : error instanceof AutomationError && error.code === 'CONFIRMATION_DENIED'
            ? 'denied'
            : 'failed';
      audit({
        ...entry,
        at: Date.now(),
        estimatedPoints: summary.estimatedPoints,
        actualPoints: null,
        approvedVia: outcome === 'failed' ? 'confirmation' : outcome,
        status: outcome,
        jobId: null,
      });
      throw error;
    }
  };
  const terminalAudit = (
    run: ExternalRun,
    entry: Pick<
      SpendAuditEntry,
      'action' | 'promptText' | 'params' | 'estimatedPoints' | 'approvedVia'
    >,
    managed: boolean,
  ) => {
    const finish = managed ? budget.reserve?.(entry.estimatedPoints) : undefined;
    let recorded = false;
    return async () => {
      if (recorded) return;
      recorded = true;
      if (managed) {
        if (finish) await finish(run.costPoints);
        else if (run.costPoints != null) await budget.settle(run.costPoints);
      }
      audit({
        ...entry,
        at: Date.now(),
        actualPoints: run.costPoints,
        status: run.status === 'running' ? 'failed' : run.status,
        jobId: run.id,
      });
    };
  };
  const routes: Record<string, AutomationRouteHandler> = {
    // —— 方案运行（🔴，暴露矩阵 run_scheme） ——
    'POST /v1/schemes/:id/runs': async (context) => {
      const body = (context.body ?? {}) as {
        inputs?: Record<string, string>;
        brief?: string;
        ratioId?: string;
        n?: number;
        priorityMode?: 'scheme_first' | 'user_first' | 'agent_mediated';
        providerId?: string;
        consent?: 'interactive';
      };
      const core = getMusefoldCore();
      const detail = core.schemes.get(context.params.id);
      if (!detail) {
        throw new AutomationError('NOT_FOUND', '设计方案不存在（或尚未转正）', 404, {
          schemeId: context.params.id,
        });
      }
      const n = body.n ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > MAX_RUN_N) {
        throw new AutomationError('INVALID_PARAMS', `n 必须是 1–${MAX_RUN_N} 的整数`, 400, { n });
      }
      const provider = pickProvider(body.providerId);
      const estimated = estimatePointsFor(provider, n);
      const managedByAccount = provider.managedBy === 'account';
      const approvedVia: 'budget' | 'confirmation' | 'consent' =
        body.consent === 'interactive'
          ? 'consent'
          : externalSpendCovered(estimated, managedByAccount, budget.remainingPoints())
            ? 'budget'
            : 'confirmation';
      if (approvedVia === 'confirmation') {
        await authorize(
          {
            providerName: provider.name,
            model: provider.model,
            n,
            estimatedPoints: estimated,
            managedByAccount,
            promptPreview: `运行方案「${detail.summary.name}」`,
          },
          {
            action: 'run_scheme',
            promptText: body.brief ?? null,
            params: { schemeId: detail.summary.id, n, providerId: provider.id },
          },
        );
      }

      const executionId = `ext_${ulid()}`;
      const jobIds = Array.from({ length: n }, () => ulid());
      const controller = new AbortController();
      const run: ExternalRun = {
        id: executionId,
        kind: 'scheme',
        status: 'running',
        startedAt: Date.now(),
        assets: [],
        costPoints: null,
        stepSummaries: [],
        controller,
        jobIds,
      };
      externalRuns.set(executionId, run);
      const finish = terminalAudit(
        run,
        {
          action: 'run_scheme',
          promptText: body.brief ?? null,
          params: {
            schemeId: detail.summary.id,
            inputs: body.inputs ?? {},
            n,
            providerId: provider.id,
          },
          estimatedPoints: estimated,
          approvedVia,
        },
        managedByAccount,
      );

      void Promise.resolve()
        .then(() =>
          runDesignScheme(
            {
              executionId,
              schemeId: detail.summary.id,
              revisionId: detail.summary.currentRevisionId,
              mode: 'formal',
              priorityMode: body.priorityMode,
              brief: body.brief ?? '',
              inputValues: body.inputs ?? {},
              generation: {
                requestTemplate: buildTemplate(provider, jobIds[0], body.ratioId),
                jobIds,
                providerName: provider.name,
                ratioId: body.ratioId ?? 'auto',
              },
            },
            {
              db: getDesignSchemeDb(),
              emit: (event) => {
                if (event.kind === 'trace') {
                  run.stepSummaries.push(
                    `${event.item.title}${event.item.detail ? `：${event.item.detail}` : ''}`,
                  );
                  hub.sink.emit({
                    type: 'scheme.run.step',
                    payload: { jobId: executionId, ...event.item },
                  });
                }
              },
              sendProgress: (progress) => {
                hub.sink.emit({
                  type: 'generation.progress',
                  payload: { ...progress, jobId: executionId },
                });
              },
              signal: controller.signal,
            },
          ),
        )
        .then(async (result) => {
          if (!result.ok) {
            run.status = controller.signal.aborted ? 'cancelled' : 'failed';
            run.error = { code: result.error.code, message: result.error.message };
          } else {
            const generations = result.data.generations;
            const succeeded = generations.filter(
              (generation) => generation.result.status === 'success',
            );
            run.runId = result.data.runId;
            run.assets = succeeded
              .map((generation) => generation.result.imagePath)
              .filter((path): path is string => Boolean(path))
              .map((path) => ({ path }));
            run.costPoints = aggregateCost(generations.map((generation) => generation.result));
            run.status = controller.signal.aborted
              ? 'cancelled'
              : succeeded.length > 0
                ? 'success'
                : 'failed';
          }
          await finish();
          hub.sink.emit({
            type: run.status === 'success' ? 'scheme.run.completed' : 'scheme.run.failed',
            payload: runPayload(run),
          });
        })
        .catch(async (error) => {
          run.status = controller.signal.aborted ? 'cancelled' : 'failed';
          run.error = {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : String(error),
          };
          await finish();
          hub.sink.emit({ type: 'scheme.run.failed', payload: runPayload(run) });
        });

      context.json(runPayload(run), 202);
    },

    'GET /v1/scheme-runs/:id': (context) => {
      const run = externalRuns.get(context.params.id);
      if (run?.kind !== 'scheme') throw new AutomationError('NOT_FOUND', '方案运行不存在', 404);
      return runPayload(run);
    },

    // —— GitHub Skill 运行（🔴，暴露矩阵 run_github_skill） ——
    'POST /v1/skills/github/run': async (context) => {
      const body = (context.body ?? {}) as {
        url?: string;
        prompt?: string;
        n?: number;
        ratioId?: string;
        providerId?: string;
        consent?: 'interactive';
      };
      if (!body.url || !/^https:\/\/github\.com\//.test(body.url)) {
        throw new AutomationError('INVALID_PARAMS', 'url 必须是公开 GitHub 仓库地址', 400);
      }
      const repositoryUrl = body.url;
      if (!body.prompt?.trim()) {
        throw new AutomationError('INVALID_PARAMS', 'prompt 为必填', 400);
      }
      const userPrompt = body.prompt;
      const n = body.n ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > MAX_RUN_N) {
        throw new AutomationError('INVALID_PARAMS', `n 必须是 1–${MAX_RUN_N} 的整数`, 400, { n });
      }
      const provider = pickProvider(body.providerId);
      const estimated = estimatePointsFor(provider, n);
      const managedByAccount = provider.managedBy === 'account';
      const approvedVia: 'budget' | 'confirmation' | 'consent' =
        body.consent === 'interactive'
          ? 'consent'
          : externalSpendCovered(estimated, managedByAccount, budget.remainingPoints())
            ? 'budget'
            : 'confirmation';
      if (approvedVia === 'confirmation') {
        await authorize(
          {
            providerName: provider.name,
            model: provider.model,
            n,
            estimatedPoints: estimated,
            managedByAccount,
            promptPreview: `运行 GitHub Skill：${body.url}`,
          },
          {
            action: 'run_github_skill',
            promptText: body.prompt ?? null,
            params: { url: body.url, n, providerId: provider.id },
          },
        );
      }

      const executionId = `ext_${ulid()}`;
      const jobIds = Array.from({ length: n }, () => ulid());
      const controller = new AbortController();
      const run: ExternalRun = {
        id: executionId,
        kind: 'skill',
        status: 'running',
        startedAt: Date.now(),
        assets: [],
        costPoints: null,
        stepSummaries: [],
        controller,
        jobIds,
      };
      externalRuns.set(executionId, run);
      const finish = terminalAudit(
        run,
        {
          action: 'run_github_skill',
          promptText: body.prompt ?? null,
          params: { url: body.url, n, providerId: provider.id },
          estimatedPoints: estimated,
          approvedVia,
        },
        managedByAccount,
      );

      void (async () => {
        const prepared = await prepareGithubSkillRuntime({ repositoryUrl });
        if (!prepared.ok || controller.signal.aborted) {
          run.status = controller.signal.aborted ? 'cancelled' : 'failed';
          if (!prepared.ok)
            run.error = { code: prepared.error.code, message: prepared.error.message };
          await finish();
          hub.sink.emit({ type: 'skill.runtime.failed', payload: runPayload(run) });
          return;
        }
        const execution = await executeSkillRuntime(
          {
            runtimeId: prepared.data.runtimeId,
            executionId,
            userPrompt,
            userImages: [],
            availableImageSlots: 16,
            generation: {
              requestTemplate: buildTemplate(provider, jobIds[0], body.ratioId),
              jobIds,
              providerName: provider.name,
              ratioId: body.ratioId ?? 'auto',
            },
          },
          {
            emit: (payload) => {
              if (payload.kind === 'trace') {
                run.stepSummaries.push(payload.item.title);
                hub.sink.emit({
                  type: 'skill.runtime.delta',
                  payload: { jobId: executionId, ...payload.item },
                });
              }
            },
            sendProgress: (progress) => {
              hub.sink.emit({
                type: 'generation.progress',
                payload: { ...progress, jobId: executionId },
              });
            },
          },
        );
        if (!execution.ok) {
          run.status = controller.signal.aborted ? 'cancelled' : 'failed';
          run.error = { code: execution.error.code, message: execution.error.message };
        } else {
          const generations = execution.data.generations;
          const succeeded = generations.filter(
            (generation) => generation.result.status === 'success',
          );
          run.assets = succeeded
            .map((generation) => generation.result.imagePath)
            .filter((path): path is string => Boolean(path))
            .map((path) => ({ path }));
          run.costPoints = aggregateCost(generations.map((generation) => generation.result));
          run.status = controller.signal.aborted
            ? 'cancelled'
            : succeeded.length > 0
              ? 'success'
              : 'failed';
        }
        await finish();
        hub.sink.emit({
          type: run.status === 'success' ? 'skill.runtime.completed' : 'skill.runtime.failed',
          payload: runPayload(run),
        });
      })().catch(async (error) => {
        run.status = controller.signal.aborted ? 'cancelled' : 'failed';
        run.error = {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error),
        };
        await finish();
        hub.sink.emit({ type: 'skill.runtime.failed', payload: runPayload(run) });
      });

      context.json(runPayload(run), 202);
    },

    'GET /v1/skill-runs/:id': (context) => {
      const run = externalRuns.get(context.params.id);
      if (run?.kind !== 'skill') throw new AutomationError('NOT_FOUND', 'Skill 运行不存在', 404);
      return runPayload(run);
    },

    'DELETE /v1/scheme-runs/:id': (context) => cancelExternalRun(context.params.id, 'scheme'),
    'DELETE /v1/skill-runs/:id': (context) => cancelExternalRun(context.params.id, 'skill'),
  };
  for (const route of ['POST /v1/schemes/:id/runs', 'POST /v1/skills/github/run']) {
    const handler = routes[route];
    routes[route] = async (context) => {
      const body = structuredClone(context.body ?? {});
      const keyHeader = context.request.headers['idempotency-key'];
      const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
      if (!key) return handler({ ...context, body });
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(canonicalInput({ route, params: context.params, body })))
        .digest('hex');
      const previous = submissions.get(key);
      if (previous && previous.fingerprint !== fingerprint) {
        throw new AutomationError('IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同的运行请求', 409);
      }
      const response =
        previous?.response ??
        Promise.resolve().then(async () => {
          let payload: unknown;
          let status = 200;
          await handler({
            ...context,
            body,
            json: (value, code = 200) => {
              payload = value;
              status = code;
            },
          });
          return { payload, status };
        });
      if (!previous) submissions.set(key, { fingerprint, response });
      const result = await response;
      const jobId = (result.payload as { jobId?: string })?.jobId;
      const run = jobId ? externalRuns.get(jobId) : undefined;
      context.json(
        previous && run ? { ...runPayload(run), idempotentReplay: true } : result.payload,
        previous ? 200 : result.status,
      );
    };
  }
  return routes;
}

function cancelExternalRun(id: string, kind: 'scheme' | 'skill') {
  const run = externalRuns.get(id);
  if (!run || run.kind !== kind) {
    throw new AutomationError(
      'NOT_FOUND',
      kind === 'scheme' ? '方案运行不存在' : 'Skill 运行不存在',
      404,
    );
  }
  if (run.status !== 'running') return { jobId: run.id, cancelling: false };
  run.controller.abort();
  if (run.kind === 'skill') cancelSkillRuntimeExecution(run.id);
  for (const jobId of run.jobIds) getMusefoldCore().generation.cancel(jobId);
  return { jobId: run.id, cancelling: true };
}

/**
 * 供预算判定复用（与生图闸门一致的口径）。
 * v0.6：非托管 Provider 视为不计费，自动放行；托管 Provider 仍按预算覆盖估算。
 */
export function externalSpendCovered(
  estimatedPoints: number | null,
  managedByAccount: boolean,
  remainingPoints = remainingAutomationBudgetPoints(),
): boolean {
  if (!managedByAccount) return true;
  return (
    remainingPoints > 0 &&
    estimatedPoints != null &&
    Number.isFinite(estimatedPoints) &&
    estimatedPoints >= 0 &&
    estimatedPoints <= remainingPoints
  );
}
