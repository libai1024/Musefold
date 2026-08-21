import type { LocalImageReference, PromptReference } from '@musefold/desktop-contracts/providers';
import type { DesignSchemeHistorySourceItem } from '@musefold/desktop-contracts/design-scheme';
import { LOCAL_STORAGE_PREFIX } from '@musefold/domain/constants';
import { DEFAULT_REFINE_PARAMS, type RefineParams } from '../../../lib/generation-params';
import type { GenerationSource } from './types';
import {
  isDuplicateReference,
  MAX_DRAFT_REFERENCES,
  MAX_REFERENCE_TEXT_LENGTH,
} from '../../../lib/prompt-references';
import { uniqueReferenceImages } from './imageReferences';

export const DEFAULT_WORKBENCH_PARAMS: RefineParams = {
  ...DEFAULT_REFINE_PARAMS,
  n: 4,
};

const PREFERENCES_KEY = `${LOCAL_STORAGE_PREFIX}workbench-preferences-v2`;
export const WORKBENCH_PROMPT_LIMIT = 8000;

export interface WorkbenchDraftControllerState {
  draftPrompt: string;
  draftNegativePrompt: string;
  draftReferences: PromptReference[];
  draftImages: LocalImageReference[];
  draftSource: GenerationSource;
  draftCommand: 'design-plan' | null;
  draftHistorySource: { items: DesignSchemeHistorySourceItem[] } | null;
  params: RefineParams;
  lastError: { code: string; message: string } | null;
}

export type WorkbenchDraftControllerAction =
  | { type: 'set-prompt'; value: string }
  | { type: 'set-negative'; value: string }
  | { type: 'set-command'; value: 'design-plan' | null }
  | { type: 'set-history-source'; value: { items: DesignSchemeHistorySourceItem[] } | null }
  | { type: 'add-reference'; value: PromptReference }
  | { type: 'remove-reference'; index: number }
  | { type: 'clear-references' }
  | { type: 'add-images'; value: LocalImageReference[] }
  | { type: 'remove-image'; index: number }
  | { type: 'clear-images' }
  | { type: 'set-source'; value: GenerationSource }
  | { type: 'clear-source' }
  | { type: 'set-params'; value: RefineParams };

export function createEmptyWorkbenchDraft(): Pick<
  WorkbenchDraftControllerState,
  | 'draftPrompt'
  | 'draftNegativePrompt'
  | 'draftReferences'
  | 'draftImages'
  | 'draftSource'
  | 'draftCommand'
  | 'draftHistorySource'
> {
  return {
    draftPrompt: '',
    draftNegativePrompt: '',
    draftReferences: [],
    draftImages: [],
    draftSource: { kind: 'manual' },
    draftCommand: null,
    draftHistorySource: null,
  };
}

export function workbenchDraftControllerReducer(
  state: WorkbenchDraftControllerState,
  action: WorkbenchDraftControllerAction,
): Partial<WorkbenchDraftControllerState> {
  switch (action.type) {
    case 'set-prompt':
      return { draftPrompt: action.value.slice(0, WORKBENCH_PROMPT_LIMIT) };
    case 'set-negative':
      return { draftNegativePrompt: action.value };
    case 'set-command':
      return {
        draftCommand: action.value,
        ...(action.value === null && state.draftHistorySource ? { draftHistorySource: null } : {}),
      };
    case 'set-history-source':
      return { draftHistorySource: action.value };
    case 'add-reference': {
      const text = action.value.text.trim();
      const normalized = {
        ...action.value,
        title: action.value.title.trim() || '未命名提示词',
        text,
      };
      if (!text) {
        return { lastError: { code: 'EMPTY_REFERENCE', message: '引用内容不能为空' } };
      }
      if (text.length > MAX_REFERENCE_TEXT_LENGTH) {
        return {
          lastError: {
            code: 'REFERENCE_TOO_LONG',
            message: `单条引用不能超过 ${MAX_REFERENCE_TEXT_LENGTH} 字`,
          },
        };
      }
      if (state.draftReferences.length >= MAX_DRAFT_REFERENCES) {
        return {
          lastError: {
            code: 'TOO_MANY_REFERENCES',
            message: `最多同时引用 ${MAX_DRAFT_REFERENCES} 条提示词`,
          },
        };
      }
      if (isDuplicateReference(state.draftReferences, normalized)) {
        return {
          lastError: { code: 'DUPLICATE_REFERENCE', message: '这段内容已经引用过了' },
        };
      }
      return {
        draftReferences: [...state.draftReferences, normalized],
        lastError: null,
      };
    }
    case 'remove-reference':
      return {
        draftReferences: state.draftReferences.filter(
          (_reference, index) => index !== action.index,
        ),
        lastError: null,
      };
    case 'clear-references':
      return { draftReferences: [], lastError: null };
    case 'add-images':
      return {
        draftImages: uniqueReferenceImages([...state.draftImages, ...action.value]),
        lastError: null,
      };
    case 'remove-image':
      return {
        draftImages: state.draftImages.filter((_image, index) => index !== action.index),
        lastError: null,
      };
    case 'clear-images':
      return { draftImages: [], lastError: null };
    case 'set-source':
      return { draftSource: action.value };
    case 'clear-source':
      return { draftPrompt: state.draftPrompt, draftSource: { kind: 'manual' } };
    case 'set-params':
      return { params: action.value };
  }
}

function normalizeCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && [1, 2, 4, 6].includes(value) ? value : fallback;
}

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    return typeof storage?.getItem === 'function' && typeof storage?.setItem === 'function'
      ? storage
      : null;
  } catch {
    return null;
  }
}

export function loadWorkbenchPreferences(): RefineParams {
  const storage = safeStorage();
  if (!storage) return { ...DEFAULT_WORKBENCH_PARAMS };
  try {
    const parsed = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? '{}') as Partial<RefineParams>;
    return {
      ...DEFAULT_WORKBENCH_PARAMS,
      ...parsed,
      n: normalizeCount(parsed.n, DEFAULT_WORKBENCH_PARAMS.n),
    };
  } catch {
    return { ...DEFAULT_WORKBENCH_PARAMS };
  }
}

export function persistWorkbenchPreferences(params: RefineParams): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(params));
  } catch {
    // 偏好写入失败不能影响实际生成。
  }
}
