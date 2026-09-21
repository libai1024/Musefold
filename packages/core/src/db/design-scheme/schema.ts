/**
 * 设计方案数据域使用独立数据库，不依赖已移除的旧模板系统。
 *
 * 表结构对应 docs/v0.3.2/V03.2-AGENT-RUNTIME-DEVELOPMENT.md §10；
 * document_json 等 JSON 字段必须先通过 shared/design-scheme 的 zod 校验再写入。
 */

export const DESIGN_SCHEME_DB_FILENAME = 'musefold-design-scheme-v0.3.2.db';
export const DESIGN_SCHEME_DB_NAMESPACE = 'v0.3.2-design-scheme';
export const DESIGN_SCHEME_DB_SCHEMA_VERSION = 11;

export const DESIGN_SCHEME_DB_BOOTSTRAP_SQL = `
CREATE TABLE design_scheme_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE design_scheme_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
`;

export const DESIGN_SCHEME_SOURCE_TABLES_SQL = `
CREATE TABLE source_packages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('github', 'history', 'user-brief')),
  repository_url TEXT,
  license TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE source_snapshots (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES source_packages(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  commit_hash TEXT,
  content_hash TEXT,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  scan_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ds_source_snapshots_package
  ON source_snapshots(package_id, created_at DESC);

CREATE TABLE source_files (
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'other')),
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  store_key TEXT,
  text_content TEXT,
  PRIMARY KEY (snapshot_id, path)
);
`;

export const DESIGN_SCHEME_CORE_TABLES_SQL = `
CREATE TABLE design_schemes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'formal')),
  source_presentation TEXT NOT NULL CHECK (source_presentation IN ('skill', 'musefold-created')),
  source_label TEXT NOT NULL DEFAULT '',
  current_revision_id TEXT NOT NULL,
  working_draft_revision_id TEXT,
  cover_asset_id TEXT,
  fidelity TEXT NOT NULL CHECK (fidelity IN ('verified', 'faithful', 'adapted', 'unsupported')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK (updated_at >= created_at)
);

CREATE INDEX idx_ds_schemes_status_updated
  ON design_schemes(status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE design_scheme_revisions (
  revision_id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL REFERENCES design_schemes(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document_json TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('agent', 'user', 'import')),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ds_revisions_scheme
  ON design_scheme_revisions(scheme_id, created_at DESC);

CREATE TABLE design_scheme_source_bindings (
  revision_id TEXT NOT NULL REFERENCES design_scheme_revisions(revision_id) ON DELETE CASCADE,
  source_snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  role TEXT NOT NULL CHECK (role IN ('normative', 'reference', 'example', 'context')),
  PRIMARY KEY (revision_id, source_snapshot_id)
);

CREATE TABLE design_scheme_assets (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES design_scheme_revisions(revision_id) ON DELETE CASCADE,
  store_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cover', 'example', 'reference')),
  origin TEXT NOT NULL CHECK (origin IN ('repository', 'local-run')),
  license TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ds_assets_revision
  ON design_scheme_assets(revision_id, created_at);
`;

export const DESIGN_SCHEME_RUN_TABLES_SQL = `
CREATE TABLE design_scheme_runs (
  run_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES design_scheme_revisions(revision_id),
  mode TEXT NOT NULL CHECK (mode IN ('trial', 'formal')),
  status TEXT NOT NULL CHECK (status IN (
    'planning', 'executing', 'evaluating', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  policy_json TEXT NOT NULL,
  provider_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_ds_runs_revision
  ON design_scheme_runs(revision_id, created_at DESC);

CREATE TABLE design_scheme_run_steps (
  run_id TEXT NOT NULL REFERENCES design_scheme_runs(run_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  input_json TEXT,
  output_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (run_id, step_id)
);
`;

/** 市场候选缓存（开发规范 §10：market_candidates；Explorer 只能写这里）。 */
export const MARKET_CANDIDATE_TABLES_SQL = `
CREATE TABLE market_candidates (
  candidate_id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_market_candidates_query
  ON market_candidates(query, created_at DESC);
`;

/** 分享包索引（开发规范 §10：share_packages；.musefold.design 导出记录）。 */
export const SHARE_PACKAGE_TABLES_SQL = `
CREATE TABLE share_packages (
  package_id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL REFERENCES design_schemes(id),
  manifest_json TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_share_packages_scheme
  ON share_packages(scheme_id, created_at DESC);
`;

/** P01-2：本地方案 optimistic locking；不改变 revision 不可变语义。 */
export const DESIGN_SCHEME_VERSION_TABLES_SQL = `
ALTER TABLE design_schemes ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
`;

