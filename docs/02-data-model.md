# 02 · 数据模型

> DB schema、三层数据模型、FTS5 中文搜索、迁移机制、"另存为 Prompt"打通。

---

## 1. 数据库总览

- **引擎**：better-sqlite3，同步 API，WAL 模式（读写并发友好）
- **位置**：
  - macOS：`~/Library/Application Support/PromptForge/data.db`
  - Windows：`%APPDATA%/PromptForge/data.db`
- **图片目录**：`userData/previews/`（预览图）、`~/Pictures/PromptForge/`（生成图）
- **备份**：启动时若 schema 版本升级，先备份到 `backups/db-{timestamp}.db`

---

## 2. 完整 Schema DDL

### 2.1 提示词库

```sql
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,              -- ULID
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  content_negative TEXT,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  model_id TEXT,                    -- 适配模型，单独字段便于高频筛选
  params TEXT,                      -- JSON 参数包 {schema_version, ...}
  preview_image_path TEXT,           -- 相对 userData 的路径
  rating INTEGER DEFAULT 0,          -- 0-5
  is_pinned INTEGER DEFAULT 0,
  pin_order INTEGER,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  source TEXT,                       -- manual | import | shared | composition
  source_url TEXT,
  composition_id TEXT,              -- 若来自 Composition，保留外键（可空）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                 -- 软删除
);

CREATE INDEX idx_prompts_folder ON prompts(folder_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_prompts_model ON prompts(model_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_prompts_pinned ON prompts(is_pinned, pin_order) WHERE deleted_at IS NULL AND is_pinned = 1;
CREATE INDEX idx_prompts_updated ON prompts(updated_at DESC) WHERE deleted_at IS NULL;
```

### 2.2 文件夹与标签

```sql
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,  -- 最多 2 层（应用层约束）
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tag_group TEXT,                    -- 风格 | 场景 | 模型 | 主体 | 画质
  color TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_tags_group ON tags(tag_group);

CREATE TABLE prompt_tags (
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);
```

### 2.3 组合系统三层数据

```sql
CREATE TABLE fragments (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                -- subject|style|lighting|composition|camera|quality|negative|custom
  content TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  weightable INTEGER DEFAULT 1,      -- bool
  tags TEXT,                         -- JSON string[]
  category TEXT,                     -- 如 "lighting/dramatic"
  compatible_models TEXT,            -- JSON string[]
  source TEXT,                       -- user | builtin | community
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_fragments_type ON fragments(type) WHERE deleted_at IS NULL;
CREATE INDEX idx_fragments_category ON fragments(category) WHERE deleted_at IS NULL;

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL,                -- 带 {{slot}} 的骨架
  negative_body TEXT,
  slots TEXT NOT NULL,               -- JSON Slot[]
  params TEXT,                       -- JSON 参数包
  target TEXT,                       -- a1111|comfyui|midjourney|flux|openai|generic
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE compositions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  slot_fills TEXT NOT NULL,          -- JSON {slotKey: {fragmentId, weightOverride, textOverride}}
  rendered_positive TEXT,
  rendered_negative TEXT,
  params TEXT,                       -- JSON
  seed INTEGER,
  preview_image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_compositions_template ON compositions(template_id) WHERE deleted_at IS NULL;
```

### 2.4 生成历史

```sql
CREATE TABLE history (
  id TEXT PRIMARY KEY,
  prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
  composition_id TEXT REFERENCES compositions(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  negative_text TEXT,
  params TEXT,                       -- JSON：size/quality/n/background...
  status TEXT NOT NULL,              -- success | failed | cancelled
  error_code TEXT,
  error_message TEXT,
  image_path TEXT,                    -- 成功时为本地文件路径
  cost INTEGER,                       -- 估算成本（分）
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_history_created ON history(created_at DESC);
CREATE INDEX idx_history_prompt ON history(prompt_id);
CREATE INDEX idx_history_status ON history(status);
```

### 2.5 Provider 配置

```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                -- openai | openai-compatible
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,               -- 默认 model 字符串，如 gpt-image-2
  has_key INTEGER DEFAULT 0,         -- 密钥是否已存于 keychain（明文不在 DB）
  key_suffix TEXT,                   -- 末 4 位用于显示
  is_active INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

> **密钥不入 DB**：`providers` 表只存元数据 + `has_key` 标记 + `key_suffix`；真实密钥用 safeStorage 加密后存于 electron-store（key 为 `keys.{providerId}`）。

### 2.6 FTS5 全文搜索

```sql
CREATE VIRTUAL TABLE prompts_fts USING fts5(
  title, description, content, tags_index,
  content_prompts='',
  tokenize='unicode61'               -- 简易按字分词，JS 侧写入预分词结果
);

