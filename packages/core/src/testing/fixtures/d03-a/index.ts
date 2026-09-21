import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import {
  DESIGN_SCHEME_CORE_TABLES_SQL,
  DESIGN_SCHEME_DB_BOOTSTRAP_SQL,
  DESIGN_SCHEME_EVALUATION_TABLES_SQL,
  DESIGN_SCHEME_RUN_TABLES_SQL,
  DESIGN_SCHEME_SOURCE_TABLES_SQL,
  MARKET_CANDIDATE_TABLES_SQL,
  SHARE_PACKAGE_TABLES_SQL,
} from '../../../db/design-scheme/schema';
import { SCHEMA_SQL } from '../../../db/schema';
import { up as addAccountManagement } from '../../../db/migrations/0013_account_managed';
import { up as addAutomationAudit } from '../../../db/migrations/0012_automation_audit';
import { up as addDailyUsage } from '../../../db/migrations/0014_doubao_web_daily_usage';
import { up as addGenerationLedger } from '../../../db/migrations/0015_remove_recipes';
import { up as addCostPoints } from '../../../db/migrations/0016_cost_points';
import { up as addCloudSync } from '../../../db/migrations/0017_cloud_prompt_sync';
import { up as addCloudSnapshot } from '../../../db/migrations/0018_cloud_sync_snapshot';
import { up as addCloudUsageOutbox } from '../../../db/migrations/0019_cloud_sync_usage_events';
import { up as removeWukongProvider } from '../../../db/migrations/0020_remove_wukong_studio';

export const D03A_FIXTURE_VERSION = 1 as const;
export const D03A_REDACTED_PROMPT = '[D03-A synthetic prompt redacted]' as const;
export const D03A_FIXED_TIME = 1_700_000_000_000 as const;
export const D03A_LEGACY_USER_VERSION = 20 as const;
export const D03A_DESIGN_SCHEME_USER_VERSION = 4 as const;
export const D03A_LONG_RELATIVE_PATH =
  `fixture-assets/${'長'.repeat(96)}/日本語/preview.png` as const;
export const D03A_PROVENANCE_MANIFEST_PATH =
  'packages/core/src/testing/fixtures/d03-a/provenance.json' as const;

export type D03AFixtureKind = 'legacy-v2.1' | 'design-scheme-v4';

export interface D03AFixtureCoverage {
  nonAsciiMetadata: boolean;
  longPathMetadata: boolean;
  ftsDrift: boolean;
  syncConsent: readonly ('unset' | 'paused' | 'enabled')[];
  outbox: boolean;
  conflict: boolean;
  tombstone: boolean;
  historicalAssets: boolean;
  archivedSessions: boolean;
}

export interface D03AFixtureManifest {
  fixtureId: string;
  fixtureVersion: number;
  kind: D03AFixtureKind;
  schema: string;
  userVersion: number;
  source: {
    provenance: 'synthetic';
    sourceKind: 'deterministic-builder';
    generator: string;
    command: string;
    networkAccess: false;
    credentialSources: readonly [];
    forbiddenSources: readonly string[];
  };
  redaction: {
    promptBody: 'redacted';
    credentials: 'excluded';
    userIdentity: 'synthetic-only';
    absolutePaths: 'excluded';
    realGeneration: false;
    realSpend: false;
  };
  coverage: D03AFixtureCoverage;
  unimplementedFields: readonly string[];
  canonicalHash: string;
  fileHash: string;
}

const COMMON_SOURCE = {
  provenance: 'synthetic',
  sourceKind: 'deterministic-builder',
  generator: 'packages/core/src/testing/fixtures/d03-a/index.ts',
  command: 'pnpm vitest run packages/core/src/testing/fixtures/d03-a/__tests__/fixtures.test.ts',
  networkAccess: false,
  credentialSources: [],
  forbiddenSources: ['userData', 'release', '.drizzle-pull', 'active App database'],
} as const;

