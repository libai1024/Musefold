import Database from 'better-sqlite3';
import { designSchemeDbPath } from './electron-helpers';

// Shared frozen formal-scheme fixture for real Electron workbench/legacy entry tests.
export function seedFormalTextScheme(userData: string, withReferenceInput = false): void {
  const schemeDb = new Database(designSchemeDbPath(userData));
  const now = Date.now();
  const document = {
    schemaVersion: 1,
    revisionId: 'revision_e2e_scheme',
    schemeId: 'scheme_e2e_formal',
    name: 'E2E 文本海报方案',
    summary: '用于工作台运行取消测试',
    fidelity: 'adapted',
    sources: [
      {
        id: 'source_brief',
        kind: 'user-brief',
        role: 'context',
        packageId: 'package_e2e_scheme',
        snapshotId: 'snapshot_e2e_scheme',
      },
    ],
    sourceSnapshotIds: ['snapshot_e2e_scheme'],
    inputs: [
      {
        id: 'topic',
        label: '主题',
        kind: 'text',
        required: true,
        description: '输入海报主题',
      },
      ...(withReferenceInput
        ? [{ id: 'reference', label: '参考图', kind: 'image-set', required: true }]
        : []),
    ],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'module_1',
        order: 0,
        kind: 'input-template',
        template: 'Create a restrained poster about {{topic}}',
        variables: ['topic'],
        sourceIds: ['source_brief'],
      },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'e2e-fixture', connectionName: 'E2E fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  };
  schemeDb.transaction(() => {
    schemeDb
      .prepare(
        `INSERT INTO source_packages (id, kind, repository_url, license, created_at)
         VALUES ('package_e2e_scheme', 'user-brief', NULL, NULL, ?)`,
      )
      .run(now);
    schemeDb
      .prepare(
        `INSERT INTO source_snapshots
           (id, package_id, ref, commit_hash, content_hash, total_bytes, scan_json, created_at)
         VALUES ('snapshot_e2e_scheme', 'package_e2e_scheme', 'e2e-seed', NULL, NULL, 0, '{}', ?)`,
      )
      .run(now);
    schemeDb
      .prepare(
        `INSERT INTO design_schemes
           (id, name, summary, status, source_presentation, source_label, current_revision_id,
            working_draft_revision_id, cover_asset_id, fidelity, version, created_at, updated_at,
            deleted_at)
         VALUES ('scheme_e2e_formal', 'E2E 文本海报方案', '用于工作台运行取消测试',
           'formal', 'musefold-created', 'E2E 本地种子', 'revision_e2e_scheme', NULL,
           'asset_e2e_cover', 'adapted', 1, ?, ?, NULL)`,
      )
      .run(now, now);
    schemeDb
      .prepare(
        `INSERT INTO design_scheme_revisions
           (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
         VALUES ('revision_e2e_scheme', 'scheme_e2e_formal', 1, ?, 'user', ?)`,
      )
      .run(JSON.stringify(document), now);
    schemeDb
      .prepare(
        `INSERT INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
         VALUES ('revision_e2e_scheme', 'snapshot_e2e_scheme', 'context')`,
      )
      .run();
    schemeDb
      .prepare(
        `INSERT INTO design_scheme_runs
           (run_id, revision_id, mode, status, policy_json, provider_json, created_at, completed_at)
         VALUES ('run_e2e_seed', 'revision_e2e_scheme', 'trial', 'completed', '{}', NULL, ?, ?)`,
      )
      .run(now, now);
    schemeDb
      .prepare(
        `INSERT INTO design_scheme_assets
           (id, revision_id, store_key, role, origin, license, mime_type, width, height,
            byte_size, content_hash, created_at)
         VALUES ('asset_e2e_cover', 'revision_e2e_scheme', 'e2e-fixture-cover', 'cover',
           'local-run', NULL, 'image/png', 1, 1, 0, ?, ?)`,
      )
      .run('0'.repeat(64), now);
  })();
  schemeDb.close();
}
