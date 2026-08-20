// 桌面独有面：library 查询/写、关联历史、searchHistory、账号全量状态、cloudSync、
// workbench 无损会话文档与原生进度事件。
// 类型只来自行模型（desktop-contracts），禁止引用 domain/contracts 云形状。
// 故意不放进 ipc.ts，避免 IPC 通道契约文件继续胀大。
// 运行时请按子路径导入：@musefold/desktop-contracts/desktop-extras

import type { AccountCredentialsInput, AccountRedeemResult, AccountStatus } from './account';
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from './cloud-sync';
import type {
  AiConnectionPreset,
  AiConnectionProfile,
  AiConnectionValidationResult,
  AiTextModelInfo,
  CreateAiConnectionInput,
  UpdateAiConnectionInput,
} from './ai';
import type { HistoryStatus } from './enums';
import type {
  HistoryClearRequest,
  HistoryClearResult,
  HistoryDeleteRequest,
  HistoryDeleteResult,
  HistoryLinkPromptRequest,
  HistoryLinkPromptResult,
  ListPromptsQuery,
  PromptStats,
  RelatedHistoryQuery,
  RelatedHistoryResult,
} from './ipc';
import type {
  HistoryRecord,
  HistoryStats,
  HistoryStatsQuery,
  NewPrompt,
  NewProviderConfig,
  Prompt,
  ProviderConfig,
  SearchHistoryItem,
} from './models';
import type { ImageGenerationProgress, ModelInfo, ValidationResult } from './providers';
import type {
  WorkbenchSessionDocument,
  WorkbenchSessionListQuery,
  WorkbenchSessionListResult,
} from './workbench';

/**
 * 桌面独有面（扁平方法，便于 DesktopGateway implements）。
 * library / searchHistory 对齐 Api.prompt / Api.searchHistory，返回桌面行模型。
 * 关联历史对齐 Api.history.related / linkPrompt / list 与 Api.system.getVersion，
 * 直通行模型，不经 HistoryGateway 的 GenerationJob mapper。
 * account / cloudSync 对齐 Api.account / Api.cloudSync，返回桌面 AccountStatus /
 * CloudSyncSummary，禁止经 AccountSession mapper。workbench 保留摘要计数、runs 与
 * 无 seq 的 Provider 重试进度，禁止经云端 WorkbenchSession / SSE 形状有损转换。
 * 命名避开 library 前缀，以免与现有方法撞名。
 */
export interface DesktopExtras {
  listLibraryPrompts(q?: ListPromptsQuery): Promise<Prompt[]>;
  getLibraryPrompt(id: string): Promise<Prompt | null>;
  listDeletedLibraryPrompts(): Promise<Prompt[]>;
  libraryStats(): Promise<PromptStats>;
  createLibraryPrompt(p: NewPrompt): Promise<Prompt>;
  toggleLibraryPin(id: string, pinned: boolean): Promise<Prompt>;
  reorderLibraryPins(ids: string[]): Promise<{ ok: true }>;
  purgeLibraryPrompt(id: string): Promise<{ ok: true }>;
  purgeLibraryPrompts(): Promise<{ purged: number }>;
  listSearchHistory(limit?: number): Promise<SearchHistoryItem[]>;
  addSearchHistory(term: string): Promise<{ ok: true }>;
  clearSearchHistory(): Promise<{ ok: true }>;

  listAiConnectionPresets(): Promise<AiConnectionPreset[]>;
  listAiConnections(): Promise<AiConnectionProfile[]>;
  createAiConnection(input: CreateAiConnectionInput): Promise<AiConnectionProfile>;
  updateAiConnection(id: string, patch: UpdateAiConnectionInput): Promise<AiConnectionProfile>;
  deleteAiConnection(id: string): Promise<{ ok: true }>;
  saveAiConnectionKey(id: string, apiKey: string): Promise<AiConnectionProfile>;
  deleteAiConnectionKey(id: string): Promise<AiConnectionProfile>;
  hasAiConnectionKey(id: string): Promise<{ hasKey: boolean; suffix: string | null }>;
  setActiveAiConnection(id: string): Promise<AiConnectionProfile>;
  listAiConnectionModels(id: string): Promise<AiTextModelInfo[]>;
  validateAiConnection(id: string): Promise<AiConnectionValidationResult>;

