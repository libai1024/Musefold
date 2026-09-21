/**
 * v10: a purged scheme must not erase execution receipts, steps or evaluations.
 * Rebuild the whole run FK graph with foreign_keys enabled throughout. The migration
 * runner wraps all copies, drops, renames and journal updates in one transaction.
 * Original identities remain available after the live revision link is detached.
 */
export const DESIGN_SCHEME_PURGE_TABLES_SQL = `
CREATE TABLE design_scheme_runs_v10 (
  run_id TEXT PRIMARY KEY,
  revision_id TEXT REFERENCES design_scheme_revisions(revision_id),
  mode TEXT NOT NULL CHECK (mode IN ('trial', 'formal')),
  status TEXT NOT NULL CHECK (status IN (
    'planning', 'executing', 'evaluating', 'completed', 'blocked', 'failed', 'cancelled'
  )),
  policy_json TEXT NOT NULL,
  provider_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  origin_scheme_id TEXT,
  origin_revision_id TEXT,
  CHECK (revision_id IS NOT NULL OR (
    origin_scheme_id IS NOT NULL AND origin_revision_id IS NOT NULL
    AND status IN ('completed', 'blocked', 'failed', 'cancelled')
  ))
);
INSERT INTO design_scheme_runs_v10
  (run_id, revision_id, mode, status, policy_json, provider_json, created_at,
   completed_at, origin_scheme_id, origin_revision_id)
SELECT run.run_id, run.revision_id, run.mode, run.status, run.policy_json,
       run.provider_json, run.created_at, run.completed_at, revision.scheme_id, run.revision_id
FROM design_scheme_runs run
LEFT JOIN design_scheme_revisions revision ON revision.revision_id = run.revision_id;

CREATE TABLE design_scheme_run_steps_v10 (
  run_id TEXT NOT NULL REFERENCES design_scheme_runs_v10(run_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  input_json TEXT,
  output_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (run_id, step_id)
);
INSERT INTO design_scheme_run_steps_v10 SELECT * FROM design_scheme_run_steps;

CREATE TABLE design_scheme_evaluations_v10 (
  evaluation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES design_scheme_runs_v10(run_id) ON DELETE CASCADE,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  metrics_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO design_scheme_evaluations_v10 SELECT * FROM design_scheme_evaluations;

DROP TABLE design_scheme_run_steps;
DROP TABLE design_scheme_evaluations;
DROP TABLE design_scheme_runs;
ALTER TABLE design_scheme_runs_v10 RENAME TO design_scheme_runs;
ALTER TABLE design_scheme_run_steps_v10 RENAME TO design_scheme_run_steps;
ALTER TABLE design_scheme_evaluations_v10 RENAME TO design_scheme_evaluations;
CREATE INDEX idx_ds_runs_revision ON design_scheme_runs(revision_id, created_at DESC);
CREATE INDEX idx_ds_runs_origin ON design_scheme_runs(origin_scheme_id, created_at DESC);
CREATE INDEX idx_ds_evaluations_run ON design_scheme_evaluations(run_id, created_at DESC);

CREATE TABLE design_scheme_purge_identities (
  scheme_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  retired_keys INTEGER NOT NULL CHECK (retired_keys >= 0),
  deferred_keys INTEGER NOT NULL CHECK (deferred_keys >= 0),
  purged_at INTEGER NOT NULL
);
CREATE TABLE design_scheme_purge_revision_identities (
  revision_id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL REFERENCES design_scheme_purge_identities(scheme_id),
  purged_at INTEGER NOT NULL
);

CREATE TRIGGER prevent_purged_scheme_insert BEFORE INSERT ON design_schemes
WHEN EXISTS (SELECT 1 FROM design_scheme_purge_identities WHERE scheme_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'DESIGN_SCHEME_PURGED'); END;
CREATE TRIGGER prevent_purged_scheme_update BEFORE UPDATE OF id ON design_schemes
WHEN EXISTS (SELECT 1 FROM design_scheme_purge_identities WHERE scheme_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'DESIGN_SCHEME_PURGED'); END;
CREATE TRIGGER prevent_purged_revision_insert BEFORE INSERT ON design_scheme_revisions
WHEN EXISTS (SELECT 1 FROM design_scheme_purge_revision_identities WHERE revision_id = NEW.revision_id)
  OR EXISTS (SELECT 1 FROM design_scheme_purge_identities WHERE scheme_id = NEW.scheme_id)
BEGIN SELECT RAISE(ABORT, 'DESIGN_SCHEME_PURGED'); END;
CREATE TRIGGER prevent_purged_revision_update BEFORE UPDATE OF revision_id, scheme_id ON design_scheme_revisions
WHEN EXISTS (SELECT 1 FROM design_scheme_purge_revision_identities WHERE revision_id = NEW.revision_id)
  OR EXISTS (SELECT 1 FROM design_scheme_purge_identities WHERE scheme_id = NEW.scheme_id)
BEGIN SELECT RAISE(ABORT, 'DESIGN_SCHEME_PURGED'); END;
`;

/** v11: file deletion intent is atomic with scheme deletion in this independent database. */
export const DESIGN_SCHEME_PURGE_CLEANUP_SQL = `
CREATE TABLE design_scheme_asset_cleanup (
  path TEXT PRIMARY KEY,
  device TEXT,
  inode TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'blocked')),
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX idx_ds_asset_cleanup_due ON design_scheme_asset_cleanup(state, next_attempt_at);

CREATE TABLE design_scheme_retained_assets (
  asset_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES design_scheme_runs(run_id) ON DELETE CASCADE,
  store_key TEXT NOT NULL,
  PRIMARY KEY (asset_id, run_id)
);
CREATE INDEX idx_ds_retained_assets_path ON design_scheme_retained_assets(store_key);
CREATE TRIGGER prevent_retained_scheme_asset_insert BEFORE INSERT ON design_scheme_assets
WHEN EXISTS (SELECT 1 FROM design_scheme_retained_assets WHERE asset_id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'DESIGN_SCHEME_ASSET_RETAINED'); END;
CREATE TRIGGER prevent_retained_scheme_asset_update BEFORE UPDATE OF id ON design_scheme_assets
WHEN EXISTS (SELECT 1 FROM design_scheme_retained_assets WHERE asset_id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'DESIGN_SCHEME_ASSET_RETAINED'); END;
`;
