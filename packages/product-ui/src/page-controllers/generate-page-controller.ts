import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import type { GenerationSavePromptState } from "../workbench/GenerationSavePromptAction";
import type { WorkbenchSessionListItemViewModel } from "../models";
import {
  activeWorkbenchGenerationSnapshots,
  latestWorkbenchGenerationSnapshot,
  sortWorkbenchGenerationSnapshots,
  upsertWorkbenchGenerationSnapshot,
} from "../workbench/generationSnapshots";
import { useWorkbenchDraftSyncController } from "../workbench/useWorkbenchDraftSyncController";
import { useWorkbenchGenerationSyncController } from "../workbench/useWorkbenchGenerationSyncController";
import { useWorkbenchSessionController } from "../workbench/useWorkbenchSessionController";
import { useGeneratePageCommands } from "./generate-page-commands";
import {
  DEFAULT_LIBRARY_PAGE_LIST_KEY,
  DEFAULT_WORKBENCH_SESSION_LIST_KEY,
  dropListCache,
  itemsFromQueryData,
  replaceListCache,
  upsertListCache,
} from "./paged-items";
import { musefoldQueryKeys } from "./query-client";
import { requirePageControllerDeps, type GeneratePageControllerDeps } from "./types";
import {
  GENERATE_PAGE_RATIO_SIZES,
  areWorkbenchDraftsEqual,
  buildWorkbenchDraft,
  generatePageSessionItems,
  workbenchRatio,
  type GeneratePageJob,
  type GeneratePagePrompt,
  type GeneratePagePromptRef,
  type GeneratePageQuality,
  type GeneratePageRatio,
  type GeneratePageSession,
} from "./generate-page-model";

export type { GeneratePageControllerDeps };
export {
  areWorkbenchDraftsEqual,
  buildWorkbenchDraft,
  collectGatewayPages,
  type GeneratePagePromptRef,
  type GeneratePageQuality,
  type GeneratePageRatio,
  type GeneratePageSession,
  type WorkbenchDraftInput,
} from "./generate-page-model";

type SessionListResult<TSession> =
  | TSession[]
  | { items: TSession[]; nextCursor?: string | null };

export interface GeneratePageHydrateInput<TSession extends GeneratePageSession> {
  sessions: TSession[];
  selected: TSession | null;
  snapshots: GeneratePageJob[];
  sessionJobs: GeneratePageJob[];
  prompts?: GeneratePagePromptRef[];
}

export interface GeneratePageController<TSession extends GeneratePageSession = GeneratePageSession> {
  promptText: string;
  setPromptText: (value: string) => void;
  ratio: GeneratePageRatio;
  setRatio: (value: GeneratePageRatio) => void;
  quality: GeneratePageQuality;
  setQuality: (value: GeneratePageQuality) => void;
  selectedPrompt: GeneratePagePromptRef | null;
  clearPromptReference: () => void;
  canGenerate: boolean;
  job: GeneratePageJob | null;
  jobs: GeneratePageJob[];
  savePromptState: (job: GeneratePageJob) => GenerationSavePromptState;
  retrying: (job: GeneratePageJob) => boolean;
  actionError: string | null;
  draftSaveStatus: ReturnType<typeof useWorkbenchDraftSyncController>["status"];
  draftConflict: TSession | null;
  useCloudDraft: () => void;
  overwriteCloudDraft: () => Promise<void>;
  submit: () => Promise<void>;
  cancel: () => Promise<void>;
  savePrompt: (job: GeneratePageJob) => Promise<void>;
  retry: (job: GeneratePageJob) => Promise<void>;
  reuse: (job: GeneratePageJob) => Promise<void>;
  applyPrompt: (prompt: GeneratePagePrompt) => Promise<boolean>;
  session: TSession | null;
  sessionItems: WorkbenchSessionListItemViewModel[];
  sessionListLoading: boolean;
  sessionListError: string | null;
  beginNewDesign: () => Promise<boolean>;
  openSession: (id: string) => Promise<TSession | null>;
  archiveSession: (id: string) => Promise<void>;
  renameSession: (item: WorkbenchSessionListItemViewModel, title: string) => Promise<void>;
  deleteSession: (item: WorkbenchSessionListItemViewModel) => Promise<void>;
  refreshSessions: () => Promise<void>;
  upsertJob: (job: GeneratePageJob) => void;
  dropJob: (id: string) => void;
  createPromptFromGeneration: (job: GeneratePageJob) => Promise<GeneratePagePrompt>;
  hydrate: (input: GeneratePageHydrateInput<TSession>) => void;
  resetDraft: () => void;
  setActionError: (message: string | null) => void;
  libraryItems: GeneratePagePromptRef[];
}