export const D03A_LEGACY_MANIFEST: D03AFixtureManifest = {
  fixtureId: 'd03-a-legacy-v2.1-synthetic',
  fixtureVersion: D03A_FIXTURE_VERSION,
  kind: 'legacy-v2.1',
  schema: 'core-legacy-v2.1-final',
  userVersion: D03A_LEGACY_USER_VERSION,
  source: COMMON_SOURCE,
  redaction: {
    promptBody: 'redacted',
    credentials: 'excluded',
    userIdentity: 'synthetic-only',
    absolutePaths: 'excluded',
    realGeneration: false,
    realSpend: false,
  },
  coverage: {
    nonAsciiMetadata: true,
    longPathMetadata: true,
    ftsDrift: true,
    syncConsent: ['unset', 'paused', 'enabled'],
    outbox: true,
    conflict: true,
    tombstone: true,
    historicalAssets: true,
    archivedSessions: true,
  },
  unimplementedFields: [],
  canonicalHash: 'e4d69922f8ea1ebf587ceea24d25270a9bd2330aaa43878047126f11478b82cf',
  fileHash: '9d03bc46e93fa3db73da4725cbf8dadd54261ed6eb210a04f5249c55bb5c7d96',
};

export const D03A_DESIGN_SCHEME_MANIFEST: D03AFixtureManifest = {
  fixtureId: 'd03-a-design-scheme-v4-synthetic',
  fixtureVersion: D03A_FIXTURE_VERSION,
  kind: 'design-scheme-v4',
  schema: 'design-scheme-local-v4',
  userVersion: D03A_DESIGN_SCHEME_USER_VERSION,
  source: COMMON_SOURCE,
  redaction: {
    promptBody: 'redacted',
    credentials: 'excluded',
    userIdentity: 'synthetic-only',
    absolutePaths: 'excluded',
    realGeneration: false,
    realSpend: false,
  },
  coverage: {
    nonAsciiMetadata: true,
    longPathMetadata: true,
    ftsDrift: false,
    syncConsent: [],
    outbox: false,
    conflict: false,
    tombstone: false,
    historicalAssets: false,
    archivedSessions: false,
  },
  unimplementedFields: [
    'v5 optimistic-lock version column',
    'full design document fields and prompt program',
    'provider execution provenance',
    'real generated assets',
    'cloud owner/workspace mapping',
  ],
  canonicalHash: '612a27224d617b8c8d391dcfe03cb56953b1fce1201424b7e39f99735dce1660',
  fileHash: 'ab3828ade64337487e79da8bd62afbc015498e6718410d37bf2710afe364f8d1',
};

export interface D03AFixtureArtifact {
  readonly kind: D03AFixtureKind;
  readonly path: string;
  readonly manifest: D03AFixtureManifest;
  readonly canonicalHash: string;
  readonly fileHash: string;
}

export interface D03AScanResult {
  readonly kind: D03AFixtureKind;
  readonly userVersion: number;
  readonly integrity: string;
  readonly foreignKeyViolations: readonly unknown[];
  readonly tables: readonly string[];
  readonly missingTables: readonly string[];
  readonly sensitiveMatches: readonly string[];
  readonly absolutePathMatches: readonly string[];
  readonly redactionViolations: readonly string[];
  readonly ftsDrift: readonly string[];
  readonly sourceViolations: readonly string[];
  readonly canonicalHash: string;
  readonly passed: boolean;
}

const LEGACY_REQUIRED_TABLES = [
  'folders',
  'prompts',
  'tags',
  'prompt_tags',
  'history',
  'history_prompt_references',
  'smart_sets',
  'search_history',
  'providers',
  'doubao_web_daily_usage',
  'automation_audit',
  'workbench_sessions',
  'generation_runs',
  'generated_assets',
  'cloud_sync_accounts',
  'cloud_entity_state',
  'cloud_sync_outbox',
  'cloud_sync_conflicts',
  'cloud_sync_usage_outbox',
  'prompts_fts',
] as const;

