import type { AccountRecoveryRequest } from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  accountEpoch,
  applyAccountSession,
  assertAccountEpoch,
  beginAccountTransition,
  observeAccountSession,
} from './account-session';
import type { AccountSummary } from '@musefold/contracts';

type RecoveryMethod = 'retryRecovery' | 'verifyOriginalSession' | 'createIndependentWorkspace';

export function useAccountRecoveryMutation(method: RecoveryMethod) {
  const { account } = useGateway();
  const client = useQueryClient();
  return useMutation({
    onMutate: () =>
      method === 'verifyOriginalSession' ? accountEpoch(client) : beginAccountTransition(client),
    mutationFn: (input: AccountRecoveryRequest) => {
      const call = account[method];
      if (!call) throw new Error('当前版本暂不支持此恢复操作，请更新后重试');
      if (method !== 'verifyOriginalSession') {
        const recovery = client.getQueryData<AccountSummary>(queryKeys.account.status())?.recovery;
        const action = method === 'retryRecovery' ? 'retry' : 'create_independent_workspace';
        if (recovery?.requestId !== input.requestId || !recovery.actions.includes(action)) {
          throw new Error('恢复状态已变化，请刷新账号状态');
        }
        if (Date.parse(recovery.expiresAt) <= Date.now()) {
          throw new Error('恢复申请已过期，请退出后重新登录');
        }
      }
      return call.call(account, input);
    },
    onSuccess: (result, _input, epoch) => {
      if (method === 'verifyOriginalSession') {
        assertAccountEpoch(client, epoch);
        // 服务端返回原设备自身摘要；仅真实身份变化才重置原设备的查询/花费意图。
        observeAccountSession(client, result);
        client.setQueryData(queryKeys.account.status(), result);
        return;
      }
      return applyAccountSession(client, result, epoch);
    },
  });
}

export function useInspectAccountRecovery() {
  const { account } = useGateway();
  const client = useQueryClient();
  return useMutation({
    onMutate: () => accountEpoch(client),
    mutationFn: async (input: AccountRecoveryRequest) => {
      if (!account.inspectRecovery) throw new Error('当前版本暂不支持原设备验证');
      const result = await account.inspectRecovery(input);
      if (result.requestId !== input.requestId) throw new Error('恢复申请不匹配，请重新核对');
      if (Date.parse(result.expiresAt) <= Date.now()) throw new Error('恢复申请已过期');
      return result;
    },
    onSuccess: (_result, _input, epoch) => assertAccountEpoch(client, epoch),
  });
}
