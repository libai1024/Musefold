// packages/desktop-contracts/src/ipc/history.ts
// history 域：请求响应类型 + Api namespace（V13-GOV-04 自 ipc.ts 分域拆出）。

import type { HistoryRecord, HistoryStats, HistoryStatsQuery } from "../models";
import type { HistoryStatus } from "../enums";

export interface HistoryClearRequest {
  /** 创建时间上界（不含），ms epoch */
  before?: number;
  /** 要清理的历史状态；不传或空数组表示不按状态限制 */
  statuses?: HistoryStatus[];
  /** 是否同时删除 Musefold 管理的输出目录内的图片文件 */
  deleteFiles?: boolean;
}

export interface HistoryClearResult {
  ok: true;
  deleted: number;
  runsDeleted?: number;
  filesDeleted?: number;
  filesMissing?: number;
  fileErrors?: Array<{ id: string; path: string; message: string }>;
}

export interface RelatedHistoryQuery {
  promptId: string;
  status?: HistoryStatus;
  limit?: number;
  offset?: number;
}

export interface RelatedHistoryResult {
  items: HistoryRecord[];
  total: number;
}

export interface HistoryLinkPromptRequest {
  promptId: string;
  historyIds: string[];
}

export interface HistoryLinkPromptResult {
  linked: number;
  alreadyLinked: number;
  conflicts: string[];
  missing: string[];
}

export interface HistoryDeleteRequest {
  id: string;
  deleteFile?: boolean;
}

export interface HistoryDeleteResult {
  ok: true;
  deleted: number;
  imagePath?: string | null;
  runDeleted?: boolean;
  assetsMarked?: number;
  fileDeleted?: boolean;
  fileMissing?: boolean;
  fileError?: string;
}

export interface HistoryApi {
  list: (q?: {
    status?: HistoryStatus;
    providerId?: string;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  }) => Promise<HistoryRecord[]>;
  related: (q: RelatedHistoryQuery) => Promise<RelatedHistoryResult>;
  linkPrompt: (req: HistoryLinkPromptRequest) => Promise<HistoryLinkPromptResult>;
  get: (id: string) => Promise<HistoryRecord | null>;
  delete: (req: string | HistoryDeleteRequest) => Promise<HistoryDeleteResult>;
  clear: (req?: number | HistoryClearRequest) => Promise<HistoryClearResult>;
  stats: (q: HistoryStatsQuery) => Promise<HistoryStats>;
}