const DESIGN_SCHEME_REQUIRED_TABLES = [
  'design_scheme_meta',
  'design_scheme_migrations',
  'source_packages',
  'source_snapshots',
  'source_files',
  'design_schemes',
  'design_scheme_revisions',
  'design_scheme_source_bindings',
  'design_scheme_assets',
  'design_scheme_runs',
  'design_scheme_run_steps',
  'market_candidates',
  'share_packages',
] as const;

const LOCAL_ABSOLUTE_PATH = /(?:^|\s)(?:\/(?:Users|home|private|tmp|var|Volumes)\/|[A-Za-z]:[\\/])/;
const SECRET_VALUE =
  /(?:bearer\s+|(?:api|access|refresh)[_-]?key\s*[:=]|(?:api|access|refresh)[_-]?token\s*[:=]|sk-[A-Za-z0-9]|password\s*[:=])/i;
const PROMPT_BODY_COLUMNS = new Set([
  'content',
  'content_negative',
  'prompt_text',
  'negative_text',
  'excerpt',
  'final_prompt',
  'base_prompt',
  'user_prompt',
  'document_json',
]);
const INTERNAL_TABLE_PREFIXES = ['sqlite_', 'prompts_fts_'];

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function jsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value)) return value.toString('hex');
  return value;
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'prompts_fts_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function canonicalDatabasePayload(db: Database.Database): string {
  const tables = tableNames(db);
  const objects = (
    db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'prompts_fts_%' ORDER BY type, name",
      )
      .all() as Array<Record<string, unknown>>
  ).map((row) => ({
    type: row.type,
    name: row.name,
    tbl_name: row.tbl_name,
    sql: row.sql,
  }));
  const data = tables.map((table) => {
    const columns = (
      db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>
    ).map((column) => column.name);
    const rows = (
      db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Array<Record<string, unknown>>
    ).map((row) => columns.map((column) => jsonValue(row[column])));
    return { table, columns, rows };
  });
  return JSON.stringify({ objects, data });
}

export function canonicalFixtureHash(db: Database.Database): string {
  return sha256(canonicalDatabasePayload(db));
}

export function fileFixtureHash(path: string): string {
  return sha256(readFileSync(path));
}

function prepareDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
  const db = new DatabaseConstructor(path);
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = OFF');
  return db;
}

function finishDatabase(db: Database.Database, path: string): void {
  db.pragma('user_version = 20');
  db.exec('VACUUM');
  db.close();
  if (!existsSync(path)) throw new Error(`D03-A fixture was not written: ${path}`);
}

