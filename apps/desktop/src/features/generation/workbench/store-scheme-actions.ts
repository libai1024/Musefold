import type { LocalImageReference } from '@musefold/desktop-contracts/providers';
import type { RefineParams } from '../../../lib/generation-params';
import type { GenerationTurn, SchemeCreationDraftCard } from './types';
import type {
  DesignSchemeCreationTraceItem,
  DesignSchemeRunGeneration,
  DesignSchemeRunMode,
} from '@musefold/desktop-contracts/design-scheme';
import { getWorkbenchIO } from './io';
import { workbenchSessionErrorMessage } from './sessionErrors';
import {
  applyImageResult,
  resultStatus,
  sessionHasRunningTurn,
  withRunRegistered,
  withRunReleased,
} from './generationSyncController';
import {
  mapTurnsEverywhere,
  markSessionUnreadAfterTurn,
  rememberRunningSession,
  uid,
} from './store-shared';
import { findDesktopWorkbenchSession } from './workbench-session-query';
import { notifyWorkbenchHistoryChanged } from '../../../runtime/workbench-side-effects';
import type { WorkbenchGet, WorkbenchSet, WorkbenchSchemeActions } from './store-types';

export function createWorkbenchSchemeActions(set: WorkbenchSet, get: WorkbenchGet): WorkbenchSchemeActions {
  return {
  beginSchemeCreationTurn: (input) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return null;
    const turnId = uid('turn');
    const submittedAt = Date.now();
    const briefText = input.brief.trim();
    const proposedSessionTitle = (briefText || `方案创建 · ${input.label}`)
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    const existingSession = findDesktopWorkbenchSession(state.sessionId);
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
    rememberRunningSession({
      sessionId: state.sessionId,
      title: sessionTitle,
      existing: existingSession,
      submittedAt,
      conversationKind: 'prompt',
      latestStatus: 'running',
    });
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
    const existingSession = findDesktopWorkbenchSession(state.sessionId);
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
    rememberRunningSession({
      sessionId: state.sessionId,
      title: sessionTitle,
      existing: existingSession,
      submittedAt,
      conversationKind: 'prompt',
      latestStatus: 'running',
    });
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
    markSessionUnreadAfterTurn(turnId, get);
    notifyWorkbenchHistoryChanged();
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
    markSessionUnreadAfterTurn(turnId, get);
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
  };
}
