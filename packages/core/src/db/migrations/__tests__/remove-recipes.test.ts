import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_DATA_NAMESPACE } from '@musefold/domain/constants';
import { migrateAndRemoveLegacyRecipeDatabase } from '../../index';
import { up } from '../0015_remove_recipes';

let db: Database.Database | null = null;
let tempDir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function columns(database: Database.Database, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

describe('0015_remove_recipes', () => {
  it('removes recipe links while preserving library/history facts and creating generic workbench tables', () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE prompts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        recipe_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_prompts_recipe ON prompts(recipe_id) WHERE recipe_id IS NOT NULL;
      CREATE TABLE history (
        id TEXT PRIMARY KEY,
        prompt_id TEXT,
        recipe_id TEXT,
        recipe_name_snapshot TEXT,
        recipe_fields_snapshot TEXT,
        recipe_values_snapshot TEXT,
        recipe_variant_index INTEGER,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_history_recipe ON history(recipe_id);
      INSERT INTO prompts VALUES ('prompt-1', '保留标题', '保留正文', 'legacy-1', 1, 2);
      INSERT INTO history VALUES (
        'history-1', 'prompt-1', 'legacy-1', '旧名称', '[]', '{}', 0,
        'provider-1', 'model-1', '保留生成提示词', 'success', 3
      );
    `);

    up(db);
    up(db);

    expect(columns(db, 'prompts')).not.toContain('recipe_id');
    expect(columns(db, 'history')).not.toEqual(expect.arrayContaining([
      'recipe_id',
      'recipe_name_snapshot',
      'recipe_fields_snapshot',
      'recipe_values_snapshot',
      'recipe_variant_index',
    ]));
    expect(db.prepare('SELECT id, title, content FROM prompts').get()).toEqual({
      id: 'prompt-1',
      title: '保留标题',
      content: '保留正文',
    });
    expect(db.prepare('SELECT id, prompt_id, prompt_text FROM history').get()).toEqual({
      id: 'history-1',
      prompt_id: 'prompt-1',
      prompt_text: '保留生成提示词',
    });

    db.prepare(
      `INSERT INTO workbench_sessions (id, title, created_at, updated_at)
       VALUES ('session-1', '普通会话', 10, 10)`,
    ).run();
    db.prepare(
      `INSERT INTO generation_runs
        (id, run_kind, workbench_session_id, provider_id, model, base_prompt, final_prompt,
         params_json, prompt_snapshot_json, status, created_at)
       VALUES ('run-1', 'free_generation', 'session-1', 'provider-1', 'model-1', 'base', 'final',
         '{}', '{}', 'success', 11)`,
    ).run();
    db.prepare(
      `INSERT INTO generated_assets (id, run_id, position, status, media_path, created_at)
       VALUES ('asset-1', 'run-1', 0, 'available', '/tmp/result.png', 12)`,
    ).run();
    expect(db.prepare('SELECT media_path FROM generated_assets WHERE id = ?').get('asset-1'))
      .toEqual({ media_path: '/tmp/result.png' });
    expect(() => db!.prepare(
      `INSERT INTO generation_runs
        (id, run_kind, provider_id, model, base_prompt, final_prompt,
         params_json, prompt_snapshot_json, status, created_at)
       VALUES ('legacy-run', 'recipe_generation', 'provider-1', 'model-1', 'base', 'final',
         '{}', '{}', 'success', 13)`,
    ).run()).toThrow();
  });

  it('keeps generic workbench facts before deleting the dedicated legacy database', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'musefold-remove-recipes-'));
    const legacyPath = join(tempDir, `musefold-recipe-data-${APP_DATA_NAMESPACE}.db`);
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE workbench_sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, archived_at INTEGER, deleted_at INTEGER
      );
      CREATE TABLE generation_runs (
        id TEXT PRIMARY KEY, run_kind TEXT NOT NULL, workbench_session_id TEXT,
        workbench_turn_id TEXT, turn_index INTEGER, result_index INTEGER,
        parent_run_id TEXT, retry_of_run_id TEXT, source_asset_id TEXT,
        provider_id TEXT NOT NULL, model TEXT NOT NULL, user_prompt TEXT NOT NULL,
        base_prompt TEXT NOT NULL, refinement_instruction TEXT, final_prompt TEXT NOT NULL,
        negative_prompt TEXT, params_json TEXT NOT NULL, prompt_snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL, error_code TEXT, error_message TEXT, request_id TEXT,
        estimated_cost REAL, actual_cost REAL, duration_ms INTEGER, created_at INTEGER NOT NULL,
        started_at INTEGER, finished_at INTEGER, deleted_at INTEGER
      );
      CREATE TABLE generated_assets (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL,
        media_path TEXT, mime_type TEXT, width INTEGER, height INTEGER, file_size INTEGER,
        checksum TEXT, created_at INTEGER NOT NULL
      );
      INSERT INTO workbench_sessions VALUES ('session-1', '保留的普通会话', 1, 4, NULL, NULL);
      INSERT INTO generation_runs VALUES (
        'recipe-run', 'recipe_generation', 'session-1', 'turn-1', 0, 0,
        NULL, NULL, NULL, 'provider', 'model', 'old', 'old', NULL, 'old', NULL,
        '{}', '{"schemaVersion":1}', 'success', NULL, NULL, NULL,
        NULL, NULL, 10, 2, 2, 3, NULL
      );
      INSERT INTO generation_runs VALUES (
        'free-run', 'free_generation', 'session-1', 'turn-2', 1, 0,
        NULL, NULL, NULL, 'provider', 'model', 'keep', 'keep', NULL, 'keep', NULL,
        '{}', '{"schemaVersion":1}', 'success', NULL, NULL, NULL,
        NULL, NULL, 10, 3, 3, 4, NULL
      );
      INSERT INTO generated_assets VALUES (
        'recipe-asset', 'recipe-run', 0, 'available', '/tmp/old.png', 'image/png', 1, 1, 1, NULL, 3
      );
      INSERT INTO generated_assets VALUES (
        'free-asset', 'free-run', 0, 'available', '/tmp/keep.png', 'image/png', 1, 1, 1, NULL, 4
      );
    `);
    legacy.close();
    writeFileSync(`${legacyPath}-wal`, '');
    writeFileSync(`${legacyPath}-shm`, '');

    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    migrateAndRemoveLegacyRecipeDatabase(db, tempDir);

    expect(db.prepare('SELECT id, title FROM workbench_sessions').all()).toEqual([
      { id: 'session-1', title: '保留的普通会话' },
    ]);
    expect(db.prepare('SELECT id, run_kind FROM generation_runs').all()).toEqual([
      { id: 'free-run', run_kind: 'free_generation' },
    ]);
    expect(db.prepare('SELECT id, media_path FROM generated_assets').all()).toEqual([
      { id: 'free-asset', media_path: '/tmp/keep.png' },
    ]);
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(`${legacyPath}-wal`)).toBe(false);
    expect(existsSync(`${legacyPath}-shm`)).toBe(false);
  });
});