function insertLegacyRows(db: Database.Database): void {
  const t = D03A_FIXED_TIME;
  db.exec(`
    INSERT INTO folders (id, name, parent_id, sort_order, created_at) VALUES
      ('folder-root', '素材 / 研究', NULL, 0, ${t}),
      ('folder-child', '日本語・长路径归档', 'folder-root', 1, ${t + 1});
    INSERT INTO tags (id, name, tag_group, color, created_at) VALUES
      ('tag-visual', '视觉 / 風景', 'synthetic', '#6b7280', ${t}),
      ('tag-archive', '归档・Archive', 'synthetic', '#9ca3af', ${t + 1});
    INSERT INTO prompts (
      id, title, description, content, content_negative, folder_id, model_id, params,
      preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at,
      source, source_url, created_at, updated_at, deleted_at
    ) VALUES
      ('prompt-alpha', '雾中的庭院 / 霧の庭', 'synthetic metadata α', '${D03A_REDACTED_PROMPT}', NULL,
       'folder-child', 'synthetic-model', '{"schemaVersion":1}',
       '${D03A_LONG_RELATIVE_PATH}', 4, 1, 0, 3, ${t + 20}, 'fixture',
       'https://example.invalid/synthetic/prompt-alpha', ${t}, ${t + 20}, NULL),
      ('prompt-deleted', '归档提示词', 'synthetic deleted metadata', '${D03A_REDACTED_PROMPT}', NULL,
       'folder-root', 'synthetic-model', '{"schemaVersion":1}',
       'fixture-assets/archive/deleted-preview.png', 0, 0, NULL, 0, NULL, 'fixture',
       NULL, ${t + 2}, ${t + 3}, ${t + 4});
    INSERT INTO prompt_tags (prompt_id, tag_id) VALUES ('prompt-alpha', 'tag-visual'), ('prompt-deleted', 'tag-archive');
    INSERT INTO smart_sets (id, name, query, sort_order, created_at, updated_at)
      VALUES ('smart-archive', '归档候选', 'synthetic', 0, ${t}, ${t + 1});
    INSERT INTO search_history (id, term, used_at) VALUES ('search-1', '日本語', ${t + 5});
    INSERT INTO providers (id, name, type, base_url, model, has_key, key_suffix, is_active, created_at, updated_at, managed_by)
      VALUES ('provider-synthetic', '脱敏本地 Provider', 'openai-compatible', 'https://example.invalid/provider', 'synthetic-model', 0, NULL, 1, ${t}, ${t + 1}, NULL);
    INSERT INTO doubao_web_daily_usage (usage_scope, usage_date, request_count, updated_at)
      VALUES ('synthetic-scope', '2023-11-14', 0, ${t});
    INSERT INTO automation_audit (
      at, caller, action, prompt_text, params_json, estimated_points, actual_points, approved_via, status, job_id
    ) VALUES (${t + 30}, 'fixture-agent', 'metadata-only', NULL, '{"fixture":true}', 0, 0, 'test-fixture', 'not_run', 'job-synthetic');
    INSERT INTO workbench_sessions (id, title, created_at, updated_at, archived_at, deleted_at)
      VALUES ('session-archived', '归档会话 / Archived', ${t}, ${t + 40}, ${t + 40}, NULL),
             ('session-active', '活动会话 metadata', ${t + 1}, ${t + 2}, NULL, NULL);
    INSERT INTO generation_runs (
      id, run_kind, workbench_session_id, provider_id, model, user_prompt,
      base_prompt, final_prompt, params_json, prompt_snapshot_json, status,
      actual_cost, duration_ms, created_at, finished_at
    ) VALUES ('run-historical', 'free_generation', 'session-archived', 'provider-synthetic',
      'synthetic-model', '${D03A_REDACTED_PROMPT}', '${D03A_REDACTED_PROMPT}',
      '${D03A_REDACTED_PROMPT}', '{"schemaVersion":1}', '{"fixture":true}', 'success',
      0, 900, ${t + 45}, ${t + 46});
    INSERT INTO generated_assets (
      id, run_id, position, status, media_path, mime_type, width, height,
      file_size, checksum, created_at
    ) VALUES ('asset-historical', 'run-historical', 0, 'available',
      'fixture-assets/history/historical.png', 'image/png', 64, 64, 0,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', ${t + 46});
    INSERT INTO history (
      id, prompt_id, provider_id, model, prompt_text, negative_text, params, status,
      error_code, error_message, image_path, cost, duration_ms, created_at, cost_unit
    ) VALUES
      ('history-success', 'prompt-alpha', 'provider-synthetic', 'synthetic-model', '${D03A_REDACTED_PROMPT}', NULL,
       '{"schemaVersion":1}', 'success', NULL, NULL,
       'fixture-assets/history/success.png', 0, 1200, ${t + 50}, 'point'),
      ('history-missing', NULL, 'provider-synthetic', 'synthetic-model', '${D03A_REDACTED_PROMPT}', NULL,
       '{"schemaVersion":1}', 'failed', 'FIXTURE_ONLY', 'synthetic failure; no provider call',
       NULL, 0, 0, ${t + 51}, 'point');
    INSERT INTO history_prompt_references (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
      VALUES ('history-success', 'prompt-alpha', '雾中的庭院 / 霧の庭', '${D03A_REDACTED_PROMPT}', 'full', 0);
    INSERT INTO cloud_sync_accounts (
      owner_id, username, device_id, device_name, platform, client_version, active, enabled,
      cursor, bootstrap_completed_at, last_sync_at, last_error, created_at, updated_at
    ) VALUES
      ('owner-enabled', 'synthetic-enabled', 'device-enabled', 'Synthetic Mac', 'macos', '2.1-fixture', 1, 1,
       '42', ${t + 60}, ${t + 61}, NULL, ${t}, ${t + 61}),
      ('owner-paused', 'synthetic-paused', 'device-paused', 'Synthetic Windows', 'windows', '2.1-fixture', 0, 0,
       '0', ${t + 62}, NULL, 'paused synthetic evidence', ${t + 2}, ${t + 62}),
      ('owner-unset', 'synthetic-unset', 'device-unset', 'Synthetic Linux', 'linux', '2.1-fixture', 0, 0,
       '0', NULL, NULL, NULL, ${t + 3}, ${t + 3});
    INSERT INTO cloud_entity_state (
      owner_id, entity_type, local_id, cloud_id, cloud_version, last_synced_hash,
      remote_snapshot_json, sync_status, last_synced_at
    ) VALUES ('owner-paused', 'prompt', 'prompt-alpha', 'cloud-alpha', 7, 'synthetic-hash',
      '{"fixture":true}', 'conflict', ${t + 63});
    INSERT INTO cloud_sync_outbox (
      mutation_id, owner_id, entity_type, entity_id, operation, base_version,
      payload_json, created_at, attempt_count, next_attempt_at, last_error
    ) VALUES
      ('mutation-update', 'owner-paused', 'prompt', 'prompt-alpha', 'update', 6,
       '{"fixture":true,"redacted":true}', ${t + 64}, 1, ${t + 65}, 'synthetic retry'),
      ('mutation-tombstone', 'owner-paused', 'prompt', 'prompt-deleted', 'delete', 3,
       '{"fixture":true,"tombstone":true}', ${t + 66}, 0, 0, NULL);
    INSERT INTO cloud_sync_conflicts (
      id, owner_id, entity_type, entity_id, mutation_id, base_version,
      local_snapshot_json, remote_snapshot_json, detected_at, resolved_at, resolution
    ) VALUES
      ('conflict-active', 'owner-paused', 'prompt', 'prompt-alpha', 'mutation-update', 6,
       '{"fixture":"local"}', '{"fixture":"remote"}', ${t + 67}, NULL, NULL),
      ('conflict-resolved', 'owner-paused', 'prompt', 'prompt-deleted', 'mutation-tombstone', 3,
       '{"fixture":"local"}', '{"fixture":"remote"}', ${t + 68}, ${t + 69}, 'duplicate');
    INSERT INTO cloud_sync_usage_outbox (
      event_id, owner_id, prompt_id, action, created_at, attempt_count, next_attempt_at, last_error
    ) VALUES ('usage-event', 'owner-paused', 'prompt-alpha', 'copy', ${t + 70}, 1, ${t + 71}, 'synthetic retry');
  `);

  // Deliberately stale: one row is absent and the existing row has drifted metadata.
  db.prepare(
    'INSERT INTO prompts_fts (rowid, title, description, content, tags_index) VALUES (?, ?, ?, ?, ?)',
  ).run(1, 'stale fixture title', 'stale fixture description', D03A_REDACTED_PROMPT, 'stale-tag');
}

