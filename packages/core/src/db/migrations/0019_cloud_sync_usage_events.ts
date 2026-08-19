import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_sync_usage_outbox (
      event_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES cloud_sync_accounts(owner_id) ON DELETE CASCADE,
      prompt_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('copy', 'apply', 'generate')),
      created_at INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cloud_sync_usage_outbox_ready
      ON cloud_sync_usage_outbox(owner_id, next_attempt_at, created_at, event_id);
  `);
}
