import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/**
 * 使用统计时间范围(ui-parity 07-05)。不含「全部」,避免炸现有 7/30/90 测试。
 * 窗口含首含尾:from = now - (days-1)·86400000,to = now(与旧 usage-statistics 一致)。
 */
export const usageRangeSchema = z.enum(['7d', '30d', '90d']);

export const USAGE_RANGE_DAYS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
} as const;

export const usageSummaryQuerySchema = z
  .object({
    range: usageRangeSchema,
  })
  .strict();

export const usageProviderBucketSchema = z
  .object({
    /** 桌面本地 provider id;云端生成任务表无 provider 列,恒为 null。 */
    providerId: z.string().trim().min(1).max(128).nullable(),
    /** 展示名:桌面取 providers.name,缺行回退 provider_id;云端取 provider_model 或「Musefold 云生图」。 */
    label: z.string().trim().min(1).max(120),
    generationCount: z.number().int().nonnegative(),
    /**
     * 该渠道实际成本之和。组内成本列全体为 null → null,不把缺记录伪造为 0。
     * 体验通道 / 自备 Key 往往没有 actual_cost,UI 显示「—」。
     */
    costPoints: z.number().nonnegative().nullable(),
  })
  .strict();

/** 本地自然日,YYYY-MM-DD。分桶时区由聚合端注入,单测用 UTC。 */
export const usageLocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const usageDayBucketSchema = z
  .object({
    date: usageLocalDateSchema,
    generationCount: z.number().int().nonnegative(),
    succeededCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    cancelledCount: z.number().int().nonnegative(),
    /**
     * 当日实际成本之和。无记录日与「有记录但成本列全缺」都是 null,不伪造 0。
     * 汇总卡「无任何尝试」看 generationCount 总和,不要被补零日骗成有数据。
     */
    costPoints: z.number().nonnegative().nullable(),
    /** 当日成功率;分母(succeeded+failed+cancelled)为 0 → null,趋势图跳点/断线。 */
    successRate: z.number().min(0).max(1).nullable(),
  })
  .strict();

export const usageModelBucketSchema = z
  .object({
    /** 桌面取 generation_runs.model / params_json.model;云端取 provider_model;空串归「未知模型」。 */
    model: z.string().trim().min(1).max(128),
    generationCount: z.number().int().nonnegative(),
    costPoints: z.number().nonnegative().nullable(),
  })
  .strict();

/**
 * 使用统计汇总(设置「使用统计」卡)。图表与四指标同一响应,不加第二个网关方法。
 *
 * 口径:
 * - 只计 deleted_at IS NULL 的生成任务;时间按 created_at 落在 [from, to]。
 * - generationCount 含范围内全部未删行(含 queued/running)。
 * - 成功率分母 = succeeded + failed + cancelled,排除 queued/running/pending/cancelling/rejected/expired;
 *   桌面 SQLite 的终态 success 视同 succeeded。分母 0 → successRate null(UI「—」,不伪造 0)。
 * - costPoints:范围内成本列全体为 null(或无行)→ null,不伪造 0;有值则对非 null 求和。
 * - imageCount:范围内未删任务对应的成图资产数。
 * - byDay:含首含尾每个本地自然日一个桶;无记录日 generationCount=0 且 costPoints=null。
 * - byModel:按次数降序;空范围给空数组。
 */
export const usageSummarySchema = z
  .object({
    range: usageRangeSchema,
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    generationCount: z.number().int().nonnegative(),
    succeededCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    cancelledCount: z.number().int().nonnegative(),
    imageCount: z.number().int().nonnegative(),
    costPoints: z.number().nonnegative().nullable(),
    successRate: z.number().min(0).max(1).nullable(),
    byProvider: z.array(usageProviderBucketSchema),
    byDay: z.array(usageDayBucketSchema),
    byModel: z.array(usageModelBucketSchema),
  })
  .strict();

export type UsageRange = z.infer<typeof usageRangeSchema>;
export type UsageSummaryQuery = z.infer<typeof usageSummaryQuerySchema>;
export type UsageProviderBucket = z.infer<typeof usageProviderBucketSchema>;
export type UsageDayBucket = z.infer<typeof usageDayBucketSchema>;
export type UsageModelBucket = z.infer<typeof usageModelBucketSchema>;
export type UsageSummary = z.infer<typeof usageSummarySchema>;
export type UsageRunOutcome = 'succeeded' | 'failed' | 'cancelled' | 'other';

const DAY_MS = 86_400_000;
const SUCCEEDED_STATUS = new Set(['succeeded', 'success']);
const FAILED_STATUS = new Set(['failed']);
const CANCELLED_STATUS = new Set(['cancelled']);
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/** ISO 8601 with offset;zod datetime({ offset: true }) 不接受裸 Z。 */
export function toUsageIso(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, '+00:00');
}

/** 范围窗口:含首含尾的 (days) 个自然日切片,用调用方注入的 now 避免测试漂移。 */
export function usageWindow(
  range: UsageRange,
  nowMs: number,
): { from: string; to: string; fromMs: number; toMs: number } {
  const fromMs = nowMs - (USAGE_RANGE_DAYS[range] - 1) * DAY_MS;
  return { fromMs, toMs: nowMs, from: toUsageIso(fromMs), to: toUsageIso(nowMs) };
}

