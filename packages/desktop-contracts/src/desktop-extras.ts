// 桌面独有面：library 查询/写、关联历史、searchHistory、账号全量状态、cloudSync、
// workbench 无损会话文档与原生进度事件。
// V13-ENT-02 起历史面返回文档形状；V13-ENT-03 起 library 面返回 library-documents。
// provider / account / workbench 面暂仍为行或桌面专用文档（V13-ENT-04 收尾）。
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
} from './ipc';
import type {
  DesktopGenerationEntry,
  DesktopRelatedHistoryResult,
  HistoryStats,
  HistoryStatsQuery,
} from './history-documents';
import type { DesktopLibraryPrompt, SearchHistoryItem } from './library-documents';
import type {
  NewPrompt,
  NewProviderConfig,
  ProviderConfig,
} from './models';
import type { ImageGenerationProgress, ModelInfo, ValidationResult } from './providers';
import type {
  WorkbenchSessionDocument,
  WorkbenchSessionListQuery,
  WorkbenchSessionListResult,
} from './workbench';

/** 输入 DTO 经 extras 面导出（V13-ENT-02：渲染层禁 models，输入类型随消费的方法导出）。 */
export type { NewPrompt } from './models';
export type { DesktopLibraryPrompt, SearchHistoryItem } from './library-documents';

/**
 * 桌面独有面（扁平方法，便于 DesktopGateway implements）。
 * library / searchHistory 自 V13-ENT-03 起返回 library-documents 文档形状，
 * 行→文档转换集中在 runtime/mappers/prompt.ts。create 仍接受 NewPrompt 以保留
 * previewImagePath。关联历史与 history 读写自 V13-ENT-02 起返回
 * history-documents 文档形状。
 * account / cloudSync 对齐 Api.account / Api.cloudSync，返回桌面 AccountStatus /
 * CloudSyncSummary（V13-ENT-03 文档化）。workbench 保留摘要计数、runs 与
 * 无 seq 的 Provider 重试进度，禁止经云端 WorkbenchSession / SSE 形状有损转换。
 * 命名避开 library 前缀，以免与现有方法撞名。
 */
export interface DesktopExtras {
  listLibraryPrompts(q?: ListPromptsQuery): Promise<DesktopLibraryPrompt[]>;
  getLibraryPrompt(id: string): Promise<DesktopLibraryPrompt | null>;
  listDeletedLibraryPrompts(): Promise<DesktopLibraryPrompt[]>;
  libraryStats(): Promise<PromptStats>;
  createLibraryPrompt(p: NewPrompt): Promise<DesktopLibraryPrompt>;
  toggleLibraryPin(id: string, pinned: boolean): Promise<DesktopLibraryPrompt>;
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

  /** 对齐 Api.history.related；返回文档形状（V13-ENT-02）。 */
  relatedHistory(q: RelatedHistoryQuery): Promise<DesktopRelatedHistoryResult>;
  /** 对齐 Api.history.linkPrompt */
  linkHistoryPrompt(req: HistoryLinkPromptRequest): Promise<HistoryLinkPromptResult>;
  /** 对齐 Api.history.list；关联历史在旧 DB 上回退直连记录时用。查询面保持桌面形状
   *  （HistoryStatus 词表 + epoch from/to），返回文档形状。 */
  listHistory(q?: {
    status?: HistoryStatus;
    providerId?: string;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  }): Promise<DesktopGenerationEntry[]>;
  /** 对齐 Api.history.get；需要桌面 promptReferences 等无损字段的宿主读取面。
   * 返回文档形状（V13-ENT-02），promptReferences 在扩展字段上无损保留。 */
  getHistory(id: string): Promise<DesktopGenerationEntry | null>;
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
