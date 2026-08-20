// packages/desktop-contracts/src/ipc/prompt.ts
// prompt / searchHistory 域：请求响应类型 + Api namespace（V13-GOV-04 自 ipc.ts 分域拆出）。

import type { Prompt, NewPrompt, LibraryQuerySnapshot, SearchHistoryItem } from "../models";
import type { PromptSource } from "../enums";

/** IPC 侧提示词列表查询，与 LibraryQuerySnapshot 同构。排序方向缺省 desc（title 的 desc 语义为 A→Z，见 repositories/prompts.ts）。 */
export type ListPromptsQuery = LibraryQuerySnapshot;

export interface UpdatePromptPatch {
  title?: string;
  description?: string | null;
  content?: string;
  contentNegative?: string | null;
  isPinned?: boolean;
  folderId?: string | null;
  modelId?: string | null;
  params?: Prompt["params"];
  previewImagePath?: string | null;
  rating?: number;
  tagIds?: string[];
  /** 誊清：笺（slip）补全保存后翻转为 manual，离开笺匣（v0.3.3 §8） */
  source?: PromptSource;
}

/**
 * 侧栏计数徽标数据（docs/product/10 TASK-LIB-03/06）。
 * 渲染进程不能用 prompts.length 现算：list() 有 LIMIT 且被筛选收敛过。
 */
export interface PromptStats {
  /** 未删除总数 */
  total: number;
  /** 未归档（folder_id IS NULL）条数 */
  unfiled: number;
  /** 回收站条数 */
  trashed: number;
  /** 收藏条数 */
  pinned: number;
  /** folderId → 条数（仅有值的 key） */
  byFolder: Record<string, number>;
  /** tagId → 条数（仅有值的 key） */
  byTag: Record<string, number>;
}

export interface PromptApi {
  list: (q?: ListPromptsQuery) => Promise<Prompt[]>;
  get: (id: string) => Promise<Prompt | null>;
  create: (p: NewPrompt) => Promise<Prompt>;
  update: (id: string, patch: UpdatePromptPatch) => Promise<Prompt>;
  delete: (id: string) => Promise<{ ok: true }>;
  togglePin: (id: string, pinned: boolean) => Promise<Prompt>;
  reorderPins: (ids: string[]) => Promise<{ ok: true }>;
  incrementUsage: (id: string) => Promise<{ ok: true }>;
  /** 回收站：已软删除条目 */
  listDeleted: () => Promise<Prompt[]>;
  /** 回收站：恢复 */
  restore: (id: string) => Promise<Prompt>;
  /** 回收站：彻底删除（不可恢复） */
  purge: (id: string) => Promise<{ ok: true }>;
  /** 回收站：清空，返回清理条数 */
  purgeAll: () => Promise<{ purged: number }>;
  /** 侧栏计数（文件夹/标签/回收站徽标） */
  stats: () => Promise<PromptStats>;
}

export interface SearchHistoryApi {
  list: (limit?: number) => Promise<SearchHistoryItem[]>;
  add: (term: string) => Promise<{ ok: true }>;
  clear: () => Promise<{ ok: true }>;
}
