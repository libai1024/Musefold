// 接管正确性守护(至 M5c 删除 core legacy 链前,双体系一致性以此为准):
// 1) baseline(忠实 DDL)建的空库 ≡ legacy 链(core 0001→0020)建的库(对象/列/索引集合);
// 2) 既有库接管零数据搬运、先备份、可重入;3) 非终态旧库拒绝接管。
// 测试住在 core 而非 desktop-db:依赖方向是 core → desktop-db(initDb 内嵌接管),
// desktop-db 保持零 workspace 依赖,而本测试需要 core 的 legacy 链建旧库。

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEGACY_FINAL_USER_VERSION,
  REQUIRED_TABLES,
  takeoverDesktopDatabase,
  verifyDesktopDatabase,
} from '@musefold/desktop-db';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
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

function applyBundledMigrations(db: Database.Database, count: number): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  const apply = db.transaction(() => {
    for (const migration of DESKTOP_MIGRATIONS.slice(0, count)) {
      for (const statement of migration.sql) db.exec(statement);
      db.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(
        migration.hash,
        migration.folderMillis,
      );
    }
  });

  const foreignKeysWereEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  if (foreignKeysWereEnabled) db.pragma('foreign_keys = OFF');
  try {
    apply();
  } finally {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = ON');
  }
}

function buildManaged0004Db(name: string): Database.Database {
  const db = openDb(name);
  applyBundledMigrations(db, 5);
  return db;
}

