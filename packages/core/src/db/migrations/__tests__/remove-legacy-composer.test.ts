import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { up } from '../0011_remove_legacy_composer';

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function tableNames(database: Database.Database): string[] {
  return (database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

describe('0011_remove_legacy_composer', () => {
  it('preserves library/history facts while removing legacy runtime tables and recipe foreign keys', () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, sort_order INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, tag_group TEXT, color TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE recipes (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE materials (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE recipe_drafts (id TEXT PRIMARY KEY, recipe_id TEXT REFERENCES recipes(id));
      CREATE TABLE fragments (id TEXT PRIMARY KEY);
      CREATE TABLE templates (id TEXT PRIMARY KEY);
      CREATE TABLE compositions (id TEXT PRIMARY KEY);
      CREATE TABLE composition_events (id TEXT PRIMARY KEY, composition_id TEXT REFERENCES compositions(id));
      CREATE TABLE composition_snapshots (id TEXT PRIMARY KEY, composition_id TEXT REFERENCES compositions(id));
      CREATE VIRTUAL TABLE materials_fts USING fts5(title, content, category, tags_index);

      CREATE TABLE prompts (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, content TEXT NOT NULL,
        content_negative TEXT, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        model_id TEXT, params TEXT, preview_image_path TEXT, rating INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0, pin_order INTEGER, usage_count INTEGER DEFAULT 0,
        last_used_at INTEGER, source TEXT, source_url TEXT,
        recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
      );
      CREATE TABLE prompt_tags (
        prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(prompt_id, tag_id)
      );
      CREATE TABLE history (
        id TEXT PRIMARY KEY, prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
        recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
        recipe_name_snapshot TEXT, recipe_fields_snapshot TEXT, recipe_values_snapshot TEXT,
        recipe_variant_index INTEGER, provider_id TEXT NOT NULL, model TEXT NOT NULL,
        prompt_text TEXT NOT NULL, negative_text TEXT, params TEXT, status TEXT NOT NULL,
        error_code TEXT, error_message TEXT, image_path TEXT, cost INTEGER,
        duration_ms INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE history_prompt_references (
        history_id TEXT NOT NULL REFERENCES history(id) ON DELETE CASCADE,
        prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
        prompt_title TEXT NOT NULL, excerpt TEXT NOT NULL,
        scope TEXT NOT NULL, sort_order INTEGER NOT NULL,
        PRIMARY KEY(history_id, sort_order)
      );
      CREATE VIRTUAL TABLE prompts_fts USING fts5(title, description, content, tags_index);

      INSERT INTO folders VALUES ('folder-1', '项目', NULL, 0, 1);
      INSERT INTO tags VALUES ('tag-1', '架构图', NULL, NULL, 1);
      INSERT INTO recipes VALUES ('legacy-recipe-1', '旧配方');
      INSERT INTO prompts
        (id, title, content, folder_id, recipe_id, created_at, updated_at)
      VALUES ('prompt-1', '系统架构图', '绘制系统架构图', 'folder-1', 'legacy-recipe-1', 1, 2);
      INSERT INTO prompt_tags VALUES ('prompt-1', 'tag-1');
      INSERT INTO prompts_fts(rowid, title, description, content, tags_index)
      SELECT rowid, title, '', content, '架 构 图' FROM prompts WHERE id = 'prompt-1';
      INSERT INTO history
        (id, prompt_id, recipe_id, recipe_name_snapshot, provider_id, model,
         prompt_text, status, created_at)
      VALUES ('history-1', 'prompt-1', 'legacy-recipe-1', '旧配方',
        'provider-1', 'model-1', '绘制系统架构图', 'success', 3);
      INSERT INTO history_prompt_references
      VALUES ('history-1', 'prompt-1', '系统架构图', '绘制系统架构图', 'full', 0);
    `);

    const originalRowId = (db.prepare(
      "SELECT rowid FROM prompts WHERE id = 'prompt-1'",
    ).get() as { rowid: number }).rowid;

    db.transaction(() => up(db!))();

    expect(tableNames(db)).not.toEqual(expect.arrayContaining([
      'recipes',
      'materials',
      'recipe_drafts',
      'fragments',
      'templates',
      'compositions',
      'composition_events',
      'composition_snapshots',
    ]));
    expect(db.prepare(
      "SELECT rowid, recipe_id FROM prompts WHERE id = 'prompt-1'",
    ).get()).toEqual({ rowid: originalRowId, recipe_id: 'legacy-recipe-1' });
    expect(db.prepare(
      "SELECT prompt_id, recipe_id FROM history WHERE id = 'history-1'",
    ).get()).toEqual({ prompt_id: 'prompt-1', recipe_id: 'legacy-recipe-1' });
    expect(db.prepare(
      "SELECT prompt_id, excerpt FROM history_prompt_references WHERE history_id = 'history-1'",
    ).get()).toEqual({ prompt_id: 'prompt-1', excerpt: '绘制系统架构图' });

    const promptForeignTables = (db.prepare('PRAGMA foreign_key_list(prompts)').all() as Array<{ table: string }>)
      .map((row) => row.table);
    const historyForeignTables = (db.prepare('PRAGMA foreign_key_list(history)').all() as Array<{ table: string }>)
      .map((row) => row.table);
    expect(promptForeignTables).not.toContain('recipes');
    expect(historyForeignTables).not.toContain('recipes');
    expect(db.pragma('foreign_key_check')).toEqual([]);

    expect(() => db!.prepare(
      `INSERT INTO prompts (id, title, content, recipe_id, created_at, updated_at)
       VALUES ('prompt-v021', '新配方来源', '正文', 'recipe-v021', 4, 4)`,
    ).run()).not.toThrow();
  });
});
