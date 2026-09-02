import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/**
 * Cloud-safe design-scheme copy. This is deliberately separate from the local
 * design-scheme SQLite database; no local path, store key, or credential is stored here.
 */
export const designSchemes = pgTable(
  'design_schemes',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull().default(''),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    sourcePresentation: varchar('source_presentation', { length: 24 }).notNull(),
    sourceLabel: varchar('source_label', { length: 160 }).notNull().default(''),
    currentRevisionId: varchar('current_revision_id', { length: 64 }).notNull(),
    workingDraftRevisionId: varchar('working_draft_revision_id', { length: 64 }),
    coverAssetId: varchar('cover_asset_id', { length: 64 }),
    fidelity: varchar('fidelity', { length: 20 }).notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('design_schemes_user_updated_idx').on(table.userId, table.updatedAt),
    index('design_schemes_user_status_idx').on(table.userId, table.status),
    unique('design_schemes_id_user_id_unique').on(table.id, table.userId),
    check('design_schemes_status_check', sql`${table.status} IN ('draft', 'formal')`),
    check(
      'design_schemes_source_presentation_check',
      sql`${table.sourcePresentation} IN ('skill', 'musefold-created')`,
    ),
    check(
      'design_schemes_fidelity_check',
      sql`${table.fidelity} IN ('verified', 'faithful', 'adapted', 'unsupported')`,
    ),
    check('design_schemes_version_check', sql`${table.version} > 0`),
  ],
);

