import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, CircleUserRound, LoaderCircle } from '@musefold/ui/icons';
import {
  cloudGenerationRequestSchema,
  type AccountSession,
  type GenerationJob,
  type GenerationQuality,
  type GenerationHistoryPage,
  type GenerationHistoryQuery,
  type McpConnectionPage,
  type PromptDocument,
  type PromptPage,
  type WorkbenchSession,
} from '@musefold/contracts';
import {
  applyPromptToGeneration,
  canCancelGeneration,
  formatAccountPoints,
  generationRequestToPromptDraft,
  getProductCapabilities,
} from '@musefold/domain';
import {
  useWorkbenchDraftSyncController,
  useWorkbenchSessionController,
  type WorkbenchSessionListItemViewModel,
  AccountScreen,
  activeWorkbenchGenerationSnapshots,
  ConnectedAppsScreen,
  GenerationResultSurface,
  latestWorkbenchGenerationSnapshot,
  sortWorkbenchGenerationSnapshots,
  upsertWorkbenchGenerationSnapshot,
  workbenchGenerationResultStatus,
  workbenchGenerationStatusLabel,
  useWorkbenchGenerationSyncController,
  ProductSidebarLayout,
} from '@musefold/product-ui';
import { WebSidebar, WebTopbar, type WebView } from './layout/WebNavigation';
import { useKeyboardInset } from './layout/useKeyboardInset';
import { Button, Input } from '@musefold/ui';
import musefoldIconUrl from '../../../website/Musefold/assets/musefold-icon.png';
import { WebGatewayError, type WebGateway } from './runtime';
import { areWorkbenchDraftsEqual, buildWorkbenchDraft } from './workbench-draft';
import { GenerateView } from './views/GenerateView';
import { HistoryView } from './views/HistoryView';
import { PromptLibraryView } from './views/PromptLibraryView';
import { getSafeOAuthReturnTo } from './oauth-return-to';

type View = WebView;
type Ratio = '1:1' | '16:9' | '9:16';

const capabilities = getProductCapabilities('web');
const ratioSizes: Record<Ratio, '1024x1024' | '1536x1024' | '1024x1536'> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
};

const ratioValues: readonly Ratio[] = ['1:1', '16:9', '9:16'];

function workbenchRatio(session: WorkbenchSession): Ratio {
  const value = session.draft.params.aspectRatio;
  return ratioValues.includes(value as Ratio) ? (value as Ratio) : '1:1';
}