function buildLegacyDatabase(path: string): void {
  const db = prepareDatabase(path);
  try {
    db.exec(SCHEMA_SQL);
    addAutomationAudit(db);
    addAccountManagement(db);
    addDailyUsage(db);
    addGenerationLedger(db);
    addCostPoints(db);
    addCloudSync(db);
    addCloudSnapshot(db);
    addCloudUsageOutbox(db);
    removeWukongProvider(db);
    insertLegacyRows(db);
    finishDatabase(db, path);
  } catch (error) {
    if (db.open) db.close();
    throw error;
  }
}

function buildDesignSchemeDatabase(path: string): void {
  const db = prepareDatabase(path);
  try {
    const t = D03A_FIXED_TIME;
    db.exec(DESIGN_SCHEME_DB_BOOTSTRAP_SQL);
    db.exec(DESIGN_SCHEME_SOURCE_TABLES_SQL);
    db.exec(DESIGN_SCHEME_CORE_TABLES_SQL);
    db.exec(DESIGN_SCHEME_RUN_TABLES_SQL);
    db.exec(DESIGN_SCHEME_EVALUATION_TABLES_SQL);
    db.exec(MARKET_CANDIDATE_TABLES_SQL);
    db.exec(SHARE_PACKAGE_TABLES_SQL);
    db.exec(`
      INSERT INTO design_scheme_meta (key, value) VALUES
        ('namespace', 'v0.3.2-design-scheme'),
        ('schema_version', '4'),
        ('created_at', '${t}');
      INSERT INTO design_scheme_migrations (version, name, applied_at) VALUES
        (1, '0001_design_scheme_domain', ${t}),
        (2, '0002_design_scheme_evaluations', ${t + 1}),
        (3, '0003_market_candidates', ${t + 2}),
        (4, '0004_share_packages', ${t + 3});
      INSERT INTO source_packages (id, kind, repository_url, license, created_at)
        VALUES ('pkg_synthetic_scheme', 'github', 'https://example.invalid/synthetic-scheme', 'MIT', ${t});
      INSERT INTO source_snapshots (id, package_id, ref, commit_hash, content_hash, total_bytes, scan_json, created_at)
        VALUES ('snapshot_synthetic_scheme', 'pkg_synthetic_scheme', 'fixture-v4',
          '0000000000000000000000000000000000000000',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0,
          '{"fixture":true,"scripts":"excluded"}', ${t + 1});
      INSERT INTO source_files (snapshot_id, path, kind, content_hash, size_bytes, store_key, text_content)
        VALUES ('snapshot_synthetic_scheme', '${D03A_LONG_RELATIVE_PATH}', 'text',
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 0,
          'fixture-schemes/pkg_synthetic_scheme/docs-description.md', NULL);
      INSERT INTO design_schemes (
        id, name, summary, status, source_presentation, source_label,
        current_revision_id, working_draft_revision_id, cover_asset_id, fidelity,
        created_at, updated_at, deleted_at
      ) VALUES ('scheme_synthetic_v4', '合成方案 / Synthetic scheme',
        'metadata-only v4 scaffold', 'draft', 'skill', 'synthetic source',
        'revision_synthetic_v4', NULL, 'asset_synthetic_cover', 'adapted', ${t}, ${t + 4}, NULL);
      INSERT INTO design_scheme_revisions (
        revision_id, scheme_id, schema_version, document_json, created_by, created_at
      ) VALUES ('revision_synthetic_v4', 'scheme_synthetic_v4', 1, '{}', 'import', ${t + 1});
      INSERT INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
        VALUES ('revision_synthetic_v4', 'snapshot_synthetic_scheme', 'normative');
      INSERT INTO design_scheme_assets (id, revision_id, store_key, role, origin, license, created_at)
        VALUES ('asset_synthetic_cover', 'revision_synthetic_v4', 'fixture-schemes/cover.png', 'cover', 'repository', 'MIT', ${t + 2});
      INSERT INTO design_scheme_runs (run_id, revision_id, mode, status, policy_json, provider_json, created_at, completed_at)
        VALUES ('run_synthetic_blocked', 'revision_synthetic_v4', 'trial', 'blocked',
          '{"spend":"disabled","fixture":true}', NULL, ${t + 3}, ${t + 4});
      INSERT INTO design_scheme_run_steps (run_id, step_id, status, input_json, output_json, started_at, completed_at)
        VALUES ('run_synthetic_blocked', 'validate', 'failed', '{}', '{"reason":"fixture scaffold"}', ${t + 3}, ${t + 4});
      INSERT INTO market_candidates (candidate_id, query, repository_url, metadata_json, created_at, expires_at)
        VALUES ('candidate_synthetic', 'synthetic-scheme', 'https://example.invalid/synthetic-scheme', '{"fixture":true}', ${t}, ${t + 1000});
      INSERT INTO share_packages (package_id, scheme_id, manifest_json, path, created_at)
        VALUES ('share_synthetic', 'scheme_synthetic_v4', '{"fixture":true}', 'fixture-packages/synthetic-v4.design', ${t + 5});
    `);
    db.pragma('user_version = 4');
    db.exec('VACUUM');
    db.close();
  } catch (error) {
    if (db.open) db.close();
    throw error;
  }
}

