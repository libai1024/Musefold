import { create } from 'zustand';
import { subscribeToWorkbenchGenerationProgress } from './io';
import {
  createEmptyWorkbenchDraft,
  DEFAULT_WORKBENCH_PARAMS,
  loadWorkbenchPreferences,
  persistWorkbenchPreferences,
  workbenchDraftControllerReducer,
  WORKBENCH_PROMPT_LIMIT,
} from './draftController';
import { applyGenerationProgress, type RunningTurnEntry } from './generationSyncController';
import { createWorkbenchGenerationActions } from './store-generation-actions';
import { createWorkbenchSchemeActions } from './store-scheme-actions';
import { createWorkbenchSessionActions } from './store-session-actions';
import { createWorkbenchSkillActions } from './store-skill-actions';
import {
  clearSessionTurnsCacheForTests,
  composeRefinementPrompt,
  uid,
} from './store-shared';
import type { WorkbenchState } from './store-types';

export type { WorkbenchState } from './store-types';
export { clearSessionTurnsCacheForTests, composeRefinementPrompt };
export { useDesktopWorkbenchSessionList } from './workbench-session-query';

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

  ...createWorkbenchSkillActions(set, get),
  ...createWorkbenchSchemeActions(set, get),
  ...createWorkbenchGenerationActions(set, get),
  ...createWorkbenchSessionActions(set, get),
}));

subscribeToWorkbenchGenerationProgress((progress) => {
  useGenerationWorkbenchStore.setState((state) => ({
    turns: applyGenerationProgress(state.turns, progress),
  }));
});

export { DEFAULT_WORKBENCH_PARAMS, WORKBENCH_PROMPT_LIMIT };
export type { RunningTurnEntry };
