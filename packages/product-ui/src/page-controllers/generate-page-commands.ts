import { useCallback, type MutableRefObject } from "react";
import {
  applyPromptToGeneration,
  canCancelGeneration,
  composerToGenerationRequest,
  generationRequestToPromptDraft,
  type HistoryGateway,
} from "@musefold/domain";
import type { QueryClient } from "@tanstack/react-query";
import type { WorkbenchSessionListItemViewModel } from "../models";
import type { WorkbenchDraftSyncController } from "../workbench/useWorkbenchDraftSyncController";
import type { WorkbenchSessionController } from "../workbench/useWorkbenchSessionController";
import {
  latestWorkbenchGenerationSnapshot,
  sortWorkbenchGenerationSnapshots,
  upsertWorkbenchGenerationSnapshot,
} from "../workbench/generationSnapshots";
import {
  DEFAULT_WORKBENCH_SESSION_LIST_KEY,
  asPagedItems,
  dropListCache,
  replaceListCache,
  upsertListCache,
} from "./paged-items";
import type { GeneratePageControllerDeps } from "./types";
import {
  DEFAULT_GENERATE_JOB_PAGE_LIMIT,
  GENERATE_PAGE_HISTORY_RESTORE_LIMIT,
  GENERATE_PAGE_RATIO_SIZES,
  areWorkbenchDraftsEqual,
  collectGatewayPages,
  generatePageRatio,
  type GeneratePageDraft,
  type GeneratePageJob,
  type GeneratePagePrompt,
  type GeneratePagePromptRef,
  type GeneratePageQuality,
  type GeneratePageRatio,
  type GeneratePageSession,
} from "./generate-page-model";

type SessionListResult<TSession> =
  | TSession[]
  | { items: TSession[]; nextCursor?: string | null };

export interface GeneratePageCommandContext<TSession extends GeneratePageSession> {
  wired: GeneratePageControllerDeps & {
    listFn?: () => Promise<SessionListResult<TSession>>;
  };
  queryClient: QueryClient;
  queryKey: readonly unknown[];
  workbenchRef: MutableRefObject<TSession | null>;
  currentDraft: GeneratePageDraft;
  sessions: TSession[];
  libraryItems: GeneratePagePromptRef[];
  promptText: string;
  selectedPromptId: string | null;
  ratio: GeneratePageRatio;
  quality: GeneratePageQuality;
  job: GeneratePageJob | null;
  savingPromptJobId: string | null;
  retryingJobId: string | null;
  draftSync: WorkbenchDraftSyncController<TSession, GeneratePageDraft>;
  sessionController: WorkbenchSessionController<TSession>;
  commitWorkbench: (next: TSession | null) => void;
  applyDraft: (session: TSession | null, prompts: GeneratePagePromptRef[]) => void;
  resetComposer: () => void;
  updateWorkbenchJob: (job: GeneratePageJob) => void;
  invalidateSessions: () => void;
  setPromptText: (value: string) => void;
  setSelectedPromptId: (value: string | null) => void;
  setSelectedPrompt: (value: GeneratePagePromptRef | null) => void;
  setRatio: (value: GeneratePageRatio) => void;
  setQuality: (value: GeneratePageQuality) => void;
  setJob: (value: GeneratePageJob | null) => void;
  setWorkbenchJobs: (
    value: GeneratePageJob[] | ((current: GeneratePageJob[]) => GeneratePageJob[]),
  ) => void;
  setTrackedGenerationJobs: (
    value: GeneratePageJob[] | ((current: GeneratePageJob[]) => GeneratePageJob[]),
  ) => void;
  setActionError: (value: string | null) => void;
  setSavingPromptJobId: (value: string | null) => void;
  setSavedPromptJobId: (value: string | null) => void;
  setRetryingJobId: (value: string | null) => void;
}

async function listSessionJobs(
  history: HistoryGateway | undefined,
  query: { limit: number; sessionId?: string },
): Promise<GeneratePageJob[]> {
  if (!history) return [];
  const items = await collectGatewayPages((cursor) =>
    history.listGenerationHistory({
      ...query,
      ...(cursor ? { cursor } : {}),
    }),
  );
  return sortWorkbenchGenerationSnapshots(items);
}

async function flushCurrentDraft<TSession extends GeneratePageSession>(
  ctx: GeneratePageCommandContext<TSession>,
): Promise<boolean> {
  const current = ctx.workbenchRef.current;
  if (!current || areWorkbenchDraftsEqual(current.draft, ctx.currentDraft)) return true;
  try {
    return Boolean(await ctx.draftSync.flush());
  } catch {
    return false;
  }
}

