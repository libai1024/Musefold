// 0014: 豆包网页桥接的本地自然日用量。
// 计数在真正提交网页生图前占用，跨应用重启、Provider 配置和窗口共享；usage_scope 含账号名。

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doubao_web_daily_usage (
      usage_scope TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0 CHECK(request_count >= 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (usage_scope, usage_date)
    );
  `);
}
