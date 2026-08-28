// 一次性工具:用 core 的 legacy 迁移链(0001→0020)构建终态库文件,
// 供 drizzle-kit pull 生成 baseline(schema.ts + 0000_baseline.sql)。
// M5c 删除 core 时本脚本随之退役;此前一致性由 __tests__/takeover.test.ts 守护。

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runMigrations } from '@musefold/core/db/run-migrations';
import { configureCoreRuntime } from '@musefold/core/runtime';
import Database from 'better-sqlite3';

const target = resolve(process.argv[2] ?? '.drizzle-pull/legacy-final.db');

mkdirSync(dirname(target), { recursive: true });
rmSync(target, { force: true });

const scratch = dirname(target);
configureCoreRuntime({
  getPaths: () => ({
    userData: scratch,
    db: target,
    backups: `${scratch}/backups`,
    previews: `${scratch}/previews`,
    pictures: `${scratch}/pictures`,
    logs: `${scratch}/logs`,
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

const db = new Database(target);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
runMigrations(db);
db.close();

console.log(`legacy final schema at ${target}`);