  /** 对齐 Api.provider.list */
  listProviders(): Promise<ProviderConfig[]>;
  /** 对齐 Api.provider.create */
  createProvider(p: NewProviderConfig): Promise<ProviderConfig>;
  /** 对齐 Api.provider.update */
  updateProvider(id: string, patch: Partial<NewProviderConfig>): Promise<ProviderConfig>;
  /** 对齐 Api.provider.delete */
  deleteProvider(id: string): Promise<{ ok: true }>;
  /** 对齐 Api.provider.saveKey */
  saveProviderKey(id: string, apiKey: string): Promise<{ ok: true }>;
  /** 对齐 Api.provider.hasKey */
  hasProviderKey(id: string): Promise<{ hasKey: boolean; suffix: string | null }>;
  /** 对齐 Api.provider.setActive */
  setActiveProvider(id: string): Promise<{ ok: true }>;
  /** 对齐 Api.provider.validate */
  validateProvider(id: string): Promise<ValidationResult>;
  /** 对齐 Api.provider.listModels */
  listProviderModels(id: string): Promise<ModelInfo[]>;

  /** 对齐 Api.history.related */
  relatedHistory(q: RelatedHistoryQuery): Promise<RelatedHistoryResult>;
  /** 对齐 Api.history.linkPrompt */
  linkHistoryPrompt(req: HistoryLinkPromptRequest): Promise<HistoryLinkPromptResult>;
  /** 对齐 Api.history.list；关联历史在旧 DB 上回退直连记录时用 */
  listHistory(q?: {
    status?: HistoryStatus;
    providerId?: string;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  }): Promise<HistoryRecord[]>;
  /** 对齐 Api.history.get；需要桌面 promptReferences 等无损字段的宿主读取面。 */
  getHistory(id: string): Promise<HistoryRecord | null>;
  /** 对齐 Api.history.stats */
  historyStats(q: HistoryStatsQuery): Promise<HistoryStats>;
  /** 对齐 Api.history.delete（支持 deleteFile 物理删图） */
  deleteHistory(req: string | HistoryDeleteRequest): Promise<HistoryDeleteResult>;
  /** 对齐 Api.history.clear */
  clearHistory(req?: number | HistoryClearRequest): Promise<HistoryClearResult>;
  /** 对齐 Api.system.getVersion；判断 related / linkPrompt 通道是否可用 */
  getSystemVersion(): Promise<{ app: string; db: number }>;

  accountStatus(): Promise<AccountStatus>;
  accountRegister(input: AccountCredentialsInput): Promise<AccountStatus>;
  accountLogin(input: AccountCredentialsInput): Promise<AccountStatus>;
  accountLogout(): Promise<AccountStatus>;
  accountRedeem(code: string): Promise<AccountRedeemResult>;
  accountRefreshQuota(): Promise<AccountStatus>;
  accountSetServerUrl(url: string): Promise<AccountStatus>;
  onAccountChanged(cb: (status: AccountStatus) => void): () => void;

  cloudSyncStatus(): Promise<CloudSyncSummary>;
  cloudSyncSetEnabled(enabled: boolean): Promise<CloudSyncSummary>;
  cloudSyncNow(): Promise<CloudSyncSummary>;
  cloudSyncConflicts(): Promise<CloudSyncConflictSummary[]>;
  cloudSyncResolve(
    conflictId: string,
    resolution: CloudSyncConflictResolution,
  ): Promise<CloudSyncSummary>;
  onCloudSyncChanged(cb: (status: CloudSyncSummary) => void): () => void;

  /** 桌面会话摘要含生成计数与最近资源，不能经共享 WorkbenchSession 有损转换。 */
  listDesktopWorkbenchSessions(
    query?: WorkbenchSessionListQuery,
  ): Promise<WorkbenchSessionListResult>;
  /** 桌面会话文档含 runs，不能经共享 WorkbenchSession 有损转换。 */
  getDesktopWorkbenchSession(id: string): Promise<WorkbenchSessionDocument | null>;
  /** 桌面 Provider 重试进度没有 seq / 终态，只作为宿主原生事件暴露。 */
  onImageGenerationProgress(cb: (progress: ImageGenerationProgress) => void): () => void;
}
