/**
 * v6 元数据列仓储单测：来源文件 mime/evidence 持久化、资产元数据写入与懒回填、
 * canonical 读模型（path-free 来源快照 / 含 storeKey 的资产行）。
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import { runDesignSchemeDbMigrations } from '../migrations';
import { DesignSchemeRepository } from '../repositories';

const FULL_METADATA = {
  mimeType: 'image/png',
  width: 1024,
  height: 1536,
  byteSize: 2048,
  contentHash: 'a'.repeat(64),
};

function documentFixture(revisionId = 'dsrv_meta_1'): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId,
    schemeId: 'dsch_meta',
    name: '元数据测试方案',
    summary: 'v6 元数据列单测',
    fidelity: 'adapted',
    sources: [{ id: 'src_brief', kind: 'user-brief', role: 'context' }],
    inputs: [{ id: 'topic', label: '主题', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'pm_1',
        order: 0,
        kind: 'input-template',
        template: '{{topic}}',
        variables: ['topic'],
        sourceIds: ['src_brief'],
      },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'test', connectionName: 'test' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  };
}

describe('DesignSchemeRepository v6 元数据切片', () => {
  let db: Database.Database;
  let repository: DesignSchemeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    runDesignSchemeDbMigrations(db);
    repository = new DesignSchemeRepository(db);
    repository.insertSchemeDraft({
      document: documentFixture(),
      sourceLabel: 'Musefold 创建',
      sourcePresentation: 'musefold-created',
      createdBy: 'agent',
      bindings: [],
    });
  });

  afterEach(() => {
    db.close();
  });

  function seedSnapshot(
    files: Parameters<DesignSchemeRepository['saveSourceSnapshot']>[0]['files'],
  ) {
    const saved = repository.saveSourceSnapshot({
      package: {
        id: 'pkg_meta',
        kind: 'github',
        repositoryUrl: 'https://github.com/acme/meta',
        license: 'MIT',
      },
      snapshot: { id: 'snap_meta', ref: 'main', commitHash: null, totalBytes: 0, scan: {} },
      files,
    });
    db.prepare(
      `INSERT INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
       VALUES ('dsrv_meta_1', ?, 'normative')`,
    ).run(saved.snapshotId);
    return saved;
  }

  it('saveSourceSnapshot 持久化 mimeType/evidencePath；缺省为 NULL', () => {
    seedSnapshot([
      {
        path: 'SKILL.md',
        kind: 'text',
        contentHash: 'h1',
        sizeBytes: 10,
        textContent: '# 规则',
        mimeType: 'text/markdown',
        evidencePath: 'SKILL.md',
      },
      {
        path: 'examples/a.png',
        kind: 'image',
        contentHash: 'h2',
        sizeBytes: 33,
        storeKey: 'design-scheme-sources/snap_meta/examples/a.png',
      },
    ]);

    const rows = db
      .prepare('SELECT path, mime_type, evidence_path FROM source_files ORDER BY path')
      .all() as Array<{ path: string; mime_type: string | null; evidence_path: string | null }>;
    expect(rows).toEqual([
      { path: 'SKILL.md', mime_type: 'text/markdown', evidence_path: 'SKILL.md' },
      {
        path: 'examples/a.png',
        mime_type: null,
        evidence_path: null,
      },
    ]);
  });

  it('insertLocalRunAsset 带元数据落列；不带元数据保持 NULL（legacy 形态）', () => {
    const withMeta = repository.insertLocalRunAsset('dsrv_meta_1', '/tmp/a.png', FULL_METADATA);
    const legacy = repository.insertLocalRunAsset('dsrv_meta_1', '/tmp/b.png');
    const row = (id: string) =>
      db
        .prepare(
          'SELECT mime_type, width, height, byte_size, content_hash FROM design_scheme_assets WHERE id = ?',
        )
        .get(id) as Record<string, unknown>;
    expect(row(withMeta)).toEqual({
      mime_type: FULL_METADATA.mimeType,
      width: FULL_METADATA.width,
      height: FULL_METADATA.height,
      byte_size: FULL_METADATA.byteSize,
      content_hash: FULL_METADATA.contentHash,
    });
    expect(row(legacy)).toEqual({
      mime_type: null,
      width: null,
      height: null,
      byte_size: null,
      content_hash: null,
    });
  });

  it('backfillAssetMetadata 只补全 NULL 行，不覆盖已有元数据', () => {
    const legacy = repository.insertLocalRunAsset('dsrv_meta_1', '/tmp/legacy.png');
    const fresh = repository.insertLocalRunAsset('dsrv_meta_1', '/tmp/fresh.png', FULL_METADATA);

    repository.backfillAssetMetadata(legacy, {
      mimeType: 'image/png',
      width: 64,
      height: 64,
      byteSize: 33,
      contentHash: 'b'.repeat(64),
    });
    expect(
      db
        .prepare(
          'SELECT mime_type, width, height, byte_size, content_hash FROM design_scheme_assets WHERE id = ?',
        )
        .get(legacy),
    ).toEqual({
      mime_type: 'image/png',
      width: 64,
      height: 64,
      byte_size: 33,
      content_hash: 'b'.repeat(64),
    });

    // 已有完整元数据的行不被回填覆盖。
    repository.backfillAssetMetadata(fresh, {
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
      byteSize: 1,
      contentHash: 'c'.repeat(64),
    });
    expect(
      db
        .prepare(
          'SELECT mime_type, width, byte_size, content_hash FROM design_scheme_assets WHERE id = ?',
        )
        .get(fresh),
    ).toEqual({
      mime_type: 'image/png',
      width: 1024,
      byte_size: 2048,
      content_hash: 'a'.repeat(64),
    });
  });

  it('listAssetMetadataRows 返回元数据与 storeKey，只含本方案资产行', () => {
    expect(repository.listAssetMetadataRows('dsch_meta')).toEqual([]);
    repository.insertLocalRunAsset('dsrv_meta_1', '/tmp/a.png', FULL_METADATA);

    const rows = repository.listAssetMetadataRows('dsch_meta');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      revisionId: 'dsrv_meta_1',
      storeKey: '/tmp/a.png',
      role: 'example',
      origin: 'local-run',
      mimeType: 'image/png',
      width: 1024,
      height: 1536,
      byteSize: 2048,
      contentHash: 'a'.repeat(64),
    });
    expect(repository.listAssetMetadataRows('dsch_other')).toEqual([]);
  });

  it('listSourceSnapshotMetadata 返回 path-free 文件元数据与截断节选', () => {
    seedSnapshot([
      {
        path: 'SKILL.md',
        kind: 'text',
        contentHash: 'h1',
        sizeBytes: 10,
        textContent: 'x'.repeat(2500),
        mimeType: 'text/markdown',
        evidencePath: 'SKILL.md',
      },
    ]);
    repository.insertLocalRunAsset('dsrv_meta_1', '/tmp/a.png');

    const snapshots = repository.listSourceSnapshotMetadata('dsch_meta');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      snapshotId: 'snap_meta',
      packageId: 'pkg_meta',
      packageKind: 'github',
      repositoryUrl: 'https://github.com/acme/meta',
      ref: 'main',
      totalBytes: 0,
    });
    const file = snapshots[0].files[0];
    expect(file).toEqual({
      path: 'SKILL.md',
      kind: 'text',
      sizeBytes: 10,
      contentHash: 'h1',
      mimeType: 'text/markdown',
      evidencePath: 'SKILL.md',
      textExcerpt: 'x'.repeat(2000),
    });
    // path-free：文件行不携带 storeKey 键。
    expect(file).not.toHaveProperty('storeKey');
  });

  it('listSourceSnapshotMetadata 用显式 revision 且拒绝跨方案 revision', () => {
    seedSnapshot([
      { path: 'a.md', kind: 'text', contentHash: 'h1', sizeBytes: 1, textContent: 'a' },
    ]);
    repository.applyAgentRevision('dsch_meta', 'dsrv_meta_1', documentFixture('dsrv_meta_2'));
    expect(repository.listSourceSnapshotMetadata('dsch_meta', 'dsrv_meta_2')).toHaveLength(1);
    expect(repository.listSourceSnapshotMetadata('dsch_meta', 'dsrv_missing')).toEqual([]);
  });
});
