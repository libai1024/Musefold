// HistoryService（V04-CORE-04）：历史账本只读面。
// rowToHistory / referencesForHistory / buildHistoryListSql 自
// electron/main/ipc/history.ts 原样迁入（单一真源，IPC 反向引用本模块）。

import type Database from 'better-sqlite3';
import type { HistoryStatus } from '@musefold/desktop-contracts/enums';
import type { HistoryRecord, PromptParams } from '@musefold/desktop-contracts/models';
import type { PromptReference } from '@musefold/desktop-contracts/providers';
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
  const parentHistoryId = params?.parentHistoryId;
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
    parentHistoryId: typeof parentHistoryId === 'string' && parentHistoryId ? parentHistoryId : undefined,
  };
}

export function referencesForHistory(db: Database.Database, historyId: string): PromptReference[] {
  const rows = db.prepare(
    `SELECT prompt_id, prompt_title, excerpt, scope
     FROM history_prompt_references
     WHERE history_id = ?
     ORDER BY sort_order`,
  ).all(historyId) as Array<{
    prompt_id: string | null;
    prompt_title: string;
    excerpt: string;
    scope: 'full' | 'excerpt';
  }>;
  return rows.map((row) => ({
    promptId: row.prompt_id ?? '',
    title: row.prompt_title,
    text: row.excerpt,
    scope: row.scope,
  }));
}

/** 纯函数：拼 WHERE + values，便于单测（不碰 DB） */
export function buildHistoryListSql(q: HistoryListQuery = {}): { sql: string; values: unknown[] } {
  const where: string[] = [];
  const values: unknown[] = [];

  if (q.status) {
    where.push('status = ?');
    values.push(q.status);
  }
  if (q.providerId) {
    where.push('provider_id = ?');
    values.push(q.providerId);
  }
  if (q.from != null) {
    where.push('created_at >= ?');
    values.push(q.from);
  }
  if (q.to != null) {
    where.push('created_at <= ?');
    values.push(q.to);
  }

  let sql = 'SELECT * FROM history';
  if (where.length > 0) {
    sql += ` WHERE ${where.join(' AND ')}`;
  }
  sql += ' ORDER BY created_at DESC';
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
      return db().prepare(sql).all(...values).map(rowToHistory);
    },
    get(id) {
      const row = db().prepare('SELECT * FROM history WHERE id = ?').get(id);
      if (!row) return null;
      return { ...rowToHistory(row), promptReferences: referencesForHistory(db(), id) };
    },
  };
}
