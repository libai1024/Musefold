// electron/db/schema.ts
// 建表 DDL —— 详见 docs/02-data-model.md §2

export const SCHEMA_SQL = `
-- 文件夹（先建，被 prompts 引用）
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_sort ON folders(sort_order);

-- 提示词
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  content_negative TEXT,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  model_id TEXT,
  params TEXT,
  preview_image_path TEXT,
  rating INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  pin_order INTEGER,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  source TEXT,
  source_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prompts_folder ON prompts(folder_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prompts_model ON prompts(model_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prompts_pinned ON prompts(is_pinned, pin_order) WHERE deleted_at IS NULL AND is_pinned = 1;
CREATE INDEX IF NOT EXISTS idx_prompts_updated ON prompts(updated_at DESC) WHERE deleted_at IS NULL;

-- 标签
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tag_group TEXT,
  color TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tags_group ON tags(tag_group);

-- 提示词-标签关系
CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag ON prompt_tags(tag_id);

-- 生成历史
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  negative_text TEXT,
  params TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  image_path TEXT,
  cost INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_prompt ON history(prompt_id);
CREATE INDEX IF NOT EXISTS idx_history_status ON history(status);

-- 历史记录引用的提示词快照（工作台可引用多条或局部文本）
CREATE TABLE IF NOT EXISTS history_prompt_references (
  history_id TEXT NOT NULL REFERENCES history(id) ON DELETE CASCADE,
  prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
  prompt_title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('full', 'excerpt')),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (history_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_history_prompt_refs_prompt
  ON history_prompt_references(prompt_id);
CREATE INDEX IF NOT EXISTS idx_history_prompt_refs_history
  ON history_prompt_references(history_id, sort_order);

-- 智能集合 + 搜索历史（DIF-06）
CREATE TABLE IF NOT EXISTS smart_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_smart_sets_sort ON smart_sets(sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  used_at INTEGER NOT NULL
);
	CREATE INDEX IF NOT EXISTS idx_search_history_used ON search_history(used_at DESC);

-- Provider 配置
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  has_key INTEGER DEFAULT 0,
  key_suffix TEXT,
  is_active INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 豆包网页桥接请求限额：按豆包账号名与本机自然日计数。
CREATE TABLE IF NOT EXISTS doubao_web_daily_usage (
  usage_scope TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK(request_count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (usage_scope, usage_date)
);

-- FTS5 全文搜索（**独立表**，rowid 与 prompts.rowid 对齐）
--
-- 为什么不用 external-content（content='prompts'）：
--   tags_index 是「JS 侧预分词后的派生列」，prompts 表里并不存在该物理列。
--   external-content 表在写入时会回读 content 表的同名列，必然报
--   "no such column: T.tags_index"（历史 bug：导致 prompt.create 全线失败）。
-- 为什么不用触发器同步：
--   中文检索依赖 JS 侧分词，SQL 触发器无法调用 JS。
--   因此 FTS 由 repo 层显式维护（见 repositories/prompts.ts syncFts/removeFts），
--   所有写路径（create/update/softDelete/restore/purge）必须走 repo。
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  title, description, content, tags_index,
  tokenize='unicode61'
);

`;
