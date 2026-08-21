// src/features/history/store.ts
// 生成历史 —— 列表/筛选/选中检视/删除（TASK-HIS-01/02/03）

import { create } from 'zustand';
import type { HistoryClearRequest, HistoryDeleteResult } from '@musefold/desktop-contracts/ipc';
import type {
  DesktopGenerationEntry,
  HistoryStats,
  HistoryStatsQuery,
} from '@musefold/desktop-contracts/history-documents';
import type { HistoryStatus } from '@musefold/desktop-contracts/enums';
import { desktopGateway } from '../../runtime';
import { toast } from '../../stores/toast';
import {
  DEFAULT_HISTORY_FILTERS,
  countActiveHistoryFilters,
  resolveDateRange,
  type HistoryFilters,
} from '@musefold/domain/history-filters';
import { historyErrorPresentation } from './error';

/** 发给主进程的 list 查询（已解析日期） */
export interface HistoryListQuery {
  status?: HistoryStatus;
  from?: number;
  to?: number;
  providerId?: string;
  limit?: number;
  offset?: number;
}

export interface HistoryRetryOptions {
  /** 再次生成是用户主动同参重跑，可绕过失败错误码的 retry 动作限制。 */
  force?: boolean;
  successTitle?: string;
  successDescription?: string;
}

export interface HistoryRemoveOptions {
  deleteFile?: boolean;
}

interface HistoryState {
  records: DesktopGenerationEntry[];
  loading: boolean;
  error: string | null;
  stats: HistoryStats | null;
  statsLoading: boolean;
  statsError: string | null;
  filters: HistoryFilters;
  filtered: boolean;

  /** 当前选中记录 id（检视栏） */
  selectedId: string | null;
  /** 右栏检视是否折叠 */
  inspectorCollapsed: boolean;
  /** 以历史 id 去重的重试中任务，供列表和详情共享进度态 */
  retryingIds: Set<string>;

  setFilters: (patch: Partial<HistoryFilters>) => void;
  clearFilters: () => void;
  hasActiveFilters: () => boolean;
  activeFilterCount: () => number;

  select: (id: string | null) => void;
  toggleInspector: () => void;
  setInspectorCollapsed: (v: boolean) => void;

  load: (q?: Pick<HistoryListQuery, 'limit' | 'offset'>) => Promise<void>;
  loadStats: (q: HistoryStatsQuery) => Promise<HistoryStats | null>;
  remove: (id: string, opts?: HistoryRemoveOptions) => Promise<HistoryDeleteResult | null>;
  clear: (req?: number | HistoryClearRequest) => Promise<void>;
  clearByStatus: (statuses: HistoryStatus[]) => Promise<void>;
  retry: (id: string, opts?: HistoryRetryOptions) => Promise<void>;
}

/** 筛选状态（cloud 词表 'succeeded'）→ IPC 查询的桌面词表（'success'） */
const FILTER_STATUS_TO_QUERY: Record<string, HistoryStatus> = {
  succeeded: 'success',
  failed: 'failed',
  cancelled: 'cancelled',
};