/**
 * v6（P01-2 canonical 详情元数据）：资产与来源文件补充可空元数据列。
 *
 * - design_scheme_assets：mime_type / width / height / byte_size / content_hash，
 *   供 canonical 详情映射（designSchemeAssetSchema 全部必填）。
 * - source_files：mime_type / evidence_path，供 path-free 来源快照读模型。
 * - 全部可空：旧库迁移不重写既有行；缺失元数据由主进程读路径懒回填
 *   （真实 stat/hash/魔数探测），读模型不伪造。
 */
export const DESIGN_SCHEME_METADATA_COLUMNS_SQL = `
ALTER TABLE design_scheme_assets ADD COLUMN mime_type TEXT;
ALTER TABLE design_scheme_assets ADD COLUMN width INTEGER;
ALTER TABLE design_scheme_assets ADD COLUMN height INTEGER;
ALTER TABLE design_scheme_assets ADD COLUMN byte_size INTEGER;
ALTER TABLE design_scheme_assets ADD COLUMN content_hash TEXT;
ALTER TABLE source_files ADD COLUMN mime_type TEXT;
ALTER TABLE source_files ADD COLUMN evidence_path TEXT;
`;

/** v7：接收 canonical uploaded 来源；重建 CHECK，保留 v6 资产与全部元数据。 */
export const DESIGN_SCHEME_UPLOADED_ASSET_ORIGIN_SQL = `
CREATE TABLE design_scheme_assets_v7 (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES design_scheme_revisions(revision_id) ON DELETE CASCADE,
  store_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cover', 'example', 'reference')),
  origin TEXT NOT NULL CHECK (origin IN ('repository', 'local-run', 'uploaded')),
  license TEXT,
  created_at INTEGER NOT NULL,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  content_hash TEXT
);
INSERT INTO design_scheme_assets_v7
  (id, revision_id, store_key, role, origin, license, created_at,
   mime_type, width, height, byte_size, content_hash)
SELECT id, revision_id, store_key, role, origin, license, created_at,
       mime_type, width, height, byte_size, content_hash
FROM design_scheme_assets;
DROP TABLE design_scheme_assets;
ALTER TABLE design_scheme_assets_v7 RENAME TO design_scheme_assets;
CREATE INDEX idx_ds_assets_revision ON design_scheme_assets(revision_id, created_at);
`;

/** v8：保留云试运行的真实来源与 output 角色，不改写既有资产或成功试运行资格。 */
export const DESIGN_SCHEME_CLOUD_RUN_ASSET_SQL = `
CREATE TABLE design_scheme_assets_v8 (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES design_scheme_revisions(revision_id) ON DELETE CASCADE,
  store_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cover', 'example', 'reference', 'output')),
  origin TEXT NOT NULL CHECK (origin IN ('repository', 'local-run', 'uploaded', 'cloud-run')),
  license TEXT,
  created_at INTEGER NOT NULL,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  content_hash TEXT
);
INSERT INTO design_scheme_assets_v8
  (id, revision_id, store_key, role, origin, license, created_at,
   mime_type, width, height, byte_size, content_hash)
SELECT id, revision_id, store_key, role, origin, license, created_at,
       mime_type, width, height, byte_size, content_hash
FROM design_scheme_assets;
DROP TABLE design_scheme_assets;
ALTER TABLE design_scheme_assets_v8 RENAME TO design_scheme_assets;
CREATE INDEX idx_ds_assets_revision ON design_scheme_assets(revision_id, created_at);
`;

/** 质量门证据（开发规范 §10：design_scheme_evaluations）。 */
export const DESIGN_SCHEME_EVALUATION_TABLES_SQL = `
CREATE TABLE design_scheme_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES design_scheme_runs(run_id) ON DELETE CASCADE,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  metrics_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ds_evaluations_run
  ON design_scheme_evaluations(run_id, created_at DESC);
`;

/**
 * v9：分享导入崩溃孤儿回收意图（D02.5/D02.1）。
 * root_name 是受管 design-scheme-imports/ 根下的一级目录名（dsch_<32hex>）。
 * 意图行先于任何删除落库；崩溃中断后由下次 owner 启动续跑。
 * 刻意不外键到资产/来源表：意图只描述「目录无主待删」，不随作品级联删除。
 */
export const DESIGN_SCHEME_IMPORT_GC_TABLES_SQL = `
CREATE TABLE design_scheme_import_gc (
  root_name TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('pending', 'blocked')),
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX idx_ds_import_gc_due
  ON design_scheme_import_gc(state, next_attempt_at);
`;
