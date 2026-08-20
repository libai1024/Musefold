import { create } from 'zustand';
import type {
  ImageProviderResponseSummary,
  LocalImageReference,
  PromptReference,
} from '@musefold/desktop-contracts/providers';
import { useAppStore } from '../../../stores/app';
import { useGenerationStore } from '../store';
import { useDoubaoAccountStore } from '../../account/doubao-store';
import { useHistoryStore } from '../../history/store';
import { getWorkbenchIO, subscribeToWorkbenchGenerationProgress } from './io';
import {
  buildImageRequest,
  DEFAULT_REFINE_PARAMS,
  type RefineParams,
  type RefineSource,
} from '../params';
import type {
  GenerationResultItem,
  GenerationSource,
  GenerationTurn,
  RefinementContext,
  SchemeCreationDraftCard,
} from './types';
import type {
  DesignSchemeCreationTraceItem,
  DesignSchemeHistorySourceItem,
  DesignSchemeRunGeneration,
  DesignSchemeRunMode,
} from '@musefold/desktop-contracts/design-scheme';
import type {
  GenerationRun,
  WorkbenchSessionDocument,
  WorkbenchSessionSummary,
} from '@musefold/desktop-contracts/workbench';
import type {
  SkillRuntimeExecutionMode,
  SkillRuntimeGenerationOutcome,
  SkillRuntimeSnapshot,
  SkillRuntimeTraceItem,
} from '@musefold/desktop-contracts/skill-runtime';
import { composePromptWithReferences } from './references';
import { workbenchSessionErrorMessage } from './sessionErrors';
import { composePromptWithRatioConstraint } from './promptConstraints';
import {
  composePromptWithImageIndexHint,
  composePromptWithRefinementImageHint,
  uniqueReferenceImages,
} from './imageReferences';
import { setSessionUnread } from './sessionPreferences';
import {
  createEmptyWorkbenchDraft,
  DEFAULT_WORKBENCH_PARAMS,
  loadWorkbenchPreferences,
  persistWorkbenchPreferences,
  workbenchDraftControllerReducer,
  WORKBENCH_PROMPT_LIMIT,
  type WorkbenchDraftControllerState,
} from './draftController';
import { workbenchSessionController } from './sessionController';
import {
  applyGenerationProgress,
  applyImageResult,
  applyTransportError,
  resultStatus,
  sessionHasRunningTurn,
  updateGenerationResult,
  withRunRegistered,
  withRunReleased,
  type RunningTurnEntry,
  type WorkbenchGenerationSyncState,
} from './generationSyncController';

const SKILL_RUNTIME_PROMPT_LIMIT = 8 * 1024 * 1024;
let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const mapTurnsEverywhere = workbenchSessionController.mapTurnsEverywhere.bind(
  workbenchSessionController,
);
const findTurnAnywhere = workbenchSessionController.findTurn.bind(workbenchSessionController);
const cacheSessionTurns = workbenchSessionController.cacheTurns.bind(workbenchSessionController);
const sessionIdForTurn = workbenchSessionController.sessionIdForTurn.bind(
  workbenchSessionController,
);
const reduceSessionSummaries = workbenchSessionController.reduceSummaries.bind(
  workbenchSessionController,
);
const mergeSessionSummary = workbenchSessionController.mergeSummary.bind(
  workbenchSessionController,
);

function sourceToRefineSource(source: GenerationSource): RefineSource | null {
  if (source.kind === 'prompt') {
    return { kind: 'prompt', id: source.id, label: source.label };
  }
  if (source.kind === 'history' && source.promptId) {
    return { kind: 'prompt', id: source.promptId, label: source.label };
  }
  return null;
}

function sourcePromptId(source: GenerationSource): string | undefined {
  if (source.kind === 'prompt') return source.id;
  if (source.kind === 'history') return source.promptId;
  return undefined;
}

function sourceParentHistoryId(source: GenerationSource): string | undefined {
  if (source.kind === 'history') return source.id;
  return undefined;
}

export function composeRefinementPrompt(parentPrompt: string, instruction: string): string {
  return `${parentPrompt.trim()}\n\n微调要求：\n${instruction.trim()}`.trim();
}

function parseSkillRuntimeSnapshot(candidate: unknown): SkillRuntimeSnapshot | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const value = candidate as Partial<SkillRuntimeSnapshot>;
  if (
    typeof value.label !== 'string' ||
    typeof value.repositoryUrl !== 'string' ||
    !['agent', 'file-fallback', 'direct-forward'].includes(value.executionMode ?? '') ||
    !Array.isArray(value.trace)
  )
    return null;
  return {
    label: value.label,
    repositoryUrl: value.repositoryUrl,
    executionMode: value.executionMode as SkillRuntimeExecutionMode,
    trace: value.trace.filter((item): item is SkillRuntimeTraceItem =>
      Boolean(
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        ['tool', 'assistant', 'system'].includes(item.kind) &&
        ['running', 'success', 'warning', 'error'].includes(item.status),
      ),
    ),
  };
}

function completedSkillTrace(
  trace: SkillRuntimeTraceItem[],
  results: GenerationResultItem[],
): SkillRuntimeTraceItem[] {
  if (results.some((result) => result.status === 'pending')) return trace;
  const successCount = results.filter((result) => result.status === 'success').length;
  const failedCount = results.length - successCount;
  const item: SkillRuntimeTraceItem = {
    id: 'image-generation',
    kind: 'tool',
    title: successCount > 0 ? '图片生成完成' : '图片生成失败',
    detail:
      successCount > 0
        ? `已返回 ${successCount} 张图片${failedCount > 0 ? `，${failedCount} 张失败` : ''}`
        : results.find((result) => result.error)?.error || '图片生成失败',
    status: successCount > 0 ? 'success' : 'error',
  };
  const index = trace.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...trace, item];
  return trace.map((candidate) =>
    candidate.id === item.id ? { ...candidate, ...item } : candidate,
  );
}

function sourceFromRun(run: GenerationRun): GenerationSource {
  const skillRuntime = parseSkillRuntimeSnapshot(run.params.skillRuntime);
  if (skillRuntime) {
    return {
      kind: 'skill',
      label: skillRuntime.label,
      repositoryUrl: skillRuntime.repositoryUrl,
      compiledPrompt: run.finalPrompt,
      executionMode: skillRuntime.executionMode,
      trace: skillRuntime.trace,
    };
  }
  return { kind: 'manual' };
}

function paramsFromRun(run: GenerationRun): RefineParams {
  return {
    ...DEFAULT_REFINE_PARAMS,
    ratioId:
      typeof run.params.aspectRatio === 'string'
        ? run.params.aspectRatio
        : DEFAULT_REFINE_PARAMS.ratioId,
    quality: run.params.quality ?? DEFAULT_REFINE_PARAMS.quality,
    n: 1,
    background: run.params.background ?? DEFAULT_REFINE_PARAMS.background,
    moderation: run.params.moderation,
  };
}

function parseReferenceImage(candidate: unknown): LocalImageReference | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const value = candidate as Partial<LocalImageReference>;
  if (
    (value.source !== 'upload' && value.source !== 'history') ||
    typeof value.path !== 'string' ||
    !value.path
  )
    return null;
  return {
    path: value.path,
    source: value.source,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.mimeType === 'string'
      ? { mimeType: value.mimeType as LocalImageReference['mimeType'] }
      : {}),
    ...(typeof value.sizeBytes === 'number' ? { sizeBytes: value.sizeBytes } : {}),
    ...(typeof value.historyId === 'string' ? { historyId: value.historyId } : {}),
  };
}

function referenceImagesFromRun(run: GenerationRun): LocalImageReference[] {
  if (!Array.isArray(run.params.referenceImages)) return [];
  return uniqueReferenceImages(
    run.params.referenceImages
      .map(parseReferenceImage)
      .filter((image): image is LocalImageReference => image !== null),
  );
}

function providerResponseFromValue(value: unknown): ImageProviderResponseSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const summary = value as Partial<ImageProviderResponseSummary>;
  if (
    summary.kind !== 'doubao-web' ||
    typeof summary.expectedImageCount !== 'number' ||
    typeof summary.receivedImageCount !== 'number'
  )
    return undefined;
  return {
    kind: 'doubao-web',
    expectedImageCount: summary.expectedImageCount,
    receivedImageCount: summary.receivedImageCount,
    ...(typeof summary.message === 'string' && summary.message.trim()
      ? { message: summary.message }
      : {}),
  };
}