function replaceWorkbenchSessionUrl(sessionId: string | null): void {
  const url = new URL(window.location.href);
  if (sessionId) url.searchParams.set('session', sessionId);
  else url.searchParams.delete('session');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

async function listAllGenerationHistory(
  gateway: WebGateway,
  query: GenerationHistoryQuery,
): Promise<GenerationHistoryPage> {
  const items: GenerationJob[] = [];
  let cursor = query.cursor;
  do {
    const page = await gateway.listGenerationHistory({
      ...query,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return {
    items: sortWorkbenchGenerationSnapshots(items),
    nextCursor: null,
  };
}

interface AppProps {
  gateway: WebGateway;
}

export function App({ gateway }: AppProps) {
  useKeyboardInset();
  const [view, setView] = useState<View>('generate');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [session, setSession] = useState<AccountSession | null>(null);
  const [prompts, setPrompts] = useState<PromptPage>({
    items: [],
    nextCursor: null,
  });
  const [promptQuery, setPromptQuery] = useState('');
  const promptSearchRevision = useRef(0);
  const [history, setHistory] = useState<GenerationHistoryPage>({
    items: [],
    nextCursor: null,
  });
  const [connections, setConnections] = useState<McpConnectionPage>({
    items: [],
  });
  const [workbench, setWorkbench] = useState<WorkbenchSession | null>(null);
  const workbenchSessionController = useWorkbenchSessionController<WorkbenchSession>();
  const {
    state: workbenchSessionState,
    replace: replaceWorkbenchSessions,
    upsert: upsertWorkbenchSession,
    remove: removeWorkbenchSession,
    setError: setSessionListError,
    select: selectWorkbenchSession,
    open: openWorkbenchSessionRecord,
    refresh: refreshWorkbenchSessionList,
  } = workbenchSessionController;
  const {
    items: workbenchSessions,
    selectedId: selectedWorkbenchSessionId,
    loading: sessionListLoading,
    error: sessionListError,
  } = workbenchSessionState;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDocument | null>(null);
  const [ratio, setRatio] = useState<Ratio>('1:1');
  const [quality, setQuality] = useState<GenerationQuality>('medium');
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [workbenchJobs, setWorkbenchJobs] = useState<GenerationJob[]>([]);
  const [trackedGenerationJobs, setTrackedGenerationJobs] = useState<GenerationJob[]>([]);
  const [savingPromptJobId, setSavingPromptJobId] = useState<string | null>(null);
  const [savedPromptJobId, setSavedPromptJobId] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const workbenchRef = useRef<WorkbenchSession | null>(null);
  const approvalRequest = useMemo(() => {
    const match = window.location.pathname.match(/\/approvals\/([^/]+)$/);
    const token = new URLSearchParams(window.location.search).get('token');
    return match && token ? { id: decodeURIComponent(match[1]), token } : null;
  }, []);
  const [approvalJob, setApprovalJob] = useState<GenerationJob | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const runningWorkbenchSessionIds = useMemo(
    () =>
      new Set(
        activeWorkbenchGenerationSnapshots(trackedGenerationJobs)
          .map((item) => item.sessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    [trackedGenerationJobs],
  );
  const updateWorkbenchJob = useCallback((nextJob: GenerationJob) => {
    setTrackedGenerationJobs((current) => upsertWorkbenchGenerationSnapshot(current, nextJob));
    setWorkbenchJobs((current) => {
      if (nextJob.sessionId !== workbenchRef.current?.id) return current;
      return upsertWorkbenchGenerationSnapshot(current, nextJob);
    });
  }, []);

  const removeTrackedGenerationJob = useCallback((id: string) => {
    setTrackedGenerationJobs((current) => current.filter((item) => item.id !== id));
    setWorkbenchJobs((current) => current.filter((item) => item.id !== id));
  }, []);

  const currentDraft = useMemo(
    () =>
      buildWorkbenchDraft({
        prompt: promptText,
        selectedPromptId,
        size: ratioSizes[ratio],
        aspectRatio: ratio,
        quality,
      }),
    [promptText, quality, ratio, selectedPromptId],
  );

  const workbenchSessionItems = useMemo<WorkbenchSessionListItemViewModel[]>(
    () =>
      workbenchSessions.map((item) => ({
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
        selected: item.id === selectedWorkbenchSessionId,
        status: runningWorkbenchSessionIds.has(item.id) ? 'running' : 'idle',
      })),
    [runningWorkbenchSessionIds, selectedWorkbenchSessionId, workbenchSessions],
  );

  const commitWorkbench = useCallback(
    (next: WorkbenchSession | null) => {
      workbenchRef.current = next;
      setWorkbench(next);
      selectWorkbenchSession(next?.id ?? null);
      if (next) {
        if (next.archivedAt || next.deletedAt) removeWorkbenchSession(next.id);
        else upsertWorkbenchSession(next);
      }
    },
    [removeWorkbenchSession, selectWorkbenchSession, upsertWorkbenchSession],
  );

  const draftSync = useWorkbenchDraftSyncController({
    session: workbench,
    draft: currentDraft,
    areDraftsEqual: areWorkbenchDraftsEqual,
    saveDraft: (current, draft) =>
      gateway.updateWorkbenchSession(current.id, {
        expectedVersion: current.version,
        draft,
      }),
    loadLatest: (current) => gateway.getWorkbenchSession(current.id),
    isConflictError: (error) =>
      error instanceof WebGatewayError && error.code === 'WORKBENCH_VERSION_CONFLICT',
    onCommit: commitWorkbench,
    onError: (error) => setActionError(error instanceof Error ? error.message : '草稿保存失败'),
  });
  const {
    status: draftSaveStatus,
    conflict: draftConflict,
    reset: resetDraftSync,
    flush: flushDraftSync,
  } = draftSync;

  const loadWorkspace = async () => {
    resetDraftSync();
    setLoading(true);
    setLoadError(null);
    try {
      const [
        nextSession,
        nextPrompts,
        nextHistory,
        nextGenerationSnapshots,
        nextConnections,
        nextWorkbenchPage,
      ] = await Promise.all([
        gateway.getSession(),
        gateway.listPrompts({ limit: 20 }),
        gateway.listGenerationHistory({ limit: 20 }),
        listAllGenerationHistory(gateway, { limit: 100 }),
        gateway.listConnections(),
        gateway.listWorkbenchSessions({ limit: 20 }),
      ]);
      const requestedSessionId = new URLSearchParams(window.location.search).get('session');
      const selectedWorkbench =
        nextWorkbenchPage.items.find((item) => item.id === requestedSessionId) ??
        nextWorkbenchPage.items[0] ??
        null;
      const restoredWorkbench = selectedWorkbench
        ? await gateway.getWorkbenchSession(selectedWorkbench.id)
        : null;
      const restoredRuns = restoredWorkbench
        ? {
            items: nextGenerationSnapshots.items.filter(
              (item) => item.sessionId === restoredWorkbench.id,
            ),
            nextCursor: null,
          }
        : { items: [], nextCursor: null };
      setSession(nextSession);
      setPrompts(nextPrompts);
      setHistory(nextHistory);
      setTrackedGenerationJobs(nextGenerationSnapshots.items);
      setConnections(nextConnections);
      replaceWorkbenchSessions(nextWorkbenchPage.items);
      setSessionListError(null);
      commitWorkbench(restoredWorkbench);
      setWorkbenchJobs(restoredRuns.items);
      setJob(latestWorkbenchGenerationSnapshot(restoredRuns.items));
      if (restoredWorkbench) {
        setPromptText(restoredWorkbench.draft.prompt);
        setSelectedPromptId(restoredWorkbench.draft.promptReferenceIds[0] ?? null);
        setSelectedPrompt(
          nextPrompts.items.find(
            (prompt) => prompt.id === restoredWorkbench.draft.promptReferenceIds[0],
          ) ?? null,
        );
        setRatio(workbenchRatio(restoredWorkbench));
        setQuality(restoredWorkbench.draft.params.quality ?? 'medium');
        replaceWorkbenchSessionUrl(restoredWorkbench.id);
      } else {
        setPromptText('');
        setSelectedPromptId(null);
        setSelectedPrompt(null);
        setRatio('1:1');
        setQuality('medium');
        replaceWorkbenchSessionUrl(null);
      }
      setAuthRequired(false);
    } catch (error) {
      if (
        error instanceof WebGatewayError &&
        ['AUTH_REQUIRED', 'AUTH_SESSION_EXPIRED'].includes(error.code)
      ) {
        setAuthRequired(true);
      } else {
        setLoadError(error instanceof Error ? error.message : '无法载入 Musefold');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, [gateway]);

  useEffect(() => {
    if (!session || !approvalRequest) return;
    setApprovalLoading(true);
    gateway
      .getGeneration(approvalRequest.id)
      .then((next) => {
        setApprovalJob(next);
        updateWorkbenchJob(next);
      })
      .catch((error) => setActionError(error instanceof Error ? error.message : '审批任务无法载入'))
      .finally(() => setApprovalLoading(false));
  }, [approvalRequest, gateway, session, updateWorkbenchJob]);

  useWorkbenchGenerationSyncController<GenerationJob>({
    jobs: trackedGenerationJobs,
    enabled: Boolean(session),
    getSnapshot: useCallback((id: string) => gateway.getGeneration(id), [gateway]),
    streamEvents: useCallback(
      (id, afterSeq, onEvent, signal) =>
        gateway.streamGenerationEvents(id, afterSeq, onEvent, signal),
      [gateway],
    ),
    onSnapshot: useCallback(
      (next) => {
        if (job?.id === next.id) setJob(next);
        if (approvalRequest?.id === next.id) setApprovalJob(next);
        updateWorkbenchJob(next);
        setHistory((current) => ({
          ...current,
          items: [next, ...current.items.filter((item) => item.id !== next.id)],
        }));
      },
      [approvalRequest?.id, job?.id, updateWorkbenchJob],
    ),
    onAuthRequired: useCallback(() => setAuthRequired(true), []),
    onError: useCallback(
      (error: unknown) =>
        setActionError(error instanceof Error ? error.message : '任务状态更新失败'),
      [],
    ),
  });

  const flushCurrentWorkbenchDraft = async (): Promise<boolean> => {
    const current = workbenchRef.current;
    if (!current || areWorkbenchDraftsEqual(current.draft, currentDraft)) return true;
    try {
      return Boolean(await flushDraftSync());
    } catch {
      return false;
    }
  };

  const beginNewDesign = async (): Promise<boolean> => {
    if (!(await flushCurrentWorkbenchDraft())) return false;
    resetDraftSync();
    setView('generate');
    commitWorkbench(null);
    setWorkbenchJobs([]);
    setJob(null);
    setPromptText('');
    setSelectedPromptId(null);
    setSelectedPrompt(null);
    setRatio('1:1');
    setQuality('medium');
    setActionError(null);
    replaceWorkbenchSessionUrl(null);
    return true;
  };

  const selectPrompt = async (prompt: PromptDocument) => {
    await gateway.usePrompt(prompt.id, { action: 'apply' }).catch(() => undefined);
    const request = applyPromptToGeneration(prompt, {
      quality,
      aspectRatio: ratio,
    });
    if (!(await beginNewDesign())) return;
    setPromptQuery('');
    void searchPrompts('');
    setPromptText(request.prompt);
    setSelectedPromptId(prompt.id);
    setSelectedPrompt(prompt);
  };

  const openGenerationInWorkbench = async (nextJob: GenerationJob) => {
    if (!(await flushCurrentWorkbenchDraft())) return;
    resetDraftSync();
    commitWorkbench(null);
    setWorkbenchJobs([nextJob]);
    setJob(nextJob);
    setPromptText(nextJob.request.prompt);
    setSelectedPromptId(nextJob.promptId);
    setSelectedPrompt(prompts.items.find((prompt) => prompt.id === nextJob.promptId) ?? null);
    setRatio(
      ratioValues.includes(nextJob.request.aspectRatio as Ratio)
        ? (nextJob.request.aspectRatio as Ratio)
        : '1:1',
    );
    setQuality(nextJob.request.quality);
    setView('generate');
    setActionError(null);
    if (!nextJob.sessionId) {
      replaceWorkbenchSessionUrl(null);
      return;
    }
    try {
      const [restoredWorkbench, restoredRuns] = await Promise.all([
        gateway.getWorkbenchSession(nextJob.sessionId),
        listAllGenerationHistory(gateway, {
          limit: 20,
          sessionId: nextJob.sessionId,
        }),
      ]);
      commitWorkbench(restoredWorkbench);
      setTrackedGenerationJobs((current) => upsertWorkbenchGenerationSnapshot(current, nextJob));
      setWorkbenchJobs(restoredRuns.items);
      replaceWorkbenchSessionUrl(restoredWorkbench.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法恢复工作台会话');
    }
  };

  const openWorkbenchSession = async (sessionId: string) => {
    if (sessionId === workbenchRef.current?.id) {
      setView('generate');
      return;
    }
    if (!(await flushCurrentWorkbenchDraft())) return;
    setSessionListError(null);
    setActionError(null);
    let restoredRuns: GenerationHistoryPage = {
      items: [],
      nextCursor: null,
    };
    try {
      const restoredWorkbench = await openWorkbenchSessionRecord(sessionId, async (id) => {
        const [nextWorkbench, nextRuns] = await Promise.all([
          gateway.getWorkbenchSession(id),
          listAllGenerationHistory(gateway, { limit: 100, sessionId: id }),
        ]);
        restoredRuns = nextRuns;
        return nextWorkbench;
      });
      if (!restoredWorkbench) return;
      resetDraftSync();
      commitWorkbench(restoredWorkbench);
      setPromptText(restoredWorkbench.draft.prompt);
      setSelectedPromptId(restoredWorkbench.draft.promptReferenceIds[0] ?? null);
      setSelectedPrompt(
        prompts.items.find(
          (prompt) => prompt.id === restoredWorkbench.draft.promptReferenceIds[0],
        ) ?? null,
      );
      setRatio(workbenchRatio(restoredWorkbench));
      setQuality(restoredWorkbench.draft.params.quality ?? 'medium');
      setWorkbenchJobs(restoredRuns.items);
      setJob(latestWorkbenchGenerationSnapshot(restoredRuns.items));
      setView('generate');
      replaceWorkbenchSessionUrl(restoredWorkbench.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法恢复工作台会话';
      setSessionListError(message);
      setActionError(message);
    }
  };

  const refreshWorkbenchSessions = async () => {
    try {
      await refreshWorkbenchSessionList(async () => {
        const page = await gateway.listWorkbenchSessions({ limit: 20 });
        return page.items;
      });
    } catch (error) {
      setSessionListError(error instanceof Error ? error.message : '无法读取最近对话');
    }
  };

  const archiveWorkbenchSession = async (sessionId: string) => {
    setSessionListError(null);
    setActionError(null);
    try {
      let target = workbenchSessions.find((item) => item.id === sessionId);
      if (workbenchRef.current?.id === sessionId) {
        if (!(await flushCurrentWorkbenchDraft())) return;
        target = workbenchRef.current ?? target;
      }
      if (!target) return;
      const archived = await gateway.updateWorkbenchSession(target.id, {
        expectedVersion: target.version,
        archived: true,
      });
      removeWorkbenchSession(archived.id);
      if (workbenchRef.current?.id === archived.id) {
        resetDraftSync();
        commitWorkbench(null);
        setWorkbenchJobs([]);
        setJob(null);
        setPromptText('');
        setSelectedPromptId(null);
        setSelectedPrompt(null);
        setRatio('1:1');
        setQuality('medium');
        setView('generate');
        replaceWorkbenchSessionUrl(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法归档对话';
      setActionError(message);
      await refreshWorkbenchSessions();
      setSessionListError(message);
    }
  };

  const renameWorkbenchSession = async (item: WorkbenchSessionListItemViewModel, title: string) => {
    setSessionListError(null);
    setActionError(null);
    try {
      let target = workbenchSessions.find((sessionItem) => sessionItem.id === item.id);
      if (workbenchRef.current?.id === item.id) {
        target = workbenchRef.current;
      }
      if (!target) return;
      const renamed = await gateway.updateWorkbenchSession(target.id, {
        expectedVersion: target.version,
        title,
      });
      upsertWorkbenchSession(renamed);
      if (workbenchRef.current?.id === renamed.id) commitWorkbench(renamed);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法重命名对话';
      setActionError(message);
      await refreshWorkbenchSessions();
      setSessionListError(message);
    }
  };

  const deleteWorkbenchSession = async (item: WorkbenchSessionListItemViewModel) => {
    setSessionListError(null);
    setActionError(null);
    try {
      let target = workbenchSessions.find((sessionItem) => sessionItem.id === item.id);
      if (workbenchRef.current?.id === item.id) {
        if (!(await flushCurrentWorkbenchDraft())) return;
        target = workbenchRef.current;
      }
      if (!target) return;
      const deleted = await gateway.deleteWorkbenchSession(target.id, target.version);
      removeWorkbenchSession(deleted.id);
      if (workbenchRef.current?.id === deleted.id) {
        resetDraftSync();
        commitWorkbench(null);
        setWorkbenchJobs([]);
        setJob(null);
        setPromptText('');
        setSelectedPromptId(null);
        setSelectedPrompt(null);
        setRatio('1:1');
        setQuality('medium');
        setView('generate');
        replaceWorkbenchSessionUrl(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法删除对话';
      setActionError(message);
      await refreshWorkbenchSessions();
      setSessionListError(message);
    }
  };

  const submitGeneration = async () => {
    if (!session?.account.canGenerate || !capabilities.generation) return;
    setActionError(null);
    try {
      const request = cloudGenerationRequestSchema.parse({
        prompt: promptText,
        promptId: selectedPromptId ?? undefined,
        size: ratioSizes[ratio],
        aspectRatio: ratio,
        quality,
        count: 1,
      });
      const submissionRevision = draftSync.captureRevision();
      let currentWorkbench = workbenchRef.current;
      if (!currentWorkbench) {
        currentWorkbench = await gateway.createWorkbenchSession({
          title: promptText.trim().slice(0, 120) || '未命名创作',
          draft: currentDraft,
        });
        if (!draftSync.isRevisionCurrent(submissionRevision)) return;
        commitWorkbench(currentWorkbench);
      } else {
        currentWorkbench = await flushDraftSync();
        if (!currentWorkbench) return;
      }
      replaceWorkbenchSessionUrl(currentWorkbench.id);
      const nextJob = await gateway.createGeneration(
        { ...request, sessionId: currentWorkbench.id },
        crypto.randomUUID(),
      );
      setJob(nextJob);
      updateWorkbenchJob(nextJob);
      setHistory((current) => ({
        ...current,
        items: [nextJob, ...current.items.filter((item) => item.id !== nextJob.id)],
      }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法创建生成任务');
    }
  };

  const useCloudWorkbenchDraft = () => {
    if (!draftSync.conflict) return;
    const latest = draftSync.conflict;
    draftSync.useRemoteDraft();
    setPromptText(latest.draft.prompt);
    setSelectedPromptId(latest.draft.promptReferenceIds[0] ?? null);
    setSelectedPrompt(
      prompts.items.find((prompt) => prompt.id === latest.draft.promptReferenceIds[0]) ?? null,
    );
    setRatio(workbenchRatio(latest));
    setQuality(latest.draft.params.quality ?? 'medium');
    setActionError(null);
  };

  const overwriteCloudWorkbenchDraft = async () => {
    if (!draftSync.conflict) return;
    setActionError(null);
    try {
      await draftSync.overwriteRemoteDraft();
    } catch (error) {
      if (!(error instanceof WebGatewayError) || error.code !== 'WORKBENCH_VERSION_CONFLICT') {
        setActionError(error instanceof Error ? error.message : '无法保存本机草稿');
      }
    }
  };

  const cancelGeneration = async () => {
    if (!job || !canCancelGeneration(job)) return;
    setActionError(null);
    try {
      const nextJob = await gateway.cancelGeneration(job.id);
      setJob(nextJob);
      updateWorkbenchJob(nextJob);
      setHistory((current) => ({
        ...current,
        items: [nextJob, ...current.items.filter((item) => item.id !== nextJob.id)],
      }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法取消任务');
    }
  };

  const createPromptFromGeneration = async (targetJob: GenerationJob) => {
    const created = await gateway.createPrompt(generationRequestToPromptDraft(targetJob.request));
    setPrompts((current) => ({
      ...current,
      items: [created, ...current.items.filter((prompt) => prompt.id !== created.id)],
    }));
    return created;
  };

  const searchPrompts = useCallback(
    async (query: string) => {
      const revision = ++promptSearchRevision.current;
      const next = await gateway.listPrompts({
        q: query.trim() || undefined,
        limit: 20,
        sort: 'updated-desc',
      });
      if (revision === promptSearchRevision.current) setPrompts(next);
    },
    [gateway],
  );

  const saveGenerationPrompt = async (targetJob: GenerationJob | null = job) => {
    if (!targetJob || targetJob.status !== 'succeeded' || savingPromptJobId === targetJob.id)
      return;
    setSavingPromptJobId(targetJob.id);
    setActionError(null);
    try {
      await createPromptFromGeneration(targetJob);
      setSavedPromptJobId(targetJob.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法存为提示词');
    } finally {
      setSavingPromptJobId(null);
    }
  };

  const retryCurrentGeneration = async (targetJob: GenerationJob | null = job) => {
    if (
      !targetJob ||
      !['failed', 'cancelled'].includes(targetJob.status) ||
      retryingJobId === targetJob.id
    )
      return;
    setRetryingJobId(targetJob.id);
    setActionError(null);
    try {
      const nextJob = await gateway.retryGeneration(targetJob.id, crypto.randomUUID());
      setJob(nextJob);
      updateWorkbenchJob(nextJob);
      setHistory((current) => ({
        ...current,
        items: [nextJob, ...current.items.filter((item) => item.id !== nextJob.id)],
      }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法重试任务');
    } finally {
      setRetryingJobId(null);
    }
  };

  if (loading) return <LoadingScreen />;
  if (authRequired) {
    return <LoginScreen gateway={gateway} onAuthenticated={() => void loadWorkspace()} />;
  }
  if (approvalRequest) {
    return (
      <ApprovalScreen
        job={approvalJob}
        loading={approvalLoading}
        error={actionError}
        onApprove={async () => {
          if (!approvalRequest || !approvalJob) return;
          try {
            const next = await gateway.approveGeneration(approvalRequest.id, approvalRequest.token);
            setActionError(null);
            setApprovalJob(next);
            updateWorkbenchJob(next);
          } catch (error) {
            setActionError(error instanceof Error ? error.message : '审批失败，请稍后重试');
          }
        }}
      />
    );
  }
  if (loadError || !session) {
    return (
      <FailureScreen message={loadError ?? '会话不可用'} onRetry={() => void loadWorkspace()} />
    );
  }

  return (
    <ProductSidebarLayout
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      compactDismissKey={view}
      sidebar={
        <WebSidebar
          view={view}
          accountName={session.account.displayName ?? session.account.username}
          mode={gateway.mode}
          promptCount={prompts.items.length}
          onNavigate={setView}
          workbenchSessions={workbenchSessionItems}
          sessionListLoading={sessionListLoading}
          sessionListError={sessionListError}
          onNewDesign={() => void beginNewDesign()}
          onCollapse={() => setSidebarOpen(false)}
          onOpenWorkbenchSession={(item) => void openWorkbenchSession(item.id)}
          onArchiveWorkbenchSession={(item) => void archiveWorkbenchSession(item.id)}
          onRenameWorkbenchSession={(item, title) => renameWorkbenchSession(item, title)}
          onDeleteWorkbenchSession={(item) => deleteWorkbenchSession(item)}
          onRetryWorkbenchSessions={() => void refreshWorkbenchSessions()}
        />
      }
    >
      <main className="app-main">
        <WebTopbar
          view={view}
          quota={`${formatAccountPoints(session.account.quota)} 积分`}
          mode={gateway.mode}
          workbenchTitle={workbench?.title ?? null}
          workbenchSession={workbenchSessionItems.find((item) => item.id === workbench?.id) ?? null}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onSearch={() => {
            setView('prompts');
            window.requestAnimationFrame(() => {
              document.querySelector<HTMLInputElement>('[data-testid="library-search"]')?.focus();
            });
          }}
          onRenameSession={(item, title) => renameWorkbenchSession(item, title)}
          onArchiveSession={(item) => archiveWorkbenchSession(item.id)}
          onDeleteSession={(item) => deleteWorkbenchSession(item)}
        />
        {view === 'generate' && (
          <GenerateView
            promptText={promptText}
            ratio={ratio}
            quality={quality}
            job={job}
            jobs={workbenchJobs}
            savePromptState={(targetJob) =>
              targetJob.id === savedPromptJobId
                ? 'saved'
                : targetJob.id === savingPromptJobId
                  ? 'saving'
                  : 'idle'
            }
            error={actionError}
            draftSaveStatus={draftSaveStatus}
            draftConflict={draftConflict}
            selectedPrompt={selectedPrompt}
            canGenerate={session.account.canGenerate}
            onPromptTextChange={setPromptText}
            onRatioChange={setRatio}
            onQualityChange={setQuality}
            onOpenPromptLibrary={() => setView('prompts')}
            onSubmit={() => void submitGeneration()}
            onCancel={() => void cancelGeneration()}
            onSavePrompt={(targetJob) => void saveGenerationPrompt(targetJob)}
            retrying={(targetJob) => retryingJobId === targetJob.id}
            onRetry={(targetJob) => void retryCurrentGeneration(targetJob)}
            onReuse={(targetJob) => void openGenerationInWorkbench(targetJob)}
            onOpenHistory={() => setView('history')}
            onUseCloudDraft={useCloudWorkbenchDraft}
            onOverwriteCloudDraft={() => void overwriteCloudWorkbenchDraft()}
            onClearPromptReference={() => {
              setSelectedPromptId(null);
              setSelectedPrompt(null);
            }}
          />
        )}
        {view === 'prompts' && (
          <PromptLibraryView
            prompts={prompts.items}
            query={promptQuery}
            onQueryChange={setPromptQuery}
            onUse={(prompt) => void selectPrompt(prompt)}
            onCreate={async (input) => {
              const created = await gateway.createPrompt(input);
              setPrompts((current) => ({
                ...current,
                items: [created, ...current.items],
              }));
              return created;
            }}
            onGet={async (id) => {
              const latest = await gateway.getPrompt(id);
              setPrompts((current) => ({
                ...current,
                items: current.items.map((prompt) => (prompt.id === latest.id ? latest : prompt)),
              }));
              return latest;
            }}
            onUpdate={async (id, input) => {
              const updated = await gateway.updatePrompt(id, input);
              setPrompts((current) => ({
                ...current,
                items: current.items.map((prompt) => (prompt.id === updated.id ? updated : prompt)),
              }));
              return updated;
            }}
            onDelete={async (id, expectedVersion) => {
              const deleted = await gateway.deletePrompt(id, expectedVersion);
              setPrompts((current) => ({
                ...current,
                items: current.items.filter((prompt) => prompt.id !== id),
              }));
              return deleted;
            }}
            onRestore={async (id, expectedVersion) => {
              const restored = await gateway.restorePrompt(id, expectedVersion);
              setPrompts((current) => ({
                ...current,
                items: [restored, ...current.items.filter((prompt) => prompt.id !== id)],
              }));
              return restored;
            }}
            onListTrash={async () =>
              (
                await gateway.listPrompts({
                  includeDeleted: true,
                  limit: 100,
                  sort: 'updated-desc',
                })
              ).items.filter((prompt) => prompt.deletedAt !== null)
            }
            onSearch={searchPrompts}
          />
        )}
        {view === 'history' && (
          <HistoryView
            history={history}
            onReuse={(nextJob) => void openGenerationInWorkbench(nextJob)}
            onGet={(id) => gateway.getGeneration(id)}
            onRetry={async (id) => {
              const next = await gateway.retryGeneration(id, crypto.randomUUID());
              setHistory((current) => ({
                ...current,
                items: [next, ...current.items.filter((item) => item.id !== next.id)],
              }));
              updateWorkbenchJob(next);
              return next;
            }}
            onCancel={async (id) => {
              const next = await gateway.cancelGeneration(id);
              setHistory((current) => ({
                ...current,
                items: current.items.map((item) => (item.id === next.id ? next : item)),
              }));
              updateWorkbenchJob(next);
              if (job?.id === next.id) setJob(next);
              return next;
            }}
            onDelete={async (id) => {
              const deleted = await gateway.deleteGeneration(id);
              setHistory((current) => ({
                ...current,
                items: current.items.filter((item) => item.id !== id),
              }));
              const remainingJobs = workbenchJobs.filter((item) => item.id !== id);
              removeTrackedGenerationJob(id);
              setWorkbenchJobs(sortWorkbenchGenerationSnapshots(remainingJobs));
              if (job?.id === id) setJob(latestWorkbenchGenerationSnapshot(remainingJobs));
              return deleted;
            }}
            onRestore={async (id) => {
              const restored = await gateway.restoreGeneration(id);
              setHistory((current) => ({
                ...current,
                items: [restored, ...current.items.filter((item) => item.id !== id)],
              }));
              updateWorkbenchJob(restored);
              return restored;
            }}
            onListTrash={async () =>
              (
                await gateway.listGenerationHistory({
                  includeDeleted: true,
                  limit: 100,
                })
              ).items.filter((item) => Boolean(item.deletedAt))
            }
            onSavePrompt={createPromptFromGeneration}
            onRefresh={async () => setHistory(await gateway.listGenerationHistory({ limit: 20 }))}
          />
        )}
        {view === 'connections' && (
          <div className="page">
            <ConnectedAppsScreen
              testId="connected-apps-screen"
              items={connections.items}
              onUpdate={async (id, input) =>
                setConnections(await gateway.updateConnection(id, input))
              }
              onRevoke={async (id) => {
                await gateway.revokeConnection(id);
                setConnections(await gateway.listConnections());
              }}
            />
          </div>
        )}
        {view === 'account' && (
          <div className="page">
            <AccountScreen
              testId="account-screen"
              account={{
                name: session.account.displayName ?? session.account.username,
                username: session.account.username,
                avatarLabel: (session.account.displayName ?? session.account.username).slice(0, 1),
                quotaLabel: `${formatAccountPoints(session.account.quota)} 积分`,
                generationStatusLabel: session.account.canGenerate ? '可用' : '额度不足',
                generationAvailable: session.account.canGenerate,
                dataSourceLabel: gateway.mode === 'fixture' ? '开发预览' : 'Musefold Cloud',
              }}
              onLogout={async () => {
                await gateway.logout();
                setSession(null);
                setAuthRequired(true);
              }}
            />
          </div>
        )}
      </main>
    </ProductSidebarLayout>
  );
}

function LoadingScreen() {
  return (
    <div className="center-screen" role="status" aria-live="polite">
      <img className="loading-mark" src={musefoldIconUrl} alt="" />
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>正在载入</span>
    </div>
  );
}

function FailureScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="center-screen">
      <img className="loading-mark" src={musefoldIconUrl} alt="Musefold" />
      <strong>暂时无法连接</strong>
      <span>{message}</span>
      <Button variant="primary" className="button button-primary" type="button" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

function LoginScreen({
  gateway,
  onAuthenticated,
}: {
  gateway: WebGateway;
  onAuthenticated: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await gateway.login({ username, password });
      const returnTo = getSafeOAuthReturnTo(
        new URLSearchParams(window.location.search).get('returnTo'),
        window.location.origin,
      );
      if (returnTo) {
        window.location.assign(returnTo);
        return;
      }
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-screen">
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <div className="brand-lockup brand-lockup-login">
          <img src={musefoldIconUrl} alt="" />
          <div>
            <strong>Musefold</strong>
            <span>未像</span>
          </div>
        </div>
        <h1>登录个人账户</h1>
        <label>
          <span>账号</span>
          <Input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          <span>密码</span>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          className="button button-primary login-submit"
          type="submit"
          disabled={submitting || !username || !password}
        >
          {submitting ? (
            <LoaderCircle className="spin" aria-hidden="true" />
          ) : (
            <CircleUserRound aria-hidden="true" />
          )}
          登录
        </Button>
      </form>
    </main>
  );
}

function ApprovalScreen({
  job,
  loading,
  error,
  onApprove,
}: {
  job: GenerationJob | null;
  loading: boolean;
  error: string | null;
  onApprove: () => Promise<void>;
}) {
  const [approving, setApproving] = useState(false);
  const approve = async () => {
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };
  return (
    <main className="approval-screen">
      <div className="approval-panel">
        <div className="brand-lockup brand-lockup-login">
          <img src={musefoldIconUrl} alt="" />
          <div>
            <strong>Musefold</strong>
            <span>Cloud MCP</span>
          </div>
        </div>
        <h1>确认这次生图</h1>
        {loading && (
          <div className="generation-progress">
            <LoaderCircle className="spin" aria-hidden="true" />
            <span>正在载入任务</span>
          </div>
        )}
        {job && (
          <>
            <p className="approval-prompt">{job.request.prompt}</p>
            <div className="approval-facts">
              <span>来源：Cloud MCP</span>
              <span>
                状态：
                {job.status === 'pending_approval' ? '等待确认' : job.status}
              </span>
            </div>
            <Button
              variant="primary"
              className="button button-primary"
              type="button"
              disabled={approving || job.status !== 'pending_approval'}
              onClick={() => void approve()}
            >
              {approving ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              {job.status === 'pending_approval' ? '允许生成' : '已处理'}
            </Button>
            <GenerationResultSurface
              className="approval-result"
              testId="approval-generation-result"
              imageTestId="approval-generation-result-image"
              status={workbenchGenerationResultStatus(job.status)}
              imageUrl={job.assets[0]?.url ?? null}
              imageAlt="Musefold Cloud MCP 生图结果"
              imageLabel="查看生图结果"
              imageTitle="查看生图结果"
              aspectRatio={job.request.aspectRatio ?? '1:1'}
              progressLabel={`${workbenchGenerationStatusLabel(job.status)}${job.progress > 0 ? ` ${job.progress}%` : ''}`}
              footerLabel={workbenchGenerationStatusLabel(job.status)}
              onOpenImage={
                job.assets[0]
                  ? () => window.open(job.assets[0].url, '_blank', 'noopener')
                  : undefined
              }
              errorMessage={job.error?.message}
            />
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
