/**
 * 本地资产不变量聚焦单测：
 * - selectCover 封面来源（provenance）：只接受当前选中 revision 的本机试运行产物，
 *   仓库图 / 参考图 / 其他 revision 资产一律拒绝且不改封面；
 * - insertLocalRunAsset：storeKey 形状与元数据完整性校验（镜像 canonical 契约）；
 * - backfillAssetMetadata：全 NULL 补齐、完整行不覆盖、部分残片行整体以探测结果重写。
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import { runDesignSchemeDbMigrations } from '../migrations';
import { DesignSchemeRepository } from '../repositories';

const VALID_METADATA = {
  mimeType: 'image/png',
  width: 512,
  height: 512,
  byteSize: 128,
  contentHash: 'd'.repeat(64),
};

function documentFixture(revisionId = 'dsrv_inv_1'): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId,
    schemeId: 'dsch_inv',
    name: '资产不变量测试方案',
    summary: '封面来源与元数据校验单测',
    fidelity: 'adapted',
    sources: [{ id: 'src_brief', kind: 'user-brief', role: 'context' }],
    inputs: [
      { id: 'topic', label: '主题', kind: 'text', required: true },
      {
        id: 'main_image',
        label: '主体图片',
        kind: 'image',
        required: true,
        imageRole: 'subject-reference',
      },
    ],
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

describe('DesignSchemeRepository 本地资产不变量', () => {
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

  function seedSuccessfulTrial(revisionId: string, runId: string): void {
    repository.insertRun({ runId, revisionId, mode: 'trial', policy: {} });
    repository.updateRunStatus(runId, 'completed');
  }

  /** 绕过 insertLocalRunAsset 的固定 origin/role，直插任意来源的资产行。 */
  function insertAssetRow(input: {
    id: string;
    revisionId?: string;
    role: 'cover' | 'example' | 'reference';
    origin: 'repository' | 'local-run';
    storeKey?: string;
  }): string {
    db.prepare(
      `INSERT INTO design_scheme_assets (id, revision_id, store_key, role, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.revisionId ?? 'dsrv_inv_1',
      input.storeKey ?? 'previews/source.png',
      input.role,
      input.origin,
      Date.now(),
    );
    return input.id;
  }

  describe('selectCover 封面来源', () => {
    it('当前 revision 的本机试运行 example 资产可设为封面', () => {
      seedSuccessfulTrial('dsrv_inv_1', 'dsr_inv_ok');
      const assetId = repository.insertLocalRunAsset('dsrv_inv_1', 'previews/run.png');
      const updated = repository.selectCover('dsch_inv', assetId);
      expect(updated.coverAssetId).toBe(assetId);
      expect(updated.coverImagePath).toBe('previews/run.png');
    });

    it('当前 revision 的本机 cover 角色资产同样可设为封面', () => {
      seedSuccessfulTrial('dsrv_inv_1', 'dsr_inv_cover_role');
      const assetId = insertAssetRow({ id: 'dsa_cover_role', role: 'cover', origin: 'local-run' });
      expect(repository.selectCover('dsch_inv', assetId).coverAssetId).toBe(assetId);
    });

    it('仓库示例图被拒绝且不改封面、不递增版本；之后仍可正常选择合法封面', () => {
      seedSuccessfulTrial('dsrv_inv_1', 'dsr_inv_repo');
      const repoAssetId = insertAssetRow({
        id: 'dsa_repo_pic',
        role: 'example',
        origin: 'repository',
      });
      const before = repository.requireSummary('dsch_inv');
      expect(() => repository.selectCover('dsch_inv', repoAssetId)).toThrow(/仓库示例图/);
      const after = repository.requireSummary('dsch_inv');
      expect(after.coverAssetId).toBeNull();
      expect(after.version).toBe(before.version);

      const legitAssetId = repository.insertLocalRunAsset('dsrv_inv_1', 'previews/legit.png');
      expect(repository.selectCover('dsch_inv', legitAssetId).coverAssetId).toBe(legitAssetId);
    });

    it('参考图（reference 角色）资产被拒绝且不改封面', () => {
      seedSuccessfulTrial('dsrv_inv_1', 'dsr_inv_ref');
      const refAssetId = insertAssetRow({
        id: 'dsa_ref_pic',
        role: 'reference',
        origin: 'local-run',
      });
      const before = repository.requireSummary('dsch_inv');
      expect(() => repository.selectCover('dsch_inv', refAssetId)).toThrow(/参考图/);
      expect(repository.requireSummary('dsch_inv')).toMatchObject({
        coverAssetId: null,
        version: before.version,
      });
    });

    it('其他 revision 的历史资产被拒绝：结构化编辑产生新 revision 后旧资产不可选', () => {
      seedSuccessfulTrial('dsrv_inv_1', 'dsr_inv_old');
      const staleAssetId = repository.insertLocalRunAsset('dsrv_inv_1', 'previews/old.png');
      const { summary } = repository.updateRevisionInputs('dsch_inv', 'dsrv_inv_1', [
        { id: 'topic', required: true },
        { id: 'main_image', required: false },
      ]);
      expect(summary.currentRevisionId).not.toBe('dsrv_inv_1');
      const before = repository.requireSummary('dsch_inv');
      expect(() => repository.selectCover('dsch_inv', staleAssetId)).toThrow(/当前选中版本/);
      expect(repository.requireSummary('dsch_inv')).toMatchObject({
        coverAssetId: null,
        version: before.version,
      });
    });

    it('正式方案的待验证草稿 revision 资产不可选；当前正式 revision 资产可选', () => {
      seedSuccessfulTrial('dsrv_inv_1', 'dsr_inv_formal');
      const formalCoverId = repository.insertLocalRunAsset('dsrv_inv_1', 'previews/formal.png');
      repository.selectCover('dsch_inv', formalCoverId);
      repository.formalize('dsch_inv');

      repository.applyAgentRevision('dsch_inv', 'dsrv_inv_1', documentFixture('dsrv_inv_wd'));
      seedSuccessfulTrial('dsrv_inv_wd', 'dsr_inv_wd');
      const draftAssetId = repository.insertLocalRunAsset('dsrv_inv_wd', 'previews/wd.png');
      const before = repository.requireSummary('dsch_inv');
      expect(() => repository.selectCover('dsch_inv', draftAssetId)).toThrow(/当前选中版本/);
      expect(repository.requireSummary('dsch_inv')).toMatchObject({
        coverAssetId: formalCoverId,
        currentRevisionId: 'dsrv_inv_1',
        version: before.version,
      });
    });

    it('不属于本方案的资产被拒绝（保持原有守卫语义）', () => {
      seedSuccessfulTrial('dsrv_inv_1', 'dsr_inv_foreign');
      const before = repository.requireSummary('dsch_inv');
      expect(() => repository.selectCover('dsch_inv', 'dsa_ghost')).toThrow(/本方案的试运行结果/);
      expect(repository.requireSummary('dsch_inv')).toMatchObject({
        coverAssetId: null,
        version: before.version,
      });
    });
  });

  describe('insertLocalRunAsset 写入校验', () => {
    it('拒绝空 / 纯空白 / 含控制字符的 storeKey，且不落行', () => {
      const count = () =>
        (db.prepare('SELECT COUNT(*) AS n FROM design_scheme_assets').get() as { n: number }).n;
      expect(() => repository.insertLocalRunAsset('dsrv_inv_1', '')).toThrow(/storeKey/);
      expect(() => repository.insertLocalRunAsset('dsrv_inv_1', '   ')).toThrow(/storeKey/);
      expect(() => repository.insertLocalRunAsset('dsrv_inv_1', 'previews/ru\u0000n.png')).toThrow(
        /控制字符/,
      );
      expect(count()).toBe(0);
    });

    it('拒绝不完整 / 不自洽的元数据，且不落行', () => {
      const count = () =>
        (db.prepare('SELECT COUNT(*) AS n FROM design_scheme_assets').get() as { n: number }).n;
      const badInputs = [
        { ...VALID_METADATA, mimeType: 'png' },
        { ...VALID_METADATA, width: 0 },
        { ...VALID_METADATA, height: -1 },
        { ...VALID_METADATA, byteSize: -1 },
        { ...VALID_METADATA, contentHash: 'not-a-hash' },
      ];
      for (const bad of badInputs) {
        expect(() => repository.insertLocalRunAsset('dsrv_inv_1', 'previews/x.png', bad)).toThrow(
          /资产元数据/,
        );
      }
      expect(count()).toBe(0);
    });

    it('合法元数据照常落列；legacy 无元数据保持全 NULL', () => {
      const withMeta = repository.insertLocalRunAsset(
        'dsrv_inv_1',
        'previews/m.png',
        VALID_METADATA,
      );
      const legacy = repository.insertLocalRunAsset('dsrv_inv_1', 'previews/l.png');
      const rows = repository.listAssetMetadataRows('dsch_inv');
      expect(rows.find((row) => row.id === withMeta)).toMatchObject(VALID_METADATA);
      expect(rows.find((row) => row.id === legacy)).toMatchObject({
        mimeType: null,
        width: null,
        height: null,
        byteSize: null,
        contentHash: null,
      });
    });
  });

  describe('backfillAssetMetadata 过期元数据', () => {
    const PROBED = {
      mimeType: 'image/png',
      width: 640,
      height: 480,
      byteSize: 2048,
      contentHash: 'e'.repeat(64),
    };

    it('全 NULL 的 legacy 行被一次性补齐', () => {
      const legacy = repository.insertLocalRunAsset('dsrv_inv_1', 'previews/legacy.png');
      repository.backfillAssetMetadata(legacy, PROBED);
      expect(
        db
          .prepare(
            'SELECT mime_type, width, height, byte_size, content_hash FROM design_scheme_assets WHERE id = ?',
          )
          .get(legacy),
      ).toEqual({
        mime_type: 'image/png',
        width: 640,
        height: 480,
        byte_size: 2048,
        content_hash: 'e'.repeat(64),
      });
    });

    it('五字段齐全的行是权威写入，回填不覆盖', () => {
      const fresh = repository.insertLocalRunAsset(
        'dsrv_inv_1',
        'previews/fresh.png',
        VALID_METADATA,
      );
      repository.backfillAssetMetadata(fresh, PROBED);
      expect(
        db
          .prepare(
            'SELECT mime_type, width, byte_size, content_hash FROM design_scheme_assets WHERE id = ?',
          )
          .get(fresh),
      ).toEqual({
        mime_type: VALID_METADATA.mimeType,
        width: VALID_METADATA.width,
        byte_size: VALID_METADATA.byteSize,
        content_hash: VALID_METADATA.contentHash,
      });
    });

    it('部分残片行不信任既有过期字段：整体以探测结果重写，不拼接新旧', () => {
      const partial = repository.insertLocalRunAsset('dsrv_inv_1', 'previews/partial.png');
      // 模拟历史半截写入：只落了 mime 与宽度（文件此后被替换，字段已过期）。
      db.prepare(
        `UPDATE design_scheme_assets SET mime_type = 'image/jpeg', width = 1 WHERE id = ?`,
      ).run(partial);
      repository.backfillAssetMetadata(partial, PROBED);
      expect(
        db
          .prepare(
            'SELECT mime_type, width, height, byte_size, content_hash FROM design_scheme_assets WHERE id = ?',
          )
          .get(partial),
      ).toEqual({
        mime_type: PROBED.mimeType,
        width: PROBED.width,
        height: PROBED.height,
        byte_size: PROBED.byteSize,
        content_hash: PROBED.contentHash,
      });
    });

    it('回填入参同样经过元数据完整性校验', () => {
      const legacy = repository.insertLocalRunAsset('dsrv_inv_1', 'previews/guard.png');
      expect(() =>
        repository.backfillAssetMetadata(legacy, { ...PROBED, contentHash: 'zz' }),
      ).toThrow(/资产元数据/);
      expect(
        db.prepare('SELECT content_hash FROM design_scheme_assets WHERE id = ?').get(legacy),
      ).toEqual({ content_hash: null });
    });
  });
});
