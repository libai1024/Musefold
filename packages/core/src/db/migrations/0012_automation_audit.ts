// 0012: automation_audit —— 自动化花钱动作审计完整落库（V04-SEC-01，Q5 拍板：完整存储）。
// 提示词全文仅存本机所有者进程 SQLite，不进任何导出/分享/日志文本（V04-SECURITY §3.4）。

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      caller TEXT NOT NULL,
      action TEXT NOT NULL,
      prompt_text TEXT,
      params_json TEXT,
      estimated_cents INTEGER,
      actual_cents INTEGER,
      approved_via TEXT NOT NULL,
      status TEXT NOT NULL,
      job_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_automation_audit_at ON automation_audit(at DESC);
  `);
}
