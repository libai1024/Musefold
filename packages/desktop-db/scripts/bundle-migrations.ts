// 把 migrations/(journal + SQL)内联为 src/migrations.generated.ts:
// Electron 打包(asar)后主进程无法读迁移目录,运行时只吃这份常量。
// 每次 drizzle-kit generate / export-baseline-sql 之后必须重跑本脚本(pnpm run db:bundle)。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const generatedPath = resolve('src/migrations.generated.ts');
writeFileSync(generatedPath, `${banner}${JSON.stringify(migrations, null, 2)};\n`);

// JSON.stringify 是双引号;仓内 biome quoteStyle=single。不格式化则 CI
// `git diff --exit-code -- packages/desktop-db/src/migrations.generated.ts` 会误报漏 bundle。
const biome = resolve('..', '..', 'node_modules/.bin/biome');
if (!existsSync(biome)) {
  throw new Error('找不到仓库根 biome,无法格式化 migrations.generated.ts');
}
execFileSync(biome, ['format', '--write', generatedPath], { stdio: 'inherit' });
console.log(`bundled ${migrations.length} migrations -> src/migrations.generated.ts`);
