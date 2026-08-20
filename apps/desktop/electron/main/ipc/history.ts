// electron/main/ipc/history.ts
// 历史 IPC —— list 支持 status/from/to/providerId 组合 AND（TASK-HIS-02）

import { ipcMain } from 'electron';
import { IPC } from '@shared/types/ipc';
import type {
  HistoryClearRequest,
  HistoryDeleteRequest,
  HistoryDeleteResult,
  HistoryLinkPromptRequest,
  HistoryLinkPromptResult,
  RelatedHistoryQuery,
  RelatedHistoryResult,
} from '@shared/types/ipc';
import type {
  HistoryRecord,
  PromptHistoryRelation,
  HistoryStats,
  HistoryStatsGroupBy,
  HistoryStatsQuery,
} from '@shared/types/models';
import type { HistoryStatus } from '@shared/types/enums';
import { unlink } from 'fs/promises';
import { resolve, sep } from 'path';
import { getDb } from '@musefold/core/db/index';
import { createWorkbenchRepositories } from '@musefold/core/db/repositories/workbench';
// 读逻辑真源在 core 服务面（V04-CORE-04）；本文件保留写路径与关联查询。
import {
  buildHistoryListSql,
  referencesForHistory,
  rowToHistory,
  type HistoryListQuery,
} from '@musefold/core/services/history';
import { getPaths } from '../../system/paths';

export { buildHistoryListSql, type HistoryListQuery };

interface StatsWhere {
  where: string;
  values: unknown[];
}

interface HistoryDeletionRow {
  id: string;
  image_path: string | null;
}

interface ManagedFileDeleteResult {
  fileDeleted?: true;
  fileMissing?: true;
  fileError?: string;
}

function attachPromptRelations(
  db: ReturnType<typeof getDb>,
  promptId: string,
  rows: unknown[],
): HistoryRecord[] {
  const items = rows.map(rowToHistory);
  if (items.length === 0) return items;

  const relations = new Map<string, PromptHistoryRelation[]>();
  for (const item of items) {
    if (item.promptId === promptId) relations.set(item.id, [{ kind: 'source' }]);
  }

  const prompt = db.prepare('SELECT source_url FROM prompts WHERE id = ?').get(promptId) as
    | { source_url: string | null }
    | undefined;
  const savedHistoryId = prompt?.source_url?.startsWith('history://')
    ? prompt.source_url.slice('history://'.length)
    : null;
  if (savedHistoryId && items.some((item) => item.id === savedHistoryId)) {
    const current = relations.get(savedHistoryId) ?? [];
    current.push({ kind: 'saved' });
    relations.set(savedHistoryId, current);
  }

  const placeholders = items.map(() => '?').join(', ');
  const referenceRows = db.prepare(
    `SELECT history_id, prompt_title, excerpt, scope
     FROM history_prompt_references
     WHERE prompt_id = ? AND history_id IN (${placeholders})
     ORDER BY history_id, sort_order`,
  ).all(promptId, ...items.map((item) => item.id)) as Array<{
    history_id: string;
    prompt_title: string;
    excerpt: string;
    scope: 'full' | 'excerpt';
  }>;

  for (const row of referenceRows) {
    const current = relations.get(row.history_id) ?? [];
    current.push({
      kind: 'reference',
      scope: row.scope,
      title: row.prompt_title,
      excerpt: row.excerpt,
    });
    relations.set(row.history_id, current);
  }

  return items.map((item) => ({
    ...item,
    promptRelations: relations.get(item.id) ?? [],
  }));
}

