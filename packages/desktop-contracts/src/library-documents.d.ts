import type { PromptDocument } from '@musefold/contracts';
import type { PromptSource } from './enums';
import type { PromptParams } from './generation-snapshots';
/**
 * 桌面库条目：contracts PromptDocument + 本地封面与 epoch 便捷字段。
 * 基类 source 用云词表（shared→share）；contentNegative 与 negative 同值，避免改遍编辑器。
 */
export interface DesktopLibraryPrompt extends PromptDocument {
  previewImagePath: string | null;
  coverImagePath: string | null;
  contentNegative: string | null;
  /** 覆盖云契约自由 record，保留桌面 schemaVersion 包 */
  params: PromptParams | null;
  createdAtMs: number;
  updatedAtMs: number;
  lastUsedAtMs: number | null;
  deletedAtMs: number | null;
}
/** Library 智能集合保存的查询快照（DIF-06），与 db:prompts:list 入参保持同构。 */
export interface LibraryQuerySnapshot {
  folderId?: string;
  tagIds?: string[];
  search?: string;
  filters?: {
    modelId?: string;
    isPinned?: boolean;
    ratingGte?: number;
    usageCountGte?: number;
    createdAfter?: number;
    /** 按来源过滤；笺匣视图 = 'slip' */
    source?: PromptSource;
  };
  sort?: 'updated' | 'created' | 'title' | 'rating' | 'usage';
  sortDir?: 'asc' | 'desc';
}
export interface SearchHistoryItem {
  id: string;
  term: string;
  usedAt: number;
}
//# sourceMappingURL=library-documents.d.ts.map