function turnsFromSession(document: WorkbenchSessionDocument): GenerationTurn[] {
  const grouped = new Map<string, typeof document.runs>();
  for (const item of document.runs) {
    const key = item.run.workbenchTurnId ?? item.run.id;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()]
    .sort((left, right) => {
      const a = left[1][0]?.run.turnIndex ?? Number.MAX_SAFE_INTEGER;
      const b = right[1][0]?.run.turnIndex ?? Number.MAX_SAFE_INTEGER;
      return a - b;
    })
    .map(([turnId, items]) => {
      const latestByPosition = new Map<number, (typeof items)[number]>();
      for (const item of items) {
        const position = item.run.resultIndex ?? 0;
        const current = latestByPosition.get(position);
        if (!current || item.run.createdAt >= current.run.createdAt)
          latestByPosition.set(position, item);
      }
      const ordered = [...latestByPosition.entries()].sort((a, b) => a[0] - b[0]);
      const firstItem = ordered[0]?.[1] ?? items[0];
      const first = firstItem.run;
      const results: GenerationResultItem[] = ordered.flatMap(
        ([position, item]): GenerationResultItem[] => {
          const assets = item.assets
            .filter((asset) => asset.status === 'available' && asset.mediaPath)
            .sort((left, right) => left.position - right.position);
          if (assets.length > 0) {
            return assets.map((asset) => ({
              id: `${turnId}-${position}-${asset.position}`,
              jobId: item.run.id,
              historyId: item.run.id,
              assetId: asset.id,
              status: 'success' as const,
              imagePath: asset.mediaPath ?? undefined,
              cost: item.run.actualCost ?? undefined,
              durationMs: item.run.durationMs ?? undefined,
            }));
          }
          return [
            {
              id: `${turnId}-${position}`,
              jobId: item.run.id,
              historyId: item.run.id,
              status:
                item.run.status === 'queued' || item.run.status === 'running'
                  ? ('pending' as const)
                  : item.run.status,
              cost: item.run.actualCost ?? undefined,
              durationMs: item.run.durationMs ?? undefined,
              error: item.run.errorMessage ?? undefined,
              errorCode: item.run.errorCode ?? undefined,
            },
          ];
        },
      );
      const source = sourceFromRun(first);
      const providerResponse = ordered
        .map(([, item]) => providerResponseFromValue(item.providerResponse))
        .find((summary): summary is ImageProviderResponseSummary => Boolean(summary));
      return {
        id: turnId,
        prompt: first.finalPrompt,
        userPrompt: first.promptSnapshot.userPrompt || first.userPrompt,
        references: firstItem.promptReferences.map((reference) => ({ ...reference })),
        negativePrompt: first.negativePrompt ?? '',
        source:
          source.kind === 'skill'
            ? { ...source, trace: completedSkillTrace(source.trace, results) }
            : source,
        providerId: first.providerId,
        params: { ...paramsFromRun(first), n: results.length },
        status: resultStatus(results),
        results,
        ...(providerResponse ? { providerResponse } : {}),
        referenceImages: referenceImagesFromRun(first),
        parentHistoryId: first.parentRunId ?? undefined,
        createdAt: first.createdAt,
        completedAt: Math.max(...items.map((item) => item.run.finishedAt ?? item.run.createdAt)),
      } satisfies GenerationTurn;
    });
}

/** 测试隔离用：清空会话内存缓存。 */
export function clearSessionTurnsCacheForTests(): void {
  workbenchSessionController.clearCache();
}

