// electron/db/repositories/smartSets.ts
// Library 智能集合 + 搜索历史（TASK-DIF-06）

import { ulid } from 'ulid';
import type { LibraryQuerySnapshot, NewSmartSet, SearchHistoryItem, SmartSet } from '@musefold/desktop-contracts/models';
import type { UpdateSmartSetPatch } from '@musefold/desktop-contracts/ipc';
import { getDb } from '../index';
import { parseJsonColumn } from '../json';

const MAX_HISTORY = 10;

function sanitizeQuery(input: LibraryQuerySnapshot | null | undefined): LibraryQuerySnapshot {
  const q = input ?? {};
  const filters = q.filters ?? {};
  const cleanFilters: NonNullable<LibraryQuerySnapshot['filters']> = {};
  if (typeof filters.modelId === 'string' && filters.modelId.trim()) cleanFilters.modelId = filters.modelId.trim();
  if (filters.isPinned !== undefined) cleanFilters.isPinned = Boolean(filters.isPinned);
  if (typeof filters.ratingGte === 'number' && Number.isFinite(filters.ratingGte)) {
    cleanFilters.ratingGte = Math.max(0, Math.min(5, Math.round(filters.ratingGte)));
  }
  if (typeof filters.usageCountGte === 'number' && Number.isFinite(filters.usageCountGte)) {
    cleanFilters.usageCountGte = Math.max(0, Math.round(filters.usageCountGte));
  }
  if (typeof filters.createdAfter === 'number' && Number.isFinite(filters.createdAfter)) {
    cleanFilters.createdAfter = Math.max(0, Math.round(filters.createdAfter));
  }

  const clean: LibraryQuerySnapshot = {};
  if (typeof q.search === 'string' && q.search.trim()) clean.search = q.search.trim();
  if (typeof q.folderId === 'string' && q.folderId.trim()) clean.folderId = q.folderId.trim();
  if (Array.isArray(q.tagIds)) {
    const tagIds = Array.from(new Set(q.tagIds.filter((id) => typeof id === 'string' && id.trim())));
    if (tagIds.length > 0) clean.tagIds = tagIds;
  }
  if (Object.keys(cleanFilters).length > 0) clean.filters = cleanFilters;
  if (['updated', 'created', 'title', 'rating', 'usage'].includes(String(q.sort))) {
    clean.sort = q.sort;
  }
  if (q.sortDir === 'asc' || q.sortDir === 'desc') clean.sortDir = q.sortDir;
  return clean;
}

function rowToSmartSet(row: unknown): SmartSet {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    name: r.name as string,
    query: sanitizeQuery(parseJsonColumn<LibraryQuerySnapshot | null>(r.query, null)),
    sortOrder: (r.sort_order as number) ?? 0,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function rowToSearchHistoryItem(row: unknown): SearchHistoryItem {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    term: r.term as string,
    usedAt: r.used_at as number,
  };
}

export const smartSetsRepo = {
  list(): SmartSet[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM smart_sets ORDER BY sort_order ASC, created_at DESC').all();
    return rows.map(rowToSmartSet);
  },

  create(input: NewSmartSet): SmartSet {
    const db = getDb();
    const name = input.name.trim();
    if (!name) throw new Error('集合名称不能为空');
    const now = Date.now();
    const id = ulid();
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM smart_sets').get() as {
      max_order: number;
    };
    db.prepare(
      `INSERT INTO smart_sets (id, name, query, sort_order, created_at, updated_at)
       VALUES (@id, @name, @query, @sort_order, @created_at, @updated_at)`
    ).run({
      id,
      name,
      query: JSON.stringify(sanitizeQuery(input.query)),
      sort_order: (max.max_order ?? -1) + 1,
      created_at: now,
      updated_at: now,
    });
    return this.get(id)!;
  },

  get(id: string): SmartSet | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM smart_sets WHERE id = ?').get(id);
    return row ? rowToSmartSet(row) : null;
  },

  update(id: string, patch: UpdateSmartSetPatch): SmartSet {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) throw new Error('智能集合不存在');
    const fields: string[] = [];
    const values: Record<string, unknown> = { id, updated_at: Date.now() };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error('集合名称不能为空');
      fields.push('name = @name');
      values.name = name;
    }
    if (patch.query !== undefined) {
      fields.push('query = @query');
      values.query = JSON.stringify(sanitizeQuery(patch.query));
    }
    if (patch.sortOrder !== undefined) {
      fields.push('sort_order = @sort_order');
      values.sort_order = patch.sortOrder;
    }
    if (fields.length === 0) return existing;
    fields.push('updated_at = @updated_at');
    db.prepare(`UPDATE smart_sets SET ${fields.join(', ')} WHERE id = @id`).run(values);
    return this.get(id)!;
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM smart_sets WHERE id = ?').run(id);
  },
};

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
