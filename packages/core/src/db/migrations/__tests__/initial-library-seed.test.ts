import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { up } from '../0001_initial';

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe('0001_initial v0.3.0 library seed', () => {
  it('creates only current library examples and indexes them for search', () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.transaction(() => up(db!))();

    const folders = db.prepare('SELECT name FROM folders ORDER BY sort_order').all() as Array<{ name: string }>;
    expect(folders.map((row) => row.name)).toEqual(['人物', '场景', '设计素材', '实验草稿']);

    const prompts = db.prepare(
      `SELECT p.title, f.name AS folder_name
       FROM prompts p LEFT JOIN folders f ON f.id = p.folder_id
       ORDER BY p.rowid`,
    ).all() as Array<{ title: string; folder_name: string }>;
    expect(prompts).toHaveLength(3);
    expect(prompts.every((row) => Boolean(row.folder_name))).toBe(true);
    expect((db.prepare(
      "SELECT COUNT(*) AS total FROM prompts_fts WHERE prompts_fts MATCH 'cinematic'",
    ).get() as { total: number }).total).toBeGreaterThan(0);

    const tables = new Set((db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as Array<{ name: string }>).map((row) => row.name));
    expect(tables.has('fragments')).toBe(false);
    expect(tables.has('templates')).toBe(false);
    expect(tables.has('compositions')).toBe(false);
  });
});
