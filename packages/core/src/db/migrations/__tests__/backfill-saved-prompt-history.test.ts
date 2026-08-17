import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { up } from '../0010_backfill_saved_prompt_history';

let db: Database.Database | null = null;

function database(): Database.Database {
  const next = new Database(':memory:');
  next.exec(`
    CREATE TABLE prompts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      content_negative TEXT,
      source TEXT NOT NULL,
      source_url TEXT,
      preview_image_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE history (
      id TEXT PRIMARY KEY,
      prompt_id TEXT,
      prompt_text TEXT NOT NULL,
      negative_text TEXT,
      status TEXT NOT NULL,
      image_path TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return next;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('migration 0010 saved prompt history backfill', () => {
  it('links all exact recent images and uses the nearest as preview provenance', () => {
    db = database();
    db.prepare(
      `INSERT INTO prompts
         (id, content, content_negative, source, created_at, updated_at)
       VALUES ('p1', 'exact prompt', 'no blur', 'manual', 1000000, 1000000)`,
    ).run();
    const insert = db.prepare(
      `INSERT INTO history
         (id, prompt_id, prompt_text, negative_text, status, image_path, created_at)
       VALUES (?, NULL, ?, ?, 'success', ?, ?)`,
    );
    insert.run('near-1', 'exact prompt', 'no blur', '/near-1.png', 999000);
    insert.run('near-2', 'exact prompt', 'no blur', '/near-2.png', 998000);
    insert.run('too-old', 'exact prompt', 'no blur', '/old.png', 399000);
    insert.run('wrong-negative', 'exact prompt', 'different', '/wrong.png', 999500);

    up(db);

    expect(db.prepare('SELECT id, prompt_id FROM history ORDER BY id').all()).toEqual([
      { id: 'near-1', prompt_id: 'p1' },
      { id: 'near-2', prompt_id: 'p1' },
      { id: 'too-old', prompt_id: null },
      { id: 'wrong-negative', prompt_id: null },
    ]);
    expect(db.prepare('SELECT source_url, preview_image_path FROM prompts WHERE id = ?').get('p1')).toEqual({
      source_url: 'history://near-1',
      preview_image_path: '/near-1.png',
    });
  });

  it('does not touch imported, deleted, already sourced, or failed records', () => {
    db = database();
    db.exec(`
      INSERT INTO prompts
        (id, content, source, source_url, created_at, updated_at, deleted_at)
      VALUES
        ('imported', 'same', 'import', NULL, 1000, 1000, NULL),
        ('deleted', 'same', 'manual', NULL, 1000, 1000, 900),
        ('sourced', 'same', 'manual', 'history://known', 1000, 1000, NULL);
      INSERT INTO history
        (id, prompt_id, prompt_text, status, image_path, created_at)
      VALUES ('failed', NULL, 'same', 'failed', '/failed.png', 999);
    `);

    up(db);

    expect(db.prepare('SELECT prompt_id FROM history WHERE id = ?').get('failed')).toEqual({ prompt_id: null });
    expect(db.prepare('SELECT id, source_url FROM prompts ORDER BY id').all()).toEqual([
      { id: 'deleted', source_url: null },
      { id: 'imported', source_url: null },
      { id: 'sourced', source_url: 'history://known' },
    ]);
  });
});
