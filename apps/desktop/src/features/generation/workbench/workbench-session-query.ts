import { useQuery } from '@tanstack/react-query';
import { musefoldQueryKeys, upsertListCache } from '@musefold/product-ui';
import type { WorkbenchSessionSummary } from '@musefold/desktop-contracts/workbench';
import { desktopQueryClient } from '../../../runtime/query-client';
import { workbenchSessionController } from './sessionController';
import { workbenchSessionErrorMessage } from './sessionErrors';

/** 桌面侧栏会话列表。与 Web `{ limit: 20 }` 分键，禁止把 Date.now() 写进 key。 */
export const DESKTOP_WORKBENCH_SESSION_LIST_KEY = { limit: 200 } as const;
export const DESKTOP_WORKBENCH_ARCHIVED_SESSION_LIST_KEY = {
  limit: 200,
  archived: true,
} as const;

export function desktopWorkbenchSessionListQueryKey(archived = false) {
  return musefoldQueryKeys.workbench.list(
    archived
      ? DESKTOP_WORKBENCH_ARCHIVED_SESSION_LIST_KEY
      : DESKTOP_WORKBENCH_SESSION_LIST_KEY,
  );
}

export async function fetchDesktopWorkbenchSessions(
  archived = false,
): Promise<WorkbenchSessionSummary[]> {
  const outcome = await workbenchSessionController.list(archived);
  if (outcome.status === 'stale') {
    return readDesktopWorkbenchSessions(archived);
  }
  if (outcome.status === 'error') {
    throw new Error(workbenchSessionErrorMessage(outcome.error, '加载对话失败'));
  }
  return outcome.value.items;
}

export function readDesktopWorkbenchSessions(
  archived = false,
): WorkbenchSessionSummary[] {
  const data = desktopQueryClient.getQueryData(
    desktopWorkbenchSessionListQueryKey(archived),
  );
  return Array.isArray(data) ? (data as WorkbenchSessionSummary[]) : [];
}

export function findDesktopWorkbenchSession(
  id: string,
): WorkbenchSessionSummary | undefined {
  return (
    readDesktopWorkbenchSessions(false).find((session) => session.id === id) ??
    readDesktopWorkbenchSessions(true).find((session) => session.id === id)
  );
}

export function replaceDesktopWorkbenchSessions(
  archived: boolean,
  items: WorkbenchSessionSummary[],
): void {
  desktopQueryClient.setQueryData(
    desktopWorkbenchSessionListQueryKey(archived),
    items,
  );
}

export function upsertDesktopWorkbenchSession(
  item: WorkbenchSessionSummary,
  archived = Boolean(item.archivedAt),
): void {
  desktopQueryClient.setQueryData(
    desktopWorkbenchSessionListQueryKey(archived),
    (current) => upsertListCache(current ?? [], item),
  );
  if (archived) {
    desktopQueryClient.setQueryData(
      desktopWorkbenchSessionListQueryKey(false),
      (current) =>
        Array.isArray(current)
          ? (current as WorkbenchSessionSummary[]).filter(
              (session) => session.id !== item.id,
            )
          : current,
    );
  } else {
    desktopQueryClient.setQueryData(
      desktopWorkbenchSessionListQueryKey(true),
      (current) =>
        Array.isArray(current)
          ? (current as WorkbenchSessionSummary[]).filter(
              (session) => session.id !== item.id,
            )
          : current,
    );
  }
}

export function dropDesktopWorkbenchSession(id: string): void {
  for (const archived of [false, true]) {
    desktopQueryClient.setQueryData(
      desktopWorkbenchSessionListQueryKey(archived),
      (current) =>
        Array.isArray(current)
          ? (current as WorkbenchSessionSummary[]).filter(
              (session) => session.id !== id,
            )
          : current,
    );
  }
}

export function invalidateDesktopWorkbenchSessions(archived?: boolean): void {
  if (archived === undefined) {
    void desktopQueryClient.invalidateQueries({
      queryKey: musefoldQueryKeys.workbench.sessions,
    });
    return;
  }
  void desktopQueryClient.invalidateQueries({
    queryKey: desktopWorkbenchSessionListQueryKey(archived),
  });
}

export async function refetchDesktopWorkbenchSessions(
  archived = false,
): Promise<WorkbenchSessionSummary[]> {
  return desktopQueryClient.fetchQuery({
    queryKey: desktopWorkbenchSessionListQueryKey(archived),
    queryFn: () => fetchDesktopWorkbenchSessions(archived),
  });
}

export function useDesktopWorkbenchSessionList(archived = false) {
  const query = useQuery({
    queryKey: desktopWorkbenchSessionListQueryKey(archived),
    queryFn: () => fetchDesktopWorkbenchSessions(archived),
  });
  const sessions = Array.isArray(query.data) ? query.data : [];
  const error =
    query.error instanceof Error
      ? query.error.message
      : query.error
        ? String(query.error)
        : null;
  return {
    sessions,
    loading: query.isFetching,
    error,
    refetch: query.refetch,
  };
}

export function resetDesktopWorkbenchSessionQueriesForTests(): void {
  desktopQueryClient.setQueryData(desktopWorkbenchSessionListQueryKey(false), []);
  desktopQueryClient.setQueryData(desktopWorkbenchSessionListQueryKey(true), []);
}
