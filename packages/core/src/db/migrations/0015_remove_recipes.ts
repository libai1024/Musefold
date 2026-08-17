import type Database from 'better-sqlite3';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      deleted_at INTEGER,
      CHECK (updated_at >= created_at)
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_sessions_active_updated
      ON workbench_sessions(archived_at, updated_at DESC)
      WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS generation_runs (
      id TEXT PRIMARY KEY,
      run_kind TEXT NOT NULL CHECK (run_kind IN ('free_generation', 'refinement', 'retry')),
      workbench_session_id TEXT REFERENCES workbench_sessions(id) ON DELETE SET NULL,
      workbench_turn_id TEXT,
      turn_index INTEGER CHECK (turn_index IS NULL OR turn_index >= 0),
      result_index INTEGER CHECK (result_index IS NULL OR result_index >= 0),
      parent_run_id TEXT REFERENCES generation_runs(id) ON DELETE SET NULL,
      retry_of_run_id TEXT REFERENCES generation_runs(id) ON DELETE SET NULL,
      source_asset_id TEXT,
      provider_id TEXT NOT NULL CHECK (length(trim(provider_id)) > 0),
      model TEXT NOT NULL CHECK (length(trim(model)) > 0),
      user_prompt TEXT NOT NULL DEFAULT '',
      base_prompt TEXT NOT NULL,
      refinement_instruction TEXT,
      final_prompt TEXT NOT NULL CHECK (length(trim(final_prompt)) > 0),
      negative_prompt TEXT,
      params_json TEXT NOT NULL CHECK (json_valid(params_json)),
      prompt_snapshot_json TEXT NOT NULL CHECK (json_valid(prompt_snapshot_json)),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
      error_code TEXT,
      error_message TEXT,
      request_id TEXT,
      estimated_cost REAL,
      actual_cost REAL,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_generation_runs_workbench_order
      ON generation_runs(workbench_session_id, turn_index, result_index, created_at)
      WHERE workbench_session_id IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_generation_runs_parent_created
      ON generation_runs(parent_run_id, created_at ASC)
      WHERE parent_run_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_generation_runs_status_created
      ON generation_runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS generated_assets (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      status TEXT NOT NULL CHECK (status IN ('available', 'missing', 'deleted', 'failed')),
      media_path TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      file_size INTEGER,
      checksum TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (run_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_generated_assets_run_position
      ON generated_assets(run_id, position);
    CREATE INDEX IF NOT EXISTS idx_generated_assets_media_path
      ON generated_assets(media_path) WHERE media_path IS NOT NULL;
  `);

  db.exec('DROP INDEX IF EXISTS idx_prompts_recipe');
  db.exec('DROP INDEX IF EXISTS idx_history_recipe');
  for (const column of [
    'recipe_variant_index',
    'recipe_values_snapshot',
    'recipe_fields_snapshot',
    'recipe_name_snapshot',
    'recipe_id',
  ]) {
    if (hasColumn(db, 'history', column)) db.exec(`ALTER TABLE history DROP COLUMN ${column}`);
  }
  if (hasColumn(db, 'prompts', 'recipe_id')) db.exec('ALTER TABLE prompts DROP COLUMN recipe_id');
}