interface WorkbenchState extends WorkbenchDraftControllerState, WorkbenchGenerationSyncState {
  /** Composer 指令芯片（Codex 式）：输入完整 / 指令后收敛为图标+指令名。 */
  draftCommand: 'design-plan' | null;
  /** 「从历史内容创建」挑选的来源（UI 规范 §10）；随 design-plan 指令一起提交。 */
  draftHistorySource: { items: DesignSchemeHistorySourceItem[] } | null;
  /** 方案运行事件回填当前 jobId（供该对话的停止按钮取消）。 */
  setRunningTurnJob: (turnId: string, jobId: string | null) => void;
  sessionId: string;
  activeSessionId: string | null;
  sessions: WorkbenchSessionSummary[];
  archivedSessions: WorkbenchSessionSummary[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  refinementContext: RefinementContext | null;

  setDraftPrompt: (value: string) => void;
  setDraftCommand: (command: 'design-plan' | null) => void;
  setDraftHistorySource: (source: { items: DesignSchemeHistorySourceItem[] } | null) => void;
  setDraftNegativePrompt: (value: string) => void;
  addDraftReference: (reference: PromptReference) => void;
  removeDraftReference: (index: number) => void;
  clearDraftReferences: () => void;
  addDraftImages: (images: LocalImageReference[]) => void;
  removeDraftImage: (index: number) => void;
  clearDraftImages: () => void;
  setDraftSource: (source: GenerationSource) => void;
  setTurnSkillTrace: (turnId: string, trace: SkillRuntimeTraceItem[]) => void;
  /** Skill 执行开始：立即建立对话轮与待生成卡片，生成本身由主进程 Agent 驱动。 */
  beginSkillTurn: (input: {
    userPrompt: string;
    providerId: string;
    params: RefineParams;
    referenceImages: LocalImageReference[];
    source: Extract<GenerationSource, { kind: 'skill' }>;
  }) => {
    turnId: string;
    turnIndex: number;
    jobIds: string[];
    sessionId: string;
    sessionTitle: string;
  } | null;
  /** 生图真正开始时才补建结果占位卡片（Agent 阅读/编排阶段不显示骨架）。幂等。 */
  materializeSkillTurnResults: (turnId: string, jobIds: string[]) => void;
  /** 主进程逐张推送的生图结果回填到对应卡片。 */
  applySkillGenerationResult: (turnId: string, outcome: SkillRuntimeGenerationOutcome) => void;
  /** Skill 执行收尾：写入最终提示词与轨迹，补齐漏掉的结果并结束生成态。 */
  finishSkillTurn: (
    turnId: string,
    patch: {
      prompt: string;
      source: Extract<GenerationSource, { kind: 'skill' }>;
      referenceImages: LocalImageReference[];
      generations: SkillRuntimeGenerationOutcome[];
    },
  ) => void;
  /** Skill 执行整体失败（Agent 报错 / IPC 异常）：所有未完成卡片标记失败。 */
  failSkillTurn: (turnId: string, message: string, code?: string) => void;
  /** 创建设计方案：立即建立对话轮，过程由主进程创建管线事件驱动。 */
  beginSchemeCreationTurn: (input: {
    brief: string;
    executionId: string;
    label: string;
    githubUrl?: string;
  }) => { turnId: string } | null;
  /** 方案文本槽位值：slotId → 用户填写内容（挂载方案附件时使用）。 */
  schemeInputValues: Record<string, string>;
  setSchemeInputValue: (slotId: string, value: string) => void;
  /** 方案运行（试运行/正式使用）：立即建立对话轮，生成由主进程确定性管线驱动。 */
  beginSchemeRunTurn: (input: {
    userPrompt: string;
    executionId: string;
    providerId: string;
    params: RefineParams;
    referenceImages: LocalImageReference[];
    source: Extract<GenerationSource, { kind: 'scheme' }> & { mode: DesignSchemeRunMode };
    /** 质量门修复重跑（有限修复链，规范 §5.5）。 */
    isRepairRun?: boolean;
  }) => {
    turnId: string;
    turnIndex: number;
    jobIds: string[];
    sessionId: string;
    sessionTitle: string;
  } | null;
  patchSchemeRunSource: (
    turnId: string,
    patch: Partial<Omit<Extract<GenerationSource, { kind: 'scheme-run' }>, 'kind'>>,
  ) => void;
  upsertSchemeRunTrace: (turnId: string, item: DesignSchemeCreationTraceItem) => void;
  finishSchemeRunTurn: (
    turnId: string,
    patch: {
      compiledPrompt: string;
      generations: DesignSchemeRunGeneration[];
      trace: DesignSchemeCreationTraceItem[];
      /** 本轮 runId 与质量门修复建议（有限修复链，规范 §5.5）。 */
      runId?: string;
      repairHint?: string | null;
    },
  ) => void;
  failSchemeRunTurn: (turnId: string, message: string, cancelled?: boolean) => void;
  patchSchemeCreationSource: (
    turnId: string,
    patch: Partial<Omit<Extract<GenerationSource, { kind: 'scheme-creation' }>, 'kind'>>,
  ) => void;
  upsertSchemeCreationTrace: (turnId: string, item: DesignSchemeCreationTraceItem) => void;
  completeSchemeCreationTurn: (
    turnId: string,
    draft: SchemeCreationDraftCard,
    trace: DesignSchemeCreationTraceItem[],
  ) => void;
  failSchemeCreationTurn: (turnId: string, message: string, cancelled?: boolean) => void;
  clearDraftSource: () => void;
  setParams: (patch: Partial<RefineParams>) => void;
  submitDraft: () => Promise<void>;
  cancel: () => Promise<void>;
  retryResult: (turnId: string, resultId: string) => Promise<void>;
  submitRefinement: (
    turnId: string,
    resultId: string,
    instruction: string,
    images?: LocalImageReference[],
  ) => Promise<void>;
  reuseResult: (turnId: string, resultId: string) => void;
  editTurn: (turnId: string) => void;
  openDraft: (input: {
    prompt: string;
    negative?: string;
    source?: GenerationSource;
    params?: Partial<RefineParams>;
    references?: PromptReference[];
  }) => void;
  newSession: () => void;
  loadSessions: (archived?: boolean) => Promise<void>;
  openSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  archiveSession: (id: string, archived?: boolean) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  startRefinement: (turnId: string, resultId: string) => void;
  startRefinementFromResults: (turnId: string, resultIds: string[]) => void;
  clearRefinement: () => void;
}

const preferences = loadWorkbenchPreferences();

export const useGenerationWorkbenchStore = create<WorkbenchState>((set, get) => ({
  turns: [],
  ...createEmptyWorkbenchDraft(),
  params: preferences,
  isGenerating: false,
  runningTurns: {},
  activeTurnId: null,
  activeJobId: null,
  cancelRequested: false,
  lastError: null,
  sessionId: uid('session'),
  activeSessionId: null,
  sessions: [],
  archivedSessions: [],
  sessionsLoading: false,
  sessionsError: null,
  refinementContext: null,

  setRunningTurnJob: (turnId, jobId) =>
    set((state) => ({
      activeJobId: jobId,
      runningTurns: state.runningTurns[turnId]
        ? { ...state.runningTurns, [turnId]: { ...state.runningTurns[turnId], jobId } }
        : state.runningTurns,
    })),
  setDraftPrompt: (value) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'set-prompt', value })),
  setDraftCommand: (value) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'set-command', value })),
  setDraftHistorySource: (value) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'set-history-source', value })),
  setDraftNegativePrompt: (value) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'set-negative', value })),
  addDraftReference: (value) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'add-reference', value })),
  removeDraftReference: (index) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'remove-reference', index })),
  clearDraftReferences: () =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'clear-references' })),
  addDraftImages: (value) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'add-images', value })),
  removeDraftImage: (index) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'remove-image', index })),
  clearDraftImages: () =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'clear-images' })),
  setDraftSource: (value) =>
    set((state) => workbenchDraftControllerReducer(state, { type: 'set-source', value })),
  setTurnSkillTrace: (turnId, trace) =>
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) =>
        turn.id === turnId && turn.source.kind === 'skill'
          ? { ...turn, source: { ...turn.source, trace: trace.map((item) => ({ ...item })) } }
          : turn,
      ),
    })),
  beginSkillTurn: (input) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return null;
    const turnId = uid('turn');
    const turnIndex = state.turns.length;
    const jobIds = Array.from({ length: input.params.n }, () => uid('job'));
    const proposedSessionTitle =
      input.userPrompt.replace(/\s+/g, ' ').trim().slice(0, 80) || '新设计';
    const existingSession = state.sessions.find((session) => session.id === state.sessionId);
    const sessionTitle = existingSession?.title ?? proposedSessionTitle;
    const submittedAt = Date.now();
    const turn: GenerationTurn = {
      id: turnId,
      // 最终提示词由主进程 Agent 决定，完成时在 finishSkillTurn 覆盖
      prompt: input.userPrompt,
      userPrompt: input.userPrompt,
      references: [],
      negativePrompt: '',
      source: input.source,
      providerId: input.providerId,
      params: { ...input.params },
      status: 'running',
      // Agent 阶段不显示图片骨架；生图开始后由 materializeSkillTurnResults 补建
      results: [],
      referenceImages: input.referenceImages.map((image) => ({ ...image })),
      createdAt: submittedAt,
    };
    set((current) => ({
      turns: [...current.turns, turn],
      activeSessionId: state.sessionId,
      sessions: reduceSessionSummaries(current.sessions, current.activeSessionId, {
        type: 'upsert',
        item: {
          id: state.sessionId,
          title: sessionTitle,
          createdAt: existingSession?.createdAt ?? submittedAt,
          updatedAt: submittedAt,
          archivedAt: null,
          deletedAt: null,
          turnCount: (existingSession?.turnCount ?? 0) + 1,
          runCount: existingSession?.runCount ?? 0,
          latestAssetPath: existingSession?.latestAssetPath ?? null,
          conversationKind: 'prompt',
          latestStatus: 'running',
        },
      }).items,
      ...withRunRegistered(current, turnId, {
        sessionId: state.sessionId,
        jobId: null,
        cancelRequested: false,
        kind: 'skill',
      }),
      activeJobId: null,
      cancelRequested: false,
      lastError: null,
      draftPrompt: '',
      draftImages: [],
      draftNegativePrompt: '',
      draftSource: { kind: 'manual' as const },
    }));
    void getWorkbenchIO()
      .ensureWorkbenchSession({
        id: state.sessionId,
        title: sessionTitle,
        createdAt: submittedAt,
      })
      .catch((error: unknown) => {
        set({ sessionsError: workbenchSessionErrorMessage(error, '创建对话失败') });
      });
    return { turnId, turnIndex, jobIds, sessionId: state.sessionId, sessionTitle };
  },
  materializeSkillTurnResults: (turnId, jobIds) =>
    set((state) => {
      // 补建的占位卡片要在当前与后台缓存中保持同一 result id，否则后续按 jobId 找 id 会错位。
      const created = new Map<string, string>();
      const resultIdFor = (jobId: string) => {
        const existing = created.get(jobId);
        if (existing) return existing;
        const id = uid('result');
        created.set(jobId, id);
        return id;
      };
      return {
        turns: mapTurnsEverywhere(state.turns, (turn) => {
          if (turn.id !== turnId) return turn;
          const missing = jobIds.filter(
            (jobId) => !turn.results.some((result) => result.jobId === jobId),
          );
          if (missing.length === 0) return turn;
          const results = [
            ...turn.results,
            ...missing.map((jobId) => ({
              id: resultIdFor(jobId),
              jobId,
              status: 'pending' as const,
            })),
          ];
          return { ...turn, results, status: resultStatus(results) };
        }),
      };
    }),
  applySkillGenerationResult: (turnId, outcome) => {
    // 用户可能已切到其他对话：轮次也可能只存在于后台缓存里。
    const turn = findTurnAnywhere(get().turns, turnId);
    const result = turn?.results.find((item) => item.jobId === outcome.jobId);
    if (!turn || !result) return;
    set((state) => ({
      turns: applyImageResult(state.turns, turnId, result.id, outcome.result),
    }));
    if (get().activeJobId === outcome.jobId) set({ activeJobId: null });
  },
  finishSkillTurn: (turnId, patch) => {
    // 兜底补建：取消或事件丢失时也要有卡片承接 cancelled/failed 结果。
    const jobIds = [...patch.generations]
      .sort((left, right) => left.resultIndex - right.resultIndex)
      .map((outcome) => outcome.jobId);
    if (jobIds.length > 0) get().materializeSkillTurnResults(turnId, jobIds);
    for (const outcome of patch.generations) {
      get().applySkillGenerationResult(turnId, outcome);
    }
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) => {
        if (turn.id !== turnId) return turn;
        const results = turn.results.map((result) =>
          result.status === 'pending'
            ? { ...result, status: 'failed' as const, error: '生成未完成', errorCode: 'UNKNOWN' }
            : result,
        );
        return {
          ...turn,
          prompt: patch.prompt || turn.prompt,
          source: patch.source,
          referenceImages: patch.referenceImages.map((image) => ({ ...image })),
          results,
          status: results.length > 0 ? resultStatus(results) : 'failed',
          completedAt: Date.now(),
        };
      }),
      ...withRunReleased(state, turnId),
      draftPrompt: '',
      draftNegativePrompt: '',
      draftCommand: null,
      draftHistorySource: null,
    }));
    markSessionUnreadAfterTurn(turnId);
    void useHistoryStore.getState().load({ limit: 200 });
    void get().loadSessions();
  },
  failSkillTurn: (turnId, message, code = 'UNKNOWN') => {
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) => {
        if (turn.id !== turnId) return turn;
        const results = turn.results.map((result) =>
          result.status === 'pending'
            ? { ...result, status: 'failed' as const, error: message, errorCode: code }
            : result,
        );
        return {
          ...turn,
          results,
          status: results.length > 0 ? resultStatus(results) : 'failed',
          completedAt: Date.now(),
        };
      }),
      ...withRunReleased(state, turnId),
      lastError: { code, message },
    }));
    void get().loadSessions();
  },
  beginSchemeCreationTurn: (input) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return null;
    const turnId = uid('turn');
    const submittedAt = Date.now();
    const briefText = input.brief.trim();
    const proposedSessionTitle = (briefText || `方案创建 · ${input.label}`)
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    const existingSession = state.sessions.find((session) => session.id === state.sessionId);
    const sessionTitle = existingSession?.title ?? proposedSessionTitle;
    const turn: GenerationTurn = {
      id: turnId,
      prompt: briefText,
      userPrompt: briefText,
      references: [],
      negativePrompt: '',
      source: {
        kind: 'scheme-creation',
        label: input.label,
        executionId: input.executionId,
        state: 'created',
        ...(input.githubUrl ? { githubUrl: input.githubUrl } : {}),
        trace: [],
      },
      providerId: null,
      params: { ...state.params },
      status: 'running',
      results: [],
      referenceImages: [],
      createdAt: submittedAt,
    };
    set((current) => ({
      turns: [...current.turns, turn],
      activeSessionId: state.sessionId,
      sessions: reduceSessionSummaries(current.sessions, current.activeSessionId, {
        type: 'upsert',
        item: {
          id: state.sessionId,
          title: sessionTitle,
          createdAt: existingSession?.createdAt ?? submittedAt,
          updatedAt: submittedAt,
          archivedAt: null,
          deletedAt: null,
          turnCount: (existingSession?.turnCount ?? 0) + 1,
          runCount: existingSession?.runCount ?? 0,
          latestAssetPath: existingSession?.latestAssetPath ?? null,
          conversationKind: 'prompt',
          latestStatus: 'running',
        },
      }).items,
      ...withRunRegistered(current, turnId, {
        sessionId: state.sessionId,
        jobId: null,
        cancelRequested: false,
        kind: 'scheme-creation',
      }),
      activeJobId: null,
      cancelRequested: false,
      lastError: null,
    }));
    void getWorkbenchIO()
      .ensureWorkbenchSession({
        id: state.sessionId,
        title: sessionTitle,
        createdAt: submittedAt,
      })
      .catch((error) => {
        set({ sessionsError: workbenchSessionErrorMessage(error, '创建对话失败') });
      });
    return { turnId };
  },
  patchSchemeCreationSource: (turnId, patch) =>
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) =>
        turn.id === turnId && turn.source.kind === 'scheme-creation'
          ? { ...turn, source: { ...turn.source, ...patch } }
          : turn,
      ),
    })),
  schemeInputValues: {},
  setSchemeInputValue: (slotId, value) =>
    set((state) => ({
      schemeInputValues: { ...state.schemeInputValues, [slotId]: value },
    })),
  beginSchemeRunTurn: (input) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return null;
    const turnId = uid('turn');
    const turnIndex = state.turns.length;
    const jobIds = Array.from({ length: input.params.n }, () => uid('job'));
    const proposedSessionTitle =
      `${input.source.mode === 'trial' ? '试运行' : ''}${input.source.label}`.slice(0, 80) ||
      '新设计';
    const existingSession = state.sessions.find((session) => session.id === state.sessionId);
    const sessionTitle = existingSession?.title ?? proposedSessionTitle;
    const submittedAt = Date.now();
    const turn: GenerationTurn = {
      id: turnId,
      // 最终提示词由主进程编译，完成时在 finishSchemeRunTurn 覆盖
      prompt: input.userPrompt,
      userPrompt: input.userPrompt,
      references: [],
      negativePrompt: '',
      source: {
        kind: 'scheme-run',
        schemeId: input.source.schemeId,
        revisionId: input.source.revisionId,
        label: input.source.label,
        mode: input.source.mode,
        executionId: input.executionId,
        state: 'running',
        trace: [],
        generations: [],
        coverAssetId: input.source.coverAssetId,
        ...(input.isRepairRun ? { isRepairRun: true } : {}),
      },
      providerId: input.providerId,
      params: { ...input.params },
      status: 'running',
      // 编译阶段不显示图片骨架；生图开始后由 materializeSkillTurnResults 补建
      results: [],
      referenceImages: input.referenceImages.map((image) => ({ ...image })),
      createdAt: submittedAt,
    };
    set((current) => ({
      turns: [...current.turns, turn],
      activeSessionId: state.sessionId,
      sessions: reduceSessionSummaries(current.sessions, current.activeSessionId, {
        type: 'upsert',
        item: {
          id: state.sessionId,
          title: sessionTitle,
          createdAt: existingSession?.createdAt ?? submittedAt,
          updatedAt: submittedAt,
          archivedAt: null,
          deletedAt: null,
          turnCount: (existingSession?.turnCount ?? 0) + 1,
          runCount: existingSession?.runCount ?? 0,
          latestAssetPath: existingSession?.latestAssetPath ?? null,
          conversationKind: 'prompt',
          latestStatus: 'running',
        },
      }).items,
      ...withRunRegistered(current, turnId, {
        sessionId: state.sessionId,
        jobId: null,
        cancelRequested: false,
        kind: 'scheme-run',
      }),
      activeJobId: null,
      cancelRequested: false,
      lastError: null,
      draftPrompt: '',
      draftImages: [],
      draftNegativePrompt: '',
      draftSource: { kind: 'manual' as const },
      schemeInputValues: {},
    }));
    void getWorkbenchIO()
      .ensureWorkbenchSession({
        id: state.sessionId,
        title: sessionTitle,
        createdAt: submittedAt,
      })
      .catch((error) => {
        set({ sessionsError: workbenchSessionErrorMessage(error, '创建对话失败') });
      });
    return { turnId, turnIndex, jobIds, sessionId: state.sessionId, sessionTitle };
  },
  patchSchemeRunSource: (turnId, patch) =>
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) =>
        turn.id === turnId && turn.source.kind === 'scheme-run'
          ? { ...turn, source: { ...turn.source, ...patch } }
          : turn,
      ),
    })),
  upsertSchemeRunTrace: (turnId, item) =>
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) => {
        if (turn.id !== turnId || turn.source.kind !== 'scheme-run') return turn;
        const trace = turn.source.trace.some((existing) => existing.id === item.id)
          ? turn.source.trace.map((existing) => (existing.id === item.id ? { ...item } : existing))
          : [...turn.source.trace, { ...item }];
        return { ...turn, source: { ...turn.source, trace } };
      }),
    })),
  finishSchemeRunTurn: (turnId, patch) => {
    // 兜底补建：取消或事件丢失时也要有卡片承接 cancelled/failed 结果。
    const jobIds = [...patch.generations]
      .sort((left, right) => left.resultIndex - right.resultIndex)
      .map((outcome) => outcome.jobId);
    if (jobIds.length > 0) get().materializeSkillTurnResults(turnId, jobIds);
    for (const outcome of patch.generations) {
      get().applySkillGenerationResult(turnId, outcome);
    }
    const succeeded = patch.generations.some((outcome) => outcome.result.status === 'success');
    const cancelled =
      !succeeded && patch.generations.some((outcome) => outcome.result.status === 'cancelled');
    const failureMessage =
      succeeded || cancelled
        ? undefined
        : (patch.generations.find((outcome) => outcome.result.error)?.result.error?.message ??
          '图片生成失败');
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) => {
        if (turn.id !== turnId) return turn;
        const results = turn.results.map((result) =>
          result.status === 'pending'
            ? { ...result, status: 'failed' as const, error: '生成未完成', errorCode: 'UNKNOWN' }
            : result,
        );
        return {
          ...turn,
          prompt: patch.compiledPrompt || turn.prompt,
          source:
            turn.source.kind === 'scheme-run'
              ? {
                  ...turn.source,
                  state: succeeded
                    ? ('succeeded' as const)
                    : cancelled
                      ? ('cancelled' as const)
                      : ('failed' as const),
                  trace: patch.trace.map((item) => ({ ...item })),
                  generations: patch.generations.map((outcome) => ({ ...outcome })),
                  ...(patch.runId ? { runId: patch.runId } : {}),
                  repairHint: patch.repairHint ?? null,
                  ...(failureMessage ? { error: failureMessage } : {}),
                }
              : turn.source,
          results,
          status: results.length > 0 ? resultStatus(results) : 'failed',
          completedAt: Date.now(),
        };
      }),
      ...withRunReleased(state, turnId),
      draftPrompt: '',
      draftNegativePrompt: '',
      draftCommand: null,
      draftHistorySource: null,
    }));
    markSessionUnreadAfterTurn(turnId);
    void useHistoryStore.getState().load({ limit: 200 });
    void get().loadSessions();
  },
  failSchemeRunTurn: (turnId, message, cancelled = false) => {
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) => {
        if (turn.id !== turnId) return turn;
        const results = turn.results.map((result) =>
          result.status === 'pending'
            ? { ...result, status: 'failed' as const, error: message, errorCode: 'UNKNOWN' }
            : result,
        );
        return {
          ...turn,
          source:
            turn.source.kind === 'scheme-run'
              ? {
                  ...turn.source,
                  state: cancelled ? ('cancelled' as const) : ('failed' as const),
                  error: message,
                }
              : turn.source,
          results,
          status: results.length > 0 ? resultStatus(results) : cancelled ? 'cancelled' : 'failed',
          completedAt: Date.now(),
        };
      }),
      ...withRunReleased(state, turnId),
      lastError: cancelled ? null : { code: 'SCHEME_RUN_FAILED', message },
    }));
    void get().loadSessions();
  },
  upsertSchemeCreationTrace: (turnId, item) =>
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) => {
        if (turn.id !== turnId || turn.source.kind !== 'scheme-creation') return turn;
        const trace = turn.source.trace.some((existing) => existing.id === item.id)
          ? turn.source.trace.map((existing) => (existing.id === item.id ? { ...item } : existing))
          : [...turn.source.trace, { ...item }];
        return { ...turn, source: { ...turn.source, trace } };
      }),
    })),
  completeSchemeCreationTurn: (turnId, draft, trace) => {
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) =>
        turn.id === turnId && turn.source.kind === 'scheme-creation'
          ? {
              ...turn,
              source: {
                ...turn.source,
                state: 'draft_ready',
                trace: trace.map((item) => ({ ...item })),
                draft,
              },
              status: 'success',
              completedAt: Date.now(),
            }
          : turn,
      ),
      ...withRunReleased(state, turnId),
      draftPrompt: '',
      draftNegativePrompt: '',
      draftCommand: null,
      draftHistorySource: null,
    }));
    markSessionUnreadAfterTurn(turnId);
    void get().loadSessions();
  },
  failSchemeCreationTurn: (turnId, message, cancelled = false) => {
    set((state) => ({
      turns: mapTurnsEverywhere(state.turns, (turn) =>
        turn.id === turnId && turn.source.kind === 'scheme-creation'
          ? {
              ...turn,
              source: {
                ...turn.source,
                state: cancelled ? 'cancelled' : 'failed',
                error: message,
              },
              status: cancelled ? 'cancelled' : 'failed',
              completedAt: Date.now(),
            }
          : turn,
      ),
      ...withRunReleased(state, turnId),
      lastError: cancelled ? null : { code: 'SCHEME_CREATION_FAILED', message },
    }));
    void get().loadSessions();
  },
  clearDraftSource: () =>
    set((state) => ({
      ...workbenchDraftControllerReducer(state, { type: 'clear-source' }),
      schemeInputValues: {},
    })),
  setParams: (patch) =>
    set((state) => {
      const next = { ...state.params, ...patch };
      persistWorkbenchPreferences(next);
      return { params: next };
    }),
  submitDraft: async () => {
    const state = get();
    // 单飞锁按对话粒度：其他对话的运行不阻塞本对话提交。
    if (sessionHasRunningTurn(state, state.sessionId)) return;

    const generation = useGenerationStore.getState();
    const defaultProviderId = useAppStore.getState().defaultProviderId;
    const provider =
      generation.providers.find((item) => item.id === generation.activeProviderId) ??
      generation.providers.find((item) => item.id === defaultProviderId) ??
      generation.providers.find((item) => item.isActive) ??
      generation.providers[0] ??
      null;
    const userPrompt = state.draftPrompt.trim();
    const negativePrompt = state.draftNegativePrompt.trim();
    const basePrompt =
      state.draftSource.kind === 'skill' ? state.draftSource.compiledPrompt : userPrompt;
    const references = state.draftReferences.map((reference) => ({ ...reference }));
    const params = {
      ...state.params,
      ...(provider?.type === 'doubao-web' ? { n: 1 } : {}),
    };
    const prompt = composePromptWithRatioConstraint(
      composePromptWithImageIndexHint(
        composePromptWithReferences(basePrompt, references),
        state.draftImages.length,
      ),
      params.ratioId,
    );
    if (!prompt) return;
    const promptLimit =
      state.draftSource.kind === 'skill' ? SKILL_RUNTIME_PROMPT_LIMIT : WORKBENCH_PROMPT_LIMIT;
    if (prompt.length > promptLimit) {
      set({
        lastError: {
          code: 'PROMPT_TOO_LONG',
          message: `提示词与引用合计 ${prompt.length} 字，不能超过 ${promptLimit} 字`,
        },
      });
      return;
    }
    const turnId = uid('turn');
    const turnIndex = state.turns.length;
    const proposedSessionTitle =
      (userPrompt || basePrompt || references[0]?.title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || '新设计';
    const existingSession = state.sessions.find((session) => session.id === state.sessionId);
    const sessionTitle = existingSession?.title ?? proposedSessionTitle;
    const conversationKind =
      state.draftSource.kind === 'prompt' ||
      state.draftSource.kind === 'skill' ||
      (state.draftSource.kind === 'history' && Boolean(state.draftSource.promptId)) ||
      references.length > 0
        ? 'prompt'
        : 'chat';
    const submittedAt = Date.now();
    const results: GenerationResultItem[] = Array.from({ length: params.n }, () => ({
      id: uid('result'),
      jobId: '',
      status: 'pending',
    }));
    const turn: GenerationTurn = {
      id: turnId,
      prompt,
      userPrompt,
      references,
      negativePrompt,
      source: state.draftSource,
      providerId: provider?.id ?? null,
      params,
      status: provider?.hasKey ? 'running' : 'failed',
      results,
      referenceImages: state.draftImages.map((image) => ({ ...image })),
      parentHistoryId: sourceParentHistoryId(state.draftSource),
      createdAt: Date.now(),
    };

    set((current) => ({
      turns: [...current.turns, turn],
      activeSessionId: state.sessionId,
      sessions: reduceSessionSummaries(current.sessions, current.activeSessionId, {
        type: 'upsert',
        item: {
          id: state.sessionId,
          title: sessionTitle,
          createdAt: existingSession?.createdAt ?? submittedAt,
          updatedAt: submittedAt,
          archivedAt: null,
          deletedAt: null,
          turnCount: (existingSession?.turnCount ?? 0) + 1,
          runCount: existingSession?.runCount ?? 0,
          latestAssetPath: existingSession?.latestAssetPath ?? null,
          conversationKind,
          latestStatus: provider?.hasKey ? 'running' : null,
        },
      }).items,
      ...(provider?.hasKey
        ? withRunRegistered(current, turnId, {
            sessionId: state.sessionId,
            jobId: null,
            cancelRequested: false,
            kind: 'image',
          })
        : {}),
      cancelRequested: false,
      lastError: provider?.hasKey
        ? null
        : {
            code: provider ? 'NO_KEY' : 'NO_PROVIDER',
            message: provider ? '当前服务商尚未配置密钥' : '尚未配置服务商',
          },
      ...(provider?.hasKey
        ? {
            draftPrompt: '',
            draftImages: [],
            draftNegativePrompt: '',
            draftSource: { kind: 'manual' as const },
          }
        : {}),
    }));

    try {
      await getWorkbenchIO().ensureWorkbenchSession({
        id: state.sessionId,
        title: sessionTitle,
        createdAt: submittedAt,
      });
    } catch (error) {
      set({ sessionsError: workbenchSessionErrorMessage(error, '创建对话失败') });
    }

    if (!provider?.hasKey) {
      for (const result of results) {
        set((current) => ({
          turns: updateGenerationResult(current.turns, turnId, result.id, {
            status: 'failed',
            errorCode: provider ? 'NO_KEY' : 'NO_PROVIDER',
            error: provider ? '当前服务商尚未配置密钥' : '尚未配置服务商',
          }),
        }));
      }
      return;
    }

    for (const result of results) {
      // 取消只作用于本轮（并行运行互不影响）。
      if (get().runningTurns[turnId]?.cancelRequested) {
        set((current) => ({
          turns: updateGenerationResult(current.turns, turnId, result.id, {
            status: 'cancelled',
            errorCode: 'CANCELLED',
            error: '已取消生成',
          }),
        }));
        continue;
      }
      const jobId = uid('job');
      set((current) => ({
        turns: updateGenerationResult(current.turns, turnId, result.id, {
          jobId,
          status: 'pending',
        }),
      }));
      get().setRunningTurnJob(turnId, jobId);
      try {
        const refineSource = sourceToRefineSource(state.draftSource);
        const request = buildImageRequest({
          jobId,
          providerId: provider.id,
          prompt,
          negative: negativePrompt,
          params,
          source: refineSource,
          parentHistoryId: sourceParentHistoryId(state.draftSource),
          references,
          referenceImages: state.draftImages,
          workbench: {
            sessionId: state.sessionId,
            sessionTitle,
            turnId,
            turnIndex,
            resultIndex: results.indexOf(result),
            userPrompt,
          },
          skillRuntime:
            state.draftSource.kind === 'skill'
              ? {
                  label: state.draftSource.label,
                  repositoryUrl: state.draftSource.repositoryUrl,
                  executionMode: state.draftSource.executionMode,
                  trace: state.draftSource.trace,
                }
              : undefined,
        });
        const response = await getWorkbenchIO().generateImage(request);
        set((current) => ({
          turns: applyImageResult(current.turns, turnId, result.id, response),
        }));
      } catch (error) {
        set((current) => ({
          turns: applyTransportError(current.turns, turnId, result.id, error),
        }));
      } finally {
        if (get().activeJobId === jobId) set({ activeJobId: null });
        if (provider.type === 'doubao-web') {
          void useDoubaoAccountStore
            .getState()
            .refreshUsage()
            .catch(() => {});
        }
      }
    }

    set((current) => ({
      ...withRunReleased(current, turnId),
      turns: mapTurnsEverywhere(current.turns, (item) =>
        item.id === turnId ? { ...item, completedAt: Date.now() } : item,
      ),
    }));
    markSessionUnreadAfterTurn(turnId);
    void useHistoryStore.getState().load({ limit: 200 });
    void get().loadSessions();
  },

  cancel: async () => {
    // 取消当前对话的运行（并行时不影响其他对话）。
    const state = get();
    const running = Object.entries(state.runningTurns).find(
      ([, entry]) => entry.sessionId === state.sessionId && !entry.cancelRequested,
    );
    if (!running) return;
    const [turnId] = running;
    set((current) => ({
      cancelRequested: true,
      runningTurns: current.runningTurns[turnId]
        ? {
            ...current.runningTurns,
            [turnId]: { ...current.runningTurns[turnId], cancelRequested: true },
          }
        : current.runningTurns,
    }));
    const jobId = get().runningTurns[turnId]?.jobId;
    if (!jobId) return;
    try {
      await getWorkbenchIO().cancelImage(jobId);
    } catch {
      // 主进程任务最终会以 cancelled/failed 返回，取消 IPC 失败不阻塞状态收尾。
    }
  },

  retryResult: async (turnId, resultId) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return;
    const turn = state.turns.find((item) => item.id === turnId);
    const target = turn?.results.find((item) => item.id === resultId);
    if (!turn || !target || !turn.providerId) return;

    set((current) => ({
      turns: updateGenerationResult(current.turns, turnId, resultId, {
        status: 'pending',
        error: undefined,
        errorCode: undefined,
        imagePath: undefined,
        cost: undefined,
        durationMs: undefined,
      }),
    }));
    const jobId = uid('job');
    set((current) => ({
      ...withRunRegistered(current, turnId, {
        sessionId: state.sessionId,
        jobId,
        cancelRequested: false,
        kind: 'retry',
      }),
      lastError: null,
    }));
    set((current) => ({
      turns: updateGenerationResult(current.turns, turnId, resultId, { jobId }),
    }));
    set({ activeJobId: jobId });
    const freshRequest = () =>
      buildImageRequest({
        jobId,
        providerId: turn.providerId!,
        prompt: turn.prompt,
        negative: turn.negativePrompt,
        params: turn.params,
        source: sourceToRefineSource(turn.source),
        parentHistoryId: turn.parentHistoryId,
        references: turn.references,
        referenceImages: turn.referenceImages,
        workbench: {
          sessionId: state.sessionId,
          sessionTitle: turn.userPrompt.slice(0, 80) || '新设计',
          turnId: turn.id,
          turnIndex: turnIndexForTurn(state.turns, turn.id),
          resultIndex: turn.results.findIndex((item) => item.id === resultId),
          userPrompt: turn.userPrompt,
        },
      });
    try {
      let response = target.historyId
        ? await getWorkbenchIO().retryImage(target.historyId, jobId)
        : await getWorkbenchIO().generateImage(freshRequest());
      // 崩溃恢复后的重试：中断的那张只有运行账本、没有 history 记录
      // （history 在完成时才落库）。此时按本轮快照重发一次，而不是把用户
      // 堵在「历史记录已不存在」的死路上。
      if (response.status !== 'success' && response.error?.code === 'NO_HISTORY') {
        response = await getWorkbenchIO().generateImage(freshRequest());
      }
      set((current) => ({
        turns: applyImageResult(current.turns, turnId, resultId, response),
      }));
    } catch (error) {
      set((current) => ({
        turns: applyTransportError(current.turns, turnId, resultId, error),
      }));
    } finally {
      set((current) => withRunReleased(current, turnId));
      const retryProvider = useGenerationStore
        .getState()
        .providers.find((item) => item.id === turn.providerId);
      if (retryProvider?.type === 'doubao-web') {
        void useDoubaoAccountStore
          .getState()
          .refreshUsage()
          .catch(() => {});
      }
      markSessionUnreadAfterTurn(turnId);
      void useHistoryStore.getState().load({ limit: 200 });
    }
  },

  submitRefinement: async (turnId, resultId, instruction, images = []) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return;
    const turn = state.turns.find((item) => item.id === turnId);
    const target = turn?.results.find((item) => item.id === resultId);
    const text = instruction.trim();
    if (
      !turn ||
      !target ||
      target.status !== 'success' ||
      !target.imagePath ||
      !target.historyId ||
      !turn.providerId ||
      !text
    )
      return;

    const fallbackImage: LocalImageReference = {
      source: 'history',
      path: target.imagePath,
      historyId: target.historyId,
      ...(target.assetId ? { assetId: target.assetId } : {}),
      name: '图 1',
    };
    const inheritedImages =
      state.refinementContext?.turnId === turnId && state.refinementContext.images.length > 0
        ? state.refinementContext.images
        : [fallbackImage];
    const referenceImages = uniqueReferenceImages([...inheritedImages, ...images]);
    const generation = useGenerationStore.getState();
    const provider = generation.providers.find((item) => item.id === turn.providerId);
    // 豆包网页已经收到所选图片；微调时只发送本轮修改要求，不能把首次
    // 生图使用的 Skill/长提示词再次嵌入请求。其他 Provider 保持原有语义。
    const prompt =
      provider?.type === 'doubao-web'
        ? text
        : composePromptWithRatioConstraint(
            composePromptWithRefinementImageHint(
              composeRefinementPrompt(turn.prompt, text),
              referenceImages.length,
            ),
            turn.params.ratioId,
          );
    if (prompt.length > WORKBENCH_PROMPT_LIMIT) {
      set({
        lastError: {
          code: 'PROMPT_TOO_LONG',
          message: `微调后的提示词共 ${prompt.length} 字，不能超过 ${WORKBENCH_PROMPT_LIMIT} 字`,
        },
      });
      return;
    }

    const refinementTurnId = uid('turn');
    const refinementTurnIndex = state.turns.length;
    const refinementResultId = uid('result');
    const jobId = uid('job');
    const refinementTurn: GenerationTurn = {
      id: refinementTurnId,
      prompt,
      userPrompt: text,
      references: turn.references.map((reference) => ({ ...reference })),
      negativePrompt: turn.negativePrompt,
      source: turn.source,
      providerId: turn.providerId,
      params: { ...turn.params, n: 1 },
      status: provider?.hasKey ? 'running' : 'failed',
      results: [
        {
          id: refinementResultId,
          jobId,
          status: provider?.hasKey ? 'pending' : 'failed',
          ...(provider?.hasKey
            ? {}
            : {
                errorCode: provider ? 'NO_KEY' : 'NO_PROVIDER',
                error: provider ? '当前服务商尚未配置密钥' : '尚未配置服务商',
              }),
        },
      ],
      referenceImages: referenceImages.map((image) => ({ ...image })),
      parentHistoryId: target.historyId,
      createdAt: Date.now(),
    };

    set((current) => ({
      turns: [...current.turns, refinementTurn],
      ...(provider?.hasKey
        ? withRunRegistered(current, refinementTurnId, {
            sessionId: state.sessionId,
            jobId,
            cancelRequested: false,
            kind: 'refinement',
          })
        : {}),
      activeJobId: provider?.hasKey ? jobId : null,
      cancelRequested: false,
      lastError: provider?.hasKey
        ? null
        : {
            code: provider ? 'NO_KEY' : 'NO_PROVIDER',
            message: provider ? '当前服务商尚未配置密钥' : '尚未配置服务商',
          },
    }));

    if (!provider?.hasKey) {
      set((current) => ({
        turns: mapTurnsEverywhere(current.turns, (item) =>
          item.id === refinementTurnId ? { ...item, completedAt: Date.now() } : item,
        ),
        refinementContext: null,
        draftPrompt: '',
        draftImages: [],
      }));
      return;
    }

    try {
      const response = await getWorkbenchIO().generateImage(
        buildImageRequest({
          jobId,
          providerId: provider.id,
          prompt,
          negative: turn.negativePrompt,
          params: { ...turn.params, n: 1 },
          source: sourceToRefineSource(turn.source),
          parentHistoryId: target.historyId,
          sourceAssetId: target.assetId ?? target.historyId,
          refinementInstruction: text,
          referenceImages,
          references: turn.references,
          workbench: {
            sessionId: state.sessionId,
            sessionTitle: turn.userPrompt.slice(0, 80) || '新设计',
            turnId: refinementTurnId,
            turnIndex: refinementTurnIndex,
            resultIndex: 0,
            userPrompt: text,
          },
        }),
      );
      set((current) => ({
        turns: applyImageResult(current.turns, refinementTurnId, refinementResultId, response),
      }));
    } catch (error) {
      set((current) => ({
        turns: applyTransportError(current.turns, refinementTurnId, refinementResultId, error),
      }));
    } finally {
      set((current) => ({
        ...withRunReleased(current, refinementTurnId),
        refinementContext: null,
        draftPrompt: '',
        draftImages: [],
        turns: mapTurnsEverywhere(current.turns, (item) =>
          item.id === refinementTurnId ? { ...item, completedAt: Date.now() } : item,
        ),
      }));
      markSessionUnreadAfterTurn(refinementTurnId);
      if (provider.type === 'doubao-web') {
        void useDoubaoAccountStore
          .getState()
          .refreshUsage()
          .catch(() => {});
      }
      void useHistoryStore.getState().load({ limit: 200 });
    }
  },

  reuseResult: (turnId, resultId) => {
    const state = get();
    const turn = state.turns.find((item) => item.id === turnId);
    const result = turn?.results.find((item) => item.id === resultId);
    if (!turn || !result?.historyId) return;
    set({
      draftPrompt: turn.userPrompt,
      draftNegativePrompt: turn.negativePrompt,
      draftReferences: turn.references.map((reference) => ({ ...reference })),
      draftImages: turn.referenceImages.map((image) => ({ ...image })),
      draftSource: {
        kind: 'history',
        id: result.historyId,
        label: '再次制作此结果',
        promptId: sourcePromptId(turn.source),
      },
      params: { ...turn.params },
      refinementContext: null,
    });
  },

  editTurn: (turnId) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return;
    const turn = state.turns.find((item) => item.id === turnId);
    if (!turn) return;

    let refinementContext: RefinementContext | null = null;
    if (turn.parentHistoryId) {
      for (const candidate of state.turns) {
        const result = candidate.results.find((item) => item.historyId === turn.parentHistoryId);
        if (result?.imagePath && result.status === 'success') {
          const targetImage = turn.referenceImages.find(
            (image) => image.source === 'history' && image.historyId === turn.parentHistoryId,
          );
          refinementContext = {
            turnId: candidate.id,
            resultId: result.id,
            historyId: result.historyId!,
            assetId: result.assetId,
            imagePath: result.imagePath,
            label: candidate.userPrompt.slice(0, 48) || '上一张图片',
            images: [
              targetImage
                ? { ...targetImage, name: '图 1' }
                : {
                    source: 'history',
                    path: result.imagePath,
                    historyId: result.historyId!,
                    ...(result.assetId ? { assetId: result.assetId } : {}),
                    name: '图 1',
                  },
            ],
          };
          break;
        }
      }
    }

    const editableReferences = refinementContext
      ? turn.referenceImages
          .filter(
            (image) => !(image.source === 'history' && image.historyId === turn.parentHistoryId),
          )
          .map((image) => ({ ...image }))
      : turn.referenceImages.map((image) => ({ ...image }));
    set({
      draftPrompt: turn.userPrompt.slice(0, WORKBENCH_PROMPT_LIMIT),
      draftNegativePrompt: turn.negativePrompt,
      draftReferences: turn.references.map((reference) => ({ ...reference })),
      draftImages: editableReferences,
      draftSource: turn.source,
      params: { ...turn.params },
      refinementContext,
      lastError: null,
    });
  },

  openDraft: ({ prompt, negative = '', source = { kind: 'manual' }, params, references = [] }) => {
    cacheSessionTurns(get().sessionId, get().turns);
    set((state) => ({
      turns: [],
      sessionId: uid('session'),
      activeSessionId: null,
      draftPrompt: prompt.slice(0, WORKBENCH_PROMPT_LIMIT),
      draftNegativePrompt: negative,
      draftSource: source,
      draftCommand: null,
      draftHistorySource: null,
      draftReferences: references.map((reference) => ({ ...reference })),
      draftImages: [],
      params: {
        ...state.params,
        ...(source.kind === 'manual' ? {} : { n: 1 }),
        ...params,
      },
      refinementContext: null,
    }));
    useAppStore.getState().setView('generate');
  },

  newSession: () => {
    // 生成期间也允许开新对话：正在运行的会话连同未落库的轮次进入后台缓存，
    // 事件继续写入缓存，完成后侧栏标未读。单飞约束不变（不能同时发起第二次生成）。
    const state = get();
    cacheSessionTurns(state.sessionId, state.turns);
    set({
      turns: [],
      ...createEmptyWorkbenchDraft(),
      params: loadWorkbenchPreferences(),
      lastError: null,
      sessionId: uid('session'),
      activeSessionId: null,
      refinementContext: null,
    });
  },

  startRefinement: (turnId, resultId) => {
    get().startRefinementFromResults(turnId, [resultId]);
  },

  startRefinementFromResults: (turnId, resultIds) => {
    const turn = get().turns.find((item) => item.id === turnId);
    if (!turn) return;
    const results = resultIds
      .map((resultId) => turn.results.find((item) => item.id === resultId))
      .filter((result): result is GenerationResultItem & { historyId: string; imagePath: string } =>
        Boolean(result?.historyId && result.imagePath && result.status === 'success'),
      );
    const result = results[0];
    if (!result) return;
    const targetImage: LocalImageReference = {
      source: 'history',
      path: result.imagePath,
      historyId: result.historyId,
      ...(result.assetId ? { assetId: result.assetId } : {}),
      name: '图 1',
    };
    set({
      refinementContext: {
        turnId,
        resultId: result.id,
        historyId: result.historyId,
        assetId: result.assetId,
        imagePath: result.imagePath,
        label: turn.userPrompt.slice(0, 48) || '上一张图片',
        images: [targetImage],
      },
      draftPrompt: '',
      draftImages: results.slice(1).map((item, index) => ({
        source: 'history',
        path: item.imagePath,
        historyId: item.historyId,
        ...(item.assetId ? { assetId: item.assetId } : {}),
        name: `图 ${index + 2}`,
      })),
      lastError: null,
    });
  },

  clearRefinement: () => set({ refinementContext: null, draftPrompt: '', draftImages: [] }),

  loadSessions: async (archived = false) => {
    set({ sessionsLoading: true, sessionsError: null });
    const outcome = await workbenchSessionController.list(archived);
    if (outcome.status === 'stale') return;
    if (outcome.status === 'error') {
      set({
        sessionsLoading: false,
        sessionsError: workbenchSessionErrorMessage(outcome.error, '加载对话失败'),
      });
      return;
    }
    set((current) => {
      if (archived) return { archivedSessions: outcome.value.items, sessionsLoading: false };
      const activeOptimistic =
        current.activeSessionId === current.sessionId && current.turns.length > 0
          ? current.sessions.find((session) => session.id === current.activeSessionId)
          : undefined;
      const sessions =
        activeOptimistic &&
        !outcome.value.items.some((session) => session.id === activeOptimistic.id)
          ? [activeOptimistic, ...outcome.value.items]
          : outcome.value.items;
      const reconciled = reduceSessionSummaries(current.sessions, current.activeSessionId, {
        type: 'replace',
        items: sessions,
      });
      return { sessions: reconciled.items, sessionsLoading: false };
    });
  },

  openSession: async (id) => {
    // 生成期间也允许切换：当前会话先进后台缓存（含未落库的方案创建/修改轮）。
    const state = get();
    cacheSessionTurns(state.sessionId, state.turns);

    // 本次运行期间访问过（或正在后台运行）的会话：内存快照比数据库全，原样恢复。
    const operation = workbenchSessionController.open(id);
    if (operation.source === 'cache') {
      const last = operation.turns.at(-1);
      set({
        sessionId: id,
        activeSessionId: id,
        turns: operation.turns,
        ...createEmptyWorkbenchDraft(),
        params: last?.params ?? loadWorkbenchPreferences(),
        refinementContext: null,
        sessionsLoading: false,
        sessionsError: null,
      });
      useAppStore.getState().setView('generate');
      return;
    }

    set({ sessionsLoading: true, sessionsError: null });
    const outcome = await operation.result;
    if (outcome.status === 'stale') return;
    if (outcome.status === 'error') {
      set({
        sessionsLoading: false,
        sessionsError: workbenchSessionErrorMessage(outcome.error, '打开对话失败'),
      });
      return;
    }
    const turns = turnsFromSession(outcome.value);
    const last = turns.at(-1);
    const selection = reduceSessionSummaries(get().sessions, get().activeSessionId, {
      type: 'select',
      id,
    });
    set({
      sessionId: id,
      activeSessionId: selection.selectedId,
      turns,
      ...createEmptyWorkbenchDraft(),
      params: last?.params ?? loadWorkbenchPreferences(),
      refinementContext: null,
      sessionsLoading: false,
    });
    useAppStore.getState().setView('generate');
  },

  renameSession: async (id, title) => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      const renamed = await getWorkbenchIO().renameWorkbenchSession(id, title);
      set((current) => {
        const existing =
          current.sessions.find((item) => item.id === id) ??
          current.archivedSessions.find((item) => item.id === id);
        const item = mergeSessionSummary(renamed, existing);
        const target = renamed.archivedAt ? 'archivedSessions' : 'sessions';
        const next = reduceSessionSummaries(
          current[target],
          target === 'sessions' ? current.activeSessionId : null,
          { type: 'upsert', item },
        );
        return {
          [target]: next.items,
          sessionsLoading: false,
          sessionsError: null,
        };
      });
    } catch (error) {
      set({
        sessionsLoading: false,
        sessionsError: workbenchSessionErrorMessage(error, '重命名对话失败'),
      });
      throw error;
    }
  },

  archiveSession: async (id, archived = true) => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      const existing =
        get().sessions.find((item) => item.id === id) ??
        get().archivedSessions.find((item) => item.id === id);
      const result = await getWorkbenchIO().archiveWorkbenchSession(id, archived);
      if (get().activeSessionId === id) get().newSession();
      set((current) => {
        const item = mergeSessionSummary(result, existing);
        const active = reduceSessionSummaries(
          current.sessions,
          current.activeSessionId,
          archived ? { type: 'remove', id } : { type: 'upsert', item },
        );
        const archivedList = reduceSessionSummaries(
          current.archivedSessions,
          null,
          archived ? { type: 'upsert', item } : { type: 'remove', id },
        );
        return {
          sessions: active.items,
          archivedSessions: archivedList.items,
          activeSessionId: active.selectedId,
          sessionsLoading: false,
          sessionsError: null,
        };
      });
    } catch (error) {
      set({
        sessionsLoading: false,
        sessionsError: workbenchSessionErrorMessage(
          error,
          archived ? '归档对话失败' : '恢复对话失败',
        ),
      });
      throw error;
    }
  },

  deleteSession: async (id) => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      await getWorkbenchIO().deleteWorkbenchSession(id, 1);
      // newSession 会把当前对话快照进缓存，删除对话时要在其后清掉该会话的缓存。
      if (get().activeSessionId === id) get().newSession();
      workbenchSessionController.deleteCachedTurns(id);
      set((current) => {
        const active = reduceSessionSummaries(current.sessions, current.activeSessionId, {
          type: 'remove',
          id,
        });
        const archived = reduceSessionSummaries(current.archivedSessions, null, {
          type: 'remove',
          id,
        });
        return {
          sessions: active.items,
          archivedSessions: archived.items,
          activeSessionId: active.selectedId,
          sessionsLoading: false,
          sessionsError: null,
        };
      });
    } catch (error) {
      set({
        sessionsLoading: false,
        sessionsError: workbenchSessionErrorMessage(error, '删除对话失败'),
      });
      throw error;
    }
  },
}));

