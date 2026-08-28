import type {
  GenerationHistoryQuery,
  PromptListQuery,
  WorkbenchSessionListQuery,
} from '@musefold/contracts';

/**
 * TanStack Query key 工厂:全仓唯一 key 源,避免宿主间 key 漂移导致缓存失效错位。
 */
export const queryKeys = {
  settings: {
    preferences: () => ['settings', 'preferences'] as const,
  },
  account: {
    status: () => ['account', 'status'] as const,
  },
  prompts: {
    all: () => ['prompts'] as const,
    list: (query: PromptListQuery) => ['prompts', 'list', query] as const,
    detail: (id: string) => ['prompts', 'detail', id] as const,
    folders: () => ['prompts', 'folders'] as const,
    tags: () => ['prompts', 'tags'] as const,
  },
  workbench: {
    all: () => ['workbench'] as const,
    sessions: (query: WorkbenchSessionListQuery) => ['workbench', 'sessions', query] as const,
    session: (id: string) => ['workbench', 'session', id] as const,
  },
  generation: {
    all: () => ['generation'] as const,
    list: (query: GenerationHistoryQuery) => ['generation', 'list', query] as const,
    detail: (id: string) => ['generation', 'detail', id] as const,
  },
} as const;
