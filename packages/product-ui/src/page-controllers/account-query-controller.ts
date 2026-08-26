import { useCallback, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AccountGateway } from '@musefold/domain';
import { musefoldQueryKeys } from './query-client';

type AccountQueryGateway = Pick<AccountGateway, 'getAccount'>;

export interface AccountQueryControllerDeps {
  account: AccountQueryGateway;
  enabled?: boolean;
  onRefreshError?: (error: unknown) => void;
}

export interface AccountRefreshScheduler {
  schedule: () => Promise<void>;
}

export function createAccountRefreshScheduler(
  refresh: () => Promise<unknown>,
  onError?: (error: unknown) => void,
): AccountRefreshScheduler {
  let inFlight: Promise<void> | null = null;
  let trailing = false;

  const run = async (): Promise<void> => {
    try {
      do {
        trailing = false;
        await refresh();
      } while (trailing);
    } catch (error) {
      trailing = false;
      onError?.(error);
    } finally {
      inFlight = null;
    }
  };

  return {
    schedule() {
      if (inFlight) {
        trailing = true;
        return inFlight;
      }
      inFlight = run();
      return inFlight;
    },
  };
}

export function accountStatusQueryOptions(account: AccountQueryGateway) {
  return {
    queryKey: musefoldQueryKeys.account.status,
    queryFn: () => account.getAccount(),
  };
}

export async function refreshAccountQuery(queryClient: QueryClient, account: AccountQueryGateway) {
  await queryClient.invalidateQueries({
    queryKey: musefoldQueryKeys.account.status,
    exact: true,
    refetchType: 'none',
  });
  return queryClient.fetchQuery(accountStatusQueryOptions(account));
}

/** Shared account server-state controller. Hosts inject their AccountGateway explicitly. */
export function useAccountQueryController({
  account,
  enabled = true,
  onRefreshError,
}: AccountQueryControllerDeps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...accountStatusQueryOptions(account),
    enabled,
  });
  const refresh = useCallback(
    () => refreshAccountQuery(queryClient, account),
    [account, queryClient],
  );
  const refreshRef = useRef(refresh);
  const refreshErrorRef = useRef(onRefreshError);
  refreshRef.current = refresh;
  refreshErrorRef.current = onRefreshError;
  const schedulerRef = useRef<AccountRefreshScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createAccountRefreshScheduler(
      () => refreshRef.current(),
      (error) => refreshErrorRef.current?.(error),
    );
  }
  const scheduleRefresh = useCallback(() => schedulerRef.current!.schedule(), []);

  return {
    account: query.data ?? null,
    loading: query.isLoading,
    refreshing: query.isFetching,
    error: query.error,
    refresh,
    scheduleRefresh,
  };
}

export type AccountQueryController = ReturnType<typeof useAccountQueryController>;
