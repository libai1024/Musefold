'use client';

import type {
  CreateGenerationInput,
  CreateWorkbenchSession,
  GenerationAsset,
  GenerationJob,
  SaveAssetInput,
  UpdateWorkbenchSession,
  UploadReferenceImageInput,
  WorkbenchSession,
  WorkbenchSessionListQuery,
} from '@musefold/contracts';
import { queryKeys, usePlatform } from '@musefold/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

export function useCreateSession() {
  const { gateway } = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkbenchSession) => gateway.workbench.createSession(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() }),
  });
}

export function useUpdateSession() {
  const { gateway } = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateWorkbenchSession }) =>
      gateway.workbench.updateSession(vars.id, vars.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() }),
  });
}

export function useRemoveSession() {
  const { gateway } = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gateway.workbench.removeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() }),
  });
}

/** 会话时间线:按创建时间升序;存在进行中任务时 1.5s 轮询直至终态。 */
export function useSessionJobs(sessionId: string | null) {
  const { gateway } = usePlatform();
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
    refetchInterval: (query) => (hasActiveJob(query.state.data) ? 1_500 : false),
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
    mutationFn: (input: CreateGenerationInput) => gateway.generation.create(input),
    onSuccess: invalidate,
  });
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
    mutationFn: (id: string) => gateway.generation.retry(id),
    onSuccess: invalidate,
  });
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
