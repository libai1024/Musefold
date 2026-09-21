// v2.5 桌面使用统计域桥(ui-parity 07-05):
// 从 generation_runs + generated_assets 聚合,providers 表补渠道 label。
// 只回契约形状,不含路径。

import {
  type UsageRange,
  type UsageSummary,
  type UsageSummaryQuery,
  assembleUsageByDay,
  assembleUsageByModel,
  classifyUsageRunStatus,
  resolveUsageModelLabel,
  usageCostTotal,
  usageHostTimeZone,
  usageSuccessRate,
  usageSummaryQuerySchema,
  usageSummarySchema,
  usageWindow,
} from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import type { MethodDef } from './envelope';

type RunAggRow = {
  status: string;
  actual_cost: number | null;
  provider_id: string;
  created_at: number;
  model: string;
  params_json: string;
};

type ProviderNameRow = { id: string; name: string };

/** 桌面模型:优先 generation_runs.model,空串再读 params_json.model。 */
export function resolveDesktopUsageModel(model: string, paramsJson: string): string {
  const fromColumn = model.trim();
  if (fromColumn) return resolveUsageModelLabel(fromColumn);
  try {
    const params = JSON.parse(paramsJson) as { model?: unknown };
    if (typeof params.model === 'string' && params.model.trim()) {
      return resolveUsageModelLabel(params.model);
    }
  } catch {
    // 坏 JSON 不阻断聚合。
  }
  return resolveUsageModelLabel(null);
}

/**
 * 桌面使用统计组装。timeZone 默认 UTC:单测注入固定 now + UTC,避免 CI 宿主时区漂移。
 * summarize 生产路径传入宿主本地时区。
 */
export function assembleDesktopUsageSummary(
  range: UsageRange,
  nowMs: number,
  runs: readonly RunAggRow[],
  imageCount: number,
  providerNames: ReadonlyMap<string, string>,
  timeZone = 'UTC',
): UsageSummary {
  const window = usageWindow(range, nowMs);
  let succeededCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  const costs: Array<number | null> = [];
  const groups = new Map<
    string,
    { providerId: string; generationCount: number; costs: Array<number | null> }
  >();

  for (const run of runs) {
    const outcome = classifyUsageRunStatus(run.status);
    if (outcome === 'succeeded') succeededCount += 1;
    else if (outcome === 'failed') failedCount += 1;
    else if (outcome === 'cancelled') cancelledCount += 1;
    costs.push(run.actual_cost);

    const group = groups.get(run.provider_id) ?? {
      providerId: run.provider_id,
      generationCount: 0,
      costs: [],
    };
    group.generationCount += 1;
    group.costs.push(run.actual_cost);
    groups.set(run.provider_id, group);
  }

  const byProvider = [...groups.values()]
    .map((group) => ({
      providerId: group.providerId,
      label: providerNames.get(group.providerId)?.trim() || group.providerId,
      generationCount: group.generationCount,
      costPoints: usageCostTotal(group.costs),
    }))
    .sort(
      (left, right) =>
        right.generationCount - left.generationCount || left.label.localeCompare(right.label),
    );

  return usageSummarySchema.parse({
    range,
    from: window.from,
    to: window.to,
    generationCount: runs.length,
    succeededCount,
    failedCount,
    cancelledCount,
    imageCount,
    costPoints: usageCostTotal(costs),
    successRate: usageSuccessRate(succeededCount, failedCount, cancelledCount),
    byProvider,
    byDay: assembleUsageByDay(
      range,
      nowMs,
      runs.map((run) => ({
        createdAtMs: run.created_at,
        status: run.status,
        costPoints: run.actual_cost,
      })),
      timeZone,
    ),
    byModel: assembleUsageByModel(
      runs.map((run) => ({
        model: resolveDesktopUsageModel(run.model, run.params_json),
        costPoints: run.actual_cost,
      })),
    ),
  });
}

function loadProviderNames(): Map<string, string> {
  const rows = getDb().prepare('SELECT id, name FROM providers').all() as ProviderNameRow[];
  return new Map(rows.map((row) => [row.id, row.name]));
}

function summarize(range: UsageRange, nowMs = Date.now()): UsageSummary {
  const window = usageWindow(range, nowMs);
  const runs = getDb()
    .prepare(
      `SELECT status, actual_cost, provider_id, created_at, model, params_json
       FROM generation_runs
       WHERE deleted_at IS NULL AND created_at >= ? AND created_at <= ?`,
    )
    .all(window.fromMs, window.toMs) as RunAggRow[];
  const imageRow = getDb()
    .prepare(
      `SELECT COUNT(*) AS image_count
       FROM generated_assets a
       INNER JOIN generation_runs r ON r.id = a.run_id
       WHERE r.deleted_at IS NULL
         AND r.created_at >= ? AND r.created_at <= ?
         AND a.status = 'available'`,
    )
    .get(window.fromMs, window.toMs) as { image_count: number };
  return assembleDesktopUsageSummary(
    range,
    nowMs,
    runs,
    Number(imageRow.image_count),
    loadProviderNames(),
    usageHostTimeZone(),
  );
}

export function buildUsageDomainMethods(): Record<string, MethodDef> {
  return {
    'usage.summary': {
      input: usageSummaryQuerySchema,
      handle: async (input) => {
        const { range } = input as UsageSummaryQuery;
        return summarize(range);
      },
    },
  };
}
