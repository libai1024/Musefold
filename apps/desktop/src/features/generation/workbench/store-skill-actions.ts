import type { GenerationTurn } from './types';
import { getWorkbenchIO } from './io';
import { notifyWorkbenchHistoryChanged } from '../../../runtime/workbench-side-effects';
import { workbenchSessionErrorMessage } from './sessionErrors';
import { resultStatus, sessionHasRunningTurn, withRunRegistered, withRunReleased, applyImageResult } from './generationSyncController';
import {
  findTurnAnywhere,
  mapTurnsEverywhere,
  markSessionUnreadAfterTurn,
  rememberRunningSession,
  uid,
} from './store-shared';
import { findDesktopWorkbenchSession } from './workbench-session-query';
import type { WorkbenchGet, WorkbenchSet, WorkbenchSkillActions } from './store-types';

export function createWorkbenchSkillActions(set: WorkbenchSet, get: WorkbenchGet): WorkbenchSkillActions {
  return {
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
    const existingSession = findDesktopWorkbenchSession(state.sessionId);
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
    markSessionUnreadAfterTurn(turnId, get);
    notifyWorkbenchHistoryChanged();
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
  };
}
