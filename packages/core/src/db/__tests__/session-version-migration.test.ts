import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
import { describe, expect, it } from 'vitest';

function prefix(db: Database.Database, count: number) {
  db.exec(
    'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  for (const migration of DESKTOP_MIGRATIONS.slice(0, count)) {
    for (const sql of migration.sql) db.exec(sql);
    db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(
      migration.hash,
      migration.folderMillis,
    );
  }
  db.pragma('foreign_keys = ON');
}

describe('managed Session version migration', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'preserves Session, draft and generation facts from managed prefix %i',
    (count) => {
      const db = new Database(':memory:');
      try {
        prefix(db, count);
        db.prepare(
          'INSERT INTO workbench_sessions(id,title,created_at,updated_at,archived_at,deleted_at) VALUES (?,?,?,?,?,?)',
        ).run('old', 'Old session', 1, 2, 3, 4);
        const draft = JSON.stringify({
          prompt: '旧'.repeat(12_000),
          negative: '',
          params: { aspectRatio: '7:3' },
        });
        db.prepare('INSERT INTO workbench_drafts VALUES (?,?,?)').run('old', draft, 2);
        db.prepare(`INSERT INTO generation_runs(id,run_kind,workbench_session_id,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,actual_cost,created_at)
        VALUES ('run','free_generation','old','provider','model','base','final','{}','{}','success',0.25,5)`).run();
        const previous = {
          session: db.prepare('SELECT * FROM workbench_sessions').get(),
          drafts: db.prepare('SELECT * FROM workbench_drafts').all(),
          runs: db.prepare('SELECT * FROM generation_runs').all(),
        };
        takeoverDesktopDatabase(db);
        expect(db.prepare('SELECT * FROM workbench_sessions').get()).toEqual({
          ...(previous.session as object),
          version: 1,
        });
        expect(db.prepare('SELECT * FROM workbench_drafts').all()).toEqual(previous.drafts);
        // 0002 adds prompt_id to older runs; all pre-existing columns remain byte-for-byte equal.
        const expectedRuns =
          count === 2
            ? previous.runs.map((row) => ({ ...(row as object), prompt_id: null }))
            : previous.runs;
        expect(db.prepare('SELECT * FROM generation_runs').all()).toEqual(expectedRuns);
        expect(db.pragma('foreign_key_check')).toEqual([]);
        expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
        db.prepare('UPDATE workbench_sessions SET version=7 WHERE id=?').run('old');
        takeoverDesktopDatabase(db);
        expect(db.prepare('SELECT version FROM workbench_sessions').get()).toEqual({ version: 7 });
        expect(db.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({
          count: DESKTOP_MIGRATIONS.length,
        });
      } finally {
        db.close();
      }
    },
  );

  it('defaults new Sessions to version one and keeps foreign key behavior', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      takeoverDesktopDatabase(db);
      db.prepare(
        'INSERT INTO workbench_sessions(id,title,created_at,updated_at) VALUES (?,?,1,2)',
      ).run('new', 'New');
      expect(db.prepare('SELECT version FROM workbench_sessions').get()).toEqual({ version: 1 });
      expect(() =>
        db.prepare('INSERT INTO workbench_drafts VALUES (?,?,1)').run('missing', '{}'),
      ).toThrow('FOREIGN KEY');
      db.prepare('INSERT INTO workbench_drafts VALUES (?,?,1)').run('new', '{}');
      db.prepare('DELETE FROM workbench_sessions WHERE id=?').run('new');
      expect(db.prepare('SELECT * FROM workbench_drafts').all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
