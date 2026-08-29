// HistoryService（V04-CORE-04）：生成账本只读面。
// 单账本迁移(0002/0003)后由 generation_runs + generated_assets 合成旧 HistoryRecord
// 线格式(automation API / CLI / 导出继续消费同一形状),history 表已退役。

import type Database from 'better-sqlite3';
import type { HistoryStatus } from '@musefold/desktop-contracts/enums';
import type { HistoryRecord, PromptParams } from '@musefold/desktop-contracts/models';
import type { PromptReference } from '@musefold/desktop-contracts/providers';
import type { PromptSnapshot } from '@musefold/desktop-contracts/workbench';
import { getDb } from '../db/index';
import { parseJsonColumn } from '../db/json';

export interface HistoryListQuery {
  status?: HistoryStatus;
  providerId?: string;
  /** 创建时间下界（含），ms epoch */
  from?: number;
  /** 创建时间上界（含），ms epoch */
  to?: number;
  limit?: number;
  offset?: number;
}

export function rowToHistory(row: unknown): HistoryRecord {
  const r = row as Record<string, unknown>;
  const params = parseJsonColumn<Record<string, unknown> | null>(r.params, null);
  const parentFromParams = params?.parentHistoryId;
  const parentHistoryId =
    (typeof parentFromParams === 'string' && parentFromParams ? parentFromParams : null) ??
    (r.parent_run_id as string | null);
  return {
    id: r.id as string,
    promptId: (r.prompt_id as string) ?? null,
    providerId: r.provider_id as string,
    model: r.model as string,
    promptText: r.prompt_text as string,
    negativeText: (r.negative_text as string) ?? null,
    params: params as PromptParams | null,
    status: r.status as HistoryRecord['status'],
    errorCode: (r.error_code as string) ?? null,
    errorMessage: (r.error_message as string) ?? null,
    imagePath: (r.image_path as string) ?? null,
    cost: (r.cost as number) ?? null,
    costUnit: 'point',
    durationMs: (r.duration_ms as number) ?? null,
    createdAt: r.created_at as number,
    parentHistoryId: parentHistoryId ?? undefined,
  };
}

export function referencesForHistory(db: Database.Database, historyId: string): PromptReference[] {
  const row = db
    .prepare('SELECT prompt_snapshot_json FROM generation_runs WHERE id = ?')
    .get(historyId) as { prompt_snapshot_json: string } | undefined;
  if (!row) return [];
  const snapshot = parseJsonColumn<PromptSnapshot | null>(row.prompt_snapshot_json, null);
  return (snapshot?.promptReferences ?? []).map((reference) => ({
    promptId: reference.promptId ?? '',
    title: reference.title,
    text: reference.excerpt,
    scope: reference.scope,
  }));
}

/** 合成 HistoryRecord 线格式的运行查询(列别名对齐旧 history 列名)。 */
const HISTORY_SELECT = `SELECT
    gr.id, gr.prompt_id, gr.parent_run_id, gr.provider_id, gr.model,
    gr.final_prompt AS prompt_text, gr.negative_prompt AS negative_text,
    gr.params_json AS params, gr.status, gr.error_code, gr.error_message,
    ga.media_path AS image_path, gr.actual_cost AS cost, gr.duration_ms, gr.created_at
  FROM generation_runs gr
  LEFT JOIN generated_assets ga
    ON ga.run_id = gr.id AND ga.position = 0 AND ga.status = 'available'`;

/** 纯函数：拼 WHERE + values，便于单测（不碰 DB） */
export function buildHistoryListSql(q: HistoryListQuery = {}): { sql: string; values: unknown[] } {
  // 线语义与旧账本一致:只见终态行,回收站(软删)不外泄。
  const where: string[] = [
    "gr.status IN ('success', 'failed', 'cancelled')",
    'gr.deleted_at IS NULL',
  ];
  const values: unknown[] = [];

  if (q.status) {
    where.push('gr.status = ?');
    values.push(q.status);
  }
  if (q.providerId) {
    where.push('gr.provider_id = ?');
    values.push(q.providerId);
  }
  if (q.from != null) {
    where.push('gr.created_at >= ?');
    values.push(q.from);
  }
  if (q.to != null) {
    where.push('gr.created_at <= ?');
    values.push(q.to);
  }

  let sql = `${HISTORY_SELECT} WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY gr.created_at DESC';
  if (q.limit != null) {
    sql += ' LIMIT ?';
    values.push(q.limit);
  }
  if (q.offset != null) {
    sql += ' OFFSET ?';
    values.push(q.offset);
  }
  return { sql, values };
}

export type HistoryDetail = HistoryRecord & { promptReferences: PromptReference[] };

export interface HistoryService {
  list(query?: HistoryListQuery): HistoryRecord[];
  get(id: string): HistoryDetail | null;
}

export function createHistoryService(db: () => Database.Database = getDb): HistoryService {
  return {
    list(query = {}) {
      const { sql, values } = buildHistoryListSql(query);
      return db()
        .prepare(sql)
        .all(...values)
        .map(rowToHistory);
    },
    get(id) {
      // 旧账本行只在终态才存在:in-flight 运行对这条线格式保持不可见(null=尚未完成)。
      const row = db()
        .prepare(
          `${HISTORY_SELECT}
           WHERE gr.id = ? AND gr.deleted_at IS NULL
             AND gr.status IN ('success', 'failed', 'cancelled')`,
        )
        .get(id);
      if (!row) return null;
      return { ...rowToHistory(row), promptReferences: referencesForHistory(db(), id) };
    },
  };
}
