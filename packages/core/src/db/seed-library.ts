// electron/db/seed-library.ts
// v0.3.0 首启资源库示例内容（TASK-LIB-15）
//
// 为什么不能走 promptsRepo.create()：数据库初始化期间 db/index.ts 的
// dbInstance 单例还没赋值（要等 runMigrations 整体返回后才赋值），
// repo 层一 getDb() 就会触发第二次 initDb() → 递归 runMigrations()
// 死循环。因此这里和 0002/0003 一样，直接对传入的 db 做原始 SQL，
// FTS 索引也用 tokenizeForFts 直写，不经过 repo。
//
// 幂等：文件夹和 prompt 分别只在对应表为空时 seed，避免干扰已有数据。

import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { PromptParams } from '@shared/types/models';
import { tokenizeForFts } from './fts';

interface SeedPrompt {
  title: string;
  description: string;
  content: string;
  contentNegative?: string;
  folderName: string;
  params: PromptParams;
}

const SEED_PROMPTS: SeedPrompt[] = [
  {
    title: '人像 · 电影感肖像',
    description: '示例提示词 · 可随时编辑或删除',
    content:
      'cinematic portrait of a young woman, soft rim light, 85mm lens, shallow depth of field, film grain',
    contentNegative: 'blurry, deformed hands, extra fingers, watermark',
    folderName: '人物',
    params: { schemaVersion: 1, size: '1024x1536', quality: 'high', n: 1 },
  },
  {
    title: '场景 · 赛博朋克街道',
    description: '示例提示词 · 可随时编辑或删除',
    content:
      'cyberpunk city street at night, neon signs reflected in rain puddles, towering skyscrapers, moody atmosphere',
    contentNegative: 'low resolution, overexposed, watermark',
    folderName: '场景',
    params: { schemaVersion: 1, size: '1536x1024', quality: 'high', n: 1 },
  },
  {
    title: '设计素材 · 水彩风景插画',
    description: '示例提示词 · 可随时编辑或删除',
    content:
      'watercolor illustration of a quiet mountain village at sunrise, soft pastel colors, gentle brush strokes',
    contentNegative: 'harsh contrast, oversaturated, watermark',
    folderName: '设计素材',
    params: { schemaVersion: 1, size: '1024x1024', quality: 'high', n: 1 },
  },
];

const SEED_FOLDERS = ['人物', '场景', '设计素材', '实验草稿'] as const;

export function seedLibrary(db: Database.Database): void {
  const now = Date.now();
  const folderCount = db.prepare('SELECT COUNT(*) AS c FROM folders').get() as { c: number };
  if (folderCount.c === 0) {
    const insertFolder = db.prepare(
      'INSERT INTO folders (id, name, parent_id, sort_order, created_at) VALUES (?, ?, NULL, ?, ?)',
    );
    SEED_FOLDERS.forEach((name, index) => insertFolder.run(ulid(), name, index, now));
  }

  const promptCount = db.prepare('SELECT COUNT(*) AS c FROM prompts').get() as { c: number };
  if (promptCount.c !== 0) return;

  const folderIdByName = new Map(
    (db.prepare('SELECT id, name FROM folders').all() as { id: string; name: string }[]).map(
      (f) => [f.name, f.id] as const
    )
  );

  const insertPrompt = db.prepare(
    `INSERT INTO prompts (
       id, title, description, content, content_negative, folder_id, model_id, params,
       preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at,
       source, source_url, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'gpt-image-2', ?, NULL, 0, 0, NULL, 0, NULL, 'manual', NULL, ?, ?, NULL)`
  );
  const insertFts = db.prepare(
    'INSERT INTO prompts_fts (rowid, title, description, content, tags_index) VALUES (?, ?, ?, ?, ?)'
  );

  for (const p of SEED_PROMPTS) {
    const id = ulid();
    const info = insertPrompt.run(
      id,
      p.title,
      p.description,
      p.content,
      p.contentNegative ?? null,
      folderIdByName.get(p.folderName) ?? null,
      JSON.stringify(p.params),
      now,
      now
    );
    const tagsIndex = tokenizeForFts(p.title, p.description, p.content, []);
    insertFts.run(info.lastInsertRowid, p.title, p.description, p.content, tagsIndex);
  }
}
