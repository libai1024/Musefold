// 一次性工具:从 legacy 链终态库导出忠实 DDL,覆写 drizzle 0000 迁移的 SQL 内容。
// (drizzle-kit introspect/generate 无法完整表达 CHECK/FTS/排序索引,故 SQL 以
//  sqlite_master 为事实源,meta 快照仍由 drizzle-kit generate 维护。)

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

const source = resolve(process.argv[2] ?? '.drizzle-pull/legacy-final.db');
const migrationsDir = resolve('migrations');

const baselineFile = readdirSync(migrationsDir).find((name) => name.startsWith('0000_'));
if (!baselineFile) throw new Error('先运行 drizzle-kit generate 产出 0000 迁移');

const db = new Database(source, { readonly: true, fileMustExist: true });
const rows = db
  .prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE 'prompts_fts_%'
     ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, rowid`,
  )
  .all() as Array<{ type: string; name: string; sql: string }>;
db.close();

const header = `-- v2.5 baseline:core legacy 迁移链(0001→0020)终态的忠实导出(sqlite_master)。
-- 手工审阅并由 packages/core/src/db/__tests__/desktop-db-takeover.test.ts 与 legacy 链逐对象比对;含 CHECK 约束、
-- partial/DESC 索引与 prompts_fts 虚表(这些无法由 drizzle-kit 表达,meta 快照有意不含)。
-- 本文件只在全新空库上执行;既有库经 fake-apply 直接标记为已应用(见 src/takeover.ts)。
`;

const body = rows
  .map((row) => `${row.sql.trim().replace(/;$/, '')};`)
  .join('\n--> statement-breakpoint\n');
writeFileSync(resolve(migrationsDir, baselineFile), `${header}\n${body}\n`);
console.log(`baseline sql rewritten: migrations/${baselineFile} (${rows.length} statements)`);