async function resolveSessionTarget<TSession extends GeneratePageSession>(
  ctx: GeneratePageCommandContext<TSession>,
  sessionId: string,
): Promise<TSession | undefined> {
  let target = ctx.sessions.find((item) => item.id === sessionId);
  if (ctx.workbenchRef.current?.id === sessionId) {
    if (!(await flushCurrentDraft(ctx))) return undefined;
    target = ctx.workbenchRef.current ?? target;
  }
  return target;
}

export function useGeneratePageCommands<TSession extends GeneratePageSession>(
  ctx: GeneratePageCommandContext<TSession>,
) {
  const beginNewDesign = useCallback(async (): Promise<boolean> => {
    if (!(await flushCurrentDraft(ctx))) return false;
    ctx.draftSync.reset();
    ctx.wired.onShowGenerate?.();
    ctx.commitWorkbench(null);
    ctx.resetComposer();
    return true;
  }, [ctx]);

  const applyPrompt = useCallback(
    async (prompt: GeneratePagePrompt) => {
      await ctx.wired.prompts?.usePrompt(prompt.id, { action: "apply" }).catch(() => undefined);
      const request = applyPromptToGeneration(prompt, {
        quality: ctx.quality,
        aspectRatio: ctx.ratio,
      });
      if (!(await beginNewDesign())) return false;
      ctx.setPromptText(request.prompt);
      ctx.setSelectedPromptId(prompt.id);
      ctx.setSelectedPrompt({ id: prompt.id, title: prompt.title, content: prompt.content });
      return true;
    },
    [beginNewDesign, ctx],
  );

  const reuse = useCallback(
    async (nextJob: GeneratePageJob) => {
      if (!(await flushCurrentDraft(ctx))) return;
      ctx.draftSync.reset();
      ctx.commitWorkbench(null);
      ctx.setWorkbenchJobs([nextJob]);
      ctx.setJob(nextJob);
      ctx.setPromptText(nextJob.request.prompt);
      ctx.setSelectedPromptId(nextJob.promptId);
      ctx.setSelectedPrompt(
        ctx.libraryItems.find((prompt) => prompt.id === nextJob.promptId) ?? null,
      );
      ctx.setRatio(generatePageRatio(nextJob.request.aspectRatio));
      ctx.setQuality(nextJob.request.quality);
      ctx.wired.onShowGenerate?.();
      ctx.setActionError(null);
      if (!nextJob.sessionId) {
        ctx.wired.onSessionUrlChange?.(null);
        return;
      }
      try {
        const [restoredWorkbench, restoredRuns] = await Promise.all([
          ctx.wired.workbench.getWorkbenchSession(nextJob.sessionId) as Promise<TSession>,
          listSessionJobs(ctx.wired.history, {
            limit: GENERATE_PAGE_HISTORY_RESTORE_LIMIT,
            sessionId: nextJob.sessionId,
          }),
        ]);
        ctx.commitWorkbench(restoredWorkbench);
        ctx.setTrackedGenerationJobs((current) =>
          upsertWorkbenchGenerationSnapshot(current, nextJob),
        );
        ctx.setWorkbenchJobs(restoredRuns);
        ctx.wired.onSessionUrlChange?.(restoredWorkbench.id);
      } catch (error) {
        ctx.setActionError(error instanceof Error ? error.message : "无法恢复工作台会话");
      }
    },
    [ctx],
  );

  const openSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === ctx.workbenchRef.current?.id) {
        ctx.wired.onShowGenerate?.();
        return ctx.workbenchRef.current;
      }
      if (!(await flushCurrentDraft(ctx))) return null;
      ctx.sessionController.setError(null);
      ctx.setActionError(null);
      let restoredRuns: GeneratePageJob[] = [];
      try {
        const restoredWorkbench = await ctx.sessionController.open(sessionId, async (id) => {
          const [nextWorkbench, nextRuns] = await Promise.all([
            ctx.wired.workbench.getWorkbenchSession(id) as Promise<TSession>,
            listSessionJobs(ctx.wired.history, {
              limit: DEFAULT_GENERATE_JOB_PAGE_LIMIT,
              sessionId: id,
            }),
          ]);
          restoredRuns = nextRuns;
          return nextWorkbench;
        });
        if (!restoredWorkbench) return null;
        ctx.draftSync.reset();
        ctx.commitWorkbench(restoredWorkbench);
        ctx.applyDraft(restoredWorkbench, ctx.libraryItems);
        ctx.setWorkbenchJobs(restoredRuns);
        ctx.setJob(latestWorkbenchGenerationSnapshot(restoredRuns));
        ctx.wired.onShowGenerate?.();
        ctx.wired.onSessionUrlChange?.(restoredWorkbench.id);
        return restoredWorkbench;
      } catch (error) {
        const message = error instanceof Error ? error.message : "无法恢复工作台会话";
        ctx.sessionController.setError(message);
        ctx.setActionError(message);
        return null;
      }
    },
    [ctx],
  );

  const refreshSessions = useCallback(async () => {
    try {
      await ctx.sessionController.refresh(async () => {
        const items = (
          ctx.wired.listFn
            ? asPagedItems<TSession>(await ctx.wired.listFn())
            : await ctx.wired.workbench.listWorkbenchSessions({
                ...DEFAULT_WORKBENCH_SESSION_LIST_KEY,
              })
        ).items as TSession[];
        ctx.queryClient.setQueryData(ctx.queryKey, (current) =>
          replaceListCache(current, items),
        );
        return items;
      });
    } catch (error) {
      ctx.sessionController.setError(
        error instanceof Error ? error.message : "无法读取最近对话",
      );
    }
  }, [ctx]);

  const archiveSession = useCallback(
    async (sessionId: string) => {
      ctx.sessionController.setError(null);
      ctx.setActionError(null);
      try {
        const target = await resolveSessionTarget(ctx, sessionId);
        if (!target) return;
        const archived = (await ctx.wired.workbench.updateWorkbenchSession(target.id, {
          expectedVersion: target.version,
          archived: true,
        })) as TSession;
        ctx.sessionController.remove(archived.id);
        ctx.queryClient.setQueryData(ctx.queryKey, (current) =>
          dropListCache(current, archived.id),
        );
        void ctx.invalidateSessions();
        if (ctx.workbenchRef.current?.id === archived.id) {
          ctx.draftSync.reset();
          ctx.commitWorkbench(null);
          ctx.resetComposer();
          ctx.wired.onShowGenerate?.();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "无法归档对话";
        ctx.setActionError(message);
        await refreshSessions();
        ctx.sessionController.setError(message);
      }
    },
    [ctx, refreshSessions],
  );

  const renameSession = useCallback(
    async (item: WorkbenchSessionListItemViewModel, title: string) => {
      ctx.sessionController.setError(null);
      ctx.setActionError(null);
      try {
        const target = await resolveSessionTarget(ctx, item.id);
        if (!target) return;
        const renamed = (await ctx.wired.workbench.updateWorkbenchSession(target.id, {
          expectedVersion: target.version,
          title,
        })) as TSession;
        ctx.sessionController.upsert(renamed);
        ctx.queryClient.setQueryData(ctx.queryKey, (current) =>
          upsertListCache(current, renamed),
        );
        void ctx.invalidateSessions();
        if (ctx.workbenchRef.current?.id === renamed.id) ctx.commitWorkbench(renamed);
      } catch (error) {
        const message = error instanceof Error ? error.message : "无法重命名对话";
        ctx.setActionError(message);
        await refreshSessions();
        ctx.sessionController.setError(message);
      }
    },
    [ctx, refreshSessions],
  );

  const deleteSession = useCallback(
    async (item: WorkbenchSessionListItemViewModel) => {
      ctx.sessionController.setError(null);
      ctx.setActionError(null);
      try {
        const target = await resolveSessionTarget(ctx, item.id);
        if (!target) return;
        const deleted = (await ctx.wired.workbench.deleteWorkbenchSession(
          target.id,
          target.version,
        )) as TSession;
        ctx.sessionController.remove(deleted.id);
        ctx.queryClient.setQueryData(ctx.queryKey, (current) =>
          dropListCache(current, deleted.id),
        );
        void ctx.invalidateSessions();
        if (ctx.workbenchRef.current?.id === deleted.id) {
          ctx.draftSync.reset();
          ctx.commitWorkbench(null);
          ctx.resetComposer();
          ctx.wired.onShowGenerate?.();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "无法删除对话";
        ctx.setActionError(message);
        await refreshSessions();
        ctx.sessionController.setError(message);
      }
    },
    [ctx, refreshSessions],
  );

  const submit = useCallback(async () => {
    if (!ctx.wired.canGenerate || !ctx.wired.generation) return;
    ctx.setActionError(null);
    try {
      const request = composerToGenerationRequest({
        prompt: ctx.promptText,
        promptId: ctx.selectedPromptId,
        size: GENERATE_PAGE_RATIO_SIZES[ctx.ratio],
        aspectRatio: ctx.ratio,
        quality: ctx.quality,
      });
      const submissionRevision = ctx.draftSync.captureRevision();
      let currentWorkbench = ctx.workbenchRef.current;
      if (!currentWorkbench) {
        currentWorkbench = (await ctx.wired.workbench.createWorkbenchSession({
          title: ctx.promptText.trim().slice(0, 120) || "未命名创作",
          draft: ctx.currentDraft,
        })) as TSession;
        if (!ctx.draftSync.isRevisionCurrent(submissionRevision)) return;
        ctx.commitWorkbench(currentWorkbench);
      } else {
        currentWorkbench = (await ctx.draftSync.flush()) as TSession | null;
        if (!currentWorkbench) return;
      }
      ctx.wired.onSessionUrlChange?.(currentWorkbench.id);
      const nextJob = await ctx.wired.generation.createGeneration(
        { ...request, sessionId: currentWorkbench.id },
        (ctx.wired.createIdempotencyKey ?? (() => crypto.randomUUID()))(),
      );
      ctx.setJob(nextJob);
      ctx.updateWorkbenchJob(nextJob);
      ctx.wired.onHistoryJob?.(nextJob);
    } catch (error) {
      ctx.setActionError(error instanceof Error ? error.message : "无法创建生成任务");
    }
  }, [ctx]);

  const cancel = useCallback(async () => {
    if (!ctx.job || !ctx.wired.generation || !canCancelGeneration(ctx.job)) return;
    ctx.setActionError(null);
    try {
      const nextJob = await ctx.wired.generation.cancelGeneration(ctx.job.id);
      ctx.setJob(nextJob);
      ctx.updateWorkbenchJob(nextJob);
      ctx.wired.onHistoryJob?.(nextJob);
    } catch (error) {
      ctx.setActionError(error instanceof Error ? error.message : "无法取消任务");
    }
  }, [ctx]);

  const createPromptFromGeneration = useCallback(
    async (targetJob: GeneratePageJob) => {
      if (!ctx.wired.prompts) {
        throw new Error("useGeneratePageController requires prompts to save a prompt");
      }
      const created = await ctx.wired.prompts.createPrompt(
        generationRequestToPromptDraft(targetJob.request),
      );
      ctx.wired.onLibraryPrompt?.(created);
      return created;
    },
    [ctx],
  );

  const savePrompt = useCallback(
    async (targetJob: GeneratePageJob) => {
      if (targetJob.status !== "succeeded" || ctx.savingPromptJobId === targetJob.id) return;
      ctx.setSavingPromptJobId(targetJob.id);
      ctx.setActionError(null);
      try {
        await createPromptFromGeneration(targetJob);
        ctx.setSavedPromptJobId(targetJob.id);
      } catch (error) {
        ctx.setActionError(error instanceof Error ? error.message : "无法存为提示词");
      } finally {
        ctx.setSavingPromptJobId(null);
      }
    },
    [createPromptFromGeneration, ctx],
  );

  const retry = useCallback(
    async (targetJob: GeneratePageJob) => {
      if (
        !ctx.wired.generation ||
        !["failed", "cancelled"].includes(targetJob.status) ||
        ctx.retryingJobId === targetJob.id
      ) {
        return;
      }
      ctx.setRetryingJobId(targetJob.id);
      ctx.setActionError(null);
      try {
        const nextJob = await ctx.wired.generation.retryGeneration(
          targetJob.id,
          (ctx.wired.createIdempotencyKey ?? (() => crypto.randomUUID()))(),
        );
        ctx.setJob(nextJob);
        ctx.updateWorkbenchJob(nextJob);
        ctx.wired.onHistoryJob?.(nextJob);
      } catch (error) {
        ctx.setActionError(error instanceof Error ? error.message : "无法重试任务");
      } finally {
        ctx.setRetryingJobId(null);
      }
    },
    [ctx],
  );

  const useCloudDraft = useCallback(() => {
    if (!ctx.draftSync.conflict) return;
    const latest = ctx.draftSync.conflict;
    ctx.draftSync.useRemoteDraft();
    ctx.applyDraft(latest, ctx.libraryItems);
    ctx.setActionError(null);
  }, [ctx]);

  const overwriteCloudDraft = useCallback(async () => {
    if (!ctx.draftSync.conflict) return;
    ctx.setActionError(null);
    try {
      await ctx.draftSync.overwriteRemoteDraft();
    } catch (error) {
      if (!ctx.wired.isConflictError?.(error)) {
        ctx.setActionError(error instanceof Error ? error.message : "无法保存本机草稿");
      }
    }
  }, [ctx]);

  return {
    beginNewDesign,
    applyPrompt,
    reuse,
    openSession,
    refreshSessions,
    archiveSession,
    renameSession,
    deleteSession,
    submit,
    cancel,
    createPromptFromGeneration,
    savePrompt,
    retry,
    useCloudDraft,
    overwriteCloudDraft,
  };
}
