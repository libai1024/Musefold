// 把 migrations/(journal + SQL)内联为 src/migrations.generated.ts:
// Electron 打包(asar)后主进程无法读迁移目录,运行时只吃这份常量。
// 每次 drizzle-kit generate / export-baseline-sql 之后必须重跑本脚本(pnpm run db:bundle)。

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface JournalEntry {
  when: number;
  tag: string;
  breakpoints: boolean;
}

const migrationsDir = resolve('migrations');
const journal = JSON.parse(readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
  entries: JournalEntry[];
};

// 与 drizzle-orm readMigrationFiles 同构(sql 按 breakpoint 分割,hash 为整文件 sha256)。
const migrations = journal.entries.map((entry) => {
  const query = readFileSync(resolve(migrationsDir, `${entry.tag}.sql`), 'utf8');
  return {
    sql: query.split('--> statement-breakpoint').map((it) => it.trim()),
    bps: entry.breakpoints,
    folderMillis: entry.when,
    hash: createHash('sha256').update(query).digest('hex'),
  };
});

const banner = `// 由 scripts/bundle-migrations.ts 生成,勿手改;重新生成:pnpm --filter @musefold/desktop-db run db:bundle
import type { MigrationMeta } from 'drizzle-orm/migrator';

export const DESKTOP_MIGRATIONS: MigrationMeta[] = `;

writeFileSync(
  resolve('src/migrations.generated.ts'),
  `${banner}${JSON.stringify(migrations, null, 2)};\n`,
);
console.log(`bundled ${migrations.length} migrations -> src/migrations.generated.ts`);
