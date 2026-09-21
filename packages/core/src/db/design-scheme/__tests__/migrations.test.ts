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

    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 6));

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

  it('v6→v7 preserves assets, metadata and revision associations while accepting uploaded origins', () => {
    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 6));
    db.exec(`
      INSERT INTO design_schemes
        (id, name, status, source_presentation, current_revision_id, cover_asset_id,
         fidelity, created_at, updated_at, version)
      VALUES ('scheme_v6', 'Legacy', 'formal', 'skill', 'revision_v6', 'asset_run',
        'faithful', 10, 20, 4);
      INSERT INTO design_scheme_revisions
        (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
      VALUES ('revision_v6', 'scheme_v6', 1, '{}', 'agent', 10);
      INSERT INTO source_packages (id, kind, created_at) VALUES ('pkg_v6', 'github', 10);
      INSERT INTO source_snapshots (id, package_id, ref, scan_json, created_at)
      VALUES ('snap_v6', 'pkg_v6', 'main', '{}', 10);
      INSERT INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
      VALUES ('revision_v6', 'snap_v6', 'normative');
      INSERT INTO design_scheme_runs (run_id, revision_id, mode, status, policy_json, created_at)
      VALUES ('run_v6', 'revision_v6', 'trial', 'completed', '{}', 15);
      INSERT INTO design_scheme_assets
        (id, revision_id, store_key, role, origin, license, created_at,
         mime_type, width, height, byte_size, content_hash)
      VALUES ('asset_run', 'revision_v6', 'design-scheme-sources/snap_v6/run.png',
        'cover', 'local-run', 'CC0', 20, 'image/png', 640, 480, 33, 'old-hash');
      INSERT INTO design_scheme_assets (id, revision_id, store_key, role, origin, created_at)
      VALUES ('asset_repository', 'revision_v6', 'design-scheme-sources/snap_v6/repo.png',
        'reference', 'repository', 10);
    `);
    const tables = [
      'design_scheme_assets',
      'design_schemes',
      'design_scheme_revisions',
      'design_scheme_source_bindings',
      'design_scheme_runs',
    ];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());

    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 7));

    expect(db.pragma('user_version', { simple: true })).toBe(7);
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('index_info(idx_ds_assets_revision)')).toEqual([
      { seqno: 0, cid: 1, name: 'revision_id' },
      { seqno: 1, cid: 6, name: 'created_at' },
    ]);
    const insert = db.prepare(`INSERT INTO design_scheme_assets
      (id, revision_id, store_key, role, origin, created_at)
      VALUES (?, ?, 'design-scheme-sources/snap_v6/upload.png', 'reference', ?, 30)`);
    expect(() => insert.run('asset_uploaded', 'revision_v6', 'uploaded')).not.toThrow();
    expect(() => insert.run('asset_invalid', 'revision_v6', 'unknown')).toThrow(/CHECK/);
    expect(() => insert.run('asset_orphan', 'missing_revision', 'uploaded')).toThrow(/FOREIGN KEY/);
    // The rebuilt table retains its revision cascade, without weakening foreign keys.
    db.prepare("DELETE FROM design_scheme_runs WHERE run_id = 'run_v6'").run();
    db.prepare("DELETE FROM design_scheme_revisions WHERE revision_id = 'revision_v6'").run();
    expect(db.prepare('SELECT * FROM design_scheme_assets').all()).toEqual([]);
  });

  it('v7→v8 preserves all prior origins and metadata while accepting cloud-run output assets', () => {
    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 7));
    db.exec(`
      INSERT INTO design_schemes
        (id, name, status, source_presentation, current_revision_id, cover_asset_id,
         fidelity, created_at, updated_at, version)
      VALUES ('scheme_v7', 'Existing uploads', 'draft', 'musefold-created', 'revision_v7',
        'asset_local-run', 'adapted', 10, 20, 5);
      INSERT INTO design_scheme_revisions
        (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
      VALUES ('revision_v7', 'scheme_v7', 1, '{}', 'import', 10);
    `);
    const insert = db.prepare(`INSERT INTO design_scheme_assets
      (id, revision_id, store_key, role, origin, license, created_at,
       mime_type, width, height, byte_size, content_hash)
      VALUES (?, ?, 'design-scheme-imports/old/asset.png', ?, ?,
        'CC0', 20, 'image/png', 640, 480, 33, 'stored-hash')`);
    for (const origin of ['repository', 'local-run', 'uploaded']) {
      insert.run(`asset_${origin}`, 'revision_v7', 'reference', origin);
    }
    const before = db.prepare('SELECT * FROM design_scheme_assets ORDER BY id').all();
    const beforeScheme = db.prepare('SELECT * FROM design_schemes').get();

    // v7→v8 的过渡语义：只跑到 v8（后续迁移有自己的专项用例）。
    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 8));

    expect(db.pragma('user_version', { simple: true })).toBe(8);
    expect(db.prepare('SELECT * FROM design_scheme_assets ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM design_schemes').get()).toEqual(beforeScheme);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('index_info(idx_ds_assets_revision)')).toEqual([
      { seqno: 0, cid: 1, name: 'revision_id' },
      { seqno: 1, cid: 6, name: 'created_at' },
    ]);
    expect(() => insert.run('asset_cloud', 'revision_v7', 'output', 'cloud-run')).not.toThrow();
    expect(() => insert.run('bad_origin', 'revision_v7', 'output', 'unknown')).toThrow(/CHECK/);
    expect(() => insert.run('bad_role', 'revision_v7', 'unknown', 'cloud-run')).toThrow(/CHECK/);
    expect(() => insert.run('orphan', 'missing_revision', 'output', 'cloud-run')).toThrow(
      /FOREIGN KEY/,
    );
    db.prepare("DELETE FROM design_scheme_revisions WHERE revision_id = 'revision_v7'").run();
    expect(db.prepare('SELECT * FROM design_scheme_assets').all()).toEqual([]);
  });

  it('v8→v9: 新增导入孤儿意图表，不改写既有资产与方案行', () => {
    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 8));
    db.exec(`
      INSERT INTO design_schemes
        (id, name, status, source_presentation, current_revision_id,
         fidelity, created_at, updated_at, version)
      VALUES ('scheme_v8', 'Imported', 'draft', 'musefold-created', 'revision_v8',
        'adapted', 10, 20, 3);
      INSERT INTO design_scheme_revisions
        (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
      VALUES ('revision_v8', 'scheme_v8', 1, '{}', 'import', 10);
      INSERT INTO design_scheme_assets
        (id, revision_id, store_key, role, origin, created_at)
      VALUES ('dsa_import_v8', 'revision_v8', 'design-scheme-imports/dsch_old/a.png',
        'example', 'local-run', 20);
    `);
    const beforeAssets = db.prepare('SELECT * FROM design_scheme_assets ORDER BY id').all();
    const beforeScheme = db.prepare('SELECT * FROM design_schemes').get();
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'design_scheme_import_gc'").get(),
    ).toBeUndefined();

    runDesignSchemeDbMigrations(db);

    expect(db.pragma('user_version', { simple: true })).toBe(DESIGN_SCHEME_DB_SCHEMA_VERSION);
    expect(db.prepare('SELECT * FROM design_scheme_assets ORDER BY id').all()).toEqual(
      beforeAssets,
    );
    expect(db.prepare('SELECT * FROM design_schemes').get()).toEqual(beforeScheme);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const insert = db.prepare(
      "INSERT INTO design_scheme_import_gc (root_name, state, created_at, next_attempt_at) VALUES (?, 'pending', 1, 1)",
    );
    expect(() => insert.run(`dsch_${'a'.repeat(32)}`)).not.toThrow();
    // 状态与根名形状由服务层约束，迁移只提供 CHECK 状态枚举。
    expect(() =>
      db
        .prepare(
          "INSERT INTO design_scheme_import_gc (root_name, state, created_at, next_attempt_at) VALUES ('x', 'nope', 1, 1)",
        )
        .run(),
    ).toThrow(/CHECK/);
    // 意图表刻意不随作品级联删除（无外键），与 local_asset_cleanup 同纪律。
    db.prepare("DELETE FROM design_scheme_revisions WHERE revision_id = 'revision_v8'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_scheme_import_gc').get()).toEqual({
      n: 1,
    });
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
