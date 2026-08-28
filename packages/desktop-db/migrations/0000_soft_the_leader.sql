-- v2.5 baseline:core legacy 迁移链(0001→0020)终态的忠实导出(sqlite_master)。
-- 手工审阅并由 __tests__/takeover.test.ts 与 legacy 链逐对象比对;含 CHECK 约束、
-- partial/DESC 索引与 prompts_fts 虚表(这些无法由 drizzle-kit 表达,meta 快照有意不含)。
-- 本文件只在全新空库上执行;既有库经 fake-apply 直接标记为已应用(见 src/takeover.ts)。

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  content_negative TEXT,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  model_id TEXT,
  params TEXT,
  preview_image_path TEXT,
  rating INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  pin_order INTEGER,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  source TEXT,
  source_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
--> statement-breakpoint
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tag_group TEXT,
  color TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE prompt_tags (
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);
--> statement-breakpoint
CREATE TABLE history (
  id TEXT PRIMARY KEY,
  prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  negative_text TEXT,
  params TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  image_path TEXT,
  cost INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
, cost_unit TEXT NOT NULL DEFAULT 'cny_cent');
--> statement-breakpoint
CREATE TABLE history_prompt_references (
  history_id TEXT NOT NULL REFERENCES history(id) ON DELETE CASCADE,
  prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
  prompt_title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('full', 'excerpt')),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (history_id, sort_order)
);
--> statement-breakpoint
CREATE TABLE smart_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE search_history (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  used_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  has_key INTEGER DEFAULT 0,
  key_suffix TEXT,
  is_active INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, managed_by TEXT DEFAULT NULL);
--> statement-breakpoint
CREATE TABLE doubao_web_daily_usage (
  usage_scope TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK(request_count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (usage_scope, usage_date)
);
--> statement-breakpoint
CREATE VIRTUAL TABLE prompts_fts USING fts5(
  title, description, content, tags_index,
  tokenize='unicode61'
);
--> statement-breakpoint
CREATE TABLE automation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      caller TEXT NOT NULL,
      action TEXT NOT NULL,
      prompt_text TEXT,
      params_json TEXT,
      estimated_points INTEGER,
      actual_points INTEGER,
      approved_via TEXT NOT NULL,
      status TEXT NOT NULL,
      job_id TEXT
    );
--> statement-breakpoint
CREATE TABLE workbench_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      deleted_at INTEGER,
      CHECK (updated_at >= created_at)
    );
--> statement-breakpoint
CREATE TABLE generation_runs (
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
--> statement-breakpoint
CREATE TABLE generated_assets (
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
--> statement-breakpoint
CREATE TABLE cloud_sync_accounts (
      owner_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('macos', 'windows', 'linux')),
      client_version TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      cursor TEXT NOT NULL DEFAULT '0' CHECK (cursor GLOB '[0-9]*'),
      bootstrap_completed_at INTEGER,
      last_sync_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_id, device_id)
    );
--> statement-breakpoint
CREATE TABLE cloud_entity_state (
      owner_id TEXT NOT NULL REFERENCES cloud_sync_accounts(owner_id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('prompt', 'folder', 'tag')),
      local_id TEXT NOT NULL,
      cloud_id TEXT NOT NULL,
      cloud_version INTEGER CHECK (cloud_version IS NULL OR cloud_version > 0),
      last_synced_hash TEXT,
      remote_snapshot_json TEXT CHECK (remote_snapshot_json IS NULL OR json_valid(remote_snapshot_json)),
      sync_status TEXT NOT NULL CHECK (sync_status IN ('clean', 'pending', 'conflict', 'error')),
      last_synced_at INTEGER,
      PRIMARY KEY(owner_id, entity_type, local_id),
      UNIQUE(owner_id, entity_type, cloud_id)
    );
--> statement-breakpoint
CREATE TABLE cloud_sync_outbox (
      mutation_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES cloud_sync_accounts(owner_id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('prompt', 'folder', 'tag')),
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'restore')),
      base_version INTEGER CHECK (base_version IS NULL OR base_version > 0),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      created_at INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