/**
 * 成功率 = succeeded / (succeeded+failed+cancelled)。
 * 分母 0(没有任何终态尝试)→ null,UI 显示「—」。
 */
export function usageSuccessRate(
  succeededCount: number,
  failedCount: number,
  cancelledCount: number,
): number | null {
  const denominator = succeededCount + failedCount + cancelledCount;
  return denominator === 0 ? null : succeededCount / denominator;
}

/** 成本列全体为 null → null;否则对非 null 求和。空数组视同无成本数据。 */
export function usageCostTotal(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter((value): value is number => value != null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

export function classifyUsageRunStatus(status: string): UsageRunOutcome {
  if (SUCCEEDED_STATUS.has(status)) return 'succeeded';
  if (FAILED_STATUS.has(status)) return 'failed';
  if (CANCELLED_STATUS.has(status)) return 'cancelled';
  return 'other';
}

/** 宿主本地 IANA 时区;不可解析时回退 UTC。生产聚合用,单测注入固定区。 */
export function usageHostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * 把毫秒时间戳格式化为指定时区的 YYYY-MM-DD。
 * 单测注入 `UTC` 并固定 now,避免 CI 宿主时区把补零日切到隔壁自然日。
 */
export function usageLocalDateKey(ms: number, timeZone: string): string {
  let formatter = dateKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateKeyFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(ms));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(`usageLocalDateKey: cannot format ${ms} in ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}

function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

function formatCivilDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 含首含尾的本地自然日序列(按 civil date 递进,不走本地午夜瞬时,避开 DST 跳变)。
 * UTC 下与 usageWindow 对齐时,桶数等于 USAGE_RANGE_DAYS[range]。
 */
export function usageInclusiveLocalDates(fromMs: number, toMs: number, timeZone: string): string[] {
  const start = usageLocalDateKey(fromMs, timeZone);
  const end = usageLocalDateKey(toMs, timeZone);
  const dates: string[] = [];
  let { year, month, day } = parseLocalDate(start);
  const last = parseLocalDate(end);
  while (
    year < last.year ||
    (year === last.year && month < last.month) ||
    (year === last.year && month === last.month && day <= last.day)
  ) {
    dates.push(formatCivilDate(year, month, day));
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
    if (dates.length > 366) break;
  }
  return dates;
}

export function resolveUsageModelLabel(model: string | null | undefined): string {
  const trimmed = model?.trim();
  if (!trimmed) return '未知模型';
  return trimmed.length > 128 ? trimmed.slice(0, 128) : trimmed;
}

export function assembleUsageByDay(
  range: UsageRange,
  nowMs: number,
  runs: readonly { createdAtMs: number; status: string; costPoints: number | null }[],
  timeZone: string,
): UsageDayBucket[] {
  const window = usageWindow(range, nowMs);
  const dates = usageInclusiveLocalDates(window.fromMs, window.toMs, timeZone);
  const buckets = new Map<
    string,
    {
      generationCount: number;
      succeededCount: number;
      failedCount: number;
      cancelledCount: number;
      costs: Array<number | null>;
    }
  >();
  for (const date of dates) {
    buckets.set(date, {
      generationCount: 0,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      costs: [],
    });
  }
  for (const run of runs) {
    const bucket = buckets.get(usageLocalDateKey(run.createdAtMs, timeZone));
    if (!bucket) continue;
    bucket.generationCount += 1;
    const outcome = classifyUsageRunStatus(run.status);
    if (outcome === 'succeeded') bucket.succeededCount += 1;
    else if (outcome === 'failed') bucket.failedCount += 1;
    else if (outcome === 'cancelled') bucket.cancelledCount += 1;
    bucket.costs.push(run.costPoints);
  }
  return dates.map((date) => {
    const bucket = buckets.get(date) ?? {
      generationCount: 0,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      costs: [],
    };
    return {
      date,
      generationCount: bucket.generationCount,
      succeededCount: bucket.succeededCount,
      failedCount: bucket.failedCount,
      cancelledCount: bucket.cancelledCount,
      costPoints: usageCostTotal(bucket.costs),
      successRate: usageSuccessRate(
        bucket.succeededCount,
        bucket.failedCount,
        bucket.cancelledCount,
      ),
    };
  });
}

export function assembleUsageByModel(
  runs: readonly { model: string | null | undefined; costPoints: number | null }[],
): UsageModelBucket[] {
  const groups = new Map<string, { generationCount: number; costs: Array<number | null> }>();
  for (const run of runs) {
    const model = resolveUsageModelLabel(run.model);
    const group = groups.get(model) ?? { generationCount: 0, costs: [] };
    group.generationCount += 1;
    group.costs.push(run.costPoints);
    groups.set(model, group);
  }
  return [...groups.entries()]
    .map(([model, group]) => ({
      model,
      generationCount: group.generationCount,
      costPoints: usageCostTotal(group.costs),
    }))
    .sort(
      (left, right) =>
        right.generationCount - left.generationCount || left.model.localeCompare(right.model),
    );
}
