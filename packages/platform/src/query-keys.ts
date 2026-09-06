import type {
  DesignSchemeDetailRevisionSelector,
  DesignSchemeListQuery,
  GenerationHistoryQuery,
  MarketSearchQuery,
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
  aiProviders: {
    list: () => ['ai-providers', 'list'] as const,
  },
  agentConnections: {
    list: () => ['agent-connections', 'list'] as const,
  },
  sync: {
    status: () => ['sync', 'status'] as const,
    conflicts: () => ['sync', 'conflicts'] as const,
  },
  doubao: {
    status: () => ['doubao', 'status'] as const,
  },
  system: {
    all: () => ['system'] as const,
    appInfo: () => ['system', 'app-info'] as const,
    backups: () => ['system', 'backups'] as const,
    storageLocations: () => ['system', 'storage-locations'] as const,
    diagnosticLog: () => ['system', 'diagnostic-log'] as const,
  },
  designSchemes: {
    all: () => ['design-schemes'] as const,
    list: (query: DesignSchemeListQuery) => ['design-schemes', 'list', query] as const,
    detail: (id: string, revision: DesignSchemeDetailRevisionSelector = { kind: 'current' }) =>
      ['design-schemes', 'detail', id, revision] as const,
    marketSearch: (query: MarketSearchQuery) => ['design-schemes', 'market-search', query] as const,
  },
  prompts: {
    all: () => ['prompts'] as const,
    list: (query: PromptListQuery) => ['prompts', 'list', query] as const,
    detail: (id: string) => ['prompts', 'detail', id] as const,
    folders: () => ['prompts', 'folders'] as const,
    tags: () => ['prompts', 'tags'] as const,
    /** 详情「相关作品」:该提示词生成过的历史回合(反向查询)。 */
    relatedWorks: (id: string) => ['prompts', 'related-works', id] as const,
  },
  workbench: {
    all: () => ['workbench'] as const,
    sessions: (query: WorkbenchSessionListQuery) => ['workbench', 'sessions', query] as const,
    session: (id: string) => ['workbench', 'session', id] as const,
  },
  generation: {
    all: () => ['generation'] as const,
    list: (query: GenerationHistoryQuery) => ['generation', 'list', query] as const,
    /** 历史屏无限分页与时间线 list 同源不同 key,互不覆盖页结构。 */
    history: (query: GenerationHistoryQuery) => ['generation', 'history', query] as const,
    detail: (id: string) => ['generation', 'detail', id] as const,
    providers: () => ['generation', 'providers'] as const,
    /** 桌面磁盘占用 readout;与 all() 同前缀,清理/删除后随生成域 invalidate 一起重取。 */
    storageUsage: () => ['generation', 'storage-usage'] as const,
  },
} as const;
