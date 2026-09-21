import type {
  DesignSchemeDetailRevisionSelector,
  DesignSchemeListQuery,
  GenerationHistoryQuery,
  MarketSearchQuery,
  PromptListQuery,
  UsageRange,
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
    all: () => ['account'] as const,
    status: () => ['account', 'status'] as const,
    notices: (identity: string, epoch: number) => ['account', 'notices', identity, epoch] as const,
    models: (identity: string, epoch: number) => ['account', 'models', identity, epoch] as const,
  },
  accountCloud: {
    status: () => ['account', 'cloud-connection'] as const,
    recovery: () => ['account', 'cloud-recovery'] as const,
    legacy: () => ['account', 'cloud-legacy-diagnostics'] as const,
  },
  cloudMcp: {
    /**
     * 已授权 MCP 客户端列表。前缀挂在 account.all() 下,
     * 登出 invalidate/reset account 时列表必须一起空掉。
     */
    authorizations: () => ['account', 'cloud-mcp'] as const,
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
    localWorkspaces: () => ['sync', 'local-workspaces'] as const,
    localWorkspacePreview: (sourceId: string, cursor?: string) =>
      ['sync', 'local-workspace-preview', sourceId, cursor ?? '0'] as const,
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
  automation: {
    all: () => ['automation'] as const,
    /** 控制面状态(开关/端口/掩码令牌/预算);开关、轮换、存预算后统一失效这一条。 */
    status: () => ['automation', 'status'] as const,
    requestLog: () => ['automation', 'request-log'] as const,
    spendAudit: () => ['automation', 'spend-audit'] as const,
    integrationGuide: () => ['automation', 'integration-guide'] as const,
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
    /** 归档无限分页与侧栏 sessions 同源不同 key,互不覆盖页结构。 */
    archived: (query: WorkbenchSessionListQuery) => ['workbench', 'archived', query] as const,
    trash: (query: WorkbenchSessionListQuery) => ['workbench', 'trash', query] as const,
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
  usage: {
    all: () => ['usage'] as const,
    /** 生成完成后随 workbench hooks 的 usage.all() 失效(与 generation.all() 同一次)。 */
    summary: (range: UsageRange) => ['usage', 'summary', range] as const,
  },
} as const;
