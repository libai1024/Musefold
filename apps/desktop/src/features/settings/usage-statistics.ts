import type {
  HistoryStatsBucket,
  HistoryStatsChannel,
  HistoryStatsGroupBy,
  HistoryStatsQuery,
} from '@musefold/desktop-contracts/history-documents';

export type UsageRange = '7d' | '30d' | '90d' | 'all';

export const USAGE_RANGE_OPTIONS: ReadonlyArray<{ id: UsageRange; label: string }> = [
  { id: '7d', label: '近 7 日' },
  { id: '30d', label: '近 30 日' },
  { id: '90d', label: '近 90 日' },
  { id: 'all', label: '累计' },
];

const DAY_MS = 86_400_000;

const RANGE_DAYS: Record<Exclude<UsageRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function usageGroupBy(range: UsageRange): HistoryStatsGroupBy {
  if (range === '90d') return 'week';
  if (range === 'all') return 'month';
  return 'day';
}

export function buildUsageStatsQuery(range: UsageRange, now: number): HistoryStatsQuery {
  if (range === 'all') return { groupBy: 'month' };
  const days = RANGE_DAYS[range];
  return {
    from: now - (days - 1) * DAY_MS,
    to: now,
    groupBy: usageGroupBy(range),
  };
}

export function buildActivityQuery(now: number): HistoryStatsQuery {
  return {
    from: now - 370 * DAY_MS,
    to: now,
    groupBy: 'day',
  };
}

export function formatUsageCount(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatUsagePoints(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function formatUsagePercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toLocaleString('zh-CN', {
    maximumFractionDigits: 1,
  })}%`;
}

export interface UsageHeatmapCell {
  key: string;
  dateLabel: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildUsageHeatmap(
  buckets: readonly HistoryStatsBucket[],
  now: number,
): UsageHeatmapCell[] {
  const counts = new Map(buckets.map((bucket) => [bucket.key, bucket.count]));
  const end = new Date(now);
  end.setHours(12, 0, 0, 0);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - 370);

  const raw = Array.from({ length: 371 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localDateKey(date);
    return {
      key,
      dateLabel: date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      count: counts.get(key) ?? 0,
    };
  });
  const max = Math.max(0, ...raw.map((cell) => cell.count));

  return raw.map((cell) => ({
    ...cell,
    level: usageHeatLevel(cell.count, max),
  }));
}

function usageHeatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function successRate(successCount: number, attemptCount: number): number {
  return attemptCount > 0 ? (successCount / attemptCount) * 100 : 0;
}

/** 分类色板容量；超出该数量的渠道一律落入中性「其他」色，避免循环撞色。 */
export const USAGE_CHART_COLOR_LIMIT = 6;

/**
 * 渠道 → 分类色的单一事实源：按全量渠道列表的稳定下标取色。
 * 趋势折线、趋势图例与渠道统计行必须共用本函数（传入同一份全量 channels），
 * 保证同一渠道在所有面板颜色一致；下标越界或未知渠道返回中性色。
 */
export function channelColor(
  channels: ReadonlyArray<Pick<HistoryStatsChannel, 'channelId'>>,
  channelId: string,
): string {
  const index = channels.findIndex((channel) => channel.channelId === channelId);
  if (index < 0 || index >= USAGE_CHART_COLOR_LIMIT) return 'var(--mf-usage-chart-other)';
  return `var(--mf-usage-chart-${index + 1})`;
}