export function useGeneratePageController<TSession extends GeneratePageSession = GeneratePageSession>(
  deps: GeneratePageControllerDeps & {
    listFn?: () => Promise<SessionListResult<TSession>>;
  },
): GeneratePageController<TSession> {
  const wired = requirePageControllerDeps(deps, "useGeneratePageController");
  const depsRef = useRef(wired);
  depsRef.current = wired;
  const queryClient = useQueryClient();
  const sessionController = useWorkbenchSessionController<TSession>();
  const {
    replace: replaceWorkbenchSessions,
    upsert: upsertWorkbenchSession,
    remove: removeWorkbenchSession,
    select: selectWorkbenchSession,
  } = sessionController;

  const [workbench, setWorkbench] = useState<TSession | null>(null);
  const [promptText, setPromptText] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<GeneratePagePromptRef | null>(null);
  const [ratio, setRatio] = useState<GeneratePageRatio>("1:1");
  const [quality, setQuality] = useState<GeneratePageQuality>("medium");
  const [job, setJob] = useState<GeneratePageJob | null>(null);
  const [workbenchJobs, setWorkbenchJobs] = useState<GeneratePageJob[]>([]);
  const [trackedGenerationJobs, setTrackedGenerationJobs] = useState<GeneratePageJob[]>([]);
  const [savingPromptJobId, setSavingPromptJobId] = useState<string | null>(null);
  const [savedPromptJobId, setSavedPromptJobId] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const workbenchRef = useRef<TSession | null>(null);

  const listKey = wired.listKey ?? DEFAULT_WORKBENCH_SESSION_LIST_KEY;
  const queryKey = musefoldQueryKeys.workbench.list(listKey);
  const sessionQuery = useQuery<unknown, Error>({
    queryKey,
    queryFn: () =>
      wired.listFn
        ? wired.listFn()
        : wired.workbench.listWorkbenchSessions({ ...DEFAULT_WORKBENCH_SESSION_LIST_KEY }),
    placeholderData: keepPreviousData,
    enabled: wired.listEnabled ?? true,
  });
  const sessions = itemsFromQueryData<TSession>(sessionQuery.data);

  const libraryQuery = useQuery<unknown, Error>({
    queryKey: musefoldQueryKeys.library.list(DEFAULT_LIBRARY_PAGE_LIST_KEY),
    queryFn: () =>
      wired.prompts
        ? wired.prompts.listPrompts({ ...DEFAULT_LIBRARY_PAGE_LIST_KEY })
        : Promise.resolve({ items: [], nextCursor: null }),
    enabled: Boolean(wired.prompts),
    placeholderData: keepPreviousData,
  });
  const libraryItems = itemsFromQueryData<GeneratePagePromptRef>(libraryQuery.data);

  const currentDraft = useMemo(
    () =>
      buildWorkbenchDraft({
        prompt: promptText,
        selectedPromptId,
        size: GENERATE_PAGE_RATIO_SIZES[ratio],
        aspectRatio: ratio,
        quality,
      }),
    [promptText, quality, ratio, selectedPromptId],
  );

  const runningWorkbenchSessionIds = useMemo(
    () =>
      new Set(
        activeWorkbenchGenerationSnapshots(trackedGenerationJobs)
          .map((item) => item.sessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    [trackedGenerationJobs],
  );
  const sessionItems = useMemo(
    () => generatePageSessionItems(sessions, workbench?.id ?? null, runningWorkbenchSessionIds),
    [runningWorkbenchSessionIds, sessions, workbench?.id],
  );

  const applyDraft = useCallback((session: TSession | null, promptItems: GeneratePagePromptRef[]) => {
    if (!session) {
      setPromptText("");
      setSelectedPromptId(null);
      setSelectedPrompt(null);
      setRatio("1:1");
      setQuality("medium");
      return;
    }
    const refId = session.draft.promptReferenceIds[0] ?? null;
    setPromptText(session.draft.prompt);
    setSelectedPromptId(refId);
    setSelectedPrompt(promptItems.find((prompt) => prompt.id === refId) ?? null);
    setRatio(workbenchRatio(session));
    setQuality(session.draft.params.quality ?? "medium");
  }, []);

  const commitWorkbench = useCallback(
    (next: TSession | null) => {
      workbenchRef.current = next;
      setWorkbench(next);
      selectWorkbenchSession(next?.id ?? null);
      if (!next) return;
      if (next.archivedAt || next.deletedAt) {
        removeWorkbenchSession(next.id);
        queryClient.setQueryData(queryKey, (current) => dropListCache(current, next.id));
        return;
      }
      upsertWorkbenchSession(next);
      queryClient.setQueryData(queryKey, (current) => upsertListCache(current, next));
    },
    [queryClient, queryKey, removeWorkbenchSession, selectWorkbenchSession, upsertWorkbenchSession],
  );

  const resetComposer = useCallback(() => {
    applyDraft(null, []);
    setWorkbenchJobs([]);
    setJob(null);
    setActionError(null);
    depsRef.current.onSessionUrlChange?.(null);
  }, [applyDraft]);

  const draftSync = useWorkbenchDraftSyncController({
    session: workbench,
    draft: currentDraft,
    areDraftsEqual: areWorkbenchDraftsEqual,
    saveDraft: (current, draft) =>
      wired.workbench.updateWorkbenchSession(current.id, {
        expectedVersion: current.version,
        draft,
      }) as Promise<TSession>,
    loadLatest: (current) => wired.workbench.getWorkbenchSession(current.id) as Promise<TSession>,
    isConflictError: wired.isConflictError ?? (() => false),
    onCommit: commitWorkbench,
    onError: (error) => setActionError(error instanceof Error ? error.message : "草稿保存失败"),
  });

  const updateWorkbenchJob = useCallback((nextJob: GeneratePageJob) => {
    setTrackedGenerationJobs((current) => upsertWorkbenchGenerationSnapshot(current, nextJob));
    setWorkbenchJobs((current) => {
      if (nextJob.sessionId !== workbenchRef.current?.id) return current;
      return upsertWorkbenchGenerationSnapshot(current, nextJob);
    });
  }, []);

  const upsertJob = useCallback(
    (nextJob: GeneratePageJob) => {
      updateWorkbenchJob(nextJob);
      setJob((current) => (current?.id === nextJob.id ? nextJob : current));
    },
    [updateWorkbenchJob],
  );

  const dropJob = useCallback((id: string) => {
    setTrackedGenerationJobs((current) => current.filter((item) => item.id !== id));
    setWorkbenchJobs((current) => {
      const remaining = current.filter((item) => item.id !== id);
      setJob((active) =>
        active?.id === id ? latestWorkbenchGenerationSnapshot(remaining) : active,
      );
      return sortWorkbenchGenerationSnapshots(remaining);
    });
  }, []);

  const generation = wired.generation;
  useWorkbenchGenerationSyncController<GeneratePageJob>({
    jobs: trackedGenerationJobs,
    enabled: Boolean(generation),
    getSnapshot: useCallback(
      (id: string) => {
        const port = depsRef.current.generation;
        if (!port) {
          throw new Error("useGeneratePageController requires generation to sync jobs");
        }
        return port.getGeneration(id);
      },
      [],
    ),
    streamEvents: useCallback((id, afterSeq, onEvent, signal) => {
      const port = depsRef.current.generation;
      return port ? port.streamGenerationEvents(id, afterSeq, onEvent, signal) : Promise.resolve();
    }, []),
    onSnapshot: useCallback(
      (next) => {
        upsertJob(next);
        depsRef.current.onHistoryJob?.(next);
      },
      [upsertJob],
    ),
    onAuthRequired: useCallback(() => depsRef.current.onAuthRequired?.(), []),
    onError: useCallback((error: unknown) => {
      setActionError(error instanceof Error ? error.message : "任务状态更新失败");
    }, []),
  });

  const invalidateSessions = useCallback(
    () => queryClient.invalidateQueries({ queryKey: musefoldQueryKeys.workbench.all }),
    [queryClient],
  );

  const hydrate = useCallback(
    (input: GeneratePageHydrateInput<TSession>) => {
      queryClient.setQueryData(queryKey, (current) => replaceListCache(current, input.sessions));
      replaceWorkbenchSessions(input.sessions);
      sessionController.setError(null);
      setTrackedGenerationJobs(sortWorkbenchGenerationSnapshots(input.snapshots));
      commitWorkbench(input.selected);
      setWorkbenchJobs(sortWorkbenchGenerationSnapshots(input.sessionJobs));
      setJob(latestWorkbenchGenerationSnapshot(input.sessionJobs));
      applyDraft(input.selected, input.prompts ?? []);
      depsRef.current.onSessionUrlChange?.(input.selected?.id ?? null);
    },
    [applyDraft, commitWorkbench, queryClient, queryKey, replaceWorkbenchSessions, sessionController.setError],
  );

  const commands = useGeneratePageCommands({
    wired,
    queryClient,
    queryKey,
    workbenchRef,
    currentDraft,
    sessions,
    libraryItems,
    promptText,
    selectedPromptId,
    ratio,
    quality,
    job,
    savingPromptJobId,
    retryingJobId,
    draftSync,
    sessionController,
    commitWorkbench,
    applyDraft,
    resetComposer,
    updateWorkbenchJob,
    invalidateSessions,
    setPromptText,
    setSelectedPromptId,
    setSelectedPrompt,
    setRatio,
    setQuality,
    setJob,
    setWorkbenchJobs,
    setTrackedGenerationJobs,
    setActionError,
    setSavingPromptJobId,
    setSavedPromptJobId,
    setRetryingJobId,
  });

  const clearPromptReference = useCallback(() => {
    setSelectedPromptId(null);
    setSelectedPrompt(null);
  }, []);

  const savePromptState = useCallback(
    (targetJob: GeneratePageJob): GenerationSavePromptState =>
      targetJob.id === savedPromptJobId
        ? "saved"
        : targetJob.id === savingPromptJobId
          ? "saving"
          : "idle",
    [savedPromptJobId, savingPromptJobId],
  );

  const retrying = useCallback(
    (targetJob: GeneratePageJob) => retryingJobId === targetJob.id,
    [retryingJobId],
  );

  return {
    promptText,
    setPromptText,
    ratio,
    setRatio,
    quality,
    setQuality,
    selectedPrompt,
    clearPromptReference,
    canGenerate: Boolean(wired.canGenerate),
    job,
    jobs: workbenchJobs,
    savePromptState,
    retrying,
    actionError,
    draftSaveStatus: draftSync.status,
    draftConflict: draftSync.conflict,
    useCloudDraft: commands.useCloudDraft,
    overwriteCloudDraft: commands.overwriteCloudDraft,
    submit: commands.submit,
    cancel: commands.cancel,
    savePrompt: commands.savePrompt,
    retry: commands.retry,
    reuse: commands.reuse,
    applyPrompt: commands.applyPrompt,
    session: workbench,
    sessionItems,
    sessionListLoading: sessionController.state.loading,
    sessionListError: sessionController.state.error,
    beginNewDesign: commands.beginNewDesign,
    openSession: commands.openSession,
    archiveSession: commands.archiveSession,
    renameSession: commands.renameSession,
    deleteSession: commands.deleteSession,
    refreshSessions: commands.refreshSessions,
    upsertJob,
    dropJob,
    createPromptFromGeneration: commands.createPromptFromGeneration,
    hydrate,
    resetDraft: draftSync.reset,
    setActionError,
    libraryItems,
  };
}
