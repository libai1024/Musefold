import type {
  CreateAiProvider,
  DesktopSyncConsent,
  DesktopSyncStatus,
  DoubaoAccountStatus,
  LoginRequest,
  RedeemResult,
  SyncConflictResolution,
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

/** 写入 durable consent(unset→enabled 首次同意 / enabled⇄paused);runtime phase 由宿主派生。 */
export function useSetSyncConsent() {
  const sync = useSyncGateway();
  const apply = useApplySyncResult();
  return useMutation({
    mutationFn: (consent: DesktopSyncConsent) => sync.setConsent(consent),
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

/** 冲突列表按需查询:调用方仅在状态提示存在未解决冲突时传 enabled=true。 */
export function useSyncConflicts(enabled: boolean) {
  const sync = useSyncGateway();
  return useQuery({
    queryKey: queryKeys.sync.conflicts(),
    queryFn: () => sync.listConflicts(),
    enabled,
  });
}

export function useResolveSyncConflict() {
  const sync = useSyncGateway();
  const apply = useApplySyncResult();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conflictId,
      resolution,
    }: {
      conflictId: string;
      resolution: SyncConflictResolution;
    }) => sync.resolveConflict(conflictId, resolution),
    onSuccess: (status) => {
      // apply 已失效 prompts;冲突列表随状态一起刷新,行级错误由调用方就地呈现。
      apply(status);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sync.conflicts() });
    },
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

// ── 豆包网页登录(gateway.doubao,仅桌面宿主提供;冻结 browser-service 薄适配)──

function useDoubaoGateway() {
  const gateway = useGateway();
  if (!gateway.doubao) {
    throw new Error('当前宿主不提供豆包网页登录(hasDoubaoWebLogin=false)');
  }
  return gateway.doubao;
}

/**
 * 豆包账号状态。登录流进行中(qr-ready/scanned/loading)按 2s 轮询跟随主进程内部
 * 登录 poller 的状态推进;静止状态不轮询。
 */
export function useDoubaoAccountStatus() {
  const doubao = useDoubaoGateway();
  return useQuery({
    queryKey: queryKeys.doubao.status(),
    queryFn: () => doubao.getStatus(),
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.loginState;
      return state === 'qr-ready' || state === 'scanned' || state === 'loading' ? 2_000 : false;
    },
  });
}

/** 登录态变化会经主进程 doubao-login-sync 回写 providers.has_key,连接选项一并失效。 */
function useApplyDoubaoStatus() {
  const queryClient = useQueryClient();
  return (status: DoubaoAccountStatus) => {
    queryClient.setQueryData(queryKeys.doubao.status(), status);
    void queryClient.invalidateQueries({ queryKey: queryKeys.aiProviders.list() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.generation.providers() });
  };
}

export function useStartDoubaoLogin() {
  const doubao = useDoubaoGateway();
  const apply = useApplyDoubaoStatus();
  return useMutation({
    mutationFn: () => doubao.startLogin(),
    onSuccess: apply,
  });
}

export function useRefreshDoubaoLogin() {
  const doubao = useDoubaoGateway();
  const apply = useApplyDoubaoStatus();
  return useMutation({
    mutationFn: () => doubao.refreshLogin(),
    onSuccess: apply,
  });
}

export function useLogoutDoubao() {
  const doubao = useDoubaoGateway();
  const apply = useApplyDoubaoStatus();
  return useMutation({
    mutationFn: () => doubao.logout(),
    onSuccess: apply,
  });
}
