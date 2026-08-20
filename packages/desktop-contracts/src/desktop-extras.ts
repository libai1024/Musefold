// 桌面独有面：library 查询/写与 searchHistory。
// 类型只来自行模型（desktop-contracts），禁止引用 domain/contracts 云形状。
// 故意不放进 ipc.ts，避免 IPC 通道契约文件继续胀大。
// 运行时请按子路径导入：@musefold/desktop-contracts/desktop-extras

import type { ListPromptsQuery, PromptStats } from './ipc';
import type { NewPrompt, Prompt, SearchHistoryItem } from './models';

/**
 * 桌面 library 独有面（扁平方法，便于 DesktopGateway implements）。
 * 签名对齐 Api.prompt / Api.searchHistory，返回值保持桌面行模型，
 * 因此 create 能带 previewImagePath。
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
}
