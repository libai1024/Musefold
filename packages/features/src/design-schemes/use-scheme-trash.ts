'use client';

import type { PurgeDesignSchemeInput } from '@musefold/contracts';
import { queryKeys } from '@musefold/platform';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  accountEpoch,
  assertAccountEpoch,
  subscribeAccountEpoch,
} from '../account/account-session';
import { useDesignSchemesGateway } from './hooks';

/** One opening owns its account epoch and confirmed versions. No automatic destructive retries. */
export function useSchemeTrash(query: string) {
  const gateway = useDesignSchemesGateway();
  const client = useQueryClient();
  const [epoch] = useState(() => accountEpoch(client));
  const currentEpoch = useSyncExternalStore(
    useCallback((listener) => subscribeAccountEpoch(client, listener), [client]),
    () => accountEpoch(client),
    () => epoch,
  );
  const changedAccount = currentEpoch !== epoch;
  const filter = { deletedOnly: true, limit: 20, query: query.trim() || undefined } as const;
  const list = useInfiniteQuery({
    queryKey: [...queryKeys.designSchemes.all(), 'removed', epoch, filter],
    initialPageParam: undefined as string | undefined,
    enabled: gateway != null && !changedAccount,
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      assertAccountEpoch(client, epoch);
      if (!gateway) throw new Error('当前宿主不提供设计方案能力');
      const result = await gateway.list({ ...filter, cursor: pageParam });
      signal.throwIfAborted();
      assertAccountEpoch(client, epoch);
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const purge = useMutation({
    retry: false,
    mutationFn: async (input: PurgeDesignSchemeInput) => {
      assertAccountEpoch(client, epoch);
      if (!gateway) throw new Error('当前宿主不提供设计方案能力');
      const result = await gateway.purge(input);
      assertAccountEpoch(client, epoch);
      if (result.schemeId !== input.schemeId) throw new Error('删除结果无法核对，请刷新列表');
      return result;
    },
    onSettled: () => {
      if (accountEpoch(client) !== epoch) return;
      void client.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
      void client.invalidateQueries({ queryKey: queryKeys.generation.all() });
    },
  });
  return { list, purge, changedAccount, isCurrent: () => accountEpoch(client) === epoch };
}
