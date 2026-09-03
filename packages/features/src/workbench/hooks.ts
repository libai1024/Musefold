'use client';

import type {
  CreateGenerationInput,
  CreateWorkbenchSession,
  GenerationAsset,
  GenerationJob,
  PromptReferenceSelection,
  SaveAssetInput,
  UpdateWorkbenchSession,
  UploadReferenceImageInput,
  WorkbenchSession,
  WorkbenchSessionListQuery,
} from '@musefold/contracts';
import { type GenerationGateway, queryKeys, usePlatform } from '@musefold/platform';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { type PromptReferenceResolution, resolvePromptReferenceDisplay } from './prompt-references';

/** 生成任务的非终态集合:时间线含这些状态时切短轮询。 */
const ACTIVE_STATUSES = new Set<GenerationJob['status']>([
  'pending_approval',
  'queued',
  'running',
  'cancelling',
]);

export function hasActiveJob(jobs: readonly GenerationJob[] | undefined): boolean {
  return (jobs ?? []).some((job) => ACTIVE_STATUSES.has(job.status));
}

/** 会话行状态点:该会话最近一次生成仍在进行。 */
export function sessionHasActiveJob(session: WorkbenchSession): boolean {
  return (
    session.latestJobStatus === 'queued' ||
    session.latestJobStatus === 'running' ||
    session.latestJobStatus === 'cancelling'
  );
}

export function useSessionList(query: WorkbenchSessionListQuery = {}) {
  const { gateway } = usePlatform();
  return useQuery({
    queryKey: queryKeys.workbench.sessions(query),
    queryFn: () => gateway.workbench.listSessions(query),
    // 有会话在生成时短轮询,驱动侧栏状态点翻终态(推送机制随 M5 遗留卡收口)。
    refetchInterval: (q) => (q.state.data?.items.some(sessionHasActiveJob) ? 3_000 : false),
  });
}

/** 归档会话列表:查询语义由宿主过滤,不在客户端从 includeArchived 结果中二次筛选。 */
export function useArchivedSessions(query: WorkbenchSessionListQuery = {}) {
  return useSessionList({ ...query, archivedOnly: true });
}

function useInvalidateWorkbench() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
}

export function useCreateSession() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateWorkbench();
  return useMutation({
    mutationFn: (input: CreateWorkbenchSession) => gateway.workbench.createSession(input),
    onSuccess: invalidate,
  });
}

export function useUpdateSession() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateWorkbench();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateWorkbenchSession }) =>
      gateway.workbench.updateSession(vars.id, vars.patch),
    onSuccess: invalidate,
  });
}

/** 恢复归档会话:带当前版本乐观锁,通过 updateSession 清除 archivedAt。 */
export function useRestoreSession() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateWorkbench();
  return useMutation({
    mutationFn: (vars: {
      id: WorkbenchSession['id'];
      expectedVersion: UpdateWorkbenchSession['expectedVersion'];
    }) =>
      gateway.workbench.updateSession(vars.id, {
        expectedVersion: vars.expectedVersion,
        archived: false,
      }),
    onSuccess: invalidate,
  });
}

export function useRemoveSession() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateWorkbench();
  return useMutation({
    mutationFn: (id: string) => gateway.workbench.removeSession(id),
    onSuccess: invalidate,
  });
}

/**
 * 会话时间线:按创建时间升序;存在进行中任务时 1.5s 轮询直至终态。
 * `pollWhileExternalRun`:宿主侧有进行中的方案运行时(生成回合由主进程稍后才落进本会话账本,
 * 列表里尚无活动任务可触发轮询),同样短轮询,让新回合与进度及时出现在时间线。
 */
export function useSessionJobs(
  sessionId: string | null,
  options: { pollWhileExternalRun?: boolean } = {},
) {
  const { gateway } = usePlatform();
  const externalRun = options.pollWhileExternalRun === true;
  return useQuery({
    queryKey: queryKeys.generation.list({ sessionId: sessionId ?? undefined, limit: 100 }),
    enabled: sessionId != null,
    queryFn: async () => {
      const page = await gateway.generation.list({
        sessionId: sessionId ?? undefined,
        limit: 100,
      });
      return [...page.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    refetchInterval: (query) => (externalRun || hasActiveJob(query.state.data) ? 1_500 : false),
  });
}

function useInvalidateGeneration() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.generation.all() });
    // 会话 updated_at 随生成推进,列表排序需刷新。
    void queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
  };
}

