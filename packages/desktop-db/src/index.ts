// 桌面 SQLite 的 Drizzle 受管层(V25-DATA-MIGRATION §1,M4-e):
// - 既有库(core legacy 链 0001→0020 终态)经「备份 → fake-apply baseline → 校验」原库接管,
//   零数据搬运;此后 schema 变更全部走 drizzle-kit generate → 审阅 → migrate。
// - 全新空库直接执行 baseline(忠实 DDL,含 CHECK / partial 索引 / prompts_fts)。
// 迁移内容以内联常量随包分发(migrations.generated.ts),不依赖运行时文件系统。

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DESKTOP_MIGRATIONS } from './migrations.generated';
import * as schema from './schema';

export * as desktopSchema from './schema';

/** legacy 链(core run-migrations)的最终 user_version;接管的唯一合法起点。 */
export const LEGACY_FINAL_USER_VERSION = 20;

/** 接管与迁移后必须存在的表(缺一即视为库损坏,拒绝启动)。 */
export const REQUIRED_TABLES = [
  'folders',
  'prompts',
  'tags',
  'prompt_tags',
  'history',
  'history_prompt_references',
  'smart_sets',
  'search_history',
  'providers',
  'doubao_web_daily_usage',
  'automation_audit',
  'workbench_sessions',
  'generation_runs',
  'generated_assets',
  'cloud_sync_accounts',
  'cloud_entity_state',
  'cloud_sync_outbox',
  'cloud_sync_conflicts',
  'cloud_sync_usage_outbox',
  'workbench_drafts',
  'prompts_fts',
  '__drizzle_migrations',
] as const;

export interface TakeoverOptions {
  /** 接管一瞬的 VACUUM INTO 备份目录;省略则不备份(仅测试可省略)。 */
  backupDir?: string;
  now?: () => Date;
}

export interface TakeoverResult {
  /** fresh=全新库(真跑 baseline);adopted=既有库接管;noop=早已受管。 */
  mode: 'fresh' | 'adopted' | 'noop';
  backupPath: string | null;
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
      .get(table),
  );
}

function backupInto(db: Database.Database, backupDir: string, now: () => Date): string {
  mkdirSync(backupDir, { recursive: true });
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  let target = join(backupDir, `db-v25-takeover-${stamp}.db`);
  if (existsSync(target)) target = join(backupDir, `db-v25-takeover-${stamp}-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

/** 既有库结构 ≡ baseline(由测试守护),把 baseline 标记为已应用而不执行。 */
function fakeApplyBaseline(db: Database.Database): void {
  const baseline = DESKTOP_MIGRATIONS[0];
  if (!baseline) throw new Error('desktop-db 迁移常量为空,包构建产物损坏');
  db.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  db.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(
    baseline.hash,
    baseline.folderMillis,
  );
}

function runDrizzleMigrations(db: Database.Database): void {
  const orm = drizzle(db, { schema }) as unknown as {
    dialect: {
      migrate(migrations: typeof DESKTOP_MIGRATIONS, session: unknown, config?: unknown): void;
    };
    session: unknown;
  };
  orm.dialect.migrate(DESKTOP_MIGRATIONS, orm.session);
}

export function verifyDesktopDatabase(db: Database.Database): void {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    throw new Error(`桌面库完整性校验失败:${String(integrity)}`);
  }
  for (const table of REQUIRED_TABLES) {
    if (!tableExists(db, table)) {
      throw new Error(`桌面库缺少必需表 ${table},拒绝启动(备份见 backups 目录)`);
    }
  }
}

/**
 * Drizzle 接管入口。要求既有库已由 legacy 链升到终态(user_version=20);
 * 任何一步失败即抛错且不写入接管标记,旧库保持原样(备份先行)。
 */
export function takeoverDesktopDatabase(
  db: Database.Database,
  options: TakeoverOptions = {},
): TakeoverResult {
  const now = options.now ?? (() => new Date());
  const alreadyManaged = tableExists(db, '__drizzle_migrations');
  const hasLegacyData = tableExists(db, 'prompts');

  let mode: TakeoverResult['mode'] = 'noop';
  let backupPath: string | null = null;

  if (!alreadyManaged) {
    if (hasLegacyData) {
      const userVersion = db.pragma('user_version', { simple: true }) as number;
      if (userVersion !== LEGACY_FINAL_USER_VERSION) {
        throw new Error(
          `桌面库 user_version=${userVersion},接管要求 legacy 迁移链已到 ${LEGACY_FINAL_USER_VERSION}(先经 core runMigrations)`,
        );
      }
      if (options.backupDir) backupPath = backupInto(db, options.backupDir, now);
      fakeApplyBaseline(db);
      mode = 'adopted';
    } else {
      mode = 'fresh';
    }
  }

  runDrizzleMigrations(db);
  verifyDesktopDatabase(db);
  return { mode, backupPath };
}

/** 类型化查询入口(增量采用;既有裸 SQL 读写不强改)。 */
export function createDesktopOrm(db: Database.Database) {
  return drizzle(db, { schema });
}
