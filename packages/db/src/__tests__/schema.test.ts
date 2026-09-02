import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../schema/index.js';
import { syncMutationResults } from '../schema/sync.js';

const EXPECTED_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'jwks',
  'oauth_client',
  'oauth_resource',
  'oauth_client_resource',
  'oauth_refresh_token',
  'oauth_access_token',
  'oauth_consent',
  'account_credentials',
  'relay_sessions',
  'rate_limit_buckets',
  'prompt_folders',
  'prompt_tags',
  'prompts',
  'prompt_tag_links',
  'prompt_usage_events',
  'sync_devices',
  'sync_change_log',
  'sync_mutation_results',
  'sync_retention_state',
  'workbench_sessions',
  'generation_runs',
  'generation_assets',
  'generation_events',
  'generation_reference_uploads',
  'generation_reference_links',
  'object_cleanup_queue',
  'published_skills',
  'design_schemes',
  'design_scheme_revisions',
  'design_scheme_source_packages',
  'design_scheme_source_snapshots',
  'design_scheme_source_files',
  'design_scheme_source_bindings',
  'design_scheme_assets',
  'design_scheme_runs',
  'design_scheme_run_steps',
  'design_scheme_evaluations',
];

describe('Drizzle schema', () => {
  it('导出全部业务与 Better Auth 表', () => {
    const tableNames = Object.values(schema)
      .filter((value) => typeof value === 'object' && value !== null)
      .flatMap((value) => {
        try {
          return [getTableName(value as never)];
        } catch {
          return [];
        }
      });
    for (const expected of EXPECTED_TABLES) {
      expect(tableNames, `缺表 ${expected}`).toContain(expected);
    }
  });

  it('design-scheme cloud tables keep owner/version/provenance boundaries', () => {
    expect(schema.designSchemes.userId.notNull).toBe(true);
    expect(schema.designSchemes.version.notNull).toBe(true);
    expect(schema.designSchemes.deletedAt.notNull).toBe(false);
    expect(schema.designSchemeRevisions.userId.notNull).toBe(true);
    expect(schema.designSchemeRevisions.document.notNull).toBe(true);
    expect(schema.designSchemeAssets.objectKey.notNull).toBe(true);
    expect(schema.designSchemeAssets.objectKey.name).toBe('object_key');
    expect(schema.designSchemeSourceFiles.relativePath.name).toBe('relative_path');
    expect(schema.designSchemeSourceFiles.objectKey.name).toBe('object_key');

    const ownerScopedTables = [
      schema.designSchemes,
      schema.designSchemeRevisions,
      schema.designSchemeSourcePackages,
      schema.designSchemeSourceSnapshots,
      schema.designSchemeSourceFiles,
      schema.designSchemeSourceBindings,
      schema.designSchemeAssets,
      schema.designSchemeRuns,
      schema.designSchemeRunSteps,
      schema.designSchemeEvaluations,
    ];
    for (const table of ownerScopedTables) {
      expect(table.userId.notNull, `owner missing on ${getTableName(table)}`).toBe(true);
    }

    const ownerForeignKeys = [
      [schema.designSchemeRevisions, 'design_scheme_revisions_scheme_owner_fk'],
      [schema.designSchemeSourceSnapshots, 'design_scheme_source_snapshots_package_owner_fk'],
      [schema.designSchemeSourceFiles, 'design_scheme_source_files_snapshot_owner_fk'],
      [schema.designSchemeSourceBindings, 'design_scheme_source_bindings_revision_owner_fk'],
      [schema.designSchemeSourceBindings, 'design_scheme_source_bindings_snapshot_owner_fk'],
      [schema.designSchemeAssets, 'design_scheme_assets_revision_owner_fk'],
      [schema.designSchemeRuns, 'design_scheme_runs_scheme_owner_fk'],
      [schema.designSchemeRuns, 'design_scheme_runs_revision_owner_fk'],
      [schema.designSchemeRunSteps, 'design_scheme_run_steps_run_owner_fk'],
      [schema.designSchemeEvaluations, 'design_scheme_evaluations_run_owner_fk'],
    ] as const;
    for (const [table, name] of ownerForeignKeys) {
      expect(
        getTableConfig(table).foreignKeys.map((foreignKey) => foreignKey.getName()),
        `owner FK missing: ${name}`,
      ).toContain(name);
    }

    expect(
      getTableConfig(schema.designSchemeSourcePackages).primaryKeys[0]?.columns.map(
        (column) => column.name,
      ),
    ).toEqual(['id', 'user_id']);
  });

  it('object storage retention schema keeps durable owner-scoped cleanup metadata', () => {
    expect(schema.generationReferenceUploads.objectKey.notNull).toBe(true);
    expect(schema.generationReferenceUploads.expiresAt.notNull).toBe(true);
    expect(schema.generationReferenceUploads.status.default).toBe('uploading');
    expect(schema.generationReferenceLinks.userId.notNull).toBe(true);
    expect(schema.objectCleanupQueue.objectKey.primary).toBe(true);
    expect(schema.objectCleanupQueue.ownerId.notNull).toBe(true);
    expect(schema.objectCleanupQueue.objectType.notNull).toBe(true);
    expect(schema.objectCleanupQueue.reason.notNull).toBe(true);
    expect(schema.objectCleanupQueue.attemptCount.notNull).toBe(true);
    expect(schema.objectCleanupQueue.nextAttemptAt.notNull).toBe(true);
    expect(schema.objectCleanupQueue.abandonedAt.notNull).toBe(false);

    const linkForeignKeys = getTableConfig(schema.generationReferenceLinks).foreignKeys.map(
      (foreignKey) => foreignKey.getName(),
    );
    expect(linkForeignKeys).toContain('generation_reference_links_run_owner_fk');
    expect(linkForeignKeys).toContain('generation_reference_links_reference_owner_fk');
  });

  it('sync mutation results persists a nullable request fingerprint', () => {
    expect(syncMutationResults.requestFingerprint).toBeDefined();
    expect(syncMutationResults.requestFingerprint.columnType).toBe('PgVarchar');
    expect(syncMutationResults.requestFingerprint.notNull).toBe(false);
  });

  it('迁移目录包含初始 SQL 且覆盖全部表', () => {
    const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const sql = files.map((file) => readFileSync(`${migrationsDir}/${file}`, 'utf8')).join('\n');
    for (const expected of EXPECTED_TABLES) {
      expect(sql, `迁移缺表 ${expected}`).toContain(`"${expected}"`);
    }
    expect(sql).toContain('"request_fingerprint" varchar(64)');
    expect(sql).toContain('"generation_reference_uploads"');
    expect(sql).toContain('"generation_reference_links"');
    expect(sql).toContain('"object_cleanup_queue"');
    const storageSql = readFileSync(`${migrationsDir}/0004_cloud_object_retention.sql`, 'utf8');
    expect(storageSql).toContain('"object_cleanup_queue_due_idx"');
    expect(storageSql).toContain('"attempt_count" integer DEFAULT 0 NOT NULL');
    expect(storageSql).toContain('"generation_reference_links_run_owner_fk"');
    expect(storageSql).toContain('"generation_reference_links_reference_owner_fk"');
    expect(storageSql).toContain('jsonb_array_elements');
    const cleanupMetadataSql = readFileSync(
      `${migrationsDir}/0005_cleanup_abandonment_metadata.sql`,
      'utf8',
    );
    expect(cleanupMetadataSql).toContain('ADD COLUMN "abandoned_at" timestamp with time zone');
    expect(storageSql.indexOf('"generation_runs_id_user_unique"')).toBeLessThan(
      storageSql.indexOf('"generation_reference_links_run_owner_fk"'),
    );
    expect(sql).toContain('"design_schemes"');
    expect(sql).toContain('"design_scheme_revisions"');
    expect(sql).toContain('"design_scheme_runs"');
    expect(sql).toContain('"design_scheme_evaluations"');
    expect(sql).toContain('"user_id" text NOT NULL');
    expect(sql).toContain('"version" integer DEFAULT 1 NOT NULL');
    const cloudSql = readFileSync(`${migrationsDir}/0003_design_scheme_cloud_copy.sql`, 'utf8');
    expect(cloudSql).not.toMatch(/"(?:path|file_path|image_path|cover_image_path|store_key)"/);
    expect(cloudSql).toContain('"design_scheme_revisions_document_identity_check"');
    for (const name of [
      'design_scheme_revisions_scheme_owner_fk',
      'design_scheme_source_snapshots_package_owner_fk',
      'design_scheme_source_files_snapshot_owner_fk',
      'design_scheme_source_bindings_revision_owner_fk',
      'design_scheme_source_bindings_snapshot_owner_fk',
      'design_scheme_assets_revision_owner_fk',
      'design_scheme_runs_scheme_owner_fk',
      'design_scheme_runs_revision_owner_fk',
      'design_scheme_run_steps_run_owner_fk',
      'design_scheme_evaluations_run_owner_fk',
    ]) {
      expect(cloudSql, `migration missing ${name}`).toContain(`"${name}"`);
    }
  });
});
