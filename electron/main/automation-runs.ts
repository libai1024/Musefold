// 控制面的方案/Skill 运行路由（V04 P3）：复用真实执行机器
// （runDesignScheme / executeSkillRuntime），花钱动作走与生图相同的
// 预算/确认/交互同意策略；运行注册表支撑轮询与取消。

import { ulid } from 'ulid';
import { AutomationError, type AutomationRouteHandler } from '@musefold/automation-server';
import type { EventHub } from '@musefold/core';
import type { SpendAuditEntry } from '@musefold/core/services/audit';
import { getDb } from '@musefold/core/db/index';
import { getDesignSchemeDb } from '@musefold/core/db/design-scheme';
import type { GenerateImageRequest } from '@shared/types/providers';
import { estimateProviderCost } from '../settings/pricing';
import { ACCOUNT_QUOTA_PER_USD, resolveRatioOptionById } from '@shared/constants';
import {
  remainingAutomationBudgetCents,
  settleAutomationBudget,
} from '../settings/automation';
import { getMusefoldCore } from './core-instance';
import { runDesignScheme } from './design-scheme/run-session';
import {
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
  costCents: number | null;
  error?: { code: string; message: string } | null;
  /** 方案运行的 dsr_ 运行号 / Skill 的执行轨迹摘要 */
  runId?: string;
  stepSummaries: string[];
  controller: AbortController;
}

const externalRuns = new Map<string, ExternalRun>();

interface SpendAuthorizer {
  (summary: { providerName: string; model: string; n: number; estimatedCents: number | null; promptPreview: string }): Promise<void>;
}

interface ProviderPick {
  id: string;
  name: string;
  model: string;
  managedBy: string | null;
}

function pickProvider(providerId?: string): ProviderPick {
  const db = getDb();
  const row = (providerId
    ? db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId)
    : db.prepare('SELECT * FROM providers WHERE is_active = 1 LIMIT 1').get()) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new AutomationError('INVALID_STATE', providerId ? '指定的 Provider 不存在' : '没有激活的图像 Provider', 422);
  }
  return {
    id: row.id as string,
    name: row.name as string,
    model: row.model as string,
    managedBy: (row.managed_by as string | null) ?? null,
  };
}

/**
 * 托管 Provider 的 pricing 存的是 quota point（500000 = $1，按 ¥1 计费），
 * 而预算闸门与确认卡都以人民币「分」为口径——不换算会把 0.4 积分显示成 ¥200。
 */
function estimateCentsFor(provider: ProviderPick, n: number): number | null {
  const raw = estimateProviderCost(provider.id, { n });
  if (raw == null || provider.managedBy !== 'account') return raw;
  return Math.round((raw * 100) / ACCOUNT_QUOTA_PER_USD);
}

