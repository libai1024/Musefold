// 桌面 SQLite 的 Drizzle schema —— legacy 迁移链(core 0001→0020)终态的忠实映射。
//
// 事实源边界(与 migrations/0000_baseline.sql 头部注释配套):
// - baseline SQL 是 sqlite_master 的忠实导出(含 CHECK 约束与 prompts_fts 虚表);
// - 本文件不表达 CHECK(drizzle introspect 缺陷,登记放弃),也不含 FTS 虚表
//   (由 core repo 层显式维护);未来增量迁移 drizzle-kit generate 时人工审阅补齐。
// - 一致性由 __tests__ 守护:legacy 链建库 与 baseline 建库 的对象集合必须一致。

import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const folders = sqliteTable(
  'folders',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    parentId: text('parent_id'),
    sortOrder: integer('sort_order').default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_folders_sort').on(table.sortOrder),
    index('idx_folders_parent').on(table.parentId),
    foreignKey(() => ({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'folders_parent_id_folders_id_fk',
    })).onDelete('cascade'),
  ],
);

export const prompts = sqliteTable(
  'prompts',
  {
    id: text().primaryKey(),
    title: text().notNull(),
    description: text(),
    content: text().notNull(),
    contentNegative: text('content_negative'),
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    modelId: text('model_id'),
    params: text(),
    previewImagePath: text('preview_image_path'),
    rating: integer().default(0),
    isPinned: integer('is_pinned').default(0),
    pinOrder: integer('pin_order'),
    usageCount: integer('usage_count').default(0),
    lastUsedAt: integer('last_used_at'),
    source: text(),
    sourceUrl: text('source_url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('idx_prompts_updated').on(table.updatedAt).where(sql`deleted_at IS NULL`),
    index('idx_prompts_pinned')
      .on(table.isPinned, table.pinOrder)
      .where(sql`deleted_at IS NULL AND is_pinned = 1`),
    index('idx_prompts_model').on(table.modelId).where(sql`deleted_at IS NULL`),
    index('idx_prompts_folder').on(table.folderId).where(sql`deleted_at IS NULL`),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text().primaryKey(),
    name: text().notNull().unique(),
    tagGroup: text('tag_group'),
    color: text(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_tags_group').on(table.tagGroup)],
);

export const promptTags = sqliteTable(
  'prompt_tags',
  {
    promptId: text('prompt_id')
      .notNull()
      .references(() => prompts.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('idx_prompt_tags_tag').on(table.tagId),
    primaryKey({ columns: [table.promptId, table.tagId], name: 'prompt_tags_prompt_id_tag_id_pk' }),
  ],
);

// history / history_prompt_references 已随单账本迁移退役:
// 0002 把旧行回填进 generation_runs / generated_assets,0003 DROP 两表。

export const smartSets = sqliteTable(
  'smart_sets',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    query: text().notNull(),
    sortOrder: integer('sort_order').default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_smart_sets_sort').on(table.sortOrder, table.createdAt)],
);

export const searchHistory = sqliteTable(
  'search_history',
  {
    id: text().primaryKey(),
    term: text().notNull().unique(),
    usedAt: integer('used_at').notNull(),
  },
  (table) => [index('idx_search_history_used').on(table.usedAt)],
);

export const providers = sqliteTable('providers', {
  id: text().primaryKey(),
  name: text().notNull(),
  type: text().notNull(),
  baseUrl: text('base_url').notNull(),
  model: text().notNull(),
  hasKey: integer('has_key').default(0),
  keySuffix: text('key_suffix'),
  isActive: integer('is_active').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  managedBy: text('managed_by'),
});

export const doubaoWebDailyUsage = sqliteTable(
  'doubao_web_daily_usage',
  {
    usageScope: text('usage_scope').notNull(),
    usageDate: text('usage_date').notNull(),
    requestCount: integer('request_count').default(0).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.usageScope, table.usageDate],
      name: 'doubao_web_daily_usage_usage_scope_usage_date_pk',
    }),
  ],
);

export const automationAudit = sqliteTable(
  'automation_audit',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    at: integer().notNull(),
    caller: text().notNull(),
    action: text().notNull(),
    promptText: text('prompt_text'),
    paramsJson: text('params_json'),
    estimatedPoints: integer('estimated_points'),
    actualPoints: integer('actual_points'),
    approvedVia: text('approved_via').notNull(),
    status: text().notNull(),
    jobId: text('job_id'),
  },
  // 列名 `at` 触发 drizzle builder 冲突,不能链 (真库索引带 DESC,以 baseline SQL 为准)。
  (table) => [index('idx_automation_audit_at').on(table.at)],
);

