// electron/db/migrations/0006_smart_sets.ts
// TASK-DIF-06：Library 智能集合 + 最近搜索历史。

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_smart_sets_sort ON smart_sets(sort_order, created_at DESC);

    CREATE TABLE IF NOT EXISTS search_history (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL UNIQUE,
      used_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_history_used ON search_history(used_at DESC);
  `);
}
