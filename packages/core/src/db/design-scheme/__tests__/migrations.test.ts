import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  designSchemeDbMigrations,
  runDesignSchemeDbMigrations,
  type DesignSchemeDbMigration,
} from '../migrations';
import { DESIGN_SCHEME_DB_SCHEMA_VERSION } from '../schema';

describe('design-scheme SQLite migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('replays v4 databases into the current version without changing existing rows', () => {
    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 4));
    db.prepare(
      `INSERT INTO design_schemes
        (id, name, summary, status, source_presentation, source_label,
         current_revision_id, fidelity, created_at, updated_at)
       VALUES ('scheme_replay', 'Replay', '', 'draft', 'musefold-created', 'local',
         'revision_replay', 'adapted', 10, 10)`,
    ).run();

    runDesignSchemeDbMigrations(db);

    expect(db.pragma('user_version', { simple: true })).toBe(DESIGN_SCHEME_DB_SCHEMA_VERSION);
    expect(
      db.prepare("SELECT value FROM design_scheme_meta WHERE key = 'schema_version'").get(),
    ).toEqual({ value: String(DESIGN_SCHEME_DB_SCHEMA_VERSION) });
    expect(
      db.prepare('SELECT version FROM design_schemes WHERE id = ?').get('scheme_replay'),
    ).toEqual({ version: 1 });
    expect(
      db.prepare('SELECT version, name FROM design_scheme_migrations ORDER BY version').all(),
    ).toHaveLength(DESIGN_SCHEME_DB_SCHEMA_VERSION);
  });

  it('v5→v6: seeded old database keeps rows and gains nullable metadata columns', () => {
    // 旧 v5 库:已有资产与来源文件行,均无元数据列。
    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 5));
    db.prepare(
      `INSERT INTO design_schemes
        (id, name, summary, status, source_presentation, source_label,
         current_revision_id, fidelity, created_at, updated_at)
       VALUES ('scheme_v5', 'Legacy', '', 'formal', 'skill', 'acme/kit',
         'revision_v5', 'faithful', 10, 10)`,
    ).run();
    db.prepare(
      `INSERT INTO design_scheme_revisions
         (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
       VALUES ('revision_v5', 'scheme_v5', 1, '{}', 'agent', 10)`,
    ).run();
    db.prepare(
      `INSERT INTO design_scheme_assets (id, revision_id, store_key, role, origin, created_at)
       VALUES ('dsa_legacy', 'revision_v5', 'design-scheme-sources/snap_old/a.png',
         'example', 'local-run', 20)`,
    ).run();
    db.prepare(
      `INSERT INTO source_packages (id, kind, repository_url, created_at)
       VALUES ('pkg_v5', 'github', 'https://github.com/acme/kit', 10)`,
    ).run();
    db.prepare(
      `INSERT INTO source_snapshots (id, package_id, ref, commit_hash, total_bytes, scan_json, created_at)
       VALUES ('snap_v5', 'pkg_v5', 'main', NULL, 5, '{}', 10)`,
    ).run();
    db.prepare(
      `INSERT INTO source_files (snapshot_id, path, kind, content_hash, size_bytes, store_key, text_content)
       VALUES ('snap_v5', 'SKILL.md', 'text', 'oldhash', 5, NULL, '# old')`,
    ).run();

    runDesignSchemeDbMigrations(db);

    expect(db.pragma('user_version', { simple: true })).toBe(6);
    // 既有行不动;新元数据列全部为 NULL(由读路径懒回填,迁移不猜值)。
    expect(
      db
        .prepare(
          `SELECT store_key, role, origin, mime_type, width, height, byte_size, content_hash
           FROM design_scheme_assets WHERE id = 'dsa_legacy'`,
        )
        .get(),
    ).toEqual({
      store_key: 'design-scheme-sources/snap_old/a.png',
      role: 'example',
      origin: 'local-run',
      mime_type: null,
      width: null,
      height: null,
      byte_size: null,
      content_hash: null,
    });
    expect(
      db
        .prepare(
          `SELECT path, kind, content_hash, size_bytes, mime_type, evidence_path
           FROM source_files WHERE snapshot_id = 'snap_v5'`,
        )
        .get(),
    ).toEqual({
      path: 'SKILL.md',
      kind: 'text',
      content_hash: 'oldhash',
      size_bytes: 5,
      mime_type: null,
      evidence_path: null,
    });
    // 方案行与绑定关系照旧。
    expect(
      db.prepare('SELECT name, status, version FROM design_schemes WHERE id = ?').get('scheme_v5'),
    ).toEqual({ name: 'Legacy', status: 'formal', version: 1 });
  });

  it('re-running the current migration set is a noop', () => {
    runDesignSchemeDbMigrations(db);
    const before = db
      .prepare('SELECT version, name FROM design_scheme_migrations ORDER BY version')
      .all();
    runDesignSchemeDbMigrations(db);
    const after = db
      .prepare('SELECT version, name FROM design_scheme_migrations ORDER BY version')
      .all();
    expect(after).toEqual(before);
    expect(db.pragma('user_version', { simple: true })).toBe(DESIGN_SCHEME_DB_SCHEMA_VERSION);
  });

  it('rolls back a failed migration and leaves the prior version usable', () => {
    runDesignSchemeDbMigrations(db);
    const failedMigration: DesignSchemeDbMigration = {
      version: DESIGN_SCHEME_DB_SCHEMA_VERSION + 1,
      name: '0006_failed_test_migration',
      up(currentDb) {
        currentDb.exec('CREATE TABLE should_rollback (id TEXT PRIMARY KEY)');
        throw new Error('intentional migration failure');
      },
    };

    expect(() => runDesignSchemeDbMigrations(db, [failedMigration])).toThrow(
      'intentional migration failure',
    );
    expect(db.pragma('user_version', { simple: true })).toBe(DESIGN_SCHEME_DB_SCHEMA_VERSION);
    expect(
      db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get('should_rollback'),
    ).toBeUndefined();
    expect(
      db.prepare('SELECT version, name FROM design_scheme_migrations ORDER BY version').all(),
    ).toHaveLength(DESIGN_SCHEME_DB_SCHEMA_VERSION);
  });
});