--> statement-breakpoint
CREATE TABLE cloud_sync_conflicts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES cloud_sync_accounts(owner_id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('prompt', 'folder', 'tag')),
      entity_id TEXT NOT NULL,
      mutation_id TEXT NOT NULL,
      base_version INTEGER,
      local_snapshot_json TEXT NOT NULL CHECK (json_valid(local_snapshot_json)),
      remote_snapshot_json TEXT NOT NULL CHECK (json_valid(remote_snapshot_json)),
      detected_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolution TEXT CHECK (resolution IS NULL OR resolution IN ('remote', 'local', 'duplicate'))
    );
--> statement-breakpoint
CREATE TABLE cloud_sync_usage_outbox (
      event_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES cloud_sync_accounts(owner_id) ON DELETE CASCADE,
      prompt_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('copy', 'apply', 'generate')),
      created_at INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
--> statement-breakpoint
CREATE INDEX idx_folders_parent ON folders(parent_id);
--> statement-breakpoint
CREATE INDEX idx_folders_sort ON folders(sort_order);
--> statement-breakpoint
CREATE INDEX idx_prompts_folder ON prompts(folder_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_prompts_model ON prompts(model_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_prompts_pinned ON prompts(is_pinned, pin_order) WHERE deleted_at IS NULL AND is_pinned = 1;
--> statement-breakpoint
CREATE INDEX idx_prompts_updated ON prompts(updated_at DESC) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_tags_group ON tags(tag_group);
--> statement-breakpoint
CREATE INDEX idx_prompt_tags_tag ON prompt_tags(tag_id);
--> statement-breakpoint
CREATE INDEX idx_history_created ON history(created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_history_prompt ON history(prompt_id);
--> statement-breakpoint
CREATE INDEX idx_history_status ON history(status);
--> statement-breakpoint
CREATE INDEX idx_history_prompt_refs_prompt
  ON history_prompt_references(prompt_id);
--> statement-breakpoint
CREATE INDEX idx_history_prompt_refs_history
  ON history_prompt_references(history_id, sort_order);
--> statement-breakpoint
CREATE INDEX idx_smart_sets_sort ON smart_sets(sort_order, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_search_history_used ON search_history(used_at DESC);
--> statement-breakpoint
CREATE INDEX idx_automation_audit_at ON automation_audit(at DESC);
--> statement-breakpoint
CREATE INDEX idx_workbench_sessions_active_updated
      ON workbench_sessions(archived_at, updated_at DESC)
      WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_generation_runs_workbench_order
      ON generation_runs(workbench_session_id, turn_index, result_index, created_at)
      WHERE workbench_session_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_generation_runs_parent_created
      ON generation_runs(parent_run_id, created_at ASC)
      WHERE parent_run_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_generation_runs_status_created
      ON generation_runs(status, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_generated_assets_run_position
      ON generated_assets(run_id, position);
--> statement-breakpoint
CREATE INDEX idx_generated_assets_media_path
      ON generated_assets(media_path) WHERE media_path IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_cloud_sync_one_active_account
      ON cloud_sync_accounts(active) WHERE active = 1;
--> statement-breakpoint
CREATE INDEX idx_cloud_entity_state_status
      ON cloud_entity_state(owner_id, sync_status, entity_type);
--> statement-breakpoint
CREATE INDEX idx_cloud_sync_outbox_ready
      ON cloud_sync_outbox(owner_id, next_attempt_at, created_at, mutation_id);
--> statement-breakpoint
CREATE INDEX idx_cloud_sync_outbox_entity
      ON cloud_sync_outbox(owner_id, entity_type, entity_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_cloud_sync_conflicts_active_entity
      ON cloud_sync_conflicts(owner_id, entity_type, entity_id)
      WHERE resolved_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_cloud_sync_conflicts_owner_detected
      ON cloud_sync_conflicts(owner_id, resolved_at, detected_at DESC);
--> statement-breakpoint
CREATE INDEX idx_cloud_sync_usage_outbox_ready
      ON cloud_sync_usage_outbox(owner_id, next_attempt_at, created_at, event_id);
