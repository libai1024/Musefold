import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { musefoldQueryKeys } from '@musefold/product-ui';
import type { DesktopLibraryPrompt } from '@musefold/desktop-contracts/library-documents';
import { desktopQueryClient } from '../../runtime/query-client';
import {
  getLibraryDesktopExtras,
  selectNormal,
  selectPinned,
  useLibraryStore,
} from './store';

export function useLibraryListQuery() {
  const listQuery = useLibraryStore((s) => s.listQuery);
  const result = useQuery({
    queryKey: musefoldQueryKeys.library.list(listQuery),
    queryFn: () => getLibraryDesktopExtras().listLibraryPrompts(listQuery),
  });
  const prompts = result.data ?? [];
  return {
    prompts,
    loading: result.isFetching,
    initialized: result.isFetched,
    error: result.error instanceof Error ? result.error.message : null,
    refetch: result.refetch,
  };
}

export function useLibraryStatsQuery() {
  const result = useQuery({
    queryKey: musefoldQueryKeys.library.stats,
    queryFn: () => getLibraryDesktopExtras().libraryStats(),
  });
  return result.data;
}

export function useDeletedLibraryQuery(enabled: boolean) {
  return useQuery({
    queryKey: musefoldQueryKeys.library.deleted,
    queryFn: () => getLibraryDesktopExtras().listDeletedLibraryPrompts(),
    enabled,
  });
}

export function usePinnedPromptsFromQuery(): DesktopLibraryPrompt[] {
  const { prompts } = useLibraryListQuery();
  return useMemo(() => selectPinned({ prompts }), [prompts]);
}

export function useNormalPromptsFromQuery(): DesktopLibraryPrompt[] {
  const { prompts } = useLibraryListQuery();
  return useMemo(() => selectNormal({ prompts }), [prompts]);
}

export async function invalidateLibraryQueries(): Promise<void> {
  await desktopQueryClient.invalidateQueries({ queryKey: musefoldQueryKeys.library.all });
}
