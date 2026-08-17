import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS history_prompt_references (
      history_id TEXT NOT NULL REFERENCES history(id) ON DELETE CASCADE,
      prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
      prompt_title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('full', 'excerpt')),
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (history_id, sort_order)
    );
    CREATE INDEX IF NOT EXISTS idx_history_prompt_refs_prompt
      ON history_prompt_references(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_history_prompt_refs_history
      ON history_prompt_references(history_id, sort_order);
  `);
}