function toListQuery(
  filters: HistoryFilters,
  page?: Pick<HistoryListQuery, 'limit' | 'offset'>,
): HistoryListQuery {
  const range = resolveDateRange(filters);
  return {
    status: filters.status ? FILTER_STATUS_TO_QUERY[filters.status] : undefined,
    providerId: filters.providerId,
    from: range.from,
    to: range.to,
    limit: page?.limit ?? 200,
    offset: page?.offset,
  };
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  records: [],
  loading: false,
  error: null,
  stats: null,
  statsLoading: false,
  statsError: null,
  filters: { ...DEFAULT_HISTORY_FILTERS },
  filtered: false,
  selectedId: null,
  inspectorCollapsed: false,
  retryingIds: new Set(),

  setFilters: (patch) => {
    const next: HistoryFilters = { ...get().filters, ...patch };
    if (patch.datePreset && patch.datePreset !== 'custom') {
      next.customFrom = undefined;
      next.customTo = undefined;
    }
    if (
      (patch.customFrom != null || patch.customTo != null || patch.datePreset === 'custom') &&
      next.customFrom != null &&
      next.customTo != null &&
      next.customFrom > next.customTo
    ) {
      const tmp = next.customFrom;
      next.customFrom = next.customTo;
      next.customTo = tmp;
    }
    set({ filters: next });
    void get().load();
  },

  clearFilters: () => {
    set({ filters: { ...DEFAULT_HISTORY_FILTERS } });
    void get().load();
  },

  hasActiveFilters: () => countActiveHistoryFilters(get().filters) > 0,
  activeFilterCount: () => countActiveHistoryFilters(get().filters),

  select: (id) => {
    set({ selectedId: id });
    // 选中时若检视折叠则自动展开，避免「点了没反应」
    if (id && get().inspectorCollapsed) set({ inspectorCollapsed: false });
  },
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  setInspectorCollapsed: (inspectorCollapsed) => set({ inspectorCollapsed }),

  load: async (page) => {
    set({ loading: true, error: null });
    const filters = get().filters;
    const query = toListQuery(filters, page);
    const filtered = countActiveHistoryFilters(filters) > 0;
    const prevSelected = get().selectedId;
    try {
      const records = await desktopGateway.listHistory(query);
      // 筛选后若选中项不在结果里，清空选中
      const stillThere = prevSelected && records.some((r) => r.id === prevSelected);
      set({
        records,
        loading: false,
        filtered,
        selectedId: stillThere ? prevSelected : null,
      });
    } catch (err) {
      console.error('[history] load failed:', err);
      set({
        loading: false,
        filtered,
        error: (err as Error)?.message ?? '加载历史失败',
      });
    }
  },

  loadStats: async (q) => {
    set({ statsLoading: true, statsError: null });
    try {
      const stats = await desktopGateway.historyStats(q);
      set({ stats, statsLoading: false });
      return stats;
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载成本看板失败';
      set({ statsLoading: false, statsError: message });
      return null;
    }
  },

  remove: async (id, opts) => {
    const result = await desktopGateway.deleteHistory(opts?.deleteFile ? { id, deleteFile: true } : id);
    set((s) => ({
      records: s.records.filter((r) => r.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
    if (opts?.deleteFile) {
      if (result.fileDeleted) {
        toast.success('已删除记录和源文件');
      } else if (result.fileMissing) {
        toast.info('已删除记录', '图片文件已不存在。');
      } else if (result.fileError) {
        toast.error('记录已删除，源文件保留', result.fileError);
      } else {
        toast.info('已删除记录', '这条记录没有可删除的图片文件。');
      }
    }
    return result;
  },

  clear: async (req) => {
    try {
      const result = await desktopGateway.clearHistory(req);
      if (result.deleted > 0) {
        toast.success('已清理历史', `${result.deleted} 条记录已移除`);
      } else {
        toast.info('无可清理', '没有匹配当前清理条件的生成历史。');
      }
      await get().load({ limit: 200 });
    } catch (err) {
      const message = err instanceof Error ? err.message : '请稍后重试';
      toast.error('清理失败', message);
    }
  },

  clearByStatus: async (statuses) => {
    await get().clear({ statuses });
  },

  retry: async (id, opts) => {
    const record = get().records.find((r) => r.id === id);
    if (!record) return;
    if (!opts?.force && record.status !== 'failed') return;
    if (get().retryingIds.has(id)) return;

    const presentation =
      record.status === 'failed'
        ? historyErrorPresentation(record.errorCode, record.errorMessage)
        : null;
    if (!opts?.force && presentation && !presentation.canRetry) {
      toast.info(presentation.primaryAction?.label ?? '暂不可重试', presentation.hint);
      return;
    }

    set((s) => {
      const retryingIds = new Set(s.retryingIds);
      retryingIds.add(id);
      return { retryingIds };
    });

    try {
      const result = await desktopGateway.retryImage(id);
      if (result.status === 'success') {
        toast.success(
          opts?.successTitle ?? '重试完成',
          opts?.successDescription ?? '新的生成记录已加入历史',
        );
      } else if (result.status === 'cancelled') {
        toast.info('重试已取消');
      } else {
        const next = historyErrorPresentation(result.error?.code, result.error?.message);
        toast.error(next.displayTitle, next.hint);
      }
      await get().load({ limit: 200 });
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法发起重试';
      toast.error('重试失败', message);
    } finally {
      set((s) => {
        const retryingIds = new Set(s.retryingIds);
        retryingIds.delete(id);
        return { retryingIds };
      });
    }
  },
}));

export function selectSelectedHistory(s: HistoryState): DesktopGenerationEntry | null {
  if (!s.selectedId) return null;
  return s.records.find((r) => r.id === s.selectedId) ?? null;
}

export type { HistoryFilters, HistoryDatePreset } from '@musefold/domain/history-filters';
