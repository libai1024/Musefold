// history 域文档形状 —— V13-ENT-02。
// UI 与 store 的历史实体唯一形状：contracts GenerationJob（云文档）+ 桌面本地语义扩展。
// SQLite 行模型（models.ts 的 HistoryRecord）是存储细节，只允许 core / 主进程 / ipc 传输签名 /
// runtime mappers 引用；行 → 文档转换集中在 apps/desktop/src/runtime/mappers/history.ts。
// 运行时请按子路径导入：@musefold/desktop-contracts/history-documents

import type { GenerationJob } from '@musefold/contracts';
import type {
  CostUnit,
  GenerationUsageChannel,
  PromptReference,
} from './generation-snapshots';
import type { PromptParams } from './generation-snapshots';

/** `history.related` 对某条提示词的命中原因。普通 history.list 不填。 */
export interface PromptHistoryRelation {
  kind: 'source' | 'reference' | 'saved';
  scope?: PromptReference['scope'];
  title?: string;
  excerpt?: string;
}

/**
 * 桌面历史条目：contracts GenerationJob + 本地语义扩展。
 * 扩展字段沿用行模型命名（imagePath / cost / costUnit / params / providerId / createdAtMs …），
 * 基类字段按云契约语义（status 用 'succeeded' 词表、createdAt 为 ISO 串、model→providerModel、
 * promptText→request.prompt、parentHistoryId→parentRunId）。
 */
export interface DesktopGenerationEntry extends GenerationJob {
  /** 本地 Provider id（云契约无槽位） */
  providerId: string;
  /** 本地图片文件路径（云为资产 URL） */
  imagePath: string | null;
  /** 数值单位由 costUnit 决定（云 costPoints 为积分取整） */
  cost: number | null;
  /** 记账单位快照（FR-COST-03）：入账时按 Provider 来源冻结，登出后仍可正确解释 */
  costUnit: CostUnit;
  durationMs: number | null;
  /** 桌面原始生成参数（含 n=1–4 等云契约 count 字面量 1 表达不了的字段） */
  params: PromptParams | null;
  /** epoch ms（云 createdAt 为 ISO 串，桌面 UI 格式化沿用 ms 便捷入口） */
  createdAtMs: number;
  /** 桌面原始错误码（云 error.code 已换算为 API 错误码） */
  errorCode: string | null;
  errorMessage: string | null;
  /** history.get 可返回引用快照；history.list 保持轻量，不填此字段。 */
  promptReferences?: PromptReference[];
  /** history.related 返回，解释该作品是直接制作还是引用整条/选段产生。 */
  promptRelations?: PromptHistoryRelation[];
}

/** relatedHistory 的文档化返回（ipc 传输面 RelatedHistoryResult 仍是行模型）。 */
export interface DesktopRelatedHistoryResult {
  items: DesktopGenerationEntry[];
  total: number;
}

export type HistoryStatsGroupBy = 'day' | 'week' | 'month';

export interface HistoryStatsQuery {
  from?: number;
  to?: number;
  groupBy: HistoryStatsGroupBy;
  providerId?: string;
}

export interface HistoryStatsBucket {
  key: string;
  /** 仅账号渠道的积分消耗。 */
  cost: number;
  /** 成功生成次数（全部渠道）。 */
  count: number;
  attemptCount: number;
  failedCount: number;
  cancelledCount: number;
  channels: HistoryStatsChannelPoint[];
  /** 成本单位，固定为 point。 */
  unit?: CostUnit;
}

export interface HistoryStatsChannelPoint {
  channelId: string;
  kind: GenerationUsageChannel;
  name: string;
  count: number;
}

export interface HistoryStatsChannel {
  channelId: string;
  kind: GenerationUsageChannel;
  name: string;
  providerId: string | null;
  attemptCount: number;
  successCount: number;
  failedCount: number;
  cancelledCount: number;
  /** 非账号渠道为 null，明确表示不参与积分统计。 */
  accountPoints: number | null;
}

export interface HistoryStatsModel {
  model: string;
  count: number;
}

export interface HistoryStatsProvider {
  providerId: string;
  name: string;
  cost: number;
  count: number;
  /** 成本单位，固定为 point。 */
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
  /** 账号渠道积分汇总（仅 succeeded）。 */
  totals?: HistoryStatsTotal[];
  /** @deprecated 使用 accountPoints；值同样仅包含账号渠道积分。 */
  totalCost: number;
  /** @deprecated 使用 totals；值为账号渠道成功生成的平均积分。 */
  avgCost: number;
  /** 全部成功次数（跨单位） */
  totalCount: number;
  attemptCount: number;
  failedCount: number;
  cancelledCount: number;
  activeDays: number;
  /** 仅账号渠道、成功生成所消耗的积分。 */
  accountPoints: number;
  /** 时间桶，内含各渠道成功次数。 */
  buckets: HistoryStatsBucket[];
  /** Provider 粒度兼容字段；cost 同样只含账号渠道积分。 */
  byProvider: HistoryStatsProvider[];
  /** 账号、豆包体验与各用户 Provider 的统计。 */
  byChannel: HistoryStatsChannel[];
  /** 全渠道成功生成的模型分布。 */
  byModel: HistoryStatsModel[];
}
