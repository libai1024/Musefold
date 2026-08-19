import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_sync_accounts (
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_sync_one_active_account
      ON cloud_sync_accounts(active) WHERE active = 1;

    CREATE TABLE IF NOT EXISTS cloud_entity_state (
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
    CREATE INDEX IF NOT EXISTS idx_cloud_entity_state_status
      ON cloud_entity_state(owner_id, sync_status, entity_type);

    CREATE TABLE IF NOT EXISTS cloud_sync_outbox (
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
    CREATE INDEX IF NOT EXISTS idx_cloud_sync_outbox_ready
      ON cloud_sync_outbox(owner_id, next_attempt_at, created_at, mutation_id);
    CREATE INDEX IF NOT EXISTS idx_cloud_sync_outbox_entity
      ON cloud_sync_outbox(owner_id, entity_type, entity_id, created_at);

    CREATE TABLE IF NOT EXISTS cloud_sync_conflicts (
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_sync_conflicts_active_entity
      ON cloud_sync_conflicts(owner_id, entity_type, entity_id)
      WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_cloud_sync_conflicts_owner_detected
      ON cloud_sync_conflicts(owner_id, resolved_at, detected_at DESC);
  `);
}
