// electron/db/migrations/0002_fix_fts.ts
// 修复 FTS：外部内容表（content='prompts'）误声明 → 独立 FTS5 表 + repo 层显式同步。
//
// 背景（真实 bug，E2E 首测即暴露）：
//   prompts_fts 声明为 content='prompts'，但 tags_index 是 JS 侧派生列、
//   prompts 表并无该物理列 → 每次 INSERT prompts 触发器回读 content 表报
//   `no such column: T.tags_index` → **prompt.create 全线失败**，提示词库不可用。
//
// 本迁移：删除旧触发器与旧 FTS 表 → 建独立 FTS 表 → 用 JS 分词全量重建索引。
// 幂等：只要发现旧结构就重建；已是新结构则只补建缺失索引行。

import type Database from 'better-sqlite3';
import { tokenizeForFts } from '../fts';

export function up(db: Database.Database): void {
  // 1. 丢弃旧触发器（新架构由 repo 层显式同步，触发器无法调用 JS 分词）
  for (const t of ['prompts_ai', 'prompts_ad', 'prompts_au']) {
    db.exec(`DROP TRIGGER IF EXISTS ${t};`);
  }

  // 2. 判断现有 prompts_fts 是否为旧的 external-content 结构
  const ftsDef = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='prompts_fts'")
    .get() as { sql?: string } | undefined;
  const isExternalContent = !!ftsDef?.sql && /content\s*=\s*'prompts'/i.test(ftsDef.sql);

  if (isExternalContent || !ftsDef) {
    db.exec('DROP TABLE IF EXISTS prompts_fts;');
    db.exec(`
      CREATE VIRTUAL TABLE prompts_fts USING fts5(
        title, description, content, tags_index,
        tokenize='unicode61'
      );
    `);
  }

  // 3. 全量重建索引（JS 分词写入 tags_index）
  const rows = db
    .prepare('SELECT rowid, id, title, description, content FROM prompts')
    .all() as { rowid: number; id: string; title: string; description: string | null; content: string }[];

  const tagsOf = db.prepare(
    'SELECT t.name AS name FROM prompt_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.prompt_id = ?'
  );
  const insert = db.prepare(
    'INSERT INTO prompts_fts (rowid, title, description, content, tags_index) VALUES (?, ?, ?, ?, ?)'
  );

  db.exec('DELETE FROM prompts_fts;');
  for (const r of rows) {
    const tagNames = (tagsOf.all(r.id) as { name: string }[]).map((x) => x.name);
    const tagsIndex = tokenizeForFts(r.title, r.description, r.content, tagNames);
    insert.run(r.rowid, r.title, r.description ?? '', r.content, tagsIndex);
  }
}
