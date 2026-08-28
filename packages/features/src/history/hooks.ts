'use client';

import type { GenerationHistoryQuery, GenerationStatus } from '@musefold/contracts';
import { queryKeys, usePlatform } from '@musefold/platform';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

export type HistoryDatePreset = 'today' | '7d' | '30d' | 'all';

export const DATE_PRESET_LABELS: Record<HistoryDatePreset, string> = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
  all: '全部时间',
};

export interface HistoryFilters {
  status: GenerationStatus | null;
  providerModel: string | null;
  datePreset: HistoryDatePreset;
}

/** 承旧默认:30 天窗口。 */
export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  status: null,
  providerModel: null,
  datePreset: '30d',
};

export function activeFilterCount(filters: HistoryFilters, search: string): number {
  return (
    (filters.status ? 1 : 0) +
    (filters.providerModel ? 1 : 0) +
    (filters.datePreset !== '30d' ? 1 : 0) +
    (search.trim() ? 1 : 0)
  );
}

function presetFromIso(preset: HistoryDatePreset): string | undefined {
  if (preset === 'all') return undefined;
  const now = new Date();
  if (preset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.toISOString();
  }
  const days = preset === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
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
    ...(presetFromIso(filters.datePreset) ? { from: presetFromIso(filters.datePreset) } : {}),
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
