import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { up } from '../0009_history_prompt_references';

let db: Database.Database | null = null;

function oldDatabase(): Database.Database {
  const next = new Database(':memory:');
  next.pragma('foreign_keys = ON');
  next.exec(`
    CREATE TABLE prompts (
      id TEXT PRIMARY KEY,
      deleted_at INTEGER
    );
    CREATE TABLE history (
      id TEXT PRIMARY KEY,
      prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL
    );
  `);
  next.pragma('user_version = 8');
  return next;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('migration 0009 history prompt references', () => {
  it('creates the relation table and indexes on an existing v8 database', () => {
    db = oldDatabase();
    up(db);
    db.pragma('user_version = 9');

    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'history_prompt_references'",
    ).get();
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'history_prompt_references'",
    ).all() as Array<{ name: string }>;
    expect(table).toBeTruthy();
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_history_prompt_refs_prompt',
      'idx_history_prompt_refs_history',
    ]));
    expect(db.pragma('user_version', { simple: true })).toBe(9);
  });

  it('keeps snapshots through soft/purge delete and cascades with history deletion', () => {
    db = oldDatabase();
    up(db);
    db.prepare('INSERT INTO prompts (id, deleted_at) VALUES (?, NULL)').run('prompt-1');
    db.prepare('INSERT INTO history (id, prompt_id) VALUES (?, ?)').run('history-1', 'prompt-1');
    db.prepare(
      `INSERT INTO history_prompt_references
         (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('history-1', 'prompt-1', '旧标题', '引用快照', 'excerpt', 0);

    db.prepare('UPDATE prompts SET deleted_at = ? WHERE id = ?').run(Date.now(), 'prompt-1');
    expect(db.prepare('SELECT prompt_id, excerpt FROM history_prompt_references').get()).toEqual({
      prompt_id: 'prompt-1',
      excerpt: '引用快照',
    });

    db.prepare('DELETE FROM prompts WHERE id = ?').run('prompt-1');
    expect(db.prepare('SELECT prompt_id, prompt_title, excerpt FROM history_prompt_references').get()).toEqual({
      prompt_id: null,
      prompt_title: '旧标题',
      excerpt: '引用快照',
    });

    db.prepare('DELETE FROM history WHERE id = ?').run('history-1');
    expect(db.prepare('SELECT COUNT(*) AS total FROM history_prompt_references').get()).toEqual({ total: 0 });
  });
});
