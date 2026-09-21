import type {
  AccountSummary,
  AiProvider,
  AiProviderListModelsInput,
  AiProviderModelList,
  AiProviderTestInput,
  AiProviderTestResult,
  CreateAiProvider,
  SetSyncConsentInput,
  SetSyncEnabled,
  DesktopSyncStatus,
  DoubaoAccountStatus,
  GenerationJob,
  LoginRequest,
  RedeemResult,
  SyncConflictResolution,
  UpdateAiProvider,
} from '@musefold/contracts';
import { ACCOUNT_QUOTA_PER_POINT } from '@musefold/contracts';
import {
  type AiProvidersGateway,
  type MusefoldGateway,
  queryKeys,
  useGateway,
} from '@musefold/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '@musefold/ui/components/sonner';
import {
  consumeQuotaRecovery,
  peekQuotaRecovery,
  resetQuotaRecovery,
} from '../history/spend-recovery-store';
import { useCreateGeneration } from '../workbench/hooks';
import { useRetryAction } from '../workbench/use-retry-action';
import { accountErrorMessage } from './error-messages';
import {
  accountEpoch,
  applyAccountSession,
  assertAccountEpoch,
  beginAccountTransition,
  isAccountRestricted,
  observeAccountSession,
} from './account-session';
import { useRememberedUsername } from './remembered-username';
import { observeLoginInteraction } from './login-interaction';

export function useAccountStatus() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  useEffect(() => observeLoginInteraction(queryClient, gateway), [queryClient, gateway]);
  return useQuery({
    queryKey: queryKeys.account.status(),
    queryFn: async () => {
      const epoch = accountEpoch(queryClient);
      const account = await gateway.account.getStatus();
      assertAccountEpoch(queryClient, epoch);
      observeAccountSession(queryClient, account);
      return account;
    },
    retry: false,
  });
}

export function useLogin() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (input: LoginRequest) => {
      try {
        return await gateway.account.login({ ...input });
      } finally {
        input.password = '';
        input.twoFactorCode = undefined;
      }
    },
    onMutate: () => beginAccountTransition(queryClient),
    onSuccess: async (account, _input, epoch) => {
      assertAccountEpoch(queryClient, epoch);
      useRememberedUsername.getState().remember(account.username);
      await applyAccountSession(queryClient, account, epoch);
    },
  });
}

export function useRegister() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (input: LoginRequest) => {
      try {
        return await gateway.account.register({ ...input });
      } finally {
        input.password = '';
        input.twoFactorCode = undefined;
      }
    },
    onMutate: () => beginAccountTransition(queryClient),
    onSuccess: async (account, _input, epoch) => {
      assertAccountEpoch(queryClient, epoch);
      useRememberedUsername.getState().remember(account.username);
      await applyAccountSession(queryClient, account, epoch);
    },
  });
}

export function useLogout() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => gateway.account.logout(),
    onMutate: () => beginAccountTransition(queryClient),
    onSuccess: async (_result, _input, epoch) => {
      assertAccountEpoch(queryClient, epoch);
      const before = queryClient.getQueryData<AccountSummary>(queryKeys.account.status());
      if (before?.username) useRememberedUsername.getState().remember(before.username);
      await queryClient.cancelQueries();
      assertAccountEpoch(queryClient, epoch);
      // 全量重置:账号状态回到未登录错误分支,其余数据不残留上个会话内容。
      await queryClient.resetQueries();
    },
  });
}