function artifactFor(kind: D03AFixtureKind, path: string): D03AFixtureArtifact {
  const manifest = kind === 'legacy-v2.1' ? D03A_LEGACY_MANIFEST : D03A_DESIGN_SCHEME_MANIFEST;
  const db = new DatabaseConstructor(path, { readonly: true });
  const canonicalHash = canonicalFixtureHash(db);
  db.close();
  return {
    kind,
    path,
    manifest: {
      ...manifest,
      canonicalHash,
      fileHash: fileFixtureHash(path),
    },
    canonicalHash,
    fileHash: fileFixtureHash(path),
  };
}

export function buildD03ALegacyFixture(root: string): D03AFixtureArtifact {
  const path = join(root, 'd03-a-legacy-v2.1.db');
  buildLegacyDatabase(path);
  return artifactFor('legacy-v2.1', path);
}

export function buildD03ADesignSchemeFixture(root: string): D03AFixtureArtifact {
  const path = join(root, 'd03-a-design-scheme-v4.db');
  buildDesignSchemeDatabase(path);
  return artifactFor('design-scheme-v4', path);
}

export function buildD03AFixtureCorpus(root: string): readonly D03AFixtureArtifact[] {
  return [buildD03ALegacyFixture(root), buildD03ADesignSchemeFixture(root)];
}