function seedLegacySyncConsentCases(db: Database.Database): void {
  const cases = [
    { ownerId: 'enabled', enabled: 1, bootstrapAt: null, lastSyncAt: null },
    { ownerId: 'bootstrap', enabled: 0, bootstrapAt: 201, lastSyncAt: null },
    { ownerId: 'last-sync', enabled: 0, bootstrapAt: null, lastSyncAt: 301 },
    { ownerId: 'entity-state', enabled: 0, bootstrapAt: null, lastSyncAt: null },
    { ownerId: 'mutation-outbox', enabled: 0, bootstrapAt: null, lastSyncAt: null },
    { ownerId: 'usage-outbox', enabled: 0, bootstrapAt: null, lastSyncAt: null },
    { ownerId: 'unresolved-conflict', enabled: 0, bootstrapAt: null, lastSyncAt: null },
    { ownerId: 'no-evidence', enabled: 0, bootstrapAt: null, lastSyncAt: null },
    { ownerId: 'device-only', enabled: 0, bootstrapAt: null, lastSyncAt: null },
    { ownerId: 'resolved-conflict', enabled: 0, bootstrapAt: null, lastSyncAt: null },
  ] as const;
  const insertAccount = db.prepare(
    `INSERT INTO cloud_sync_accounts (
       owner_id, username, device_id, device_name, platform, client_version,
       active, enabled, cursor, bootstrap_completed_at, last_sync_at, last_error,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'Test device', 'macos', '2.5.0', 0, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertWorkspace = db.prepare(
    `INSERT INTO local_workspaces (id, owner_id, kind, created_at, updated_at)
     VALUES (?, ?, 'account', ?, ?)`,
  );

  cases.forEach((item, index) => {
    const updatedAt = 1_000 + index;
    insertAccount.run(
      item.ownerId,
      `user-${item.ownerId}`,
      `device-${item.ownerId}`,
      item.enabled,
      String(100 + index),
      item.bootstrapAt,
      item.lastSyncAt,
      `retained-${item.ownerId}`,
      900 + index,
      updatedAt,
    );
    if (
      [
        'entity-state',
        'mutation-outbox',
        'usage-outbox',
        'unresolved-conflict',
        'resolved-conflict',
      ].includes(item.ownerId)
    ) {
      insertWorkspace.run(`account:${item.ownerId}`, item.ownerId, updatedAt, updatedAt);
    }
  });

  db.prepare(
    `INSERT INTO cloud_entity_state (
       owner_id, workspace_id, entity_type, local_id, cloud_id, cloud_version,
       last_synced_hash, remote_snapshot_json, sync_status, last_synced_at
     ) VALUES ('entity-state', 'account:entity-state', 'prompt', 'local-1', 'cloud-1', 4,
       'hash-1', '{"title":"retained"}', 'clean', 401)`,
  ).run();
  db.prepare(
    `INSERT INTO cloud_sync_outbox (
       mutation_id, owner_id, workspace_id, entity_type, entity_id, operation,
       base_version, payload_json, created_at, attempt_count, next_attempt_at, last_error
     ) VALUES ('mutation-1', 'mutation-outbox', 'account:mutation-outbox', 'prompt',
       'prompt-1', 'update', 3, '{"content":"retained"}', 501, 2, 601, 'retry')`,
  ).run();
  db.prepare(
    `INSERT INTO cloud_sync_usage_outbox (
       event_id, owner_id, workspace_id, prompt_id, action, created_at,
       attempt_count, next_attempt_at, last_error
     ) VALUES ('usage-1', 'usage-outbox', 'account:usage-outbox', 'prompt-2', 'copy',
       701, 1, 801, 'retry')`,
  ).run();
  const insertConflict = db.prepare(
    `INSERT INTO cloud_sync_conflicts (
       id, owner_id, workspace_id, entity_type, entity_id, mutation_id, base_version,
       local_snapshot_json, remote_snapshot_json, detected_at, resolved_at, resolution
     ) VALUES (?, ?, ?, 'prompt', ?, ?, 2, '{"content":"local"}',
       '{"content":"remote"}', ?, ?, ?)`,
  );
  insertConflict.run(
    'conflict-unresolved',
    'unresolved-conflict',
    'account:unresolved-conflict',
    'prompt-3',
    'mutation-3',
    901,
    null,
    null,
  );
  insertConflict.run(
    'conflict-resolved',
    'resolved-conflict',
    'account:resolved-conflict',
    'prompt-4',
    'mutation-4',
    902,
    903,
    'remote',
  );
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

  it('0004 受管库升级:分类 legacy consent 且完整保留四张同步账本', () => {
    const db = buildManaged0004Db('managed-0004-sync.db');
    seedLegacySyncConsentCases(db);

    expect(takeoverDesktopDatabase(db).mode).toBe('noop');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({
      count: DESKTOP_MIGRATIONS.length,
    });

    const consentRows = db
      .prepare(
        `SELECT owner_id, consent_state, consent_decided_at, consent_version, cursor, last_error
         FROM cloud_sync_accounts ORDER BY owner_id`,
      )
      .all() as Array<{
      owner_id: string;
      consent_state: string;
      consent_decided_at: number | null;
      consent_version: number;
      cursor: string;
      last_error: string;
    }>;
    const byOwner = new Map(consentRows.map((row) => [row.owner_id, row]));
    expect(byOwner.get('enabled')).toMatchObject({
      consent_state: 'enabled',
      consent_decided_at: 1_000,
      consent_version: 1,
      cursor: '100',
      last_error: 'retained-enabled',
    });
    for (const ownerId of [
      'bootstrap',
      'last-sync',
      'entity-state',
      'mutation-outbox',
      'usage-outbox',
      'unresolved-conflict',
    ]) {
      expect(byOwner.get(ownerId), ownerId).toMatchObject({
        consent_state: 'paused',
        consent_version: 1,
      });
      expect(byOwner.get(ownerId)?.consent_decided_at, ownerId).not.toBeNull();
    }
    for (const ownerId of ['no-evidence', 'device-only', 'resolved-conflict']) {
      expect(byOwner.get(ownerId), ownerId).toMatchObject({
        consent_state: 'unset',
        consent_decided_at: null,
        consent_version: 1,
      });
    }

    expect(
      db
        .prepare(
          `SELECT owner_id, workspace_id, entity_type, local_id, cloud_id, cloud_version,
                  last_synced_hash, remote_snapshot_json, sync_status, last_synced_at
           FROM cloud_entity_state`,
        )
        .get(),
    ).toEqual({
      owner_id: 'entity-state',
      workspace_id: 'account:entity-state',
      entity_type: 'prompt',
      local_id: 'local-1',
      cloud_id: 'cloud-1',
      cloud_version: 4,
      last_synced_hash: 'hash-1',
      remote_snapshot_json: '{"title":"retained"}',
      sync_status: 'clean',
      last_synced_at: 401,
    });
    expect(db.prepare('SELECT * FROM cloud_sync_outbox').get()).toMatchObject({
      mutation_id: 'mutation-1',
      owner_id: 'mutation-outbox',
      workspace_id: 'account:mutation-outbox',
      payload_json: '{"content":"retained"}',
      attempt_count: 2,
      next_attempt_at: 601,
      last_error: 'retry',
    });
    expect(db.prepare('SELECT * FROM cloud_sync_usage_outbox').get()).toMatchObject({
      event_id: 'usage-1',
      owner_id: 'usage-outbox',
      workspace_id: 'account:usage-outbox',
      attempt_count: 1,
      next_attempt_at: 801,
      last_error: 'retry',
    });
    expect(
      db
        .prepare(
          `SELECT id, owner_id, workspace_id, resolved_at, resolution
           FROM cloud_sync_conflicts ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: 'conflict-resolved',
        owner_id: 'resolved-conflict',
        workspace_id: 'account:resolved-conflict',
        resolved_at: 903,
        resolution: 'remote',
      },
      {
        id: 'conflict-unresolved',
        owner_id: 'unresolved-conflict',
        workspace_id: 'account:unresolved-conflict',
        resolved_at: null,
        resolution: null,
      },
    ]);

    const accountSql = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cloud_sync_accounts'",
        )
        .get() as { sql: string }
    ).sql;
    for (const constraint of [
      'cloud_sync_accounts_platform_check',
      'cloud_sync_accounts_active_check',
      'cloud_sync_accounts_enabled_check',
      'cloud_sync_accounts_cursor_check',
      'cloud_sync_accounts_consent_state_check',
      'cloud_sync_accounts_consent_version_check',
    ]) {
      expect(accountSql).toContain(constraint);
    }
    for (const [column, value] of [
      ['platform', 'other'],
      ['active', 2],
      ['enabled', 2],
      ['cursor', 'not-a-cursor'],
      ['consent_state', 'invalid'],
      ['consent_version', 0],
    ] as const) {
      expect(() =>
        db
          .prepare(`UPDATE cloud_sync_accounts SET ${column} = ? WHERE owner_id = 'enabled'`)
          .run(value),
      ).toThrow(/CHECK constraint failed/);
    }
  });

  it('迁移拒绝事务内调用并恢复调用前的 foreign_keys 状态', () => {
    const db = openDb('migration-transaction-guard.db');
    expect(() => db.transaction(() => takeoverDesktopDatabase(db))()).toThrow(/事务外/);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

    db.pragma('foreign_keys = OFF');
    expect(takeoverDesktopDatabase(db).mode).toBe('fresh');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
  });

  it('数据库验收拒绝外键孤儿', () => {
    const db = openDb('foreign-key-check.db');
    takeoverDesktopDatabase(db);
    db.pragma('foreign_keys = OFF');
    db.prepare(
      `INSERT INTO cloud_sync_usage_outbox (
         event_id, owner_id, workspace_id, prompt_id, action, created_at,
         attempt_count, next_attempt_at
       ) VALUES ('orphan', 'missing-owner', 'missing-workspace', 'prompt-1', 'copy', 1, 0, 0)`,
    ).run();
    db.pragma('foreign_keys = ON');

    expect(() => verifyDesktopDatabase(db)).toThrow(/外键校验失败/);
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