export function useRedeem() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  const retry = useRetryAction();
  const create = useCreateGeneration();
  // Presentation only; durable submission and payment authority remain in the gateway.
  const [recovery, setRecovery] = useState<{
    epoch: number;
    status: 'pending' | 'submitted' | 'failed';
    message: string;
    jobId?: string;
  } | null>(null);
  const mutation = useMutation({
    retry: false,
    mutationFn: (code: string) => {
      if (isAccountRestricted(queryClient.getQueryData(queryKeys.account.status()))) {
        throw new Error('请先完成账号恢复，再使用兑换与生图');
      }
      return gateway.account.redeem(code);
    },
    onMutate: () => {
      setRecovery(null);
      return { epoch: accountEpoch(queryClient), pending: peekQuotaRecovery() };
    },
    onError: (error, _input, context) => {
      if (context && accountEpoch(queryClient) === context.epoch)
        toast.error(accountErrorMessage(error));
    },
    onSuccess: async (result: RedeemResult, _input, context) => {
      const { epoch } = context;
      if (accountEpoch(queryClient) !== epoch) return;
      if (isAccountRestricted(result.account)) {
        resetQuotaRecovery();
        await applyAccountSession(queryClient, result.account, epoch);
        return;
      }
      queryClient.setQueryData(queryKeys.account.status(), result.account);
      // Crediting is already complete. A separate generation failure must not turn it into
      // a redemption error or promise that an unaccepted generation is still being retried.
      toast.success(`兑换成功,到账 ${formatPoints(result.creditedQuota)} 积分`);
      const ownedRecovery = consumeQuotaRecovery(context.pending);
      if (!ownedRecovery) return;
      const pending = ownedRecovery.intent;
      const originalId = pending.kind === 'retry-job' ? pending.jobId : undefined;
      setRecovery({
        epoch,
        status: 'pending',
        message: '额度已到账，正在恢复生成…',
        jobId: originalId,
      });
      try {
        let job: GenerationJob;
        if (pending.kind === 'retry-job') {
          const outcome = await retry.requestAsync({ id: pending.jobId });
          if (!outcome.ok) throw outcome.error;
          job = outcome.job;
        } else {
          // Preserve the original create key and frozen input; never turn a lost reply into
          // a fresh authorization. The shared mutation supplies account guards/invalidation.
          job = await create.mutateAsync([...pending.intent]);
        }
        if (accountEpoch(queryClient) === epoch) {
          const failed = ['failed', 'rejected', 'expired'].includes(job.status);
          setRecovery({
            epoch,
            status: failed ? 'failed' : 'submitted',
            message: failed
              ? `额度已到账，但本次生成未成功：${job.error?.message ?? '请查看原任务。'}`
              : job.status === 'cancelled'
                ? '生成已取消，兑换到账结果不受影响。'
                : '生成请求已提交，请查看任务结果。',
            jobId: job.id,
          });
        }
      } catch (error) {
        if (accountEpoch(queryClient) !== epoch) return;
        const reason = error instanceof Error ? error.message : '暂时无法确认结果，请核对原任务。';
        setRecovery({
          epoch,
          status: 'failed',
          message: `额度已到账，但生成未恢复：${reason}`,
          jobId: originalId,
        });
        // Retry owns a single error notification even when another screen joined it.
        if (pending.kind === 'replay-create') toast.error('生成未恢复', { description: reason });
      } finally {
        ownedRecovery.release();
      }
    },
  });
  return { ...mutation, recovery: recovery?.epoch === accountEpoch(queryClient) ? recovery : null };
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
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.sync.status(),
    queryFn: async () => {
      const epoch = accountEpoch(client);
      const status = await sync.getStatus();
      assertAccountEpoch(client, epoch);
      return status;
    },
    // 同步在后台跑(防抖/60s 兜底轮),状态面板保持新鲜。
    refetchInterval: 5_000,
  });
}

/** 同步动作成功后除状态外还要失效提示词数据(pull 可能带回远端变更)。 */
function useApplySyncResult() {
  const queryClient = useQueryClient();
  return (status: DesktopSyncStatus, epoch: number) => {
    assertAccountEpoch(queryClient, epoch);
    queryClient.setQueryData(queryKeys.sync.status(), status);
    void queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all() });
  };
}

export function useSetSyncEnabled() {
  const sync = useSyncGateway();
  const apply = useApplySyncResult();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ enabled, reviewRef }: SetSyncEnabled) =>
      reviewRef === undefined ? sync.setEnabled(enabled) : sync.setEnabled(enabled, reviewRef),
    onMutate: () => accountEpoch(client),
    onSuccess: (status, _input, epoch) => apply(status, epoch),
  });
}

/** 写入 durable consent(unset→enabled 首次同意 / enabled⇄paused);runtime phase 由宿主派生。 */
export function useSetSyncConsent() {
  const sync = useSyncGateway();
  const apply = useApplySyncResult();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ consent, reviewRef }: SetSyncConsentInput) =>
      reviewRef === undefined ? sync.setConsent(consent) : sync.setConsent(consent, reviewRef),
    onError: () => {
      void client.invalidateQueries({ queryKey: queryKeys.sync.status() });
    },
    onMutate: () => accountEpoch(client),
    onSuccess: (status, _input, epoch) => apply(status, epoch),
  });
}

export function useSyncNow() {
  const sync = useSyncGateway();
  const apply = useApplySyncResult();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => sync.syncNow(),
    onMutate: () => accountEpoch(client),
    onSuccess: (status, _input, epoch) => apply(status, epoch),
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
    onMutate: () => accountEpoch(queryClient),
    onSuccess: (status, _input, epoch) => {
      // apply 已失效 prompts;冲突列表随状态一起刷新,行级错误由调用方就地呈现。
      apply(status, epoch);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sync.conflicts() });
    },
  });
}

// ── 桌面本地连接管理(gateway.aiProviders 生图 / gateway.agentConnections 文本,仅桌面宿主提供)──
// 两个域同形状(AiProvidersGateway),差异只在事实源与缓存分区:用同一组 hook 工厂生成,
// 面板按传入的 hooks 集实例化,不为两个入口复制两份数据面。