export function useCreateGeneration() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateGeneration();
  return useMutation({
    mutationFn: (intent: Parameters<GenerationGateway['create']>) =>
      gateway.generation.create(...intent),
    onSuccess: invalidate,
  });
}

/** 调用方在用户动作边界创建一次;mutation/transport 重放复用同一组变量。 */
export function createGenerationMutationIntent(
  input: CreateGenerationInput,
): Parameters<GenerationGateway['create']> {
  return [input, crypto.randomUUID()];
}

export function useCancelGeneration() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateGeneration();
  return useMutation({
    mutationFn: (id: string) => gateway.generation.cancel(id),
    onSuccess: invalidate,
  });
}

export function useRetryGeneration() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateGeneration();
  return useMutation({
    mutationFn: (intent: Parameters<GenerationGateway['retry']>) =>
      gateway.generation.retry(...intent),
    onSuccess: invalidate,
  });
}

/** 每次用户点击重试都是新意图;同一 mutation 的网络重放保持键不变。 */
export function createRetryGenerationMutationIntent(
  id: GenerationJob['id'],
): Parameters<GenerationGateway['retry']> {
  return [id, crypto.randomUUID()];
}

/** 删除回合(软删,进历史回收站;时间线与历史列表同步失效)。 */
export function useRemoveGeneration() {
  const { gateway } = usePlatform();
  const invalidate = useInvalidateGeneration();
  return useMutation({
    mutationFn: (id: string) => gateway.generation.remove(id),
    onSuccess: invalidate,
  });
}

/** 参考图上传(草稿态,不触发列表失效;失败由调用方就地提示)。 */
export function useUploadReferenceImage() {
  const { gateway } = usePlatform();
  return useMutation({
    mutationFn: (input: UploadReferenceImageInput) =>
      gateway.generation.uploadReferenceImage(input),
  });
}

/** 保存资产到本地(03/05 §7):桌面系统对话框 / Web 浏览器下载;toast 由调用方按结果提示。 */
export function useSaveAsset() {
  const { gateway } = usePlatform();
  return useMutation({
    mutationFn: (input: SaveAssetInput) => gateway.generation.saveAsset(input),
  });
}

const ASSET_EXT: Record<GenerationAsset['mimeType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** 保存图片的默认文件名:musefold-{资产短 id}.{按 mimeType 的扩展名}。 */
export function assetSaveName(asset: GenerationAsset): string {
  return `musefold-${asset.id.slice(0, 8)}.${ASSET_EXT[asset.mimeType]}`;
}

export function useProviders() {
  const { gateway } = usePlatform();
  return useQuery({
    queryKey: queryKeys.generation.providers(),
    queryFn: () => gateway.generation.listProviders(),
    staleTime: 60_000,
  });
}

/**
 * 草稿引用意图 → 展示解析(托盘卡):逐 promptId 走 owner-safe 的 prompts.get
 * (同 id 多意图经 queryKey 去重);失败不伪造内容,由视图层呈现 unavailable 且可移除。
 */
export function usePromptReferenceResolutions(
  selections: readonly PromptReferenceSelection[],
): PromptReferenceResolution[] {
  const { gateway } = usePlatform();
  const promptIds = [...new Set(selections.map((selection) => selection.promptId))];
  const queries = useQueries({
    queries: promptIds.map((promptId) => ({
      queryKey: queryKeys.prompts.detail(promptId),
      queryFn: () => gateway.prompts.get(promptId),
      retry: false,
    })),
  });
  const queryIndexByPromptId = new Map(promptIds.map((promptId, index) => [promptId, index]));
  return selections.map((selection) => {
    const queryIndex = queryIndexByPromptId.get(selection.promptId);
    const query = queryIndex === undefined ? undefined : queries[queryIndex];
    const state = query?.isError ? 'error' : query?.isSuccess ? 'ready' : 'loading';
    return resolvePromptReferenceDisplay(selection, query?.data, state);
  });
}
