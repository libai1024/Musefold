// electron/db/migrations/0001_initial.ts
// Main library database: prompts, history, providers and organization metadata.

import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { SCHEMA_SQL } from '../schema';
import { SEED_TAG_GROUPS } from '@musefold/domain/constants';
import { seedLibrary } from '../seed-library';

export function up(db: Database.Database): void {
  db.exec(SCHEMA_SQL);

  // 预设标签 seed
  const now = Date.now();
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO tags (id, name, tag_group, created_at) VALUES (?, ?, ?, ?)'
  );
  for (const { group, tags } of SEED_TAG_GROUPS) {
    for (const name of tags) {
      insertTag.run(ulid(), name, group, now);
    }
  }

  seedLibrary(db);
}
