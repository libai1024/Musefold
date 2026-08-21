// shared/types/models.ts
// 数据模型类型 —— 主进程 DB 行与渲染进程状态共用

import type {
  TagGroup,
  PromptSource,
  HistoryStatus,
  ImageSize,
  ImageQuality,
  ImageBackground,
  ModerationLevel,
} from './enums';
import type { CostUnit, PromptReference, PromptParams } from './generation-snapshots';
import type { PromptHistoryRelation } from './history-documents';
import type { LibraryQuerySnapshot } from './library-documents';

// 重新导出枚举，方便单点导入
export type {
  TagGroup,
  PromptSource,
  HistoryStatus,
  ImageSize,
  ImageQuality,
  ImageBackground,
  ModerationLevel,
};
export type { ProviderType } from './enums';
export type { CostUnit };
// V13-ENT-02 迁出类型的兼容 re-export（core / 主进程继续从 models 单点导入；
// 渲染层业务代码禁用 models，改从 generation-snapshots / history-documents 导入）。
export type { PromptParams } from './generation-snapshots';
export type {
  PromptHistoryRelation,
  HistoryStatsGroupBy,
  HistoryStatsQuery,
  HistoryStatsBucket,
  HistoryStatsProvider,
  HistoryStatsTotal,
  HistoryStats,
} from './history-documents';
export type { LibraryQuerySnapshot, SearchHistoryItem } from './library-documents';

/** 提示词（prompts 表） */
export interface Prompt {
  id: string;
  title: string;
  description: string | null;
  content: string;
  contentNegative: string | null;
  folderId: string | null;
  modelId: string | null;
  params: PromptParams | null;
  previewImagePath: string | null;
  /** 展示用封面（只读派生）：最新一张关联成功作品，找不到时兜底 previewImagePath */
  coverImagePath: string | null;
  rating: number; // 0-5
  isPinned: boolean;
  pinOrder: number | null;
  usageCount: number;
  lastUsedAt: number | null;
  source: PromptSource;
  sourceUrl: string | null;
  tags: Tag[]; // 由 repository join 填充
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** 新建提示词（id/时间戳由主进程生成） */
export interface NewPrompt {
  title: string;
  description?: string;
  content: string;
  contentNegative?: string;
  isPinned?: boolean;
  folderId?: string;
  modelId?: string;
  params?: PromptParams;
  previewImagePath?: string;
  rating?: number;
  source?: PromptSource;
  sourceUrl?: string;
  tagIds?: string[];
}

/** 生成参数包已迁至 generation-snapshots（V13-ENT-02）；上方 re-export 保持导入面不变。 */

/** 文件夹 */
export interface Folder {
  id: string;
  name: string;
  parentId: string | null; // 最多 2 层
  sortOrder: number;
  createdAt: number;
}

export interface NewFolder {
  name: string;
  parentId?: string;
}

/** 标签 */
export interface Tag {
  id: string;
  name: string;
  tagGroup: TagGroup | null;
  color: string | null;
  createdAt: number;
}

export interface NewTag {
  name: string;
  tagGroup?: TagGroup;
  color?: string;
}

/** LibraryQuerySnapshot / SearchHistoryItem 已迁至 library-documents（V13-ENT-03）；上方 re-export 保持导入面不变。 */

export interface SmartSet {
  id: string;
  name: string;
  query: LibraryQuerySnapshot;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface NewSmartSet {
  name: string;
  query: LibraryQuerySnapshot;
}

/** PromptHistoryRelation 已迁至 history-documents（V13-ENT-02）；上方 re-export 保持导入面不变。 */

/** 历史记录（history 表） */
export interface HistoryRecord {
  id: string;
  promptId: string | null;
  providerId: string;
  model: string;
  promptText: string;
  negativeText: string | null;
  params: PromptParams | null;
  status: HistoryStatus;
  errorCode: string | null;
  errorMessage: string | null;
  imagePath: string | null;
  cost: number | null; // 数值单位由 costUnit 决定
  /** 记账单位快照（FR-COST-03）：入账时按 Provider 来源冻结，登出后仍可正确解释 */
  costUnit: CostUnit;
  durationMs: number | null;
  createdAt: number;
  parentHistoryId?: string;
  /** history.get 可返回引用快照；history.list 保持轻量，不填此字段。 */
  promptReferences?: PromptReference[];
  /** history.related 返回，解释该作品是直接制作还是引用整条/选段产生。 */
  promptRelations?: PromptHistoryRelation[];
}

/** HistoryStats 聚合族已迁至 history-documents（V13-ENT-02）；上方 re-export 保持导入面不变。 */

/** Provider 成本估算配置（electron-store: pricing.{providerId}） */
export type ProviderPricingMode = 'per-image' | 'per-1k-token';

export interface ProviderPricingConfig {
  mode: ProviderPricingMode;
  /**
   * 单位价格（积分）。per-image=每张；per-1k-token=每千 token。
   */
  unitPoints: number;
}

export interface ProviderPricingSetRequest extends ProviderPricingConfig {
  providerId: string;
}

/** Provider 配置（providers 表，不含明文 key） */
export interface ProviderConfig {
  id: string;
  name: string;
  type: import('./enums').ProviderType;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keySuffix: string | null; // 末 4 位
  isActive: boolean;
  /** 账号托管标记（FR-GW-01/03）：'account' 的记录 baseUrl/Key 只读、不可单删、登出回收 */
  managedBy: 'account' | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewProviderConfig {
  name: string;
  type: import('./enums').ProviderType;
  baseUrl: string;
  model: string;
  isActive?: boolean;
}
