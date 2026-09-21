import { accountModelCatalogSchema } from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  accountEpoch,
  accountIdentityKey,
  assertAccountEpoch,
  isAccountRestricted,
  isAccountSessionCurrent,
  subscribeAccountEpoch,
} from '../account/account-session';
import { useAccountStatus } from '../account/hooks';
import {
  assertModelCatalogAccount,
  modelPreferenceKey,
  modelSubmission,
  modelUnavailableReason,
  readModelPreference,
  writeModelPreference,
} from './account-model-choice';

/** Account-scoped display/choice. Prices are always re-read before a new user submission. */
export function useAccountModelChoice(enabled: boolean) {
  const gateway = useGateway();
  const client = useQueryClient();
  const account = useAccountStatus();
  const subscribe = useCallback(
    (listener: () => void) => subscribeAccountEpoch(client, listener),
    [client],
  );
  const epoch = useSyncExternalStore(
    subscribe,
    () => accountEpoch(client),
    () => 0,
  );
  const reader = enabled ? gateway.account.getModelCatalog : undefined;
  const readyAccount =
    account.isSuccess &&
    account.dataUpdatedAt > 0 &&
    !isAccountRestricted(account.data) &&
    isAccountSessionCurrent(client);
  const identity = account.data ? accountIdentityKey(account.data) : '';
  const queryKey = queryKeys.account.models(identity, epoch);
  const catalogQuery = useQuery({
    queryKey,
    enabled: enabled && readyAccount && Boolean(reader),
    queryFn: async () => {
      if (!reader || !account.data || !readyAccount) throw new Error('请先核对当前账号');
      const captured = accountEpoch(client);
      const catalog = accountModelCatalogSchema.parse(await reader.call(gateway.account));
      assertAccountEpoch(client, captured);
      assertModelCatalogAccount(catalog, account.data);
      return catalog;
    },
    retry: false,
    staleTime: 30_000,
    gcTime: 0,
    refetchInterval: enabled && readyAccount ? 60_000 : false,
  });
  // Hide stale prices on failed refresh, logout or transition, even if Query retains old data.
  const catalog = enabled && readyAccount && catalogQuery.isSuccess ? catalogQuery.data : undefined;
  const scope = catalog ? modelPreferenceKey(catalog) : null;
  const [choice, setChoice] = useState<{ scope: string; model: string; persisted: boolean } | null>(
    null,
  );
  const model = scope
    ? ((choice?.scope === scope ? choice.model : readModelPreference(scope)) ??
      catalog?.models.find((entry) => !modelUnavailableReason(entry))?.model ??
      '')
    : '';
  // Freeze the first displayed choice as well as explicit selections. Otherwise a catalog
  // refresh could silently pick a different available model before the user sends.
  useEffect(() => {
    if (scope && model && choice?.scope !== scope)
      setChoice({ scope, model, persisted: writeModelPreference(scope, model) });
  }, [scope, model, choice?.scope]);
  const selected = catalog?.models.find((entry) => entry.model === model);
  const reason = !enabled
    ? null
    : !reader
      ? '当前版本未提供云端模型目录，请更新应用'
      : !readyAccount
        ? '请先登录并核对当前账号'
        : catalogQuery.isError
          ? '云端模型与价格读取失败，请刷新重试'
          : !catalog
            ? '正在读取云端模型与价格…'
            : catalog.models.length === 0
              ? '当前账号没有可用模型，请检查云端配置'
              : modelUnavailableReason(selected);

  function selectModel(next: string) {
    if (accountEpoch(client) !== epoch || !isAccountSessionCurrent(client)) return;
    if (
      !catalog ||
      !scope ||
      modelUnavailableReason(catalog.models.find((entry) => entry.model === next))
    )
      return;
    setChoice({ scope, model: next, persisted: writeModelPreference(scope, next) });
  }

  async function prepareSubmission() {
    assertAccountEpoch(client, epoch);
    if (!isAccountSessionCurrent(client)) throw new Error('请先核对当前账号');
    if (reason || !catalog || !model) throw new Error(reason ?? '请先选择模型');
    const capturedEpoch = accountEpoch(client);
    const before = modelSubmission(catalog, model);
    // refetch updates the visible price even when it differs, but never silently submits it.
    const fresh = await catalogQuery.refetch({ throwOnError: true });
    assertAccountEpoch(client, capturedEpoch);
    if (!fresh.data) throw new Error('云端模型与价格读取失败，请刷新重试');
    const after = modelSubmission(fresh.data, model);
    if (JSON.stringify(before.expectedBinding) !== JSON.stringify(after.expectedBinding))
      throw new Error('账号执行身份已变化，请核对后重新发送');
    const price = fresh.data.models.find((entry) => entry.model === model)?.pricing;
    if (JSON.stringify(selected?.pricing) !== JSON.stringify(price))
      throw new Error('云端价格已更新，请核对后重新发送');
    return before;
  }

  return {
    enabled,
    catalog,
    model,
    selected,
    reason,
    loading: enabled && readyAccount && catalogQuery.isFetching,
    persistenceWarning:
      scope && choice?.scope === scope && !choice.persisted
        ? '此设备无法保存模型偏好，本次选择仍然有效'
        : null,
    selectModel,
    refresh: async () => {
      if (!readyAccount) await account.refetch();
      else await catalogQuery.refetch();
    },
    prepareSubmission,
  };
}

export type AccountModelChoice = ReturnType<typeof useAccountModelChoice>;