export const designSchemeRevisions = pgTable(
  'design_scheme_revisions',
  {
    revisionId: varchar('revision_id', { length: 64 }).primaryKey(),
    schemeId: varchar('scheme_id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    schemaVersion: integer('schema_version').notNull(),
    document: jsonb('document').$type<Record<string, unknown>>().notNull(),
    createdBy: varchar('created_by', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('design_scheme_revisions_user_scheme_idx').on(
      table.userId,
      table.schemeId,
      table.createdAt,
    ),
    unique('design_scheme_revisions_revision_user_unique').on(table.revisionId, table.userId),
    foreignKey({
      columns: [table.schemeId, table.userId],
      foreignColumns: [designSchemes.id, designSchemes.userId],
      name: 'design_scheme_revisions_scheme_owner_fk',
    }).onDelete('cascade'),
    check('design_scheme_revisions_schema_version_check', sql`${table.schemaVersion} > 0`),
    check(
      'design_scheme_revisions_document_identity_check',
      sql`(${table.document}->>'revisionId') = ${table.revisionId} AND (${table.document}->>'schemeId') = ${table.schemeId}`,
    ),
    check(
      'design_scheme_revisions_created_by_check',
      sql`${table.createdBy} IN ('agent', 'user', 'import')`,
    ),
  ],
);

export const designSchemeSourcePackages = pgTable(
  'design_scheme_source_packages',
  {
    id: varchar('id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 24 }).notNull(),
    repositoryUrl: varchar('repository_url', { length: 2_048 }),
    license: varchar('license', { length: 256 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('design_scheme_source_packages_user_created_idx').on(table.userId, table.createdAt),
    primaryKey({
      columns: [table.id, table.userId],
      name: 'design_scheme_source_packages_id_user_pk',
    }),
    check(
      'design_scheme_source_packages_kind_check',
      sql`${table.kind} IN ('github', 'history', 'user-brief', 'share-import')`,
    ),
  ],
);

export const designSchemeSourceSnapshots = pgTable(
  'design_scheme_source_snapshots',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    packageId: varchar('package_id', { length: 64 }).notNull(),
    resolvedRef: varchar('resolved_ref', { length: 256 }).notNull(),
    commitHash: varchar('commit_hash', { length: 64 }),
    contentHash: varchar('content_hash', { length: 128 }),
    totalBytes: integer('total_bytes').notNull().default(0),
    scan: jsonb('scan').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('design_scheme_source_snapshots_user_package_idx').on(
      table.userId,
      table.packageId,
      table.createdAt,
    ),
    unique('design_scheme_source_snapshots_id_user_unique').on(table.id, table.userId),
    foreignKey({
      columns: [table.packageId, table.userId],
      foreignColumns: [designSchemeSourcePackages.id, designSchemeSourcePackages.userId],
      name: 'design_scheme_source_snapshots_package_owner_fk',
    }).onDelete('cascade'),
    check('design_scheme_source_snapshots_total_bytes_check', sql`${table.totalBytes} >= 0`),
  ],
);

export const designSchemeSourceFiles = pgTable(
  'design_scheme_source_files',
  {
    snapshotId: varchar('snapshot_id', { length: 64 }).notNull(),
    relativePath: varchar('relative_path', { length: 1_024 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 12 }).notNull(),
    mimeType: varchar('mime_type', { length: 256 }),
    sizeBytes: integer('size_bytes').notNull(),
    contentHash: varchar('content_hash', { length: 128 }).notNull(),
    evidencePath: varchar('evidence_path', { length: 1_024 }),
    textExcerpt: text('text_excerpt'),
    objectKey: varchar('object_key', { length: 512 }),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.relativePath] }),
    index('design_scheme_source_files_user_snapshot_idx').on(table.userId, table.snapshotId),
    foreignKey({
      columns: [table.snapshotId, table.userId],
      foreignColumns: [designSchemeSourceSnapshots.id, designSchemeSourceSnapshots.userId],
      name: 'design_scheme_source_files_snapshot_owner_fk',
    }).onDelete('cascade'),
    check(
      'design_scheme_source_files_kind_check',
      sql`${table.kind} IN ('text', 'image', 'other')`,
    ),
    check('design_scheme_source_files_size_bytes_check', sql`${table.sizeBytes} >= 0`),
  ],
);

export const designSchemeSourceBindings = pgTable(
  'design_scheme_source_bindings',
  {
    revisionId: varchar('revision_id', { length: 64 }).notNull(),
    sourceSnapshotId: varchar('source_snapshot_id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.sourceSnapshotId] }),
    index('design_scheme_source_bindings_user_snapshot_idx').on(
      table.userId,
      table.sourceSnapshotId,
    ),
    foreignKey({
      columns: [table.revisionId, table.userId],
      foreignColumns: [designSchemeRevisions.revisionId, designSchemeRevisions.userId],
      name: 'design_scheme_source_bindings_revision_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sourceSnapshotId, table.userId],
      foreignColumns: [designSchemeSourceSnapshots.id, designSchemeSourceSnapshots.userId],
      name: 'design_scheme_source_bindings_snapshot_owner_fk',
    }).onDelete('cascade'),
    check(
      'design_scheme_source_bindings_role_check',
      sql`${table.role} IN ('normative', 'reference', 'example', 'context')`,
    ),
  ],
);

export const designSchemeAssets = pgTable(
  'design_scheme_assets',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    revisionId: varchar('revision_id', { length: 64 }).notNull(),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    origin: varchar('origin', { length: 20 }).notNull(),
    mimeType: varchar('mime_type', { length: 256 }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull().default(0),
    contentHash: varchar('content_hash', { length: 128 }).notNull(),
    license: varchar('license', { length: 256 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('design_scheme_assets_user_revision_idx').on(
      table.userId,
      table.revisionId,
      table.createdAt,
    ),
    unique('design_scheme_assets_id_user_unique').on(table.id, table.userId),
    foreignKey({
      columns: [table.revisionId, table.userId],
      foreignColumns: [designSchemeRevisions.revisionId, designSchemeRevisions.userId],
      name: 'design_scheme_assets_revision_owner_fk',
    }).onDelete('cascade'),
    check(
      'design_scheme_assets_role_check',
      sql`${table.role} IN ('cover', 'example', 'reference', 'output')`,
    ),
    check('design_scheme_assets_origin_check', sql`${table.origin} IN ('repository', 'local-run')`),
    check('design_scheme_assets_dimensions_check', sql`${table.width} > 0 AND ${table.height} > 0`),
    check('design_scheme_assets_byte_size_check', sql`${table.byteSize} >= 0`),
  ],
);

export const designSchemeRuns = pgTable(
  'design_scheme_runs',
  {
    runId: varchar('run_id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    schemeId: varchar('scheme_id', { length: 64 }).notNull(),
    revisionId: varchar('revision_id', { length: 64 }).notNull(),
    mode: varchar('mode', { length: 12 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull(),
    provider: jsonb('provider').$type<Record<string, unknown>>(),
    plan: jsonb('plan').$type<Record<string, unknown>>(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('design_scheme_runs_user_scheme_created_idx').on(
      table.userId,
      table.schemeId,
      table.createdAt,
    ),
    index('design_scheme_runs_user_status_idx').on(table.userId, table.status),
    unique('design_scheme_runs_run_user_unique').on(table.runId, table.userId),
    foreignKey({
      columns: [table.schemeId, table.userId],
      foreignColumns: [designSchemes.id, designSchemes.userId],
      name: 'design_scheme_runs_scheme_owner_fk',
    }),
    foreignKey({
      columns: [table.revisionId, table.userId],
      foreignColumns: [designSchemeRevisions.revisionId, designSchemeRevisions.userId],
      name: 'design_scheme_runs_revision_owner_fk',
    }),
    check('design_scheme_runs_mode_check', sql`${table.mode} IN ('trial', 'formal')`),
    check(
      'design_scheme_runs_status_check',
      sql`${table.status} IN ('planning', 'executing', 'evaluating', 'completed', 'blocked', 'failed', 'cancelled')`,
    ),
  ],
);

export const designSchemeRunSteps = pgTable(
  'design_scheme_run_steps',
  {
    runId: varchar('run_id', { length: 64 }).notNull(),
    stepId: varchar('step_id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull(),
    input: jsonb('input').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.stepId] }),
    index('design_scheme_run_steps_user_run_idx').on(table.userId, table.runId),
    foreignKey({
      columns: [table.runId, table.userId],
      foreignColumns: [designSchemeRuns.runId, designSchemeRuns.userId],
      name: 'design_scheme_run_steps_run_owner_fk',
    }).onDelete('cascade'),
    check(
      'design_scheme_run_steps_status_check',
      sql`${table.status} IN ('pending', 'running', 'completed', 'failed', 'cancelled')`,
    ),
  ],
);

export const designSchemeEvaluations = pgTable(
  'design_scheme_evaluations',
  {
    evaluationId: varchar('evaluation_id', { length: 64 }).primaryKey(),
    runId: varchar('run_id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    passed: integer('passed').notNull(),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('design_scheme_evaluations_user_run_idx').on(table.userId, table.runId, table.createdAt),
    foreignKey({
      columns: [table.runId, table.userId],
      foreignColumns: [designSchemeRuns.runId, designSchemeRuns.userId],
      name: 'design_scheme_evaluations_run_owner_fk',
    }).onDelete('cascade'),
    check('design_scheme_evaluations_passed_check', sql`${table.passed} IN (0, 1)`),
  ],
);

export type DesignScheme = typeof designSchemes.$inferSelect;
export type NewDesignScheme = typeof designSchemes.$inferInsert;