export interface ConnectionsHooks {
  useList(): ReturnType<typeof useQuery<AiProvider[]>>;
  useCreate(): ReturnType<typeof useMutation<AiProvider, Error, CreateAiProvider>>;
  useUpdate(): ReturnType<
    typeof useMutation<AiProvider, Error, { id: string; patch: UpdateAiProvider }>
  >;
  useRemove(): ReturnType<typeof useMutation<void, Error, string>>;
  useSetActive(): ReturnType<typeof useMutation<AiProvider, Error, string>>;
  useTest(): ReturnType<typeof useMutation<AiProviderTestResult, Error, AiProviderTestInput>>;
  useListModels(): ReturnType<
    typeof useMutation<AiProviderModelList, Error, AiProviderListModelsInput>
  >;
}

function createConnectionsHooks(options: {
  select(gateway: MusefoldGateway): AiProvidersGateway | undefined;
  missingMessage: string;
  listKey(): readonly unknown[];
  /** 连接变化时额外失效的缓存(如工作台 Composer 的 provider 选项)。 */
  alsoInvalidate?(): readonly (readonly unknown[])[];
}): ConnectionsHooks {
  function useDomain(): AiProvidersGateway {
    const domain = options.select(useGateway());
    if (!domain) throw new Error(options.missingMessage);
    return domain;
  }
  function useInvalidate() {
    const queryClient = useQueryClient();
    return () => {
      void queryClient.invalidateQueries({ queryKey: options.listKey() });
      for (const key of options.alsoInvalidate?.() ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };
  }
  return {
    useList() {
      const domain = useDomain();
      return useQuery({ queryKey: options.listKey(), queryFn: () => domain.list() });
    },
    useCreate() {
      const domain = useDomain();
      const invalidate = useInvalidate();
      return useMutation({
        mutationFn: (input: CreateAiProvider) => domain.create(input),
        onSuccess: invalidate,
      });
    },
    useUpdate() {
      const domain = useDomain();
      const invalidate = useInvalidate();
      return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: UpdateAiProvider }) =>
          domain.update(id, patch),
        onSuccess: invalidate,
      });
    },
    useRemove() {
      const domain = useDomain();
      const invalidate = useInvalidate();
      return useMutation({ mutationFn: (id: string) => domain.remove(id), onSuccess: invalidate });
    },
    useSetActive() {
      const domain = useDomain();
      const invalidate = useInvalidate();
      return useMutation({
        mutationFn: (id: string) => domain.setActive(id),
        onSuccess: invalidate,
      });
    },
    useTest() {
      const domain = useDomain();
      return useMutation({ mutationFn: (input: AiProviderTestInput) => domain.test(input) });
    },
    useListModels() {
      const domain = useDomain();
      return useMutation({
        mutationFn: (input: AiProviderListModelsInput) => domain.listModels(input),
      });
    },
  };
}

/** 生图 Provider:连接变化同时失效工作台 Composer 的 provider 选项(同一份底层数据)。 */
export const AI_PROVIDER_HOOKS = createConnectionsHooks({
  select: (gateway) => gateway.aiProviders,
  missingMessage: '当前宿主不提供本地 AI 连接管理(hasLocalAiProviders=false)',
  listKey: () => queryKeys.aiProviders.list(),
  alsoInvalidate: () => [queryKeys.generation.providers()],
});

/** Agent 文本模型连接:设计方案 Agent / Skill runtime 的 chat/completions 连接。 */
export const AGENT_CONNECTION_HOOKS = createConnectionsHooks({
  select: (gateway) => gateway.agentConnections,
  missingMessage: '当前宿主不提供 Agent 连接管理(hasAgentConnections=false)',
  listKey: () => queryKeys.agentConnections.list(),
});

export const useAiProviders = AI_PROVIDER_HOOKS.useList;
export const useCreateAiProvider = AI_PROVIDER_HOOKS.useCreate;
export const useUpdateAiProvider = AI_PROVIDER_HOOKS.useUpdate;
export const useRemoveAiProvider = AI_PROVIDER_HOOKS.useRemove;
export const useSetActiveAiProvider = AI_PROVIDER_HOOKS.useSetActive;
export const useTestAiProvider = AI_PROVIDER_HOOKS.useTest;
export const useListAiProviderModels = AI_PROVIDER_HOOKS.useListModels;

export const useAgentConnections = AGENT_CONNECTION_HOOKS.useList;
export const useCreateAgentConnection = AGENT_CONNECTION_HOOKS.useCreate;
export const useUpdateAgentConnection = AGENT_CONNECTION_HOOKS.useUpdate;
export const useRemoveAgentConnection = AGENT_CONNECTION_HOOKS.useRemove;
export const useSetActiveAgentConnection = AGENT_CONNECTION_HOOKS.useSetActive;
export const useTestAgentConnection = AGENT_CONNECTION_HOOKS.useTest;
export const useListAgentConnectionModels = AGENT_CONNECTION_HOOKS.useListModels;

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