export function buildRelatedHistorySql(q: RelatedHistoryQuery): {
  listSql: string;
  countSql: string;
  whereValues: unknown[];
  listValues: unknown[];
} {
  const where = [
    `(h.prompt_id = ? OR EXISTS (
      SELECT 1
      FROM history_prompt_references r
      WHERE r.history_id = h.id AND r.prompt_id = ?
    ) OR EXISTS (
      SELECT 1
      FROM prompts p
      WHERE p.id = ? AND p.source_url = 'history://' || h.id
    ))`,
  ];
  const whereValues: unknown[] = [q.promptId, q.promptId, q.promptId];
  if (q.status) {
    where.push('h.status = ?');
    whereValues.push(q.status);
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const limit = Math.min(Math.max(q.limit ?? 60, 1), 200);
  const offset = Math.max(q.offset ?? 0, 0);
  return {
    listSql: `SELECT h.* FROM history h ${clause} ORDER BY h.created_at DESC LIMIT ? OFFSET ?`,
    countSql: `SELECT COUNT(*) AS total FROM history h ${clause}`,
    whereValues,
    listValues: [...whereValues, limit, offset],
  };
}

function normalizeStatsGroupBy(groupBy?: string): HistoryStatsGroupBy {
  return groupBy === 'week' || groupBy === 'month' || groupBy === 'day' ? groupBy : 'day';
}

function historyStatsBucketExpression(groupBy: HistoryStatsGroupBy): string {
  const ts = "datetime(h.created_at / 1000, 'unixepoch', 'localtime')";
  if (groupBy === 'month') return `strftime('%Y-%m', ${ts})`;
  if (groupBy === 'week') return `strftime('%Y-W%W', ${ts})`;
  return `strftime('%Y-%m-%d', ${ts})`;
}

export function buildHistoryStatsWhere(q: Partial<HistoryStatsQuery> = {}): StatsWhere {
  const where = ["h.status = 'success'"];
  const values: unknown[] = [];

  if (q.providerId) {
    where.push('h.provider_id = ?');
    values.push(q.providerId);
  }
  if (q.from != null) {
    where.push('h.created_at >= ?');
    values.push(q.from);
  }
  if (q.to != null) {
    where.push('h.created_at <= ?');
    values.push(q.to);
  }

  return { where: `WHERE ${where.join(' AND ')}`, values };
}

export function buildHistoryStatsSql(q: Partial<HistoryStatsQuery> = {}): {
  totalSql: string;
  bucketsSql: string;
  byProviderSql: string;
  values: unknown[];
  groupBy: HistoryStatsGroupBy;
} {
  const groupBy = normalizeStatsGroupBy(q.groupBy);
  const bucketExpr = historyStatsBucketExpression(groupBy);
  const { where, values } = buildHistoryStatsWhere(q);
  return {
    totalSql: `
      SELECT 'point' AS unit,
             COALESCE(SUM(COALESCE(h.cost, 0)), 0) AS cost,
             COUNT(*) AS totalCount
      FROM history h
      ${where}
      GROUP BY unit
    `,
    bucketsSql: `
      SELECT ${bucketExpr} AS key,
             'point' AS unit,
             COALESCE(SUM(COALESCE(h.cost, 0)), 0) AS cost,
             COUNT(*) AS count
      FROM history h
      ${where}
      GROUP BY key, unit
      ORDER BY key ASC, unit ASC
    `,
    byProviderSql: `
      SELECT h.provider_id AS providerId,
             COALESCE(p.name, h.provider_id) AS name,
             'point' AS unit,
             COALESCE(SUM(COALESCE(h.cost, 0)), 0) AS cost,
             COUNT(*) AS count
      FROM history h
      LEFT JOIN providers p ON p.id = h.provider_id
      ${where}
      GROUP BY h.provider_id, name, unit
      ORDER BY cost DESC, count DESC, h.provider_id ASC
    `,
    values,
    groupBy,
  };
}

function normalizeClearRequest(input?: number | HistoryClearRequest): HistoryClearRequest {
  if (typeof input === 'number') return { before: input };
  return input ?? {};
}

function normalizeStatuses(statuses?: HistoryStatus[]): HistoryStatus[] {
  if (!statuses) return [];
  const allowed = new Set<HistoryStatus>(['success', 'failed', 'cancelled']);
  return [...new Set(statuses)].filter((status) => allowed.has(status));
}

function normalizeDeleteRequest(input: string | HistoryDeleteRequest): HistoryDeleteRequest {
  if (typeof input === 'string') return { id: input };
  return input;
}

function isInsideDir(path: string, dir: string): boolean {
  const root = resolve(dir);
  const target = resolve(path);
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function markGenerationRunsDeleted(historyIds: string[], deletedAt = Date.now()): number {
  const ids = Array.from(new Set(historyIds.filter(Boolean)));
  if (ids.length === 0) return 0;
  return createWorkbenchRepositories(getDb()).runs.softDelete(ids, deletedAt);
}

function markAssetByHistoryFile(
  historyId: string,
  imagePath: string | null,
  status: 'deleted' | 'missing',
): number {
  if (!imagePath) return 0;
  return getDb().prepare(
    `UPDATE generated_assets
     SET status = ?
     WHERE run_id = ?
       AND media_path = ?
       AND status = 'available'`,
  ).run(status, historyId, imagePath).changes;
}

async function deleteManagedHistoryFile(imagePath: string): Promise<ManagedFileDeleteResult> {
  const picturesDir = getPaths().pictures;
  if (!isInsideDir(imagePath, picturesDir)) {
    return { fileError: '图片路径不在 Musefold 管理的输出目录内，已保留磁盘文件。' };
  }

  try {
    await unlink(imagePath);
    return { fileDeleted: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { fileMissing: true };
    }
    return {
      fileError: err instanceof Error ? err.message : '源文件删除失败',
    };
  }
}

function buildHistoryClearWhere(input?: number | HistoryClearRequest): {
  clause: string;
  values: unknown[];
} {
  const q = normalizeClearRequest(input);
  const where: string[] = [];
  const values: unknown[] = [];
  const statuses = normalizeStatuses(q.statuses);

  if (q.before != null) {
    where.push('created_at < ?');
    values.push(q.before);
  }
  if (statuses.length > 0) {
    where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    values.push(...statuses);
  }

  return {
    clause: where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '',
    values,
  };
}

/** 纯函数：拼 clear DELETE SQL + values，兼容旧 clear(before) 调用。 */
export function buildHistoryClearSql(input?: number | HistoryClearRequest): {
  sql: string;
  values: unknown[];
} {
  const { clause, values } = buildHistoryClearWhere(input);
  const sql = `DELETE FROM history${clause}`;
  return { sql, values };
}

export function buildHistoryClearSelectSql(input?: number | HistoryClearRequest): {
  sql: string;
  values: unknown[];
} {
  const { clause, values } = buildHistoryClearWhere(input);
  return {
    sql: `SELECT id, image_path FROM history${clause}`,
    values,
  };
}

export function registerHistoryHandlers(): void {
  ipcMain.handle(IPC.HISTORY_LIST, (_e, q?: HistoryListQuery) => {
    const db = getDb();
    const { sql, values } = buildHistoryListSql(q ?? {});
    const rows = db.prepare(sql).all(...values);
    return rows.map(rowToHistory);
  });

  ipcMain.handle(IPC.HISTORY_RELATED, (_e, q: RelatedHistoryQuery): RelatedHistoryResult => {
    if (!q?.promptId) return { items: [], total: 0 };
    const db = getDb();
    const { listSql, countSql, whereValues, listValues } = buildRelatedHistorySql(q);
    const rows = db.prepare(listSql).all(...listValues);
    const count = db.prepare(countSql).get(...whereValues) as { total: number };
    return {
      items: attachPromptRelations(db, q.promptId, rows),
      total: Number(count.total ?? 0),
    };
  });

  ipcMain.handle(
    IPC.HISTORY_LINK_PROMPT,
    (_e, req: HistoryLinkPromptRequest): HistoryLinkPromptResult => {
      const db = getDb();
      const promptId = req?.promptId?.trim();
      const historyIds = [...new Set((req?.historyIds ?? []).filter(Boolean))].slice(0, 200);
      if (!promptId || historyIds.length === 0) {
        return { linked: 0, alreadyLinked: 0, conflicts: [], missing: [] };
      }
      const promptExists = db.prepare(
        'SELECT 1 FROM prompts WHERE id = ? AND deleted_at IS NULL',
      ).get(promptId);
      if (!promptExists) throw new Error('PROMPT_NOT_FOUND: 提示词不存在或已删除');

      const getHistory = db.prepare('SELECT prompt_id FROM history WHERE id = ?');
      const linkHistory = db.prepare('UPDATE history SET prompt_id = ? WHERE id = ?');
      const result: HistoryLinkPromptResult = {
        linked: 0,
        alreadyLinked: 0,
        conflicts: [],
        missing: [],
      };
      db.transaction(() => {
        for (const historyId of historyIds) {
          const row = getHistory.get(historyId) as { prompt_id: string | null } | undefined;
          if (!row) {
            result.missing.push(historyId);
          } else if (row.prompt_id === promptId) {
            result.alreadyLinked += 1;
          } else if (row.prompt_id) {
            result.conflicts.push(historyId);
          } else {
            linkHistory.run(promptId, historyId);
            result.linked += 1;
          }
        }
      })();
      return result;
    },
  );

  ipcMain.handle(IPC.HISTORY_GET, (_e, id: string) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM history WHERE id = ?').get(id);
    if (!row) return null;
    return { ...rowToHistory(row), promptReferences: referencesForHistory(db, id) };
  });

  ipcMain.handle(IPC.HISTORY_DELETE, async (_e, input: string | HistoryDeleteRequest) => {
    const req = normalizeDeleteRequest(input);
    const db = getDb();
    const row = db.prepare('SELECT id, image_path FROM history WHERE id = ?').get(req.id) as
      | HistoryDeletionRow
      | undefined;
    const result = db.prepare('DELETE FROM history WHERE id = ?').run(req.id);
    const runsDeleted = row && result.changes > 0 ? markGenerationRunsDeleted([row.id]) : 0;
    const response: HistoryDeleteResult = {
      ok: true,
      deleted: result.changes,
      imagePath: row?.image_path ?? null,
      runDeleted: runsDeleted > 0,
    };

    if (!req.deleteFile || !row?.image_path) return response;

    const fileResult = await deleteManagedHistoryFile(row.image_path);
    const assetsMarked = fileResult.fileDeleted
      ? markAssetByHistoryFile(row.id, row.image_path, 'deleted')
      : fileResult.fileMissing
        ? markAssetByHistoryFile(row.id, row.image_path, 'missing')
        : 0;
    return { ...response, ...fileResult, assetsMarked };
  });

  ipcMain.handle(IPC.HISTORY_CLEAR, async (_e, req?: number | HistoryClearRequest) => {
    const db = getDb();
    const normalized = normalizeClearRequest(req);
    const select = buildHistoryClearSelectSql(normalized);
    const rows = db.prepare(select.sql).all(...select.values) as HistoryDeletionRow[];
    const { sql, values } = buildHistoryClearSql(req);
    const result = db.prepare(sql).run(...values);
    const deletedRows = rows.slice(0, result.changes);
    const runsDeleted = result.changes > 0 ? markGenerationRunsDeleted(deletedRows.map((row) => row.id)) : 0;
    const fileErrors: Array<{ id: string; path: string; message: string }> = [];
    let filesDeleted = 0;
    let filesMissing = 0;

    if (normalized.deleteFiles) {
      for (const row of deletedRows) {
        if (!row.image_path) continue;
        const fileResult = await deleteManagedHistoryFile(row.image_path);
        if (fileResult.fileDeleted) {
          filesDeleted += 1;
          markAssetByHistoryFile(row.id, row.image_path, 'deleted');
        } else if (fileResult.fileMissing) {
          filesMissing += 1;
          markAssetByHistoryFile(row.id, row.image_path, 'missing');
        } else if (fileResult.fileError) {
          fileErrors.push({ id: row.id, path: row.image_path, message: fileResult.fileError });
        }
      }
    }

    return {
      ok: true as const,
      deleted: result.changes,
      runsDeleted,
      filesDeleted,
      filesMissing,
      fileErrors,
    };
  });

  ipcMain.handle(IPC.HISTORY_STATS, (_e, q: HistoryStatsQuery): HistoryStats => {
    const db = getDb();
    const { totalSql, bucketsSql, byProviderSql, values } = buildHistoryStatsSql(q ?? {});
    const totals = db.prepare(totalSql).all(...values).map((row) => {
      const r = row as Record<string, unknown>;
      const count = Number(r.totalCount ?? 0);
      const cost = Number(r.cost ?? 0);
      return {
        unit: 'point' as const,
        cost,
        count,
        avgCost: count > 0 ? cost / count : 0,
      };
    });
    const totalCount = totals.reduce((sum, total) => sum + total.count, 0);
    const buckets = db.prepare(bucketsSql).all(...values).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        key: String(r.key ?? ''),
        cost: Number(r.cost ?? 0),
        count: Number(r.count ?? 0),
        unit: 'point' as const,
      };
    });
    const byProvider = db.prepare(byProviderSql).all(...values).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        providerId: String(r.providerId ?? ''),
        name: String(r.name ?? r.providerId ?? ''),
        cost: Number(r.cost ?? 0),
        count: Number(r.count ?? 0),
        unit: 'point' as const,
      };
    });

    return {
      totals,
      totalCost: totals[0]?.cost ?? 0,
      avgCost: totals[0]?.avgCost ?? 0,
      totalCount,
      buckets,
      byProvider,
    };
  });
}
