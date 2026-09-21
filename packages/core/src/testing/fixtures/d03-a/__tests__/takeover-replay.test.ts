import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  D03A_FIXED_TIME,
  D03A_LEGACY_USER_VERSION,
  D03A_LONG_RELATIVE_PATH,
  D03A_REDACTED_PROMPT,
  buildD03ADesignSchemeFixture,
  buildD03ALegacyFixture,
  canonicalFixtureHash,
  createD03ATestRoot,
  removeD03ATestRoot,
} from '..';
import { runDesignSchemeDbMigrations } from '../../../../db/design-scheme/migrations';
import { DESIGN_SCHEME_DB_SCHEMA_VERSION } from '../../../../db/design-scheme/schema';

const roots: string[] = [];
const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    if (db.open) db.close();
  }
  for (const root of roots.splice(0)) removeD03ATestRoot(root);
});

function openFixture(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');
  openDatabases.push(db);
  return db;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
      .get(table),
  );
}

const retainedTables = [
  'folders',
  'prompts',
  'tags',
  'prompt_tags',
  'smart_sets',
  'search_history',
  'providers',
  'doubao_web_daily_usage',
  'automation_audit',
  'workbench_sessions',
  'cloud_sync_accounts',
  'cloud_entity_state',
  'cloud_sync_outbox',
  'cloud_sync_conflicts',
  'cloud_sync_usage_outbox',
  'generation_runs',
  'generated_assets',
] as const;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
type OriginalTable = { columns: string[]; rows: Record<string, unknown>[] };

function originalTables(db: Database.Database, tables: readonly string[]) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      {
        columns: (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map(
          (column) => column.name,
        ),
        rows: db.prepare(`SELECT * FROM ${quote(table)}`).all() as Record<string, unknown>[],
      },
    ]),
  ) satisfies Record<string, OriginalTable>;
}

function expectOriginalRows(db: Database.Database, original: Record<string, OriginalTable>) {
  const sorted = (rows: Record<string, unknown>[]) => rows.map((row) => JSON.stringify(row)).sort();
  for (const [table, before] of Object.entries(original)) {
    let rows = db
      .prepare(`SELECT ${before.columns.map(quote).join(',')} FROM ${quote(table)}`)
      .all() as Record<string, unknown>[];
    // Historical rows legitimately add runs/assets; their migration is asserted separately.
    if (table === 'generation_runs' || table === 'generated_assets') {
      const originalIds = new Set(before.rows.map((row) => row.id));
      rows = rows.filter((row) => originalIds.has(row.id));
    }
    expect(sorted(rows), `${table}: every original column`).toEqual(sorted(before.rows));
  }
}

function expectHealthyLatest(db: Database.Database) {
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(db.pragma('foreign_key_check')).toEqual([]);
  expect(db.pragma('user_version', { simple: true })).toBe(D03A_LEGACY_USER_VERSION);
  expect(
    db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all(),
  ).toEqual(
    DESKTOP_MIGRATIONS.map((migration) => ({
      hash: migration.hash,
      created_at: migration.folderMillis,
    })),
  );
}

/** Persist only synthetic database hashes/counters in the captured test output. */
function recordReplay(caseId: string, phase: string, db: Database.Database) {
  const foreignKeys = db.pragma('foreign_key_check');
  if (!Array.isArray(foreignKeys)) throw new Error('Expected SQLite foreign key result rows');
  console.info(
    'D03_REPLAY',
    JSON.stringify({
      caseId,
      phase,
      provenance: 'synthetic-D03-A',
      hash: canonicalFixtureHash(db),
      userVersion: db.pragma('user_version', { simple: true }),
      integrity: db.pragma('integrity_check', { simple: true }),
      foreignKeyViolations: foreignKeys.length,
    }),
  );
}