function turnIndexForTurn(turns: GenerationTurn[], turnId: string): number {
  return Math.max(
    0,
    turns.findIndex((turn) => turn.id === turnId),
  );
}

// 生成完成但用户不在原对话查看时，把会话标记为未读（侧栏绿色光晕）。
// 生成期间允许切换/新建对话：轮次可能已随原会话进入后台缓存，
// 此时无论当前视图如何都标未读；只有仍停留在原对话且在制作视图才视为已读。
function markSessionUnreadAfterTurn(turnId: string) {
  const workbench = useGenerationWorkbenchStore.getState();
  const inCurrentSession = workbench.turns.some((item) => item.id === turnId);
  const sessionId = inCurrentSession ? workbench.sessionId : sessionIdForTurn(turnId);
  if (!sessionId) return;
  const turn = (
    inCurrentSession ? workbench.turns : (workbenchSessionController.cachedTurns(sessionId) ?? [])
  ).find((item) => item.id === turnId);
  if (!turn?.results.some((result) => result.status === 'success')) return;
  if (inCurrentSession && useAppStore.getState().currentView === 'generate') return;
  setSessionUnread(sessionId, true);
}

// Provider 自动重试发生在主进程，必须用独立事件把状态映射回当前结果卡片。
// 用户可能已切走对话：后台缓存中的原对话同样要收到重试状态。
subscribeToWorkbenchGenerationProgress((progress) => {
  useGenerationWorkbenchStore.setState((state) => ({
    turns: applyGenerationProgress(state.turns, progress),
  }));
});

export { DEFAULT_WORKBENCH_PARAMS, WORKBENCH_PROMPT_LIMIT };
export type { RunningTurnEntry };
