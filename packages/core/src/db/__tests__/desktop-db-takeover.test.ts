// 接管正确性守护(至 M5c 删除 core legacy 链前,双体系一致性以此为准):
// 1) baseline(忠实 DDL)建的空库 ≡ legacy 链(core 0001→0020)建的库(对象/列/索引集合);
// 2) 既有库接管零数据搬运、先备份、可重入;3) 非终态旧库拒绝接管。
// 测试住在 core 而非 desktop-db:依赖方向是 core → desktop-db(initDb 内嵌接管),
// desktop-db 保持零 workspace 依赖,而本测试需要 core 的 legacy 链建旧库。

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEGACY_FINAL_USER_VERSION,
  REQUIRED_TABLES,
  takeoverDesktopDatabase,
} from '@musefold/desktop-db';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureCoreRuntime } from '../../runtime';
import { runMigrations } from '../run-migrations';

let scratch: string;
const cleanups: Array<() => void> = [];

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'desktop-db-test-'));
  configureCoreRuntime({
    getPaths: () => ({
      userData: scratch,
      db: join(scratch, 'unused.db'),
      backups: join(scratch, 'legacy-backups'),
      previews: scratch,
      pictures: scratch,
      logs: scratch,
    }),
    loadApiKey: () => null,
    createLogger: () => ({
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
    estimateProviderCost: () => null,
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function openDb(name: string): Database.Database {
  const db = new Database(join(scratch, name));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  cleanups.push(() => db.close());
  return db;
}

function buildLegacyDb(name: string): Database.Database {
  const db = openDb(name);
  runMigrations(db);
  return db;
}

interface DbShape {
  tables: string[];
  columnsByTable: Record<string, string[]>;
  indexesByTable: Record<string, string[]>;
}

function introspect(db: Database.Database): DbShape {
  const tables = (
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE 'prompts_fts_%' AND name != '__drizzle_migrations'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  const columnsByTable: Record<string, string[]> = {};
  const indexesByTable: Record<string, string[]> = {};
  for (const table of tables) {
    columnsByTable[table] = (
      db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>
    ).map((col) => `${col.name}:${col.type}:${col.notnull}:${String(col.dflt_value)}:${col.pk}`);
    indexesByTable[table] = (
      db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
        name: string;
        unique: number;
        partial: number;
      }>
    )
      .filter((idx) => !idx.name.startsWith('sqlite_autoindex'))
      .map((idx) => `${idx.name}:${idx.unique}:${idx.partial}`)
      .sort();
  }
  return { tables, columnsByTable, indexesByTable };
}

function seedLegacyData(db: Database.Database): void {
  const now = Date.now();
  db.prepare(
    'INSERT INTO prompts (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('p1', '测试提示词', '一只在月光下的猫', now, now);
  db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)').run(
    't1',
    '风格/水彩',
    now,
  );
  db.prepare('INSERT INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)').run('p1', 't1');
  db.prepare(
    'INSERT INTO workbench_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run('s1', '新设计', now, now);
  db.prepare(
    `INSERT INTO generation_runs
       (id, run_kind, workbench_session_id, provider_id, model, base_prompt, final_prompt,
        params_json, prompt_snapshot_json, status, created_at)
     VALUES (?, 'free_generation', 's1', 'prov-1', 'flux', ?, ?, '{}', '{}', 'success', ?)`,
  ).run('r1', '一只猫', '一只猫', now);
  db.prepare(
    `INSERT INTO generated_assets (id, run_id, position, status, media_path, created_at)
     VALUES ('a1', 'r1', 0, 'available', '/tmp/a1.png', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO providers (id, name, type, base_url, model, created_at, updated_at)
     VALUES ('prov-1', '网关', 'openai-compatible', 'https://gw.example', 'flux', ?, ?)`,
  ).run(now, now);
  // 旧账本行(含引用与成图):迁移 0002 应把它完整回填进 generation_runs / generated_assets。
  db.prepare(
    `INSERT INTO history
       (id, prompt_id, provider_id, model, prompt_text, status, image_path, cost, cost_unit, created_at)
     VALUES ('h1', 'p1', 'prov-1', 'flux', '一只猫', 'success', '/tmp/h1.png', 60, 'point', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO history_prompt_references
       (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
     VALUES ('h1', 'p1', '测试提示词', '一只在月光下的猫', 'full', 0)`,
  ).run();
}

describe('takeoverDesktopDatabase', () => {
  it('legacy 链接管后与全新库收敛到同一形状(单账本:history 已退役)', () => {
    // 增量迁移开始改动共享表(0002 加列、0003 DROP history)后,
    // 等价点从 baseline 移到迁移链头:接管旧库跑完增量 ≡ 全新库跑完全链。
    const legacy = buildLegacyDb('legacy-shape.db');
    expect(takeoverDesktopDatabase(legacy).mode).toBe('adopted');
    const fresh = openDb('fresh-shape.db');
    expect(takeoverDesktopDatabase(fresh).mode).toBe('fresh');

    const adoptedShape = introspect(legacy);
    const freshShape = introspect(fresh);
    expect(adoptedShape.tables).toEqual(freshShape.tables);
    expect(adoptedShape.tables).not.toContain('history');
    expect(adoptedShape.tables).not.toContain('history_prompt_references');
    for (const table of freshShape.tables) {
      expect(adoptedShape.columnsByTable[table], `表 ${table} 列不一致`).toEqual(
        freshShape.columnsByTable[table],
      );
      expect(adoptedShape.indexesByTable[table], `表 ${table} 索引不一致`).toEqual(
        freshShape.indexesByTable[table],
      );
    }
  });

  it('既有库接管:先备份,零搬运保数据,重入为 noop', () => {
    const db = buildLegacyDb('legacy-adopt.db');
    seedLegacyData(db);
    const backupDir = join(scratch, 'backups-adopt');

    const first = takeoverDesktopDatabase(db, { backupDir });
    expect(first.mode).toBe('adopted');
    expect(first.backupPath && existsSync(first.backupPath)).toBe(true);

    const counts = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(counts('prompts')).toBeGreaterThanOrEqual(1);
    expect(
      db.prepare("SELECT title FROM prompts WHERE id = 'p1'").get() as { title: string },
    ).toEqual({ title: '测试提示词' });

    // 单账本回填(0002):旧 history 行 h1 迁入 generation_runs(同 id)+ 成图落资产,
    // 引用内嵌进 prompt_snapshot_json;随后 0003 DROP 两张旧表。
    expect(counts('generation_runs')).toBe(2);
    expect(counts('generated_assets')).toBe(2);
    const backfilled = db
      .prepare(
        `SELECT run_kind, prompt_id, provider_id, status, actual_cost, final_prompt, prompt_snapshot_json
       FROM generation_runs WHERE id = 'h1'`,
      )
      .get() as Record<string, unknown>;
    expect(backfilled).toMatchObject({
      run_kind: 'free_generation',
      prompt_id: 'p1',
      provider_id: 'prov-1',
      status: 'success',
      actual_cost: 60,
      final_prompt: '一只猫',
    });
    expect(JSON.parse(backfilled.prompt_snapshot_json as string).promptReferences).toEqual([
      { promptId: 'p1', title: '测试提示词', excerpt: '一只在月光下的猫', scope: 'full' },
    ]);
    expect(
      db
        .prepare(
          "SELECT run_id, position, status, media_path FROM generated_assets WHERE id = 'h1'",
        )
        .get(),
    ).toEqual({ run_id: 'h1', position: 0, status: 'available', media_path: '/tmp/h1.png' });
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'history'").get(),
    ).toBeUndefined();

    // 增量迁移(0001 workbench_drafts)在被接管的旧库上也已应用
    db.prepare(
      "INSERT INTO workbench_drafts (session_id, draft_json, updated_at) VALUES ('s1', '{}', 1)",
    ).run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM workbench_drafts').get()).toEqual({ n: 1 });

    const again = takeoverDesktopDatabase(db, { backupDir });
    expect(again.mode).toBe('noop');
    expect(again.backupPath).toBeNull();

    // 备份可打开且含同样数据
    const backup = new Database(first.backupPath as string, { readonly: true });
    cleanups.push(() => backup.close());
    expect((backup.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number }).n).toBe(
      counts('prompts'),
    );
  });

  it('全新空库走 baseline,必需表齐备且 FTS 可写', () => {
    const db = openDb('fresh-full.db');
    const result = takeoverDesktopDatabase(db);
    expect(result.mode).toBe('fresh');
    for (const table of REQUIRED_TABLES) {
      expect(
        db
          .prepare("SELECT 1 AS x FROM sqlite_master WHERE name = ? AND type IN ('table','view')")
          .get(table),
        `表 ${table} 缺失`,
      ).toBeTruthy();
    }
    db.prepare(
      "INSERT INTO prompts_fts (rowid, title, description, content, tags_index) VALUES (1, 't', '', 'c', '')",
    ).run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM prompts_fts').get()).toEqual({ n: 1 });
  });

  it('legacy 链未到终态的库拒绝接管', () => {
    const db = buildLegacyDb('legacy-stale.db');
    db.pragma(`user_version = ${LEGACY_FINAL_USER_VERSION - 1}`);
    expect(() => takeoverDesktopDatabase(db)).toThrow(/user_version/);
  });
});
