import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
import { describe, expect, it } from 'vitest';
import { WorkbenchSessionStore } from '../repositories/workbench-sessions';

function previousDatabase() {
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE __drizzle_migrations(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  for (const migration of DESKTOP_MIGRATIONS.slice(0, 11)) {
    for (const sql of migration.sql) db.exec(sql);
    db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(
      migration.hash,
      migration.folderMillis,
    );
  }
  db.pragma('foreign_keys = ON');
  db.prepare(
    'INSERT INTO workbench_sessions(id,title,version,created_at,updated_at,archived_at,deleted_at) VALUES (?,?,7,1,2,3,4)',
  ).run('old', 'Old trashed Session');
  db.prepare('INSERT INTO workbench_drafts VALUES (?,?,2)').run(
    'old',
    '{"prompt":"legacy","negative":"","params":{}}',
  );
  return db;
}

describe('0011 permanent Session identity managed migration', () => {
  it('preserves previous version and draft, starts without inferred deletion markers and retains subsequent markers on repeat migration', () => {
    const db = previousDatabase();
    try {
      const row = db.prepare('SELECT * FROM workbench_sessions').get();
      const draft = db.prepare('SELECT * FROM workbench_drafts').get();
      takeoverDesktopDatabase(db);
      expect(db.prepare('SELECT * FROM workbench_sessions').get()).toEqual(row);
      expect(db.prepare('SELECT * FROM workbench_drafts').get()).toEqual(draft);
      expect(db.prepare('SELECT * FROM workbench_session_deletions').all()).toEqual([]);
      expect(new WorkbenchSessionStore(db).purge('old')).toEqual({ purged: 1 });
      const marker = db.prepare('SELECT * FROM workbench_session_deletions').all();
      takeoverDesktopDatabase(db);
      expect(db.prepare('SELECT * FROM workbench_session_deletions').all()).toEqual(marker);
      expect(() =>
        db
          .prepare(
            'INSERT INTO workbench_sessions(id,title,created_at,updated_at) VALUES (?,?,1,1)',
          )
          .run('old', 'Recreated'),
      ).toThrow('permanently deleted');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('rolls back the new table and journal marker when a trigger DDL fails, then safely retries', () => {
    const db = previousDatabase();
    try {
      db.exec(
        'CREATE TRIGGER workbench_session_no_recreate BEFORE INSERT ON workbench_sessions BEGIN SELECT 1; END',
      );
      const shape = db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
      const journal = db.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all();
      expect(() => takeoverDesktopDatabase(db)).toThrow('already exists');
      expect(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(
        shape,
      );
      expect(db.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(
        journal,
      );
      expect(db.prepare('SELECT version FROM workbench_sessions').get()).toEqual({ version: 7 });
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      db.exec('DROP TRIGGER workbench_session_no_recreate');
      takeoverDesktopDatabase(db);
      expect(db.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({
        count: DESKTOP_MIGRATIONS.length,
      });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
