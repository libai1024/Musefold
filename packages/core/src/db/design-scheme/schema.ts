/**
 * 设计方案数据域使用独立数据库，不依赖已移除的旧模板系统。
 *
 * 表结构对应 docs/v0.3.2/V03.2-AGENT-RUNTIME-DEVELOPMENT.md §10；
 * document_json 等 JSON 字段必须先通过 shared/design-scheme 的 zod 校验再写入。
 */

export const DESIGN_SCHEME_DB_FILENAME = 'musefold-design-scheme-v0.3.2.db';
export const DESIGN_SCHEME_DB_NAMESPACE = 'v0.3.2-design-scheme';
export const DESIGN_SCHEME_DB_SCHEMA_VERSION = 4;

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
