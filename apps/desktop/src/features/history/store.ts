// src/features/history/store.ts
// 生成历史 UI 态 —— 列表/统计走 TanStack Query（V13-STATE-02）。
// store 只留筛选、选中、检视折叠与重试中 id；拉取不再镜像 records/stats。

import { create } from 'zustand';
import type { HistoryClearRequest, HistoryDeleteResult } from '@musefold/desktop-contracts/ipc';
import type { DesktopGenerationEntry } from '@musefold/desktop-contracts/history-documents';
import type { HistoryStatus } from '@musefold/desktop-contracts/enums';
import { musefoldQueryKeys } from '@musefold/product-ui';
import { desktopGateway } from '../../runtime';
import { desktopQueryClient } from '../../runtime/query-client';
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
  filters: HistoryFilters;
  selectedId: string | null;
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

  /**
   * 失效历史查询。workbench / DataSection 等非 React 调用方仍走此别名，
   * 避免在棘轮顶格的 workbench/store.ts 上扩 import（SPLIT-03 再改经编排层）。
   */
  load: (q?: Pick<HistoryListQuery, 'limit' | 'offset'>) => Promise<void>;
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

/**
 * 列表 Query key 用筛选快照，不把 `resolveDateRange(Date.now())` 写进去。
 * 相对预设的 from/to 每毫秒都变，写进 key 会导致每帧新查询、列表闪空、详情本地态被卸掉。
 */
export function toHistoryListQueryKey(
  filters: HistoryFilters,
  page?: Pick<HistoryListQuery, 'limit' | 'offset'>,
) {
  return {
    status: filters.status,
    datePreset: filters.datePreset,
    customFrom: filters.customFrom,
    customTo: filters.customTo,
    providerId: filters.providerId,
    limit: page?.limit ?? 200,
    offset: page?.offset ?? 0,
  };
}

export function toHistoryListQuery(
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

function cachedHistoryRecords(): DesktopGenerationEntry[] {
  const merged = new Map<string, DesktopGenerationEntry>();
  for (const [, records] of desktopQueryClient.getQueriesData<DesktopGenerationEntry[]>({
    queryKey: musefoldQueryKeys.history.lists,
  })) {
    for (const record of records ?? []) merged.set(record.id, record);
  }
  return [...merged.values()];
}

function dropHistoryRecord(id: string): void {
  desktopQueryClient.setQueriesData(
    { queryKey: musefoldQueryKeys.history.lists },
    (records: DesktopGenerationEntry[] | undefined) => records?.filter((row) => row.id !== id),
  );
}

async function invalidateHistory(): Promise<void> {
  await desktopQueryClient.invalidateQueries({ queryKey: musefoldQueryKeys.history.all });
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  filters: { ...DEFAULT_HISTORY_FILTERS },
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
  },

  clearFilters: () => {
    set({ filters: { ...DEFAULT_HISTORY_FILTERS } });
  },

  hasActiveFilters: () => countActiveHistoryFilters(get().filters) > 0,
  activeFilterCount: () => countActiveHistoryFilters(get().filters),

  select: (id) => {
    set({ selectedId: id });
    if (id && get().inspectorCollapsed) set({ inspectorCollapsed: false });
  },
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  setInspectorCollapsed: (inspectorCollapsed) => set({ inspectorCollapsed }),

  load: async () => {
    await invalidateHistory();
  },

  remove: async (id, opts) => {
    const result = await desktopGateway.deleteHistory(opts?.deleteFile ? { id, deleteFile: true } : id);
    dropHistoryRecord(id);
    set((s) => ({ selectedId: s.selectedId === id ? null : s.selectedId }));
    void invalidateHistory();
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
        await invalidateHistory();
      } else {
        toast.info('无可清理', '没有匹配当前清理条件的生成历史。');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '请稍后重试';
      toast.error('清理失败', message);
    }
  },

  clearByStatus: async (statuses) => {
    await get().clear({ statuses });
  },

  retry: async (id, opts) => {
    const record = cachedHistoryRecords().find((row) => row.id === id);
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
      await invalidateHistory();
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

export function selectSelectedHistory(
  records: readonly DesktopGenerationEntry[],
  selectedId: string | null,
): DesktopGenerationEntry | null {
  if (!selectedId) return null;
  return records.find((row) => row.id === selectedId) ?? null;
}

export type { HistoryFilters, HistoryDatePreset } from '@musefold/domain/history-filters';
