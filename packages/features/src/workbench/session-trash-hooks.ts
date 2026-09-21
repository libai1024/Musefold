'use client';

import { queryKeys, useGateway } from '@musefold/platform';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useActiveSession } from './session-store';

const TRASH_QUERY = { deletedOnly: true, limit: 20 } as const;

export function useSessionTrash(enabled: boolean) {
  const gateway = useGateway();
  return useInfiniteQuery({
    queryKey: queryKeys.workbench.trash(TRASH_QUERY),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      gateway.workbench.listSessions({ ...TRASH_QUERY, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry: false,
  });
}

function useRefreshSessionLifecycle() {
  const client = useQueryClient();
  return () => {
    // Unknown outcomes and restore/purge races must be reconciled too. A failed
    // refresh must not prolong the mutation or turn a committed delete into failure.
    void client.invalidateQueries({ queryKey: queryKeys.workbench.all() });
    void client.invalidateQueries({ queryKey: queryKeys.generation.all() });
  };
}

/** Trash restore preserves archivedAt; unarchiving is a separate existing action. */
export function useRestoreTrashedSession() {
  const gateway = useGateway();
  const refresh = useRefreshSessionLifecycle();
  return useMutation({
    mutationFn: (id: string) => gateway.workbench.restoreSession(id),
    onSettled: refresh,
    retry: false,
  });
}

export function usePurgeSession() {
  const gateway = useGateway();
  const refresh = useRefreshSessionLifecycle();
  return useMutation({
    mutationFn: (id: string) => gateway.workbench.purgeSession(id),
    onSuccess: (_result, id) => {
      const state = useActiveSession.getState();
      if (state.activeSessionId === id) state.startDraftSession();
    },
    onSettled: refresh,
    retry: false,
  });
}

export function useEmptySessionTrash() {
  const gateway = useGateway();
  const refresh = useRefreshSessionLifecycle();
  return useMutation({
    mutationFn: () => gateway.workbench.emptyTrash(),
    onSettled: refresh,
    retry: false,
  });
}
