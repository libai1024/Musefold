'use client';

import type {
  GenerationCleanupInput,
  GenerationHistoryQuery,
  GenerationStatus,
} from '@musefold/contracts';
import { queryKeys, usePlatform } from '@musefold/platform';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef, useSyncExternalStore } from 'react';

export type HistoryDatePreset = 'today' | '7d' | '30d' | 'all' | 'custom';

export const DATE_PRESET_LABELS: Record<HistoryDatePreset, string> = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
  all: '全部时间',
  custom: '自定义',
};

export interface HistoryFilters {
  status: GenerationStatus | null;
  providerModel: string | null;
  datePreset: HistoryDatePreset;
  /** 自定义区间起始日(YYYY-MM-DD,含当日 00:00);仅 datePreset='custom' 生效。 */
  customFrom: string | null;
  /** 自定义区间结束日(YYYY-MM-DD,含当日 23:59:59.999)。 */
  customTo: string | null;
}

/** 承旧默认:30 天窗口。 */
export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  status: null,
  providerModel: null,
  datePreset: '30d',
  customFrom: null,
  customTo: null,
};

export function activeFilterCount(filters: HistoryFilters, search: string): number {
  return (
    (filters.status ? 1 : 0) +
    (filters.providerModel ? 1 : 0) +
    (filters.datePreset !== '30d' ? 1 : 0) +
    (search.trim() ? 1 : 0)
  );
}

/** 'YYYY-MM-DD' → 当日本地 00:00 的 ISO;非法输入返回 undefined。 */
function startOfLocalDay(day: string | null): string | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const value = new Date(year, month - 1, date, 0, 0, 0, 0);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

/** 'YYYY-MM-DD' → 当日本地 23:59:59.999 的 ISO(含尾)。 */
function endOfLocalDay(day: string | null): string | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const value = new Date(year, month - 1, date, 23, 59, 59, 999);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

function presetFromIso(preset: HistoryDatePreset): string | undefined {
  if (preset === 'all' || preset === 'custom') return undefined;
  const now = new Date();
  if (preset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.toISOString();
  }
  const days = preset === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** 时间窗口 → 契约 from/to;自定义区间含首含尾,只填了一头也生效。 */
export function historyDateBounds(filters: HistoryFilters): { from?: string; to?: string } {
  if (filters.datePreset !== 'custom') {
    const from = presetFromIso(filters.datePreset);
    return from ? { from } : {};
  }
  const from = startOfLocalDay(filters.customFrom);
  const to = endOfLocalDay(filters.customTo);
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function buildHistoryQuery(
  filters: HistoryFilters,
  search: string,
  deletedOnly: boolean,
): GenerationHistoryQuery {
  return {
    limit: 20,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.providerModel ? { providerModel: filters.providerModel } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...historyDateBounds(filters),
    ...(deletedOnly ? { deletedOnly: true } : {}),
  };
}

/** 历史列表:cursor 无限分页。 */
export function useHistoryList(query: GenerationHistoryQuery) {
  const { gateway } = usePlatform();
  return useInfiniteQuery({
    queryKey: queryKeys.generation.history(query),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => gateway.generation.list({ ...query, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function useInvalidateGeneration() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.generation.all() });
  };
}

export function useRemoveGeneration() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateGeneration();
  return useMutation({
    mutationFn: (id: string) => gateway.generation.remove(id),
    onSuccess: invalidate,
  });
}

export function useRestoreGeneration() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateGeneration();
  return useMutation({
    mutationFn: (id: string) => gateway.generation.restore(id),
    onSuccess: invalidate,
  });
}

export function usePurgeGeneration() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateGeneration();
  return useMutation({
    mutationFn: (id: string) => gateway.generation.purge(id),
    onSuccess: invalidate,
  });
}

/** 批量清理(05 §7):成功后整域 invalidate,磁盘占用 readout 随之重取。 */
export function useCleanupGeneration() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateGeneration();
  return useMutation({
    mutationFn: (input: GenerationCleanupInput) => gateway.generation.cleanup(input),
    onSuccess: invalidate,
  });
}

/**
 * 生成图片目录占用(桌面 only):宿主未实现即禁用查询,
 * 调用方仍按 capabilities.canRevealLocalFile 决定是否渲染入口。
 */
export function useStorageUsage(enabled: boolean) {
  const { gateway } = usePlatform();
  const getStorageUsage = gateway.generation.getStorageUsage;
  return useQuery({
    queryKey: queryKeys.generation.storageUsage(),
    queryFn: () => (getStorageUsage as NonNullable<typeof getStorageUsage>)(),
    enabled: enabled && typeof getStorageUsage === 'function',
  });
}

/** 「在文件夹中显示」:只送资产 id,路径解析在宿主主进程。 */
export function useRevealAsset() {
  const { gateway } = usePlatform();
  return useMutation({
    mutationFn: (assetId: string) => {
      const reveal = gateway.generation.revealAsset;
      if (!reveal) throw new Error('当前环境不支持在文件夹中显示');
      return reveal(assetId);
    },
  });
}

/** 「复制图片」:把受管资产写入系统剪贴板(桌面)。 */
export function useCopyAssetToClipboard() {
  const { gateway } = usePlatform();
  return useMutation({
    mutationFn: (assetId: string) => {
      const copy = gateway.generation.copyAssetToClipboard;
      if (!copy) throw new Error('当前环境不支持复制图片');
      return copy(assetId);
    },
  });
}

/**
 * 滚动哨兵自动加载更多(05 §7 大列表兜底):哨兵进入视口即取下一页。
 * 不引入虚拟滚动依赖,长列表靠「按需加载 + 浏览器原生滚动」控制 DOM 规模;
 * 环境没有 IntersectionObserver(jsdom/老壳)时静默退化到手动按钮。
 */
export function useAutoLoadMore(
  sentinel: RefObject<HTMLElement | null>,
  enabled: boolean,
  load: () => void,
): void {
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const node = sentinel.current;
    if (!enabled || !node || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadRef.current();
      },
      // 提前一屏取下一页,滚到底前数据已就位。
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, sentinel]);
}

/** SSR/jsdom 安全的媒体查询(Inspector 内嵌/抽屉分叉),不支持的环境回退 false。 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}