describe('D03-B disposable takeover and replay', () => {
  it('replays the D03-A legacy fixture with equivalent data, ownership, consent, FTS, and history', () => {
    const root = createD03ATestRoot('musefold-d03-b-legacy-');
    roots.push(root);
    const artifact = buildD03ALegacyFixture(root);
    const db = openFixture(artifact.path);
    const backupDir = join(root, 'backups');

    const result = takeoverDesktopDatabase(db, {
      backupDir,
      now: () => new Date(D03A_FIXED_TIME),
    });

    expect(result.mode).toBe('adopted');
    expect(result.backupPath).toBeTruthy();
    expect(existsSync(result.backupPath as string)).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(D03A_LEGACY_USER_VERSION);
    expect(db.pragma('foreign_key_check')).toEqual([]);

    expect(
      Object.fromEntries(
        [
          'folders',
          'prompts',
          'tags',
          'prompt_tags',
          'workbench_sessions',
          'generation_runs',
          'generated_assets',
          'cloud_sync_accounts',
          'cloud_entity_state',
          'cloud_sync_outbox',
          'cloud_sync_conflicts',
          'cloud_sync_usage_outbox',
        ].map((table) => [table, count(db, table)]),
      ),
    ).toEqual({
      folders: 2,
      prompts: 2,
      tags: 2,
      prompt_tags: 2,
      workbench_sessions: 2,
      generation_runs: 3,
      generated_assets: 2,
      cloud_sync_accounts: 3,
      cloud_entity_state: 1,
      cloud_sync_outbox: 2,
      cloud_sync_conflicts: 2,
      cloud_sync_usage_outbox: 1,
    });

    expect(
      db
        .prepare(
          `SELECT owner_id, active, enabled, consent_state, consent_decided_at
           FROM cloud_sync_accounts ORDER BY owner_id`,
        )
        .all(),
    ).toEqual([
      {
        owner_id: 'owner-enabled',
        active: 1,
        enabled: 1,
        consent_state: 'enabled',
        consent_decided_at: D03A_FIXED_TIME + 61,
      },
      {
        owner_id: 'owner-paused',
        active: 0,
        enabled: 0,
        consent_state: 'paused',
        consent_decided_at: D03A_FIXED_TIME + 62,
      },
      {
        owner_id: 'owner-unset',
        active: 0,
        enabled: 0,
        consent_state: 'unset',
        consent_decided_at: null,
      },
    ]);

    expect(db.prepare('SELECT id, owner_id, kind FROM local_workspaces ORDER BY id').all()).toEqual(
      [
        { id: 'account:owner-paused', owner_id: 'owner-paused', kind: 'account' },
        { id: 'local-only-legacy', owner_id: null, kind: 'local_only' },
      ],
    );
    for (const table of [
      'cloud_entity_state',
      'cloud_sync_outbox',
      'cloud_sync_conflicts',
      'cloud_sync_usage_outbox',
    ]) {
      expect(db.prepare(`SELECT DISTINCT workspace_id FROM ${table}`).all(), table).toEqual([
        { workspace_id: 'account:owner-paused' },
      ]);
    }

    expect(
      db.prepare("SELECT preview_image_path FROM prompts WHERE id = 'prompt-alpha'").get(),
    ).toEqual({
      preview_image_path: D03A_LONG_RELATIVE_PATH,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM prompts_fts').get()).toEqual({ count: 2 });
    expect(
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM folders WHERE workspace_id = 'local-only-legacy') AS folders,
             (SELECT COUNT(*) FROM prompts WHERE workspace_id = 'local-only-legacy') AS prompts,
             (SELECT COUNT(*) FROM tags WHERE workspace_id = 'local-only-legacy') AS tags,
             (SELECT COUNT(*) FROM prompt_tags WHERE workspace_id = 'local-only-legacy') AS prompt_tags`,
        )
        .get(),
    ).toEqual({ folders: 2, prompts: 2, tags: 2, prompt_tags: 2 });
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM prompts_fts WHERE prompts_fts MATCH 'synthetic'")
        .get(),
    ).toEqual({ count: 2 });
    const promptRow = db
      .prepare("SELECT rowid, title, content FROM prompts WHERE id = 'prompt-alpha'")
      .get() as { rowid: number; title: string; content: string };
    expect(
      db
        .prepare('SELECT title, content, tags_index FROM prompts_fts WHERE rowid = ?')
        .get(promptRow.rowid),
    ).toMatchObject({
      title: promptRow.title,
      content: D03A_REDACTED_PROMPT,
      tags_index: expect.stringContaining('视觉'),
    });

    expect(db.prepare('SELECT id, media_path FROM generated_assets ORDER BY id').all()).toEqual([
      { id: 'asset-historical', media_path: 'fixture-assets/history/historical.png' },
      { id: 'history-success', media_path: 'fixture-assets/history/success.png' },
    ]);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM workbench_sessions WHERE archived_at IS NOT NULL')
        .get(),
    ).toEqual({ count: 1 });
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'history'").get(),
    ).toBeUndefined();
    expect(tableExists(db, 'design_schemes')).toBe(false);
  });

  it('opens the VACUUM INTO snapshot and restores it through the same takeover path', () => {
    const root = createD03ATestRoot('musefold-d03-b-backup-');
    roots.push(root);
    const artifact = buildD03ALegacyFixture(root);
    const db = openFixture(artifact.path);
    const result = takeoverDesktopDatabase(db, {
      backupDir: join(root, 'backups'),
      now: () => new Date(D03A_FIXED_TIME),
    });
    const restoredPath = join(root, 'restored.db');
    copyFileSync(result.backupPath as string, restoredPath);

    const restored = openFixture(restoredPath);
    expect(canonicalFixtureHash(restored)).toBe(artifact.canonicalHash);
    expect(restored.pragma('user_version', { simple: true })).toBe(D03A_LEGACY_USER_VERSION);
    expect(restored.prepare('SELECT COUNT(*) AS count FROM history').get()).toEqual({ count: 2 });

    expect(takeoverDesktopDatabase(restored).mode).toBe('adopted');
    expect(restored.prepare('SELECT COUNT(*) AS count FROM generation_runs').get()).toEqual({
      count: 3,
    });
    expect(restored.prepare('SELECT COUNT(*) AS count FROM generated_assets').get()).toEqual({
      count: 2,
    });
    expect(restored.pragma('foreign_key_check')).toEqual([]);
  });

  it('rolls back the marker and every migration change when a takeover migration fails', () => {
    const root = createD03ATestRoot('musefold-d03-b-rollback-');
    roots.push(root);
    const artifact = buildD03ALegacyFixture(root);
    const db = openFixture(artifact.path);
    const beforeHash = canonicalFixtureHash(db);
    const beforeVersion = db.pragma('user_version', { simple: true });
    const originalLength = DESKTOP_MIGRATIONS.length;
    const lastMigration = DESKTOP_MIGRATIONS.at(-1);
    if (!lastMigration) throw new Error('D03-B requires a bundled desktop migration');
    DESKTOP_MIGRATIONS.push({
      sql: ['CREATE TABLE takeover_should_rollback (id TEXT PRIMARY KEY)', 'SELECT no_such_table'],
      bps: true,
      folderMillis: lastMigration.folderMillis + 1,
      hash: 'd03b-takeover-failure-test',
    });

    try {
      expect(() => takeoverDesktopDatabase(db)).toThrow(/no such (?:table|column)/);
      expect(canonicalFixtureHash(db)).toBe(beforeHash);
      expect(db.pragma('user_version', { simple: true })).toBe(beforeVersion);
      expect(tableExists(db, '__drizzle_migrations')).toBe(false);
      expect(tableExists(db, 'local_workspaces')).toBe(false);
      expect(tableExists(db, 'takeover_should_rollback')).toBe(false);
    } finally {
      DESKTOP_MIGRATIONS.splice(originalLength);
    }
  });

  it('replays the independent D03-A design-scheme v4 fixture into the current schema without merging databases', () => {
    const root = createD03ATestRoot('musefold-d03-b-design-');
    roots.push(root);
    const legacyArtifact = buildD03ALegacyFixture(root);
    const schemeArtifact = buildD03ADesignSchemeFixture(root);
    expect(schemeArtifact.path).not.toBe(legacyArtifact.path);

    const legacy = openFixture(legacyArtifact.path);
    expect(takeoverDesktopDatabase(legacy).mode).toBe('adopted');
    const scheme = openFixture(schemeArtifact.path);
    expect(scheme.pragma('user_version', { simple: true })).toBe(4);
    expect(scheme.prepare('SELECT COUNT(*) AS count FROM design_schemes').get()).toEqual({
      count: 1,
    });
    expect(tableExists(scheme, 'prompts')).toBe(false);
    expect(tableExists(legacy, 'design_schemes')).toBe(false);

    runDesignSchemeDbMigrations(scheme);

    expect(scheme.pragma('user_version', { simple: true })).toBe(DESIGN_SCHEME_DB_SCHEMA_VERSION);
    expect(
      scheme.prepare("SELECT value FROM design_scheme_meta WHERE key = 'schema_version'").get(),
    ).toEqual({ value: String(DESIGN_SCHEME_DB_SCHEMA_VERSION) });
    expect(scheme.prepare('SELECT version FROM design_schemes').get()).toEqual({ version: 1 });
    expect(scheme.prepare('SELECT COUNT(*) AS count FROM design_scheme_migrations').get()).toEqual({
      count: DESIGN_SCHEME_DB_SCHEMA_VERSION,
    });
    expect(scheme.prepare('SELECT COUNT(*) AS count FROM design_scheme_revisions').get()).toEqual({
      count: 1,
    });
    expect(scheme.prepare('SELECT COUNT(*) AS count FROM design_scheme_runs').get()).toEqual({
      count: 1,
    });
    expect(scheme.prepare('SELECT COUNT(*) AS count FROM design_scheme_assets').get()).toEqual({
      count: 1,
    });
  });
});

describe('D03.2/3 exact data preservation and failed backup recovery', () => {
  it('preserves every original column, including tombstones and retries, and leaves repeated takeover unchanged', () => {
    const root = createD03ATestRoot('musefold-d03-exact-');
    roots.push(root);
    const artifact = buildD03ALegacyFixture(root);
    const db = openFixture(artifact.path);
    const before = originalTables(db, retainedTables);
    recordReplay('exact-columns', 'before', db);
    const started = Math.floor(Date.now() / 1000) * 1000;
    takeoverDesktopDatabase(db, { backupDir: join(root, 'backups') });
    expectOriginalRows(db, before);
    expectHealthyLatest(db);
    for (const row of db.prepare('SELECT created_at,updated_at FROM local_workspaces').all() as {
      created_at: number;
      updated_at: number;
    }[]) {
      expect(row.created_at).toBeGreaterThanOrEqual(started);
      expect(row.created_at).toBeLessThanOrEqual(Date.now());
      expect(row.updated_at).toBe(row.created_at);
    }
    const migrated = canonicalFixtureHash(db);
    expect(takeoverDesktopDatabase(db, { backupDir: join(root, 'backups') })).toEqual({
      mode: 'noop',
      backupPath: null,
    });
    expect(canonicalFixtureHash(db)).toBe(migrated);
    expect(readdirSync(join(root, 'backups'))).toHaveLength(1);
    recordReplay('exact-columns', 'migrated-noop', db);
  });

  it('preserves every independent scheme field after a failed atomic step, upgrade and noop replay', () => {
    const root = createD03ATestRoot('musefold-d03-scheme-exact-');
    roots.push(root);
    const core = openFixture(buildD03ALegacyFixture(root).path);
    const coreBefore = canonicalFixtureHash(core);
    const scheme = openFixture(buildD03ADesignSchemeFixture(root).path);
    const tables = (
      scheme
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'
      AND name NOT LIKE 'sqlite_%' AND name NOT IN ('design_scheme_meta','design_scheme_migrations')
      ORDER BY name`)
        .all() as { name: string }[]
    ).map((row) => row.name);
    const before = originalTables(scheme, tables);
    const stableMeta = () =>
      scheme
        .prepare("SELECT * FROM design_scheme_meta WHERE key != 'schema_version' ORDER BY key")
        .all();
    const beforeMeta = stableMeta();
    const beforeJournal = scheme
      .prepare('SELECT * FROM design_scheme_migrations ORDER BY version')
      .all();
    const originalHash = canonicalFixtureHash(scheme);
    recordReplay('scheme-atomic', 'before', scheme);
    expect(() =>
      runDesignSchemeDbMigrations(scheme, [
        {
          version: 5,
          name: 'd03_failed_scheme_step',
          up(current) {
            current.exec(
              "CREATE TABLE scheme_should_rollback(id TEXT); UPDATE source_packages SET license='uncommitted fixture'; UPDATE design_scheme_meta SET value='uncommitted namespace' WHERE key='namespace'",
            );
            throw new Error('D03 scheme step interrupted');
          },
        },
      ]),
    ).toThrow('D03 scheme step interrupted');
    expect(canonicalFixtureHash(scheme)).toBe(originalHash);
    expect(scheme.pragma('user_version', { simple: true })).toBe(4);
    expect(tableExists(scheme, 'scheme_should_rollback')).toBe(false);
    recordReplay('scheme-atomic', 'rolled-back', scheme);
    runDesignSchemeDbMigrations(scheme);
    expectOriginalRows(scheme, before);
    expect(stableMeta()).toEqual(beforeMeta);
    expect(
      scheme
        .prepare('SELECT * FROM design_scheme_migrations WHERE version <= 4 ORDER BY version')
        .all(),
    ).toEqual(beforeJournal);
    expect(scheme.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(scheme.pragma('foreign_key_check')).toEqual([]);
    expect(scheme.pragma('user_version', { simple: true })).toBe(DESIGN_SCHEME_DB_SCHEMA_VERSION);
    const upgraded = canonicalFixtureHash(scheme);
    runDesignSchemeDbMigrations(scheme);
    expect(canonicalFixtureHash(scheme)).toBe(upgraded);
    expect(canonicalFixtureHash(core)).toBe(coreBefore);
    expect(tableExists(scheme, 'prompts')).toBe(false);
    expect(tableExists(core, 'design_schemes')).toBe(false);
    recordReplay('scheme-atomic', 'migrated-noop', scheme);
  });

  it('retains historical text, parameters, references, failures and both legacy cost units in the single ledger', () => {
    const root = createD03ATestRoot('musefold-d03-history-values-');
    roots.push(root);
    const db = openFixture(buildD03ALegacyFixture(root).path);
    db.prepare('UPDATE history SET negative_text=?,params=?,cost=?,cost_unit=? WHERE id=?').run(
      '避免过曝 / 露出',
      '{"schemaVersion":1,"quality":"high"}',
      12.5,
      'point',
      'history-success',
    );
    db.prepare('UPDATE history SET cost=?,cost_unit=? WHERE id=?').run(
      725,
      'cny_cent',
      'history-missing',
    );
    recordReplay('history-values', 'before', db);
    takeoverDesktopDatabase(db, { backupDir: join(root, 'backups') });
    const success = db
      .prepare("SELECT * FROM generation_runs WHERE id='history-success'")
      .get() as Record<string, unknown>;
    expect(success).toMatchObject({
      run_kind: 'free_generation',
      prompt_id: 'prompt-alpha',
      provider_id: 'provider-synthetic',
      model: 'synthetic-model',
      user_prompt: D03A_REDACTED_PROMPT,
      base_prompt: D03A_REDACTED_PROMPT,
      final_prompt: D03A_REDACTED_PROMPT,
      negative_prompt: '避免过曝 / 露出',
      params_json: '{"schemaVersion":1,"quality":"high"}',
      status: 'success',
      error_code: null,
      error_message: null,
      actual_cost: 12.5,
      duration_ms: 1200,
      created_at: D03A_FIXED_TIME + 50,
      finished_at: D03A_FIXED_TIME + 50,
      started_at: null,
    });
    expect(JSON.parse(success.prompt_snapshot_json as string)).toEqual({
      schemaVersion: 1,
      userPrompt: D03A_REDACTED_PROMPT,
      basePrompt: D03A_REDACTED_PROMPT,
      refinementInstruction: null,
      finalPrompt: D03A_REDACTED_PROMPT,
      negativePrompt: '避免过曝 / 露出',
      promptReferences: [
        {
          promptId: 'prompt-alpha',
          title: '雾中的庭院 / 霧の庭',
          excerpt: D03A_REDACTED_PROMPT,
          scope: 'full',
        },
      ],
    });
    expect(
      db.prepare("SELECT * FROM generated_assets WHERE id='history-success'").get(),
    ).toMatchObject({
      run_id: 'history-success',
      position: 0,
      status: 'available',
      media_path: 'fixture-assets/history/success.png',
      created_at: D03A_FIXED_TIME + 50,
    });
    expect(
      db.prepare("SELECT * FROM generation_runs WHERE id='history-missing'").get(),
    ).toMatchObject({
      prompt_id: null,
      provider_id: 'provider-synthetic',
      model: 'synthetic-model',
      user_prompt: D03A_REDACTED_PROMPT,
      status: 'failed',
      error_code: 'FIXTURE_ONLY',
      error_message: 'synthetic failure; no provider call',
      actual_cost: 7.25,
      created_at: D03A_FIXED_TIME + 51,
      finished_at: D03A_FIXED_TIME + 51,
    });
    expect(
      db.prepare("SELECT * FROM generated_assets WHERE run_id='history-missing'").all(),
    ).toEqual([]);
    expectHealthyLatest(db);
    recordReplay('history-values', 'migrated', db);
  });

  it.each(['directory', 'vacuum'] as const)(
    'a real %s backup failure leaves the original intact and permits retry',
    (phase) => {
      const root = createD03ATestRoot('musefold-d03-backup-fault-');
      roots.push(root);
      const db = openFixture(buildD03ALegacyFixture(root).path);
      const beforeHash = canonicalFixtureHash(db);
      const before = originalTables(db, retainedTables);
      const backupDir = join(root, 'backups');
      const occupiedPaths: string[] = [];
      recordReplay(`backup-${phase}`, 'before', db);
      if (phase === 'directory') writeFileSync(backupDir, 'owned test file prevents mkdir');
      else {
        mkdirSync(backupDir);
        const stamp = new Date(D03A_FIXED_TIME).toISOString().replace(/[:.]/g, '-');
        // Both candidates are nonempty valid databases; VACUUM must preserve them.
        for (const suffix of ['', `-${D03A_FIXED_TIME}`]) {
          const path = join(backupDir, `db-v25-takeover-${stamp}${suffix}.db`);
          const occupied = new Database(path);
          try {
            occupied.exec(
              "CREATE TABLE occupied(value TEXT); INSERT INTO occupied VALUES ('preserve fixture')",
            );
          } finally {
            occupied.close();
          }
          occupiedPaths.push(path);
        }
      }
      const now = vi.spyOn(Date, 'now').mockReturnValue(D03A_FIXED_TIME);
      try {
        expect(() =>
          takeoverDesktopDatabase(db, { backupDir, now: () => new Date(D03A_FIXED_TIME) }),
        ).toThrow(phase === 'directory' ? /EEXIST|ENOTDIR/ : /already exists/);
      } finally {
        now.mockRestore();
      }
      expect(canonicalFixtureHash(db)).toBe(beforeHash);
      expect(db.pragma('user_version', { simple: true })).toBe(D03A_LEGACY_USER_VERSION);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(tableExists(db, '__drizzle_migrations')).toBe(false);
      recordReplay(`backup-${phase}`, 'rolled-back', db);
      for (const path of occupiedPaths) {
        const occupied = new Database(path, { readonly: true });
        try {
          expect(occupied.prepare('SELECT value FROM occupied').get()).toEqual({
            value: 'preserve fixture',
          });
          expect(occupied.pragma('integrity_check', { simple: true })).toBe('ok');
        } finally {
          occupied.close();
        }
      }
      rmSync(backupDir, { recursive: true, force: true });
      expect(takeoverDesktopDatabase(db, { backupDir }).mode).toBe('adopted');
      expectOriginalRows(db, before);
      expectHealthyLatest(db);
      recordReplay(`backup-${phase}`, 'recovered', db);
    },
  );

  it.each(['after-backup', 'after-writes', 'verification'] as const)(
    '%s failure rolls back the original; its real snapshot and original both upgrade after removing the fault',
    (phase) => {
      const root = createD03ATestRoot('musefold-d03-transaction-fault-');
      roots.push(root);
      const db = openFixture(buildD03ALegacyFixture(root).path);
      const beforeHash = canonicalFixtureHash(db);
      const before = originalTables(db, retainedTables);
      const backupDir = join(root, 'backups');
      const originalMigrations = [...DESKTOP_MIGRATIONS];
      recordReplay(`transaction-${phase}`, 'before', db);
      const last = originalMigrations.at(-1);
      if (!last || !originalMigrations[1]) throw new Error('Expected inline pending migrations');
      try {
        if (phase === 'after-backup') {
          // The backup has completed; fail the first pending statement after the baseline marker.
          DESKTOP_MIGRATIONS[1] = {
            ...originalMigrations[1],
            sql: ['SELECT missing_d03_fault_column'],
          };
        } else {
          DESKTOP_MIGRATIONS.push({
            bps: true,
            folderMillis: last.folderMillis + 1,
            hash: `d03-fault-${phase}`,
            sql: [
              'CREATE TABLE d03_partial_write (id TEXT PRIMARY KEY)',
              "UPDATE prompts SET content='intentional uncommitted fixture mutation'",
              phase === 'verification'
                ? 'DROP TABLE smart_sets'
                : 'SELECT missing_d03_fault_column',
            ],
          });
        }
        expect(() => takeoverDesktopDatabase(db, { backupDir })).toThrow(
          phase === 'verification' ? /缺少必需表 smart_sets/ : /missing_d03_fault_column/,
        );
        expect(canonicalFixtureHash(db)).toBe(beforeHash);
        expect(db.pragma('user_version', { simple: true })).toBe(D03A_LEGACY_USER_VERSION);
        expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
        expect(tableExists(db, '__drizzle_migrations')).toBe(false);
        expect(tableExists(db, 'd03_partial_write')).toBe(false);
        recordReplay(`transaction-${phase}`, 'rolled-back', db);
      } finally {
        DESKTOP_MIGRATIONS.splice(0, DESKTOP_MIGRATIONS.length, ...originalMigrations);
      }
      const backups = readdirSync(backupDir);
      expect(backups).toHaveLength(1);
      const restoredPath = join(root, 'restored.db');
      copyFileSync(join(backupDir, backups[0]), restoredPath);
      const restored = openFixture(restoredPath);
      expect(canonicalFixtureHash(restored)).toBe(beforeHash);
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(restored.pragma('foreign_key_check')).toEqual([]);
      expect(restored.pragma('user_version', { simple: true })).toBe(D03A_LEGACY_USER_VERSION);
      recordReplay(`transaction-${phase}`, 'backup', restored);
      for (const candidate of [db, restored]) {
        expect(takeoverDesktopDatabase(candidate).mode).toBe('adopted');
        expectOriginalRows(candidate, before);
        expectHealthyLatest(candidate);
        const migrated = canonicalFixtureHash(candidate);
        expect(takeoverDesktopDatabase(candidate).mode).toBe('noop');
        expect(canonicalFixtureHash(candidate)).toBe(migrated);
        recordReplay(
          `transaction-${phase}`,
          candidate === db ? 'recovered-original' : 'recovered-backup',
          candidate,
        );
      }
    },
  );
});
