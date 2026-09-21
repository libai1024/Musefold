import type { AccountSummary } from '@musefold/contracts';
import { queryKeys } from '@musefold/platform';
import type { QueryClient } from '@tanstack/react-query';
import { resetQuotaRecovery } from '../history/spend-recovery-store';

// 每个 QueryClient 对应一个宿主会话；不把身份切换资格写入持久缓存。
const epochs = new WeakMap<QueryClient, number>();
const identities = new WeakMap<QueryClient, string>();
const confirmedEpochs = new WeakMap<QueryClient, number>();
const epochListeners = new WeakMap<QueryClient, Set<() => void>>();

/** Local transient resources must be invalidated even when no query is currently fetching. */
export function subscribeAccountEpoch(client: QueryClient, listener: () => void): () => void {
  let listeners = epochListeners.get(client);
  if (!listeners) {
    listeners = new Set();
    epochListeners.set(client, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function advanceAccountEpoch(client: QueryClient): number {
  const next = accountEpoch(client) + 1;
  epochs.set(client, next);
  for (const listener of epochListeners.get(client) ?? []) listener();
  return next;
}

export function isAccountRestricted(account: AccountSummary | undefined): boolean {
  return Boolean(account?.recovery || (account?.identity && account.identity.status !== 'active'));
}

export function accountIdentityKey(account: AccountSummary): string {
  return JSON.stringify([
    account.id,
    account.identity?.apiIssuer,
    account.identity?.principalId,
    account.identity?.identityVersion,
    account.identity?.status,
    account.recovery?.requestId,
  ]);
}

const isAccountStatus = (key: readonly unknown[]) => key[0] === 'account' && key[1] === 'status';

/** Status refresh can observe a session switch made in another window. */
export function observeAccountSession(client: QueryClient, account: AccountSummary): void {
  const key = accountIdentityKey(account);
  const cached = client.getQueryData<AccountSummary>(queryKeys.account.status());
  const previous = identities.get(client) ?? (cached ? accountIdentityKey(cached) : undefined);
  identities.set(client, key);
  if (previous !== undefined && previous !== key) {
    advanceAccountEpoch(client);
    resetQuotaRecovery();
    void client.cancelQueries({ predicate: (query) => !isAccountStatus(query.queryKey) });
    void client.resetQueries({ predicate: (query) => !isAccountStatus(query.queryKey) });
  }
  confirmedEpochs.set(client, accountEpoch(client));
}

export function accountEpoch(client: QueryClient): number {
  return epochs.get(client) ?? 0;
}

/** A transition invalidates the previous status even before its cached projection is replaced. */
export function isAccountSessionCurrent(client: QueryClient): boolean {
  return (confirmedEpochs.get(client) ?? 0) === accountEpoch(client);
}

export function assertAccountEpoch(client: QueryClient, expected: number): void {
  if (accountEpoch(client) !== expected) {
    throw new Error('账号已切换，请在当前账号下重试');
  }
}

export function beginAccountTransition(client: QueryClient): number {
  const next = advanceAccountEpoch(client);
  resetQuotaRecovery();
  // 即使底层 transport 无 AbortSignal，TanStack 仍不能提交已取消的旧查询结果。
  void client.cancelQueries();
  return next;
}

export async function applyAccountSession(
  client: QueryClient,
  account: AccountSummary,
  expected: number,
): Promise<void> {
  assertAccountEpoch(client, expected);
  identities.set(client, accountIdentityKey(account));
  await client.cancelQueries();
  assertAccountEpoch(client, expected);
  confirmedEpochs.set(client, expected);
  client.setQueryData(queryKeys.account.status(), account);
  // 清查询投影并重新读取；不删除宿主或服务器保存的历史。
  await client.resetQueries({
    predicate: (query) => !isAccountStatus(query.queryKey),
  });
}
