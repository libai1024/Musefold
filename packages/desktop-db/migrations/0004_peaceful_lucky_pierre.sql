CREATE TABLE `local_workspaces` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text,
  `kind` text NOT NULL CHECK (`kind` IN ('local_only', 'account')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK ((`kind` = 'local_only' AND `owner_id` IS NULL) OR (`kind` = 'account' AND `owner_id` IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_local_workspaces_owner` ON `local_workspaces` (`owner_id`) WHERE owner_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_local_workspaces_kind` ON `local_workspaces` (`kind`);
--> statement-breakpoint
CREATE TABLE `__legacy_folders` AS SELECT id, name, parent_id, sort_order, created_at FROM `folders`;
--> statement-breakpoint
CREATE TABLE `__legacy_prompts` AS SELECT rowid AS __rowid, id, title, description, content, content_negative, folder_id, model_id, params, preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at, source, source_url, created_at, updated_at, deleted_at FROM `prompts`;
--> statement-breakpoint
CREATE TABLE `__legacy_tags` AS SELECT id, name, tag_group, color, created_at FROM `tags`;
--> statement-breakpoint
CREATE TABLE `__legacy_prompt_tags` AS SELECT prompt_id, tag_id FROM `prompt_tags`;
--> statement-breakpoint
CREATE TABLE `__legacy_cloud_entity_state` AS SELECT
  owner_id, entity_type, local_id, cloud_version, cloud_id, last_synced_hash,
  remote_snapshot_json, sync_status, last_synced_at
FROM `cloud_entity_state`;
--> statement-breakpoint
CREATE TABLE `__legacy_cloud_sync_outbox` AS SELECT
  mutation_id, owner_id, entity_type, entity_id, operation, base_version,
  payload_json, created_at, attempt_count, next_attempt_at, last_error
FROM `cloud_sync_outbox`;
--> statement-breakpoint
CREATE TABLE `__legacy_cloud_sync_conflicts` AS SELECT
  id, owner_id, entity_type, entity_id, mutation_id, base_version,
  local_snapshot_json, remote_snapshot_json, detected_at, resolved_at, resolution
FROM `cloud_sync_conflicts`;
--> statement-breakpoint
CREATE TABLE `__legacy_cloud_sync_usage_outbox` AS SELECT
  event_id, owner_id, prompt_id, action, created_at, attempt_count,
  next_attempt_at, last_error
FROM `cloud_sync_usage_outbox`;
--> statement-breakpoint
DROP TABLE `prompt_tags`;
--> statement-breakpoint
DROP TABLE `prompts`;
--> statement-breakpoint
DROP TABLE `tags`;
--> statement-breakpoint
DROP TABLE `folders`;
--> statement-breakpoint
INSERT INTO `local_workspaces` (id, owner_id, kind, created_at, updated_at)
VALUES ('local-only-legacy', NULL, 'local_only', unixepoch('now') * 1000, unixepoch('now') * 1000)
ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT OR IGNORE INTO `local_workspaces` (id, owner_id, kind, created_at, updated_at)
SELECT 'account:' || owner_id, owner_id, 'account', unixepoch('now') * 1000, unixepoch('now') * 1000
FROM (
  SELECT owner_id FROM __legacy_cloud_entity_state
  UNION
  SELECT owner_id FROM __legacy_cloud_sync_outbox
  UNION
  SELECT owner_id FROM __legacy_cloud_sync_conflicts
  UNION
  SELECT owner_id FROM __legacy_cloud_sync_usage_outbox
);
--> statement-breakpoint
CREATE TABLE `folders` (
  `workspace_id` text NOT NULL REFERENCES `local_workspaces`(`id`) ON DELETE CASCADE,
  `id` text NOT NULL,
  `name` text NOT NULL,
  `parent_id` text,
  `sort_order` integer DEFAULT 0,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`workspace_id`, `id`),
  FOREIGN KEY (`workspace_id`, `parent_id`) REFERENCES `folders`(`workspace_id`, `id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_folders_sort` ON `folders` (`workspace_id`, `sort_order`);
--> statement-breakpoint
CREATE INDEX `idx_folders_parent` ON `folders` (`workspace_id`, `parent_id`);
--> statement-breakpoint
-- Insert every folder without a parent first. The second statement restores valid
-- parents after all rows exist, so source row order cannot break nested folders.
INSERT INTO `folders` (workspace_id, id, name, parent_id, sort_order, created_at)
SELECT 'local-only-legacy', id, name, NULL, sort_order, created_at
FROM __legacy_folders;
--> statement-breakpoint
UPDATE `folders`
SET parent_id = (
  SELECT parent.parent_id
  FROM __legacy_folders parent
  WHERE parent.id = folders.id
    AND parent.parent_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM __legacy_folders ancestor WHERE ancestor.id = parent.parent_id)
)
WHERE workspace_id = 'local-only-legacy';
--> statement-breakpoint
CREATE TABLE `prompts` (
  `workspace_id` text NOT NULL REFERENCES `local_workspaces`(`id`) ON DELETE CASCADE,
  `id` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `content` text NOT NULL,
  `content_negative` text,
  `folder_id` text,
  `model_id` text,
  `params` text,
  `preview_image_path` text,
  `rating` integer DEFAULT 0,
  `is_pinned` integer DEFAULT 0,
  `pin_order` integer,
  `usage_count` integer DEFAULT 0,
  `last_used_at` integer,
  `source` text,
  `source_url` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `deleted_at` integer,
  PRIMARY KEY (`workspace_id`, `id`),
  FOREIGN KEY (`workspace_id`, `folder_id`) REFERENCES `folders`(`workspace_id`, `id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prompts_updated` ON `prompts` (`workspace_id`, `updated_at`) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_prompts_pinned` ON `prompts` (`workspace_id`, `is_pinned`, `pin_order`) WHERE deleted_at IS NULL AND is_pinned = 1;
--> statement-breakpoint
CREATE INDEX `idx_prompts_model` ON `prompts` (`workspace_id`, `model_id`) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_prompts_folder` ON `prompts` (`workspace_id`, `folder_id`) WHERE deleted_at IS NULL;
--> statement-breakpoint
INSERT INTO `prompts` (rowid, workspace_id, id, title, description, content, content_negative, folder_id, model_id, params, preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at, source, source_url, created_at, updated_at, deleted_at)
SELECT __rowid, 'local-only-legacy', id, title, description, content, content_negative,
  CASE WHEN folder_id IS NOT NULL AND EXISTS (SELECT 1 FROM __legacy_folders folder WHERE folder.id = prompt.folder_id) THEN folder_id ELSE NULL END,
  model_id, params, preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at, source, source_url, created_at, updated_at, deleted_at
FROM __legacy_prompts prompt;
--> statement-breakpoint
CREATE TABLE `tags` (
  `workspace_id` text NOT NULL REFERENCES `local_workspaces`(`id`) ON DELETE CASCADE,
  `id` text NOT NULL,
  `name` text NOT NULL,
  `tag_group` text,
  `color` text,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`workspace_id`, `id`),
  UNIQUE (`workspace_id`, `name`)
);
--> statement-breakpoint
CREATE INDEX `idx_tags_group` ON `tags` (`workspace_id`, `tag_group`);
--> statement-breakpoint
INSERT INTO `tags` (workspace_id, id, name, tag_group, color, created_at)
SELECT 'local-only-legacy', id, name, tag_group, color, created_at FROM __legacy_tags;
--> statement-breakpoint
CREATE TABLE `prompt_tags` (
  `workspace_id` text NOT NULL,
  `prompt_id` text NOT NULL,
  `tag_id` text NOT NULL,
  PRIMARY KEY (`workspace_id`, `prompt_id`, `tag_id`),
  FOREIGN KEY (`workspace_id`, `prompt_id`) REFERENCES `prompts`(`workspace_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (`workspace_id`, `tag_id`) REFERENCES `tags`(`workspace_id`, `id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_prompt_tags_tag` ON `prompt_tags` (`workspace_id`, `tag_id`);
--> statement-breakpoint
INSERT INTO `prompt_tags` (workspace_id, prompt_id, tag_id)
SELECT 'local-only-legacy', relation.prompt_id, relation.tag_id
FROM __legacy_prompt_tags relation
WHERE EXISTS (SELECT 1 FROM prompts prompt WHERE prompt.workspace_id = 'local-only-legacy' AND prompt.id = relation.prompt_id)
  AND EXISTS (SELECT 1 FROM tags tag WHERE tag.workspace_id = 'local-only-legacy' AND tag.id = relation.tag_id);
--> statement-breakpoint
DROP TABLE `__legacy_prompt_tags`;
--> statement-breakpoint
DROP TABLE `__legacy_prompts`;
--> statement-breakpoint
DROP TABLE `__legacy_tags`;
--> statement-breakpoint
DROP TABLE `__legacy_folders`;
--> statement-breakpoint
DROP TABLE `cloud_sync_usage_outbox`;
--> statement-breakpoint
DROP TABLE `cloud_sync_conflicts`;
--> statement-breakpoint
DROP TABLE `cloud_sync_outbox`;
--> statement-breakpoint
DROP TABLE `cloud_entity_state`;
--> statement-breakpoint
CREATE TABLE `cloud_entity_state` (
  `owner_id` text NOT NULL REFERENCES `cloud_sync_accounts`(`owner_id`) ON DELETE CASCADE,
  `workspace_id` text NOT NULL REFERENCES `local_workspaces`(`id`) ON DELETE CASCADE,
  `entity_type` text NOT NULL,
  `local_id` text NOT NULL,
  `cloud_id` text NOT NULL,
  `cloud_version` integer,
  `last_synced_hash` text,
  `remote_snapshot_json` text,
  `sync_status` text NOT NULL,
  `last_synced_at` integer,
  PRIMARY KEY (`owner_id`, `workspace_id`, `entity_type`, `local_id`),
  UNIQUE (`owner_id`, `workspace_id`, `entity_type`, `cloud_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_entity_state_status` ON `cloud_entity_state` (`owner_id`, `workspace_id`, `sync_status`, `entity_type`);
--> statement-breakpoint
CREATE TABLE `cloud_sync_outbox` (
  `mutation_id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL REFERENCES `cloud_sync_accounts`(`owner_id`) ON DELETE CASCADE,
  `workspace_id` text NOT NULL REFERENCES `local_workspaces`(`id`) ON DELETE CASCADE,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `operation` text NOT NULL,
  `base_version` integer,
  `payload_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `next_attempt_at` integer NOT NULL DEFAULT 0,
  `last_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_sync_outbox_ready` ON `cloud_sync_outbox` (`owner_id`, `workspace_id`, `next_attempt_at`, `created_at`, `mutation_id`);
--> statement-breakpoint
CREATE INDEX `idx_cloud_sync_outbox_entity` ON `cloud_sync_outbox` (`owner_id`, `workspace_id`, `entity_type`, `entity_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `cloud_sync_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL REFERENCES `cloud_sync_accounts`(`owner_id`) ON DELETE CASCADE,
  `workspace_id` text NOT NULL REFERENCES `local_workspaces`(`id`) ON DELETE CASCADE,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `mutation_id` text NOT NULL,
  `base_version` integer,
  `local_snapshot_json` text NOT NULL,
  `remote_snapshot_json` text NOT NULL,
  `detected_at` integer NOT NULL,
  `resolved_at` integer,
  `resolution` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cloud_sync_conflicts_active_entity` ON `cloud_sync_conflicts` (`owner_id`, `workspace_id`, `entity_type`, `entity_id`) WHERE resolved_at IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_cloud_sync_conflicts_owner_detected` ON `cloud_sync_conflicts` (`owner_id`, `workspace_id`, `resolved_at`, `detected_at`);
--> statement-breakpoint
CREATE TABLE `cloud_sync_usage_outbox` (
  `event_id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL REFERENCES `cloud_sync_accounts`(`owner_id`) ON DELETE CASCADE,
  `workspace_id` text NOT NULL REFERENCES `local_workspaces`(`id`) ON DELETE CASCADE,
  `prompt_id` text NOT NULL,
  `action` text NOT NULL,
  `created_at` integer NOT NULL,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `next_attempt_at` integer NOT NULL DEFAULT 0,
  `last_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_sync_usage_outbox_ready` ON `cloud_sync_usage_outbox` (`owner_id`, `workspace_id`, `next_attempt_at`, `created_at`, `event_id`);
--> statement-breakpoint
INSERT INTO `cloud_entity_state` (
  owner_id, workspace_id, entity_type, local_id, cloud_id, cloud_version,
  last_synced_hash, remote_snapshot_json, sync_status, last_synced_at
)
SELECT owner_id, 'account:' || owner_id, entity_type, local_id, cloud_id, cloud_version,
  last_synced_hash, remote_snapshot_json, sync_status, last_synced_at
FROM __legacy_cloud_entity_state;
--> statement-breakpoint
INSERT INTO `cloud_sync_outbox` (
  mutation_id, owner_id, workspace_id, entity_type, entity_id, operation, base_version,
  payload_json, created_at, attempt_count, next_attempt_at, last_error
)
SELECT mutation_id, owner_id, 'account:' || owner_id, entity_type, entity_id, operation, base_version,
  payload_json, created_at, attempt_count, next_attempt_at, last_error
FROM __legacy_cloud_sync_outbox;
--> statement-breakpoint
INSERT INTO `cloud_sync_conflicts` (
  id, owner_id, workspace_id, entity_type, entity_id, mutation_id, base_version,
  local_snapshot_json, remote_snapshot_json, detected_at, resolved_at, resolution
)
SELECT id, owner_id, 'account:' || owner_id, entity_type, entity_id, mutation_id, base_version,
  local_snapshot_json, remote_snapshot_json, detected_at, resolved_at, resolution
FROM __legacy_cloud_sync_conflicts;
--> statement-breakpoint
INSERT INTO `cloud_sync_usage_outbox` (
  event_id, owner_id, workspace_id, prompt_id, action, created_at, attempt_count,
  next_attempt_at, last_error
)
SELECT event_id, owner_id, 'account:' || owner_id, prompt_id, action, created_at, attempt_count,
  next_attempt_at, last_error
FROM __legacy_cloud_sync_usage_outbox;
--> statement-breakpoint
DROP TABLE `__legacy_cloud_entity_state`;
--> statement-breakpoint
DROP TABLE `__legacy_cloud_sync_outbox`;
--> statement-breakpoint
DROP TABLE `__legacy_cloud_sync_conflicts`;
--> statement-breakpoint
DROP TABLE `__legacy_cloud_sync_usage_outbox`;
--> statement-breakpoint
DELETE FROM `prompts_fts`;
--> statement-breakpoint
INSERT INTO `prompts_fts` (rowid, title, description, content, tags_index)
SELECT p.rowid, p.title, COALESCE(p.description, ''), p.content,
  COALESCE((SELECT group_concat(t.name, ' ') FROM tags t JOIN prompt_tags pt
    ON pt.workspace_id = t.workspace_id AND pt.tag_id = t.id
    WHERE pt.workspace_id = p.workspace_id AND pt.prompt_id = p.id), '')
FROM prompts p;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
