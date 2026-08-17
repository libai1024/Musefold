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
import type { PromptReference } from './providers';

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
  folderId?: string;
  modelId?: string;
  params?: PromptParams;
  previewImagePath?: string;
  rating?: number;
  source?: PromptSource;
  sourceUrl?: string;
  tagIds?: string[];
}

/** 生成参数包（前向兼容，带 schema_version） */
export interface PromptParams {
  schemaVersion: number;
  sampler?: string;
  steps?: number;
  cfg?: number;
  seed?: number;
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
  background?: ImageBackground;
  moderation?: ModerationLevel;
  [key: string]: unknown;
}

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

export interface SearchHistoryItem {
  id: string;
  term: string;
  usedAt: number;
}

/** `history.related` 对某条提示词的命中原因。普通 history.list 不填。 */
export interface PromptHistoryRelation {
  kind: 'source' | 'reference' | 'saved';
  scope?: PromptReference['scope'];
  title?: string;
  excerpt?: string;
}

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

export type HistoryStatsGroupBy = 'day' | 'week' | 'month';

/**
 * 记账货币单位（FR-COST-03）：
 * - `cny_cent`：人民币分（BYOK 手填单价的历史语义，缺省）
 * - `point`：账号点（500000 点 = $1，与服务器扣费一致）
 */
export type CostUnit = 'cny_cent' | 'point';

export interface HistoryStatsQuery {
  from?: number;
  to?: number;
  groupBy: HistoryStatsGroupBy;
  providerId?: string;
}

export interface HistoryStatsBucket {
  key: string;
  cost: number;
  count: number;
  /** 缺省 cny_cent；point 时显式返回。可选用于兼容 v0.4 IPC 精确响应形状。 */
  unit?: CostUnit;
}

export interface HistoryStatsProvider {
  providerId: string;
  name: string;
  cost: number;
  count: number;
  /** 缺省 cny_cent；point 时显式返回。 */
  unit?: CostUnit;
}

/** 单一记账单位内的汇总（有消费的单位才出现） */
export interface HistoryStatsTotal {
  unit: CostUnit;
  cost: number;
  count: number;
  avgCost: number;
}

export interface HistoryStats {
  /**
   * 按记账单位分组的汇总（仅 success）。
   * 只有 point 参与时才在 IPC 响应显式返回；纯 cny_cent 响应保留 v0.4 精确形状。
   */
  totals?: HistoryStatsTotal[];
  /** @deprecated v0.4 兼容字段：仅人民币分（cny_cent）汇总；新 UI 使用 totals。 */
  totalCost: number;
  /** @deprecated v0.4 兼容字段：仅人民币分（cny_cent）平均；新 UI 使用 totals。 */
  avgCost: number;
  /** 全部成功次数（跨单位） */
  totalCount: number;
  /** (时间桶 × 单位) 粒度 */
  buckets: HistoryStatsBucket[];
  /** (Provider × 单位) 粒度 */
  byProvider: HistoryStatsProvider[];
}

/** Provider 成本估算配置（electron-store: pricing.{providerId}） */
export type ProviderPricingMode = 'per-image' | 'per-1k-token';

export interface ProviderPricingConfig {
  mode: ProviderPricingMode;
  /**
   * 单位价格的最小记账单位：BYOK Provider = 人民币分；账号托管 Provider = 点。
   * per-image=每张；per-1k-token=每千 token。最终显示单位由 history.cost_unit 快照决定。
   */
  unitCents: number;
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
