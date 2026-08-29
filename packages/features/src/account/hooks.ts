import type {
  CreateAiProvider,
  DesktopSyncStatus,
  LoginRequest,
  RedeemResult,
  UpdateAiProvider,
} from '@musefold/contracts';
import { ACCOUNT_QUOTA_PER_POINT } from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useAccountStatus() {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.account.status(),
    queryFn: () => gateway.account.getStatus(),
    retry: false,
  });
}

export function useLogin() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => gateway.account.login(input),
    onSuccess: (account) => {
      queryClient.setQueryData(queryKeys.account.status(), account);
      // 登录改变全部服务端数据的可见性,重新拉取登录前失败/为空的查询(会话列表等)。
      void queryClient.invalidateQueries();
    },
  });
}

export function useRegister() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => gateway.account.register(input),
    onSuccess: (account) => {
      queryClient.setQueryData(queryKeys.account.status(), account);
      void queryClient.invalidateQueries();
    },
  });
}

export function useLogout() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => gateway.account.logout(),
    onSuccess: () => {
      // 全量重置:账号状态回到未登录错误分支,其余数据不残留上个会话内容。
      queryClient.resetQueries();
    },
  });
}

export function useRedeem() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => gateway.account.redeem(code),
    onSuccess: (result: RedeemResult) => {
      queryClient.setQueryData(queryKeys.account.status(), result.account);
    },
  });
}

/** 展示积分:1 积分 = 50000 quota,保留一位小数(整数值不带小数点)。 */
export function formatPoints(quota: number): string {
  const points = quota / ACCOUNT_QUOTA_PER_POINT;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

// ── 桌面云同步(gateway.sync,仅桌面宿主提供;登录 ≠ 同步)──────────

function useSyncGateway() {
  const gateway = useGateway();
  if (!gateway.sync) {
    throw new Error('当前宿主不提供云同步控制面(hasCloudSyncControls=false)');
  }
  return gateway.sync;
}

export function useSyncStatus() {
  const sync = useSyncGateway();
  return useQuery({
    queryKey: queryKeys.sync.status(),
    queryFn: () => sync.getStatus(),
    // 同步在后台跑(防抖/60s 兜底轮),状态面板保持新鲜。
    refetchInterval: 5_000,
  });
}

/** 同步动作成功后除状态外还要失效提示词数据(pull 可能带回远端变更)。 */
function useApplySyncResult() {
  const queryClient = useQueryClient();
  return (status: DesktopSyncStatus) => {
    queryClient.setQueryData(queryKeys.sync.status(), status);
    void queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all() });
  };
}

export function useSetSyncEnabled() {
  const sync = useSyncGateway();
  const apply = useApplySyncResult();
  return useMutation({
    mutationFn: (enabled: boolean) => sync.setEnabled(enabled),
    onSuccess: apply,
  });
}

export function useSyncNow() {
  const sync = useSyncGateway();
  const apply = useApplySyncResult();
  return useMutation({
    mutationFn: () => sync.syncNow(),
    onSuccess: apply,
  });
}

// ── 桌面 AI 连接管理(gateway.aiProviders,仅桌面宿主提供)──────────

function useAiProvidersGateway() {
  const gateway = useGateway();
  if (!gateway.aiProviders) {
    throw new Error('当前宿主不提供本地 AI 连接管理(hasLocalAiProviders=false)');
  }
  return gateway.aiProviders;
}

export function useAiProviders() {
  const aiProviders = useAiProvidersGateway();
  return useQuery({
    queryKey: queryKeys.aiProviders.list(),
    queryFn: () => aiProviders.list(),
  });
}

/** 连接变化同时失效工作台 Composer 的 provider 选项(同一份底层数据)。 */
function useInvalidateProviders() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.aiProviders.list() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.generation.providers() });
  };
}

export function useCreateAiProvider() {
  const aiProviders = useAiProvidersGateway();
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: (input: CreateAiProvider) => aiProviders.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateAiProvider() {
  const aiProviders = useAiProvidersGateway();
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAiProvider }) =>
      aiProviders.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useRemoveAiProvider() {
  const aiProviders = useAiProvidersGateway();
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: (id: string) => aiProviders.remove(id),
    onSuccess: invalidate,
  });
}

export function useSetActiveAiProvider() {
  const aiProviders = useAiProvidersGateway();
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: (id: string) => aiProviders.setActive(id),
    onSuccess: invalidate,
  });
}

export function useTestAiProvider() {
  const aiProviders = useAiProvidersGateway();
  return useMutation({
    mutationFn: (id: string) => aiProviders.test(id),
  });
}
