import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
import { afterEach, describe, expect, it } from 'vitest';
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
