import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { up } from '../0020_remove_wukong_studio';

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function seed(database: Database.Database): void {
  database.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      has_key INTEGER DEFAULT 0,
      key_suffix TEXT,
      is_active INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE history (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

describe('0020_remove_wukong_studio', () => {
  it('removes wukong rows, keeps other providers and dangling history references', () => {
    db = new Database(':memory:');
    seed(db);
    db.exec(`
      INSERT INTO providers VALUES
        ('wukong-1', '悟空云 · 生图组', 'wukong-studio', 'https://wkapi.vip/api/v1/studio', 'image_gptImage2', 1, '8888', 0, 10, 10),
        ('tvt-1', 'TvT', 'openai-compatible', 'https://ai.tvt.wiki/v1', 'gpt-image-2', 1, '1234', 1, 5, 5);
      INSERT INTO history VALUES
        ('history-1', 'wukong-1', 'image_gptImage2', '旧提示词', 'success', 20),
        ('history-2', 'tvt-1', 'gpt-image-2', '保留提示词', 'success', 21);
    `);

    up(db);
    up(db);

    const types = db.prepare('SELECT type FROM providers').all();
    expect(types).toEqual([{ type: 'openai-compatible' }]);
    expect(db.prepare('SELECT id FROM history ORDER BY id').all()).toEqual([
      { id: 'history-1' },
      { id: 'history-2' },
    ]);
  });

  it('promotes the earliest remaining provider when the active row was wukong', () => {
    db = new Database(':memory:');
    seed(db);
    db.exec(`
      INSERT INTO providers VALUES
        ('tvt-1', 'TvT', 'openai-compatible', 'https://ai.tvt.wiki/v1', 'gpt-image-2', 1, '1234', 0, 5, 5),
        ('tvt-2', 'TvT 备用', 'openai-compatible', 'https://ai.tvt.wiki/v1', 'gpt-image-2', 0, NULL, 0, 8, 8),
        ('wukong-1', '悟空云 · 生图组', 'wukong-studio', 'https://wkapi.vip/api/v1/studio', 'image_gptImage2', 1, '8888', 1, 12, 12);
    `);

    up(db);

    expect(db.prepare(`SELECT id FROM providers WHERE is_active = 1`).get()).toEqual({ id: 'tvt-1' });
  });

  it('leaves an empty provider table intact when only wukong rows existed', () => {
    db = new Database(':memory:');
    seed(db);
    db.exec(`
      INSERT INTO providers VALUES
        ('wukong-1', '悟空云 · 生图组', 'wukong-studio', 'https://wkapi.vip/api/v1/studio', 'image_gptImage2', 1, '8888', 1, 10, 10);
    `);

    up(db);

    expect(db.prepare('SELECT COUNT(*) AS count FROM providers').get()).toEqual({ count: 0 });
  });
});
