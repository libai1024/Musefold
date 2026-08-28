'use client';

import type {
  CreateGenerationInput,
  CreateWorkbenchSession,
  GenerationJob,
  UpdateWorkbenchSession,
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

export function useSessionList(query: WorkbenchSessionListQuery = {}) {
  const { gateway } = usePlatform();
  return useQuery({
    queryKey: queryKeys.workbench.sessions(query),
    queryFn: () => gateway.workbench.listSessions(query),
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

export function useProviders() {
  const { gateway } = usePlatform();
  return useQuery({
    queryKey: queryKeys.generation.providers(),
    queryFn: () => gateway.generation.listProviders(),
    staleTime: 60_000,
  });
}
