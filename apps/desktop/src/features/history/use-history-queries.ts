import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { countActiveHistoryFilters } from '@musefold/domain/history-filters';
import { musefoldQueryKeys } from '@musefold/product-ui';
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
