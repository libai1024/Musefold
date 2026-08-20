// 历史筛选：日期范围解析 + 活跃计数 —— 纯逻辑可单测（TASK-HIS-02）

import type { HistoryStatus } from './history-status';

export const DAY_MS = 86_400_000;

/** 日期范围预设（清空后的默认 = 近 30 天） */
export type HistoryDatePreset = 'all' | '7d' | '30d' | 'month' | 'custom';

export interface HistoryFilters {
  /** undefined = 全部状态 */
  status?: HistoryStatus;
  datePreset: HistoryDatePreset;
  /** custom 时的起止（ms）；倒置时由 resolveDateRange 自动交换 */
  customFrom?: number;
  customTo?: number;
  /** undefined = 全部 Provider */
  providerId?: string;
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  status: undefined,
  datePreset: '30d',
  customFrom: undefined,
  customTo: undefined,
  providerId: undefined,
};

export interface ResolvedDateRange {
  from?: number;
  to?: number;
  /** 若发生起止交换则为 true */
  swapped: boolean;
}

/**
 * 把 UI 预设解析为 [from, to]（含端点，ms epoch）。
 * custom 且 from > to 时自动交换。
 */
export function resolveDateRange(
  filters: Pick<HistoryFilters, 'datePreset' | 'customFrom' | 'customTo'>,
  now = Date.now(),
): ResolvedDateRange {
  const { datePreset, customFrom, customTo } = filters;

  if (datePreset === 'all') {
    return { swapped: false };
  }

  if (datePreset === '7d') {
    return { from: now - 7 * DAY_MS, to: now, swapped: false };
  }

  if (datePreset === '30d') {
    return { from: now - 30 * DAY_MS, to: now, swapped: false };
  }

  if (datePreset === 'month') {
    const d = new Date(now);
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    return { from: start, to: now, swapped: false };
  }

  // custom
  let from = customFrom;
  let to = customTo;
  let swapped = false;
  if (from != null && to != null && from > to) {
    const tmp = from;
    from = to;
    to = tmp;
    swapped = true;
  }
  return { from, to, swapped };
}

/** 相对默认值，有几维筛选是「活跃」的（用于 chip 计数） */
export function countActiveHistoryFilters(filters: HistoryFilters): number {
  let n = 0;
  if (filters.status) n += 1;
  if (filters.providerId) n += 1;
  // 默认近 30 天；其它预设或自定义都算活跃
  if (filters.datePreset !== DEFAULT_HISTORY_FILTERS.datePreset) n += 1;
  if (filters.datePreset === 'custom' && (filters.customFrom != null || filters.customTo != null)) {
    // custom 已在 preset !== 30d 计过 1；不重复加
  }
  return n;
}

export function isDefaultHistoryFilters(filters: HistoryFilters): boolean {
  return countActiveHistoryFilters(filters) === 0;
}

export const DATE_PRESET_OPTIONS: { id: HistoryDatePreset; label: string }[] = [
  { id: 'all', label: '不限时间' },
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: 'month', label: '本月' },
  { id: 'custom', label: '自定义' },
];

export const STATUS_OPTIONS: { id: HistoryStatus | 'all'; label: string }[] = [
  { id: 'all', label: '全部状态' },
  { id: 'success', label: '成功' },
  { id: 'failed', label: '失败' },
  { id: 'cancelled', label: '已取消' },
];
