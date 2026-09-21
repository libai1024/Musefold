import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { designSchemeDbMigrations, runDesignSchemeDbMigrations } from '../migrations';
import { DESIGN_SCHEME_DB_SCHEMA_VERSION } from '../schema';

const RUN_COLUMNS =
  'run_id, revision_id, mode, status, policy_json, provider_json, created_at, completed_at';
const STATUSES = [
  'planning',
  'executing',
  'evaluating',
  'completed',
  'blocked',
  'failed',
  'cancelled',
];

describe('scheme purge v9 → current migration', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 9));
    db.exec(`
      INSERT INTO design_schemes
        (id, name, status, source_presentation, current_revision_id, fidelity, created_at, updated_at)
      VALUES ('scheme', 'Preserve receipts', 'draft', 'musefold-created', 'revision', 'adapted', 10, 10);
      INSERT INTO design_scheme_revisions
        (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
      VALUES ('revision', 'scheme', 1, '{}', 'agent', 10);
      INSERT INTO share_packages (package_id, scheme_id, manifest_json, path, created_at)
      VALUES ('export', 'scheme', '{"exported":true}', '/user/chosen/export.musefold.design', 11);
    `);
    for (const status of STATUSES) {
      db.prepare(`INSERT INTO design_scheme_runs (${RUN_COLUMNS})
        VALUES (?, 'revision', 'trial', ?, '{"cost":125}', '{"model":"historical"}', 12, ?)`).run(
        status,
        status,
        ['planning', 'executing', 'evaluating'].includes(status) ? null : 15,
      );
      db.prepare(`INSERT INTO design_scheme_run_steps
        (run_id, step_id, status, input_json, output_json, started_at, completed_at)
        VALUES (?, 'step', 'completed', '{"prompt":"retained"}', '{"asset":"result"}', 13, 14)`).run(
        status,
      );
      db.prepare(`INSERT INTO design_scheme_evaluations
        (evaluation_id, run_id, passed, metrics_json, evidence_json, created_at)
        VALUES (?, ?, 1, '{"score":99}', '["result"]', 15)`).run(`evaluation-${status}`, status);
    }
  });
  afterEach(() => db.close());

  function snapshot() {
    return {
      runs: db.prepare(`SELECT ${RUN_COLUMNS} FROM design_scheme_runs ORDER BY run_id`).all(),
      steps: db.prepare('SELECT * FROM design_scheme_run_steps ORDER BY run_id, step_id').all(),
      evaluations: db
        .prepare('SELECT * FROM design_scheme_evaluations ORDER BY evaluation_id')
        .all(),
      schemes: db.prepare('SELECT * FROM design_schemes').all(),
      revisions: db.prepare('SELECT * FROM design_scheme_revisions').all(),
      exports: db.prepare('SELECT * FROM share_packages').all(),
    };
  }

  it('preserves every run state and dependent row, backfills origins and keeps foreign keys enabled', () => {
    const before = snapshot();
    runDesignSchemeDbMigrations(db);
    expect(snapshot()).toEqual(before);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(db.pragma('user_version', { simple: true })).toBe(DESIGN_SCHEME_DB_SCHEMA_VERSION);
    expect(
      db.prepare('SELECT origin_scheme_id, origin_revision_id FROM design_scheme_runs').all(),
    ).toEqual(STATUSES.map(() => ({ origin_scheme_id: 'scheme', origin_revision_id: 'revision' })));
    runDesignSchemeDbMigrations(db);
    expect(snapshot()).toEqual(before);
  });

  it('can detach terminal receipts without cascading away their steps or evaluations', () => {
    runDesignSchemeDbMigrations(db);
    const before = snapshot();
    db.exec(`UPDATE design_scheme_runs SET revision_id = NULL
      WHERE status IN ('completed', 'blocked', 'failed', 'cancelled')`);
    expect(snapshot().steps).toEqual(before.steps);
    expect(snapshot().evaluations).toEqual(before.evaluations);
    expect(() =>
      db.exec("UPDATE design_scheme_runs SET revision_id = NULL WHERE run_id = 'planning'"),
    ).toThrow(/CHECK/);
    expect(() =>
      db.exec("UPDATE design_scheme_runs SET status = 'executing' WHERE run_id = 'completed'"),
    ).toThrow(/CHECK/);
    expect(() =>
      db.exec("DELETE FROM design_scheme_revisions WHERE revision_id = 'revision'"),
    ).toThrow(/FOREIGN KEY/);
    // Surviving child FKs still point at the renamed table and retain their original semantics.
    db.exec("DELETE FROM design_scheme_runs WHERE run_id = 'completed'");
    expect(
      db.prepare("SELECT * FROM design_scheme_run_steps WHERE run_id = 'completed'").all(),
    ).toEqual([]);
    expect(
      db.prepare("SELECT * FROM design_scheme_evaluations WHERE run_id = 'completed'").all(),
    ).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('rolls back an injected failure after the full rebuild, including journal and schema', () => {
    const before = snapshot();
    const schema = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
    const migration = designSchemeDbMigrations[9];
    if (!migration) throw new Error('Missing v10 migration');
    expect(() =>
      runDesignSchemeDbMigrations(db, [
        {
          ...migration,
          up(connection) {
            migration.up(connection);
            throw new Error('injected final DDL failure');
          },
        },
      ]),
    ).toThrow('injected final DDL failure');
    expect(db.pragma('user_version', { simple: true })).toBe(9);
    expect(snapshot()).toEqual(before);
    expect(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all()).toEqual(
      schema,
    );
    expect(
      db.prepare('SELECT MAX(version) AS version FROM design_scheme_migrations').get(),
    ).toEqual({ version: 9 });
    runDesignSchemeDbMigrations(db);
    expect(snapshot()).toEqual(before);
  });

  it('fails closed for a corrupt legacy reference instead of silently losing its run', () => {
    db.pragma('foreign_keys = OFF');
    db.exec("UPDATE design_scheme_runs SET revision_id = 'missing' WHERE run_id = 'completed'");
    db.pragma('foreign_keys = ON');
    const before = snapshot();
    expect(() => runDesignSchemeDbMigrations(db)).toThrow(/FOREIGN KEY/);
    expect(snapshot()).toEqual(before);
    expect(db.pragma('user_version', { simple: true })).toBe(9);
  });

  it('rolls back v11 cleanup tables and triggers without changing the v10 receipts', () => {
    runDesignSchemeDbMigrations(db, designSchemeDbMigrations.slice(0, 10));
    const before = snapshot();
    const schema = db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
    const migration = designSchemeDbMigrations[10];
    if (!migration) throw new Error('Missing v11 migration');
    expect(() =>
      runDesignSchemeDbMigrations(db, [
        {
          ...migration,
          up(connection) {
            migration.up(connection);
            throw new Error('cleanup DDL failed');
          },
        },
      ]),
    ).toThrow('cleanup DDL failed');
    expect(db.pragma('user_version', { simple: true })).toBe(10);
    expect(snapshot()).toEqual(before);
    expect(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(
      schema,
    );
    runDesignSchemeDbMigrations(db);
    expect(snapshot()).toEqual(before);
    expect(db.prepare('SELECT * FROM design_scheme_asset_cleanup').all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('prevents insert, replace and update resurrection of purged scheme and revision identities', () => {
    runDesignSchemeDbMigrations(db);
    db.exec(`
      INSERT INTO design_scheme_purge_identities VALUES ('purged', 2, 1, 0, 100);
      INSERT INTO design_scheme_purge_revision_identities VALUES ('purged-revision', 'purged', 100);
    `);
    const insert = `INTO design_schemes
      (id, name, status, source_presentation, current_revision_id, fidelity, created_at, updated_at)
      VALUES ('purged', 'No resurrection', 'draft', 'musefold-created', 'new-revision', 'adapted', 100, 100)`;
    expect(() => db.exec(`INSERT ${insert}`)).toThrow('DESIGN_SCHEME_PURGED');
    expect(() => db.exec(`INSERT OR REPLACE ${insert}`)).toThrow('DESIGN_SCHEME_PURGED');
    expect(() => db.exec("UPDATE design_schemes SET id = 'purged' WHERE id = 'scheme'")).toThrow(
      'DESIGN_SCHEME_PURGED',
    );
    const revisionInsert = db.prepare(`INSERT INTO design_scheme_revisions
      (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
      VALUES (?, ?, 1, '{}', 'agent', 100)`);
    expect(() => revisionInsert.run('purged-revision', 'scheme')).toThrow('DESIGN_SCHEME_PURGED');
    expect(() => revisionInsert.run('late-new-revision', 'purged')).toThrow('DESIGN_SCHEME_PURGED');
    expect(() =>
      db.exec(
        "UPDATE design_scheme_revisions SET revision_id = 'purged-revision' WHERE revision_id = 'revision'",
      ),
    ).toThrow('DESIGN_SCHEME_PURGED');
    expect(() =>
      db.exec(
        "UPDATE design_scheme_revisions SET scheme_id = 'purged' WHERE revision_id = 'revision'",
      ),
    ).toThrow('DESIGN_SCHEME_PURGED');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