export const workbenchSessions = sqliteTable(
  'workbench_sessions',
  {
    id: text().primaryKey(),
    title: text().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    archivedAt: integer('archived_at'),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('idx_workbench_sessions_active_updated')
      .on(table.archivedAt, table.updatedAt)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const generationRuns = sqliteTable(
  'generation_runs',
  {
    id: text().primaryKey(),
    runKind: text('run_kind').notNull(),
    workbenchSessionId: text('workbench_session_id').references(() => workbenchSessions.id, {
      onDelete: 'set null',
    }),
    workbenchTurnId: text('workbench_turn_id'),
    turnIndex: integer('turn_index'),
    resultIndex: integer('result_index'),
    parentRunId: text('parent_run_id'),
    retryOfRunId: text('retry_of_run_id'),
    sourceAssetId: text('source_asset_id'),
    /** 来源提示词(单账本迁移 0002 自 history.prompt_id 回填);不设外键,与云端 PG 对齐。 */
    promptId: text('prompt_id'),
    providerId: text('provider_id').notNull(),
    model: text().notNull(),
    userPrompt: text('user_prompt').default('').notNull(),
    basePrompt: text('base_prompt').notNull(),
    refinementInstruction: text('refinement_instruction'),
    finalPrompt: text('final_prompt').notNull(),
    negativePrompt: text('negative_prompt'),
    paramsJson: text('params_json').notNull(),
    promptSnapshotJson: text('prompt_snapshot_json').notNull(),
    status: text().notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    requestId: text('request_id'),
    estimatedCost: real('estimated_cost'),
    actualCost: real('actual_cost'),
    durationMs: integer('duration_ms'),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('idx_generation_runs_status_created').on(table.status, table.createdAt),
    index('idx_generation_runs_parent_created')
      .on(table.parentRunId, table.createdAt)
      .where(sql`parent_run_id IS NOT NULL`),
    // 提示词封面/相关作品查询走这条(prompts.ts COVER_IMAGE_SELECT)。
    index('idx_generation_runs_prompt_created')
      .on(table.promptId, table.createdAt)
      .where(sql`prompt_id IS NOT NULL`),
    index('idx_generation_runs_workbench_order')
      .on(table.workbenchSessionId, table.turnIndex, table.resultIndex, table.createdAt)
      .where(sql`workbench_session_id IS NOT NULL AND deleted_at IS NULL`),
    foreignKey(() => ({
      columns: [table.retryOfRunId],
      foreignColumns: [table.id],
      name: 'generation_runs_retry_of_run_id_generation_runs_id_fk',
    })).onDelete('set null'),
    foreignKey(() => ({
      columns: [table.parentRunId],
      foreignColumns: [table.id],
      name: 'generation_runs_parent_run_id_generation_runs_id_fk',
    })).onDelete('set null'),
  ],
);

/** Composer 草稿(0001 增量;M4b 曾旁存 userData JSON,M4e 并入受管库)。 */
export const workbenchDrafts = sqliteTable('workbench_drafts', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => workbenchSessions.id, { onDelete: 'cascade' }),
  draftJson: text('draft_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const generatedAssets = sqliteTable(
  'generated_assets',
  {
    id: text().primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    status: text().notNull(),
    mediaPath: text('media_path'),
    mimeType: text('mime_type'),
    width: integer(),
    height: integer(),
    fileSize: integer('file_size'),
    checksum: text(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_generated_assets_media_path').on(table.mediaPath).where(sql`media_path IS NOT NULL`),
    index('idx_generated_assets_run_position').on(table.runId, table.position),
    unique('generated_assets_run_id_position_unique').on(table.runId, table.position),
  ],
);

export const cloudSyncAccounts = sqliteTable(
  'cloud_sync_accounts',
  {
    ownerId: text('owner_id').primaryKey(),
    username: text().notNull(),
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name').notNull(),
    platform: text().notNull(),
    clientVersion: text('client_version').notNull(),
    active: integer().default(0).notNull(),
    enabled: integer().default(0).notNull(),
    cursor: text().default('0').notNull(),
    bootstrapCompletedAt: integer('bootstrap_completed_at'),
    lastSyncAt: integer('last_sync_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_cloud_sync_one_active_account').on(table.active).where(sql`active = 1`),
  ],
);

export const cloudEntityState = sqliteTable(
  'cloud_entity_state',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => cloudSyncAccounts.ownerId, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    localId: text('local_id').notNull(),
    cloudId: text('cloud_id').notNull(),
    cloudVersion: integer('cloud_version'),
    lastSyncedHash: text('last_synced_hash'),
    remoteSnapshotJson: text('remote_snapshot_json'),
    syncStatus: text('sync_status').notNull(),
    lastSyncedAt: integer('last_synced_at'),
  },
  (table) => [
    index('idx_cloud_entity_state_status').on(table.ownerId, table.syncStatus, table.entityType),
    primaryKey({
      columns: [table.ownerId, table.entityType, table.localId],
      name: 'cloud_entity_state_owner_id_entity_type_local_id_pk',
    }),
  ],
);

export const cloudSyncOutbox = sqliteTable(
  'cloud_sync_outbox',
  {
    mutationId: text('mutation_id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => cloudSyncAccounts.ownerId, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    operation: text().notNull(),
    baseVersion: integer('base_version'),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    nextAttemptAt: integer('next_attempt_at').default(0).notNull(),
    lastError: text('last_error'),
  },
  (table) => [
    index('idx_cloud_sync_outbox_entity').on(
      table.ownerId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index('idx_cloud_sync_outbox_ready').on(
      table.ownerId,
      table.nextAttemptAt,
      table.createdAt,
      table.mutationId,
    ),
  ],
);

export const cloudSyncConflicts = sqliteTable(
  'cloud_sync_conflicts',
  {
    id: text().primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => cloudSyncAccounts.ownerId, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    mutationId: text('mutation_id').notNull(),
    baseVersion: integer('base_version'),
    localSnapshotJson: text('local_snapshot_json').notNull(),
    remoteSnapshotJson: text('remote_snapshot_json').notNull(),
    detectedAt: integer('detected_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolution: text(),
  },
  (table) => [
    index('idx_cloud_sync_conflicts_owner_detected').on(
      table.ownerId,
      table.resolvedAt,
      table.detectedAt,
    ),
    uniqueIndex('idx_cloud_sync_conflicts_active_entity')
      .on(table.ownerId, table.entityType, table.entityId)
      .where(sql`resolved_at IS NULL`),
  ],
);

export const cloudSyncUsageOutbox = sqliteTable(
  'cloud_sync_usage_outbox',
  {
    eventId: text('event_id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => cloudSyncAccounts.ownerId, { onDelete: 'cascade' }),
    promptId: text('prompt_id').notNull(),
    action: text().notNull(),
    createdAt: integer('created_at').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    nextAttemptAt: integer('next_attempt_at').default(0).notNull(),
    lastError: text('last_error'),
  },
  (table) => [
    index('idx_cloud_sync_usage_outbox_ready').on(
      table.ownerId,
      table.nextAttemptAt,
      table.createdAt,
      table.eventId,
    ),
  ],
);
