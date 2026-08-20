// 桌面独有面：library 查询/写与 searchHistory、账号全量状态、cloudSync。
// 类型只来自行模型（desktop-contracts），禁止引用 domain/contracts 云形状。
// 故意不放进 ipc.ts，避免 IPC 通道契约文件继续胀大。
// 运行时请按子路径导入：@musefold/desktop-contracts/desktop-extras

import type {
  AccountCredentialsInput,
  AccountRedeemResult,
  AccountStatus,
} from './account';
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from './cloud-sync';
import type { ListPromptsQuery, PromptStats } from './ipc';
import type { NewPrompt, Prompt, SearchHistoryItem } from './models';

/**
 * 桌面独有面（扁平方法，便于 DesktopGateway implements）。
 * library / searchHistory 对齐 Api.prompt / Api.searchHistory，返回桌面行模型。
 * account / cloudSync 对齐 Api.account / Api.cloudSync，返回桌面 AccountStatus /
 * CloudSyncSummary，禁止经 AccountSession mapper。
 * 命名避开 library 前缀，以免与现有方法撞名。
 */
export interface DesktopExtras {
  listLibraryPrompts(q?: ListPromptsQuery): Promise<Prompt[]>;
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
}