export function assertAllowedFixtureSource(sourcePath: string): void {
  const normalized = sourcePath.replaceAll('\\', '/').toLowerCase();
  if (
    normalized.includes('/release/') ||
    normalized.includes('/.drizzle-pull/') ||
    normalized.endsWith('/.drizzle-pull')
  ) {
    throw new Error(`D03-A fixture source is forbidden: ${sourcePath}`);
  }
}

function dataValues(
  db: Database.Database,
): Array<{ table: string; column: string; value: string }> {
  const values: Array<{ table: string; column: string; value: string }> = [];
  for (const table of tableNames(db)) {
    if (INTERNAL_TABLE_PREFIXES.some((prefix) => table.startsWith(prefix))) continue;
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
      name: string;
    }>;
    for (const row of db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Array<
      Record<string, unknown>
    >) {
      for (const column of columns) {
        const value = row[column.name];
        if (typeof value === 'string') values.push({ table, column: column.name, value });
      }
    }
  }
  return values;
}

function scanFtsDrift(db: Database.Database): string[] {
  if (!tableNames(db).includes('prompts')) return [];
  const drift: string[] = [];
  const prompts = db
    .prepare('SELECT rowid, id, title, description, content FROM prompts ORDER BY rowid')
    .all() as Array<{
    rowid: number;
    id: string;
    title: string;
    description: string | null;
    content: string;
  }>;
  const ftsRows = db
    .prepare('SELECT rowid, title, description, content FROM prompts_fts ORDER BY rowid')
    .all() as Array<{ rowid: number; title: string; description: string; content: string }>;
  const byRowid = new Map(ftsRows.map((row) => [row.rowid, row]));
  for (const prompt of prompts) {
    const fts = byRowid.get(prompt.rowid);
    if (!fts) drift.push(`missing:${prompt.id}`);
    else if (
      fts.title !== prompt.title ||
      fts.description !== (prompt.description ?? '') ||
      fts.content !== prompt.content
    )
      drift.push(`stale:${prompt.id}`);
  }
  for (const row of ftsRows)
    if (!prompts.some((prompt) => prompt.rowid === row.rowid))
      drift.push(`orphan:${String(row.rowid)}`);
  return drift;
}

