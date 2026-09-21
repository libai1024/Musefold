import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP_MIGRATIONS } from '../../packages/desktop-db/src/migrations.generated';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

/**
 * desktop-db 迁移必须内联进 `src/migrations.generated.ts`(asar 读不到 migrations/)。
 * 与 `packages/desktop-db/scripts/bundle-migrations.ts` 同构:按 journal 读 SQL,hash 为整文件 sha256。
 * 纯读断言,不 shell out,避免改工作树。
 */

interface JournalEntry {
  when: number;
  tag: string;
  breakpoints: boolean;
}

const desktopDb = join(REPO_ROOT, 'packages/desktop-db');
const migrationsDir = join(desktopDb, 'migrations');

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

describe('desktop-db bundle freshness', () => {
  it('generated bundle 与 migrations/*.sql + journal 同步', () => {
    const entries = readJournal();
    const bundled = DESKTOP_MIGRATIONS;
    const sqlFiles = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    expect(sqlFiles).toEqual(entries.map((entry) => `${entry.tag}.sql`).sort());
    expect(bundled).toHaveLength(entries.length);
    expect(bundled.length).toBeGreaterThan(0);

    for (const [index, entry] of entries.entries()) {
      const query = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(query).digest('hex');
      const item = bundled[index];
      expect(item?.hash, `${entry.tag} hash`).toBe(hash);
      expect(item?.folderMillis, `${entry.tag} when`).toBe(entry.when);
      expect(item?.bps, `${entry.tag} breakpoints`).toBe(entry.breakpoints);
      expect(item?.sql, `${entry.tag} statements`).toEqual(
        query.split('--> statement-breakpoint').map((part) => part.trim()),
      );
    }
  });
});