function runPayload(run: ExternalRun) {
  return {
    jobId: run.id,
    kind: run.kind,
    status: run.status,
    startedAt: run.startedAt,
    assets: run.assets,
    costCents: run.costCents,
    stepSummaries: run.stepSummaries.slice(-12),
    ...(run.runId ? { runId: run.runId } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function buildTemplate(provider: ProviderPick, jobId: string, ratioId: string | undefined): GenerateImageRequest {
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

export function createExternalRunRoutes(
  hub: Pick<EventHub, 'sink'>,
  authorizeSpend: SpendAuthorizer,
  recordAudit: ExternalAuditRecorder = () => {},
): Record<string, AutomationRouteHandler> {
  return {
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
        throw new AutomationError('NOT_FOUND', '设计方案不存在（或尚未转正）', 404, { schemeId: context.params.id });
      }
      const n = body.n ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > MAX_RUN_N) {
        throw new AutomationError('INVALID_PARAMS', `n 必须是 1–${MAX_RUN_N} 的整数`, 400, { n });
      }
      const provider = pickProvider(body.providerId);
      const estimated = estimateCentsFor(provider, n);
      const approvedVia: 'budget' | 'confirmation' | 'consent' =
        body.consent === 'interactive' ? 'consent' : externalSpendCovered(estimated) ? 'budget' : 'confirmation';
      if (body.consent !== 'interactive') {
        await authorizeSpend({
          providerName: provider.name,
          model: provider.model,
          n,
          estimatedCents: estimated,
          promptPreview: `运行方案「${detail.summary.name}」`,
        });
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
        costCents: null,
        stepSummaries: [],
        controller,
      };
      externalRuns.set(executionId, run);

      void runDesignScheme(
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
              run.stepSummaries.push(`${event.item.title}${event.item.detail ? `：${event.item.detail}` : ''}`);
              hub.sink.emit({ type: 'scheme.run.step', payload: { jobId: executionId, ...event.item } });
            }
          },
          sendProgress: (progress) => {
            hub.sink.emit({ type: 'generation.progress', payload: { ...progress, jobId: executionId } });
          },
          signal: controller.signal,
        },
      )
        .then((result) => {
          if (!result.ok) {
            run.status = controller.signal.aborted ? 'cancelled' : 'failed';
            run.error = { code: result.error.code, message: result.error.message };
          } else {
            const generations = result.data.generations;
            const succeeded = generations.filter((generation) => generation.result.status === 'success');
            run.runId = result.data.runId;
            run.assets = succeeded
              .map((generation) => generation.result.imagePath)
              .filter((path): path is string => Boolean(path))
              .map((path) => ({ path }));
            const cost = generations.reduce((sum, generation) => sum + (generation.result.costCents ?? generation.result.cost ?? 0), 0);
            run.costCents = cost || null;
            run.status = succeeded.length > 0 ? 'success' : controller.signal.aborted ? 'cancelled' : 'failed';
            if (cost > 0) settleAutomationBudget(cost);
          }
          recordAudit({
            at: Date.now(),
            action: 'run_scheme',
            promptText: body.brief ?? null,
            params: { schemeId: detail.summary.id, inputs: body.inputs ?? {}, n, providerId: provider.id },
            estimatedCents: estimated,
            actualCents: run.costCents,
            approvedVia,
            status: run.status,
            jobId: run.id,
          });
          hub.sink.emit({
            type: run.status === 'success' ? 'scheme.run.completed' : 'scheme.run.failed',
            payload: runPayload(run),
          });
        })
        .catch((error) => {
          run.status = 'failed';
          run.error = { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
          hub.sink.emit({ type: 'scheme.run.failed', payload: runPayload(run) });
        });

      context.json(runPayload(run), 202);
    },

    'GET /v1/scheme-runs/:id': (context) => {
      const run = externalRuns.get(context.params.id);
      if (!run || run.kind !== 'scheme') throw new AutomationError('NOT_FOUND', '方案运行不存在', 404);
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
      if (!body.prompt?.trim()) {
        throw new AutomationError('INVALID_PARAMS', 'prompt 为必填', 400);
      }
      const n = body.n ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > MAX_RUN_N) {
        throw new AutomationError('INVALID_PARAMS', `n 必须是 1–${MAX_RUN_N} 的整数`, 400, { n });
      }
      const provider = pickProvider(body.providerId);
      const estimated = estimateCentsFor(provider, n);
      const approvedVia: 'budget' | 'confirmation' | 'consent' =
        body.consent === 'interactive' ? 'consent' : externalSpendCovered(estimated) ? 'budget' : 'confirmation';
      if (body.consent !== 'interactive') {
        await authorizeSpend({
          providerName: provider.name,
          model: provider.model,
          n,
          estimatedCents: estimated,
          promptPreview: `运行 GitHub Skill：${body.url}`,
        });
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
        costCents: null,
        stepSummaries: [],
        controller,
      };
      externalRuns.set(executionId, run);

      void (async () => {
        const prepared = await prepareGithubSkillRuntime({ repositoryUrl: body.url! });
        if (!prepared.ok) {
          run.status = 'failed';
          run.error = { code: prepared.error.code, message: prepared.error.message };
          hub.sink.emit({ type: 'skill.runtime.failed', payload: runPayload(run) });
          return;
        }
        const execution = await executeSkillRuntime(
          {
            runtimeId: prepared.data.runtimeId,
            executionId,
            userPrompt: body.prompt!,
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
                hub.sink.emit({ type: 'skill.runtime.delta', payload: { jobId: executionId, ...payload.item } });
              }
            },
            sendProgress: (progress) => {
              hub.sink.emit({ type: 'generation.progress', payload: { ...progress, jobId: executionId } });
            },
          },
        );
        if (!execution.ok) {
          run.status = controller.signal.aborted ? 'cancelled' : 'failed';
          run.error = { code: execution.error.code, message: execution.error.message };
        } else {
          const generations = execution.data.generations;
          const succeeded = generations.filter((generation) => generation.result.status === 'success');
          run.assets = succeeded
            .map((generation) => generation.result.imagePath)
            .filter((path): path is string => Boolean(path))
            .map((path) => ({ path }));
          const cost = generations.reduce((sum, generation) => sum + (generation.result.costCents ?? generation.result.cost ?? 0), 0);
          run.costCents = cost || null;
          run.status = succeeded.length > 0 ? 'success' : controller.signal.aborted ? 'cancelled' : 'failed';
          if (cost > 0) settleAutomationBudget(cost);
        }
        recordAudit({
          at: Date.now(),
          action: 'run_github_skill',
          promptText: body.prompt ?? null,
          params: { url: body.url, n, providerId: provider.id },
          estimatedCents: estimated,
          actualCents: run.costCents,
          approvedVia,
          status: run.status,
          jobId: run.id,
        });
        hub.sink.emit({
          type: run.status === 'success' ? 'skill.runtime.completed' : 'skill.runtime.failed',
          payload: runPayload(run),
        });
      })().catch((error) => {
        run.status = 'failed';
        run.error = { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
        hub.sink.emit({ type: 'skill.runtime.failed', payload: runPayload(run) });
      });

      context.json(runPayload(run), 202);
    },

    'GET /v1/skill-runs/:id': (context) => {
      const run = externalRuns.get(context.params.id);
      if (!run || run.kind !== 'skill') throw new AutomationError('NOT_FOUND', 'Skill 运行不存在', 404);
      return runPayload(run);
    },

    'DELETE /v1/scheme-runs/:id': (context) => cancelExternalRun(context.params.id, 'scheme'),
    'DELETE /v1/skill-runs/:id': (context) => cancelExternalRun(context.params.id, 'skill'),
  };
}

function cancelExternalRun(id: string, kind: 'scheme' | 'skill') {
  const run = externalRuns.get(id);
  if (!run || run.kind !== kind) {
    throw new AutomationError('NOT_FOUND', kind === 'scheme' ? '方案运行不存在' : 'Skill 运行不存在', 404);
  }
  run.controller.abort();
  return { jobId: run.id, cancelling: true };
}

/** 供预算判定复用（与生图闸门一致的口径）。 */
export function externalSpendCovered(estimatedCents: number | null): boolean {
  return estimatedCents != null && estimatedCents <= remainingAutomationBudgetCents();
}
