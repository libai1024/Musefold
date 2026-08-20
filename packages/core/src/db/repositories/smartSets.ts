// electron/db/repositories/smartSets.ts
// 搜索历史（TASK-DIF-06）。智能集合 repository 已随 IPC 退役删除；
// 导入导出直写 smart_sets 表，schema 与迁移史保留。

import { ulid } from 'ulid';
import type { SearchHistoryItem } from '@musefold/desktop-contracts/models';
import { getDb } from '../index';

const MAX_HISTORY = 10;

function rowToSearchHistoryItem(row: unknown): SearchHistoryItem {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    term: r.term as string,
    usedAt: r.used_at as number,
  };
}

export const searchHistoryRepo = {
  list(limit = MAX_HISTORY): SearchHistoryItem[] {
    const safeLimit = Math.max(1, Math.min(MAX_HISTORY, Math.floor(limit || MAX_HISTORY)));
    const rows = getDb()
      .prepare('SELECT * FROM search_history ORDER BY used_at DESC LIMIT ?')
      .all(safeLimit);
    return rows.map(rowToSearchHistoryItem);
  },

  add(term: string): void {
    const clean = term.trim();
    if (!clean) return;
    const db = getDb();
    db.transaction(() => {
      const latest = db
        .prepare('SELECT MAX(used_at) AS max_used_at FROM search_history')
        .get() as { max_used_at?: number | null };
      // Millisecond timestamps can collide when a batch of searches is recorded
      // in one event loop turn; keep ordering strictly monotonic for eviction.
      const now = Math.max(Date.now(), (latest.max_used_at ?? 0) + 1);
      db.prepare(
        `INSERT INTO search_history (id, term, used_at)
         VALUES (@id, @term, @used_at)
         ON CONFLICT(term) DO UPDATE SET used_at = excluded.used_at`
      ).run({ id: ulid(), term: clean, used_at: now });
      db.prepare(
        `DELETE FROM search_history
         WHERE id NOT IN (
           SELECT id FROM search_history ORDER BY used_at DESC LIMIT ?
         )`
      ).run(MAX_HISTORY);
    })();
  },

  clear(): void {
    getDb().prepare('DELETE FROM search_history').run();
  },
};