-- 触发器同步 prompts → prompts_fts
CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, title, description, content, tags_index)
  VALUES (new.rowid, new.title, new.description, new.content, '');
END;
CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
  DELETE FROM prompts_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER prompts_au AFTER UPDATE ON prompts BEGIN
  DELETE FROM prompts_fts WHERE rowid = old.rowid;
  INSERT INTO prompts_fts(rowid, title, description, content, tags_index)
  VALUES (new.rowid, new.title, new.description, new.content, '');
END;
```

**`tags_index` 列**：提示词的标签拼接字符串，由应用层在保存时计算填入，用于标签名搜索。

**中文分词路径**：
- MVP 用 `unicode61`（按字分，召回率一般但够用）
- 当前实现：由 JS 侧把汉字序列、双字片段与英文词写入 FTS5 列，`tokenize='unicode61'` 负责空白切词

---

## 3. 三层数据模型（组合系统）

详见 [04-composition-engine.md](04-composition-engine.md)，此处只给字段速查。

### Fragment（片段）—— 原子素材
```json
{
  "id": "01J...",
  "type": "lighting",
  "content": "cinematic lighting, volumetric rays",
  "weight": 1.0,
  "weightable": true,
  "tags": ["cinematic", "dramatic"],
  "category": "lighting/dramatic",
  "compatibleModels": ["sd15", "sdxl", "flux"],
  "source": "builtin"
}
```

### Template（模板）—— 带变量槽位的骨架
```json
{
  "id": "01J...",
  "name": "电影感人像",
  "body": "{{subject}}, {{style}}, {{lighting}}, {{composition}}, {{quality}}",
  "negativeBody": "{{negative_common}}, {{negative_portrait}}",
  "slots": [
    {"key": "subject", "type": "fragment", "category": "subject/portrait", "required": true},
    {"key": "style", "type": "fragment", "required": true},
    {"key": "lighting", "type": "fragment", "required": false, "default": "soft natural light"},
    {"key": "quality", "type": "text", "default": "8k, sharp focus, detailed"}
  ],
  "params": {"sampler": "DPM++ 2M Karras", "steps": 30, "cfg": 7},
  "target": "a1111"
}
```

### Composition（组合）—— 一次具体填充实例
```json
{
  "id": "01J...",
  "templateId": "01J...",
  "slotFills": {
    "subject": {"fragmentId": "01J...", "weightOverride": 1.3},
    "style": {"fragmentId": "01J...", "weightOverride": 1.0}
  },
  "renderedPositive": "...",
  "renderedNegative": "...",
  "params": {},
  "seed": 12345,
  "previewImage": "file://..."
}
```

---

## 4. 迁移机制

- 用 SQLite `PRAGMA user_version` 做版本号
- 每个迁移一个文件 `migrations/{NNNN_name}.ts`，导出 `up(db)` 函数
- 迁移用事务包裹，失败回滚
- 启动时：读 `user_version` → 跑所有更高版本迁移 → 更新 `user_version`
- 升级前先 `db.backup()` 到 `backups/db-{timestamp}.db`

```ts
// electron/system/migrations.ts
export function runMigrations(db: Database) {
  const current = db.pragma('user_version', { simple: true }) as number;
  const migrations = [
    { version: 1, up: migration_0001_initial },
    // 未来追加：{ version: 2, up: migration_0002_xxx },
  ];
  for (const m of migrations) {
    if (m.version > current) {
      db.transaction(() => m.up(db))();
      db.pragma(`user_version = ${m.version}`);
    }
  }
}
```

---

## 5. "另存为 Prompt"打通

Composition 渲染出的提示词 → "另存为 Prompt"（单向提升，库不被冗余污染）：

```
Composition（画布产物）
  → 用户点击"另存为 Prompt"
  → prompts 表插入一行：
      content = composition.rendered_positive
      content_negative = composition.rendered_negative
      params = composition.params
      model_id = template.target 对应的模型
      source = 'composition'
      composition_id = composition.id（外键，可空，便于反查）
  → prompts 库中正常管理（可再编辑、收藏、标签、生图）
```

**原则**：Composition 是造词工具的中间产物，Prompt 是成品库。另存后两者独立，编辑 Prompt 不回写 Composition。

---

## 6. 数据量与性能预期

- 提示词：几百到几千条，带 params JSON，总量几十 MB
- Fragment：内置 + 用户自建，预计几百到几千
- History：每次生图一条，预计几千（可定期清理）
- FTS5 索引：与 prompts 同量级，搜索 <50ms
- 预览图：几千条带图可能到 GB 级 → 导出支持"仅 DB"和"DB+图片包"两种模式
