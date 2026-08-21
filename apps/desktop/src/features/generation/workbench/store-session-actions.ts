import { useAppStore } from '../../../stores/app';
import { getWorkbenchIO } from './io';
import type { GenerationResultItem, GenerationTurn, RefinementContext } from './types';
import type { LocalImageReference } from '@musefold/desktop-contracts/providers';
import { workbenchSessionErrorMessage } from './sessionErrors';
import {
  createEmptyWorkbenchDraft,
  loadWorkbenchPreferences,
  WORKBENCH_PROMPT_LIMIT,
} from './draftController';
import { sessionHasRunningTurn } from './generationSyncController';
import { workbenchSessionController } from './sessionController';
import {
  cacheSessionTurns,
  mergeSessionSummary,
  sourcePromptId,
  turnsFromSession,
  uid,
} from './store-shared';
import {
  dropDesktopWorkbenchSession,
  fetchDesktopWorkbenchSessions,
  findDesktopWorkbenchSession,
  replaceDesktopWorkbenchSessions,
  upsertDesktopWorkbenchSession,
} from './workbench-session-query';
import type { WorkbenchGet, WorkbenchSessionActions, WorkbenchSet } from './store-types';

export function createWorkbenchSessionActions(set: WorkbenchSet, get: WorkbenchGet): WorkbenchSessionActions {
  return {
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
    set({ sessionsError: null });
    try {
      let items = await fetchDesktopWorkbenchSessions(archived);
      if (!archived) {
        const current = get();
        const activeOptimistic =
          current.activeSessionId === current.sessionId && current.turns.length > 0
            ? findDesktopWorkbenchSession(current.activeSessionId ?? '')
            : undefined;
        if (
          activeOptimistic &&
          !items.some((session) => session.id === activeOptimistic.id)
        ) {
          items = [activeOptimistic, ...items];
        }
      }
      replaceDesktopWorkbenchSessions(archived, items);
    } catch (error) {
      set({
        sessionsError: workbenchSessionErrorMessage(error, '加载对话失败'),
      });
    }
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
    set({
      sessionId: id,
      activeSessionId: id,
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
      const existing = findDesktopWorkbenchSession(id);
      upsertDesktopWorkbenchSession(mergeSessionSummary(renamed, existing));
      set({ sessionsLoading: false, sessionsError: null });
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
      const existing = findDesktopWorkbenchSession(id);
      const result = await getWorkbenchIO().archiveWorkbenchSession(id, archived);
      if (get().activeSessionId === id) get().newSession();
      upsertDesktopWorkbenchSession(mergeSessionSummary(result, existing));
      set({ sessionsLoading: false, sessionsError: null });
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
      dropDesktopWorkbenchSession(id);
      set({ sessionsLoading: false, sessionsError: null });
    } catch (error) {
      set({
        sessionsLoading: false,
        sessionsError: workbenchSessionErrorMessage(error, '删除对话失败'),
      });
      throw error;
    }
  },
  };
}
