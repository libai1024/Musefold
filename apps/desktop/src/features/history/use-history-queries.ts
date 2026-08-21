import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { countActiveHistoryFilters } from '@musefold/domain/history-filters';
import { musefoldQueryKeys } from '@musefold/product-ui';
import type { HistoryStatsQuery } from '@musefold/desktop-contracts/history-documents';
import { desktopGateway } from '../../runtime';
import { toHistoryListQuery, toHistoryListQueryKey, useHistoryStore } from './store';

export function useHistoryListQuery() {
  const filters = useHistoryStore((s) => s.filters);
  const result = useQuery({
    queryKey: musefoldQueryKeys.history.list(toHistoryListQueryKey(filters)),
    queryFn: () => desktopGateway.listHistory(toHistoryListQuery(useHistoryStore.getState().filters)),
    placeholderData: keepPreviousData,
  });
  const records = result.data ?? [];
  return {
    records,
    loading: result.isFetching,
    error: result.error instanceof Error ? result.error.message : result.error ? '加载历史失败' : null,
    filtered: countActiveHistoryFilters(filters) > 0,
    refetch: result.refetch,
  };
}

export function useHistoryStatsQuery(query: HistoryStatsQuery, enabled: boolean) {
  return useQuery({
    queryKey: musefoldQueryKeys.history.stats(query),
    queryFn: () => desktopGateway.historyStats(query),
    enabled,
    // 看板每次打开都要打 IPC：E2E/用户会在进程外写库后再打开，30s stale 会显示空缓存。
    staleTime: 0,
  });
}