export function scanD03AFixture(
  db: Database.Database,
  kind: D03AFixtureKind,
  sourcePath?: string,
): D03AScanResult {
  const tables = tableNames(db);
  const requiredTables =
    kind === 'legacy-v2.1' ? LEGACY_REQUIRED_TABLES : DESIGN_SCHEME_REQUIRED_TABLES;
  const missingTables = requiredTables.filter((table) => !tables.includes(table));
  const expectedUserVersion =
    kind === 'legacy-v2.1' ? D03A_LEGACY_USER_VERSION : D03A_DESIGN_SCHEME_USER_VERSION;
  const versionMatches =
    Number(db.pragma('user_version', { simple: true })) === expectedUserVersion;
  const sensitiveMatches: string[] = [];
  const absolutePathMatches: string[] = [];
  const redactionViolations: string[] = [];
  for (const { table, column, value } of dataValues(db)) {
    if (SECRET_VALUE.test(value)) sensitiveMatches.push(`${table}.${column}`);
    if (LOCAL_ABSOLUTE_PATH.test(value)) absolutePathMatches.push(`${table}.${column}`);
    if (
      PROMPT_BODY_COLUMNS.has(column) &&
      kind === 'legacy-v2.1' &&
      ['content', 'prompt_text', 'excerpt'].includes(column) &&
      value !== D03A_REDACTED_PROMPT
    ) {
      redactionViolations.push(`${table}.${column}`);
    }
  }
  const sourceViolations: string[] = [];
  if (sourcePath) {
    try {
      assertAllowedFixtureSource(sourcePath);
    } catch {
      sourceViolations.push(sourcePath);
    }
  }
  const foreignKeyViolations = db.pragma('foreign_key_check') as readonly unknown[];
  const integrity = String(db.pragma('integrity_check', { simple: true }));
  const ftsDrift = kind === 'legacy-v2.1' ? scanFtsDrift(db) : [];
  const canonicalHash = canonicalFixtureHash(db);
  const passed =
    versionMatches &&
    integrity === 'ok' &&
    foreignKeyViolations.length === 0 &&
    missingTables.length === 0 &&
    sensitiveMatches.length === 0 &&
    absolutePathMatches.length === 0 &&
    redactionViolations.length === 0 &&
    sourceViolations.length === 0;
  return {
    kind,
    userVersion: Number(db.pragma('user_version', { simple: true })),
    integrity,
    foreignKeyViolations,
    tables,
    missingTables,
    sensitiveMatches,
    absolutePathMatches,
    redactionViolations,
    ftsDrift,
    sourceViolations,
    canonicalHash,
    passed,
  };
}

export function scanD03AFixtureFile(artifact: D03AFixtureArtifact): D03AScanResult {
  const db = new DatabaseConstructor(artifact.path, { readonly: true });
  try {
    return scanD03AFixture(db, artifact.kind, artifact.path);
  } finally {
    db.close();
  }
}

export function createD03ATestRoot(prefix = 'musefold-d03-a-'): string {
  // A failed or interrupted run may leave its backup directory behind. Keep each
  // invocation isolated while the corpus contents and logical hashes stay fixed.
  return mkdtempSync(join('/tmp', prefix));
}

export function removeD03ATestRoot(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
