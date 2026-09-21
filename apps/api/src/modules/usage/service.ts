import {
  type UsageRange,
  type UsageSummary,
  assembleUsageByDay,
  assembleUsageByModel,
  classifyUsageRunStatus,
  usageCostTotal,
  usageHostTimeZone,
  usageSuccessRate,
  usageSummarySchema,
  usageWindow,
} from '@musefold/contracts';
import { type MusefoldDatabase, generationAssets, generationRuns } from '@musefold/db';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';

const CLOUD_PROVIDER_LABEL = 'Musefold 云生图';

type RunRow = {
  status: string;
  costPoints: number | null;
  providerModel: string | null;
  createdAt: Date | string | number;
};

function createdAtMs(value: Date | string | number): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 云端使用统计组装。timeZone 默认 UTC:单测注入固定 now + UTC,避免 CI 宿主时区漂移。
 * UsageService 生产路径传入宿主本地时区。
 */
export function assembleUsageSummary(
  range: UsageRange,
  nowMs: number,
  runs: readonly RunRow[],
  imageCount: number,
  timeZone = 'UTC',
): UsageSummary {
  const window = usageWindow(range, nowMs);
  let succeededCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  const costs: Array<number | null> = [];
  const groups = new Map<
    string,
    {
      providerId: string | null;
      label: string;
      generationCount: number;
      costs: Array<number | null>;
    }
  >();

  for (const run of runs) {
    const outcome = classifyUsageRunStatus(run.status);
    if (outcome === 'succeeded') succeededCount += 1;
    else if (outcome === 'failed') failedCount += 1;
    else if (outcome === 'cancelled') cancelledCount += 1;
    costs.push(run.costPoints);

    const label = run.providerModel?.trim() || CLOUD_PROVIDER_LABEL;
    const key = run.providerModel ?? '';
    const group = groups.get(key) ?? {
      providerId: null,
      label,
      generationCount: 0,
      costs: [],
    };
    group.generationCount += 1;
    group.costs.push(run.costPoints);
    groups.set(key, group);
  }

  const byProvider = [...groups.values()]
    .map((group) => ({
      providerId: group.providerId,
      label: group.label,
      generationCount: group.generationCount,
      costPoints: usageCostTotal(group.costs),
    }))
    .sort(
      (left, right) =>
        right.generationCount - left.generationCount || left.label.localeCompare(right.label),
    );

  const dayRuns = runs.map((run) => ({
    createdAtMs: createdAtMs(run.createdAt),
    status: run.status,
    costPoints: run.costPoints,
  }));
  const modelRuns = runs.map((run) => ({
    model: run.providerModel,
    costPoints: run.costPoints,
  }));

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
    byDay: assembleUsageByDay(range, nowMs, dayRuns, timeZone),
    byModel: assembleUsageByModel(modelRuns),
  });
}

export class UsageService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly now: () => number = Date.now,
    private readonly timeZone: () => string = usageHostTimeZone,
  ) {}

  async summary(userId: string, range: UsageRange): Promise<UsageSummary> {
    const nowMs = this.now();
    const window = usageWindow(range, nowMs);
    const from = new Date(window.fromMs);
    const to = new Date(window.toMs);
    const ownerWindow = and(
      eq(generationRuns.userId, userId),
      isNull(generationRuns.deletedAt),
      gte(generationRuns.createdAt, from),
      lte(generationRuns.createdAt, to),
    );

    const runs = await this.db
      .select({
        status: generationRuns.status,
        costPoints: generationRuns.costPoints,
        providerModel: generationRuns.providerModel,
        createdAt: generationRuns.createdAt,
      })
      .from(generationRuns)
      .where(ownerWindow);

    const [imageRow] = await this.db
      .select({ imageCount: sql<number>`count(${generationAssets.id})::int` })
      .from(generationAssets)
      .innerJoin(generationRuns, eq(generationAssets.runId, generationRuns.id))
      .where(ownerWindow);

    return assembleUsageSummary(
      range,
      nowMs,
      runs,
      Number(imageRow?.imageCount ?? 0),
      this.timeZone(),
    );
  }
}
