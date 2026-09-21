import {
  legacyPackageFixture,
  FULL_PROMPT,
} from '../../../../../../packages/scheme-package/src/__tests__/legacy-fixture';
import { writeDesignSchemePackageBytes } from '@musefold/scheme-package';
import {
  mixedPackage,
  PNG,
} from '../../../../../../packages/scheme-package/src/__tests__/fixtures';
import {
  createWriteStream,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import archiver from 'archiver';
import { loadManagedFilesystem } from '@musefold/managed-fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { designSchemeDetailSchema, DESIGN_SCHEME_WIRE_METHODS } from '@musefold/contracts';
import {
  isDesignSchemeImportSessionHeld,
  sweepDesignSchemeImportOrphans,
} from '@musefold/core/services/design-scheme-import-gc';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import {
  stableContentEntriesHash,
  readValidatedDesignSchemePackage,
  sha256,
  type CanonicalShareManifest,
  type ValidatedDesignSchemePackage,
} from '../package-archive';
import {
  exportDesignScheme,
  importDesignScheme,
  SHARE_FORMAT,
  SHARE_FORMAT_VERSION,
} from '../share';
import { fakePngBuffer } from './evaluation.test';
import { buildDesignSchemesDomainMethods } from '../../ipc-v25/design-scheme-domain';
import { resolveSchemeAssetMediaTarget } from '../asset-store';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
}));

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'musefold-share-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const COMMIT = 'a'.repeat(40);

function documentFixture(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'dsrv_share',
    schemeId: 'dsch_share',
    name: '小黑插画',
    summary: '手绘线条插画方案',
    fidelity: 'faithful',
    sources: [
      {
        id: 'src_repo',
        kind: 'github-skill',
        role: 'normative',
        uri: 'https://github.com/acme/illust',
        commit: COMMIT,
      },
    ],
    inputs: [{ id: 'topic', label: '插画主题', kind: 'text', required: true }],
    parameters: [],
    constraints: [
      {
        id: 'con_1',
        domain: 'texture',
        statement: '保持手绘线条',
        mode: 'required',
        userOverridable: false,
        sourceIds: ['src_repo'],
      },
    ],
    promptProgram: [
      {
        id: 'pm_1',
        order: 0,
        kind: 'input-template',
        template: '为「{{topic}}」创作插画',
        variables: ['topic'],
        sourceIds: ['src_repo'],
      },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'test', connectionName: 'test' },
      adopted: [],
      omitted: [],
      warnings: [],
      briefExcerpt: '插画方案',
      trace: [],
    },
  };
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runDesignSchemeDbMigrations(db);
  return db;
}

/** 建一个可导出的正式方案：来源快照（文本+图片）→ 试运行成功 → 封面 → 转正。 */
function seedFormalScheme(db: Database.Database, userData: string): void {
  const repository = new DesignSchemeRepository(db);

  const sourceImageDir = join(userData, 'design-scheme-sources', 'snap_share');
  mkdirSync(sourceImageDir, { recursive: true });
  writeFileSync(join(sourceImageDir, 'reference.png'), fakePngBuffer(64, 64));

  repository.saveSourceSnapshot({
    package: {
      id: 'pkg_share',
      kind: 'github',
      repositoryUrl: 'https://github.com/acme/illust',
      license: 'MIT',
    },
    snapshot: {
      id: 'snap_share',
      ref: 'main',
      commitHash: COMMIT,
      totalBytes: 128,
      scan: { fileCount: 2 },
    },
    files: [
      {
        path: 'SKILL.md',
        kind: 'text',
        contentHash: 'h1',
        sizeBytes: 20,
        textContent: '# 小黑插画 skill',
      },
      {
        path: 'reference.png',
        kind: 'image',
        contentHash: 'h2',
        sizeBytes: 33,
        storeKey: join('design-scheme-sources', 'snap_share', 'reference.png'),
      },
    ],
  });
  repository.insertSchemeDraft({
    document: documentFixture(),
    sourceLabel: 'acme/illust',
    sourcePresentation: 'skill',
    createdBy: 'agent',
    bindings: [{ snapshotId: 'snap_share', role: 'normative' }],
  });

  repository.insertRun({ runId: 'run_share', revisionId: 'dsrv_share', mode: 'trial', policy: {} });
  repository.updateRunStatus('run_share', 'completed');
  const coverPath = join(userData, 'cover.png');
  writeFileSync(coverPath, fakePngBuffer(1024, 1024));
  const assetId = repository.insertLocalRunAsset('dsrv_share', coverPath);
  repository.selectCover('dsch_share', assetId);
  repository.insertEvaluation('run_share', {
    passed: true,
    metrics: [{ id: 'output-count', status: 'pass' }],
    evidence: [{ path: coverPath, width: 1024, height: 1024 }],
  });
  repository.formalize('dsch_share');
}

describe('exportDesignScheme / importDesignScheme', () => {
  let db: Database.Database;
  let userData: string;

  beforeEach(() => {
    db = makeDb();
    userData = tempRoot();
    seedFormalScheme(db, userData);
  });

  it.each(['replaced', 'removed'] as const)(
    'imports verified package bytes after the staging pathname is %s',
    async (change) => {
      const { manifest, content } = mixedPackage();
      const input = join(tempRoot(), 'verified.musefold.design');
      const verified = await writeDesignSchemePackageBytes(manifest, content);
      writeFileSync(input, verified);
      if (change === 'replaced') writeFileSync(input, 'untrusted replacement');
      else rmSync(input);

      const imported = await importDesignScheme(input, { db, userDataDir: userData }, verified);
      if (!imported.ok) throw new Error(imported.error.message);
      const get = buildDesignSchemesDomainMethods({
        db,
        userDataDir: userData,
        picturesDir: userData,
      })[DESIGN_SCHEME_WIRE_METHODS.get];
      const detail = designSchemeDetailSchema.parse(
        await get.handle(get.input.parse({ id: imported.data.scheme.id })),
      );
      expect(detail.document.name).toBe(manifest.document.name);
      expect(detail.sourceSnapshots).toHaveLength(2);
      expect(detail.assets).toHaveLength(2);
      for (const asset of detail.assets) {
        const target = resolveSchemeAssetMediaTarget(db, asset.id, userData, userData);
        if (!target) throw new Error('Verified package asset missing');
        expect(sha256(readFileSync(target))).toBe(asset.contentHash);
      }
      if (change === 'replaced') expect(readFileSync(input, 'utf8')).toBe('untrusted replacement');
      else expect(fs.existsSync(input)).toBe(false);
    },
  );

  it('rejects invalid supplied bytes without falling back to a valid pathname', async () => {
    const { manifest, content } = mixedPackage();
    const input = join(tempRoot(), 'valid.musefold.design');
    const valid = await writeDesignSchemePackageBytes(manifest, content);
    writeFileSync(input, valid);
    const before = db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get();
    const imported = await importDesignScheme(
      input,
      { db, userDataDir: userData },
      Buffer.from('invalid supplied bytes'),
    );
    expect(imported.ok).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get()).toEqual(before);
    expect(readFileSync(input)).toEqual(valid);
  });

  it('v1旧包经过实际导入得到新草稿并保留旧来源文件', async () => {
    const path = join(tempRoot(), 'legacy-v1.musefold.design');
    const document = Buffer.from(JSON.stringify(documentFixture()));
    const text = Buffer.from('legacy source text');
    const manifest = {
      format: SHARE_FORMAT,
      formatVersion: 1,
      exportedAt: 0,
      scheme: {
        name: '旧包',
        summary: '',
        fidelity: 'faithful',
        sourceLabel: '旧仓库',
        sourcePresentation: 'skill',
      },
      revisionId: 'dsrv_share',
      snapshots: [
        {
          dir: 'old',
          kind: 'github',
          role: 'normative',
          repositoryUrl: 'https://github.com/acme/illust',
          ref: 'main',
          commitHash: COMMIT,
          license: null,
          scan: {},
        },
      ],
      files: { 'scheme.json': sha256(document), 'sources/old/SKILL.md': sha256(text) },
    };
    await writeZipFixture(path, [
      { name: 'manifest.json', content: JSON.stringify(manifest) },
      { name: 'scheme.json', content: document },
      { name: 'sources/old/SKILL.md', content: text },
    ]);
    const imported = await importDesignScheme(path, { db, userDataDir: userData });
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.data.scheme.id).not.toBe('dsch_share');
    expect(imported.data.scheme.status).toBe('draft');
    const repository = new DesignSchemeRepository(db);
    expect(
      repository.listSourceSnapshotMetadata(imported.data.scheme.id)[0].files[0].textExcerpt,
    ).toBe(text.toString('utf8'));
    expect(() => repository.formalize(imported.data.scheme.id)).toThrow();
  });

  it('legacy full sources and preview bytes remain reachable through canonical desktop detail without importing scan authority', async () => {
    const fixture = await legacyPackageFixture(mixedPackage().manifest.document, PNG);
    const input = join(tempRoot(), 'legacy-full.musefold.design');
    writeFileSync(input, await fixture.encode());
    const imported = await importDesignScheme(input, { db, userDataDir: userData });
    if (!imported.ok) throw new Error(imported.error.message);
    const id = imported.data.scheme.id;
    const get = buildDesignSchemesDomainMethods({
      db,
      userDataDir: userData,
      picturesDir: userData,
    })[DESIGN_SCHEME_WIRE_METHODS.get];
    const detail = designSchemeDetailSchema.parse(await get.handle(get.input.parse({ id })));
    expect(detail.sourceSnapshots).toHaveLength(1);
    expect(detail.assets).toHaveLength(2);
    expect(detail.document.sourceSnapshotIds).toEqual([detail.sourceSnapshots[0].id]);
    expect(new Set(detail.document.assetIds)).toEqual(
      new Set(detail.assets.map((asset) => asset.id)),
    );
    expect(detail.sourceSnapshots[0].commitHash).toBeNull();
    expect(detail.sourceSnapshots[0].historyItems).toBeUndefined();
    expect(detail.sourceSnapshots[0].files.find((file) => file.kind === 'text')).toMatchObject({
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(FULL_PROMPT),
    });
    const source = db
      .prepare('SELECT text_content FROM source_files WHERE snapshot_id=? AND kind=?')
      .get(detail.sourceSnapshots[0].id, 'text') as { text_content: string };
    expect(source.text_content).toBe(FULL_PROMPT);
    expect(detail.summary).toMatchObject({
      status: 'draft',
      hasSuccessfulTrial: false,
      coverAssetId: null,
    });
    expect(detail.document).toMatchObject({ createdBy: 'import', parentRevisionId: null });
    for (const asset of detail.assets) {
      const target = resolveSchemeAssetMediaTarget(db, asset.id, userData, userData);
      if (!target) throw new Error('Missing imported image content');
      expect(sha256(readFileSync(target))).toBe(asset.contentHash);
    }
    expect(() => new DesignSchemeRepository(db).formalize(id)).toThrow();
  });

  it('v1包外壳合法但旧文档无效时不发布半成品', async () => {
    const path = join(tempRoot(), 'invalid-legacy.musefold.design');
    const bytes = Buffer.from('{}');
    const manifest = {
      format: SHARE_FORMAT,
      formatVersion: 1,
      exportedAt: 0,
      scheme: {
        name: '旧包',
        summary: '',
        fidelity: 'faithful',
        sourceLabel: '',
        sourcePresentation: 'skill',
      },
      revisionId: 'old_revision',
      snapshots: [],
      files: { 'scheme.json': sha256(bytes) },
    };
    await writeZipFixture(path, [
      { name: 'manifest.json', content: JSON.stringify(manifest) },
      { name: 'scheme.json', content: bytes },
    ]);
    const before = db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get();
    const result = await importDesignScheme(path, { db, userDataDir: userData });
    expect(result.ok).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM design_schemes').get()).toEqual(before);
  });

  it('canonical历史正文和仓库图片经实际导入、IPC重读、再次导出保留新身份及完整内容', async () => {
    const { manifest, content } = mixedPackage();
    const input = join(tempRoot(), 'mixed.musefold.design');
    writeFileSync(input, await writeDesignSchemePackageBytes(manifest, content));
    const imported = await importDesignScheme(input, { db, userDataDir: userData });
    if (!imported.ok) throw new Error(imported.error.message);
    const id = imported.data.scheme.id;
    const repository = new DesignSchemeRepository(db);
    const document = repository.getRevisionDocument(imported.data.revisionId);
    expect(document?.repositoryImages).toHaveLength(1);
    expect(document?.repositoryImages?.[0].assetId).not.toBe('asset_repo');
    expect(document?.repositoryImages?.[0].snapshotId).not.toBe('snap_repo');
    expect(document?.assetIds).not.toContain('asset_history');
    expect(imported.data.scheme.status).toBe('draft');
    expect(imported.data.scheme.hasSuccessfulTrial).toBe(false);
    expect(() => repository.formalize(id)).toThrow();
    const get = buildDesignSchemesDomainMethods({
      db,
      userDataDir: userData,
      picturesDir: userData,
    })[DESIGN_SCHEME_WIRE_METHODS.get];
    const detail = designSchemeDetailSchema.parse(await get.handle(get.input.parse({ id })));
    expect(detail.document.repositoryImages).toEqual(document?.repositoryImages);
    const history = detail.sourceSnapshots.find((snapshot) => snapshot.kind === 'history');
    expect(history?.historyItems?.[0].prompt).toBe(
      manifest.sourceSnapshots[1].historyItems?.[0].prompt,
    );
    expect(history?.historyItems?.[0].imageAssetId).not.toBe('asset_history');
    expect(
      detail.assets.some((asset) => asset.id === history?.historyItems?.[0].imageAssetId),
    ).toBe(true);
    // Controlled formal-state fixture checks export compatibility only; it is not a successful image trial.
    db.prepare("UPDATE design_schemes SET status = 'formal' WHERE id = ?").run(id);
    const output = join(tempRoot(), 'mixed-again.musefold.design');
    const exported = await exportDesignScheme(id, output, { db, userDataDir: userData });
    if (!exported.ok) throw new Error(exported.error.message);
    const parsed = await readValidatedDesignSchemePackage(output, [2]);
    if (parsed.formatVersion !== 2) throw new Error('Expected canonical output');
    expect(parsed.manifest.document.repositoryImages).toEqual(document?.repositoryImages);
    expect(
      parsed.manifest.sourceSnapshots.find((snapshot) => snapshot.kind === 'history')?.historyItems,
    ).toEqual(history?.historyItems);
    const preserved = parsed.manifest.sourceSnapshots.find(
      (snapshot) => snapshot.kind === 'history',
    );
    if (!preserved?.historyItems?.[0].promptPath) throw new Error('History text missing');
    expect(
      parsed.entries.get(`sources/${preserved.id}/${preserved.historyItems[0].promptPath}`),
    ).toEqual(content.get('sources/snap_history/prompt.txt'));
    const second = await importDesignScheme(output, { db, userDataDir: userData });
    if (!second.ok) throw new Error(second.error.message);
    expect(second.data.scheme.status).toBe('draft');
    expect(
      repository.getRevisionDocument(second.data.revisionId)?.repositoryImages?.[0].assetId,
    ).not.toBe(document?.repositoryImages?.[0].assetId);
  });

  it('preserves an admitted text MIME through export and reimport without guessing from extension', async () => {
    db.prepare(
      "UPDATE source_files SET mime_type = 'text/plain' WHERE snapshot_id = 'snap_share' AND path = 'SKILL.md'",
    ).run();
    const output = join(tempRoot(), 'declared-text-mime.musefold.design');
    const result = await exportDesignScheme('dsch_share', output, { db, userDataDir: userData });
    if (!result.ok) throw new Error(result.error.message);
    const archive = await readValidatedDesignSchemePackage(output, [2]);
    if (archive.formatVersion !== 2) throw new Error('Expected canonical export');
    const snapshot = archive.manifest.sourceSnapshots[0];
    const path = `sources/${snapshot.id}/SKILL.md`;
    expect(snapshot.files.find((file) => file.relativePath === 'SKILL.md')?.mimeType).toBe(
      'text/plain',
    );
    expect(
      archive.manifest.content.entries.find((entry) => entry.relativePath === path)?.mimeType,
    ).toBe('text/plain');
    expect(archive.entries.get(path)?.toString('utf8')).toBe('# 小黑插画 skill');
    const imported = await importDesignScheme(output, { db, userDataDir: userData });
    if (!imported.ok) throw new Error(imported.error.message);
    const repository = new DesignSchemeRepository(db);
    const files = repository.listSourceSnapshotMetadata(
      imported.data.scheme.id,
      imported.data.revisionId,
    );
    expect(files[0]?.files.find((file) => file.path === 'SKILL.md')?.mimeType).toBe('text/plain');
  });

  it('导出→导入闭环：新库得到全新 ID 的草稿，来源与图片资产完整还原', async () => {
    const packagePath = join(tempRoot(), 'illust.musefold.design');
    const exported = await exportDesignScheme('dsch_share', packagePath, {
      db,
      userDataDir: userData,
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.data.sizeBytes).toBeGreaterThan(0);
    // 导出记录入库（share_packages 索引）。
    const record = db
      .prepare('SELECT scheme_id, path FROM share_packages WHERE package_id = ?')
      .get(exported.data.packageId) as { scheme_id: string; path: string };
    expect(record).toEqual({ scheme_id: 'dsch_share', path: packagePath });

    // 导入到另一台"机器"（新库 + 新 userData）。
    const otherDb = makeDb();
    const otherUserData = tempRoot();
    const imported = await importDesignScheme(packagePath, {
      db: otherDb,
      userDataDir: otherUserData,
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const scheme = imported.data.scheme;
    // 永远是草稿 + 全新 ID（不覆盖现有方案）。
    expect(scheme.status).toBe('draft');
    expect(scheme.id).not.toBe('dsch_share');
    expect(scheme.name).toBe('小黑插画');
    expect(scheme.sourcePresentation).toBe('skill');
    expect(scheme.hasSuccessfulTrial).toBe(false);

    const repository = new DesignSchemeRepository(otherDb);
    const document = repository.getRevisionDocument(imported.data.revisionId);
    expect(document?.schemeId).toBe(scheme.id);
    expect(document?.inputs.map((slot) => slot.id)).toEqual(['topic']);
    expect(document?.constraints[0]?.statement).toBe('保持手绘线条');

    // 来源快照还原：文本内容 + 图片重新落盘到本机 userData。
    const sources = repository.listSourceFiles(scheme.id);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.repositoryUrl).toBe('https://github.com/acme/illust');
    expect(sources[0]?.license).toBe('MIT');
    const text = sources[0]?.files.find((file) => file.path === 'SKILL.md');
    expect(text?.textExcerpt).toBe('# 小黑插画 skill');
    const image = sources[0]?.files.find((file) => file.path === 'reference.png');
    if (!image?.storeKey) throw new Error('expected imported source image');
    expect(readFileSync(join(otherUserData, image.storeKey)).equals(fakePngBuffer(64, 64))).toBe(
      true,
    );

    // v6：导入的来源文件固化真实 MIME（文本按扩展名，图片按魔数）。
    const importedFiles = otherDb
      .prepare('SELECT path, kind, mime_type FROM source_files ORDER BY path')
      .all() as Array<{ path: string; kind: string; mime_type: string | null }>;
    expect(importedFiles.find((file) => file.path === 'SKILL.md')?.mime_type).toBe('text/markdown');
    expect(importedFiles.find((file) => file.path === 'reference.png')?.mime_type).toBe(
      'image/png',
    );
  });

  it.each([
    { origin: 'uploaded', role: 'reference' },
    { origin: 'cloud-run', role: 'output' },
  ])('$origin/$role 随专用包往返，v25 相册保留来源、角色和哈希', async ({ origin, role }) => {
    const assetBytes = fakePngBuffer(320, 240);
    const storeKey = join('design-scheme-sources', 'snap_share', 'external.png');
    writeFileSync(join(userData, storeKey), assetBytes);
    db.prepare(`INSERT INTO design_scheme_assets
      (id, revision_id, store_key, role, origin, license, created_at)
      VALUES ('dsas_external', 'dsrv_share', ?, ?, ?, 'CC0', 30)`).run(storeKey, role, origin);
    const packagePath = join(tempRoot(), 'external.musefold.design');
    const exported = await exportDesignScheme('dsch_share', packagePath, {
      db,
      userDataDir: userData,
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error(exported.error.message);
    const validated = await readValidatedDesignSchemePackage(packagePath, [SHARE_FORMAT_VERSION]);
    if (validated.formatVersion !== SHARE_FORMAT_VERSION) throw new Error('expected v2 package');
    const expectedMetadata = {
      origin,
      role,
      mimeType: 'image/png',
      width: 320,
      height: 240,
      byteSize: assetBytes.length,
      contentHash: sha256(assetBytes),
      license: 'CC0',
    };
    expect(validated.manifest.assets.find((asset) => asset.id === 'dsas_external')).toMatchObject(
      expectedMetadata,
    );

    const otherDb = makeDb();
    try {
      const otherUserData = tempRoot();
      const imported = await importDesignScheme(packagePath, {
        db: otherDb,
        userDataDir: otherUserData,
      });
      expect(imported.ok).toBe(true);
      if (!imported.ok) throw new Error(imported.error.message);
      const repository = new DesignSchemeRepository(otherDb);
      const externalAsset = repository
        .listAssetMetadataRows(imported.data.scheme.id)
        .find((asset) => asset.origin === origin);
      expect(externalAsset).toMatchObject(expectedMetadata);
      if (!externalAsset) throw new Error('missing imported external asset');
      expect(externalAsset.id).not.toBe('dsas_external');
      expect(readFileSync(join(otherUserData, externalAsset.storeKey))).toEqual(assetBytes);
      const mediaTarget = resolveSchemeAssetMediaTarget(
        otherDb,
        externalAsset.id,
        otherUserData,
        otherUserData,
      );
      if (!mediaTarget) throw new Error('external asset is not available to the media reader');
      expect(readFileSync(mediaTarget)).toEqual(assetBytes);
      expect(imported.data.scheme.hasSuccessfulTrial).toBe(false);
      expect(imported.data.scheme.status).toBe('draft');
      expect(() => repository.selectCover(imported.data.scheme.id, externalAsset.id)).toThrow();
      expect(() => repository.formalize(imported.data.scheme.id)).toThrow();

      const get = buildDesignSchemesDomainMethods({
        db: otherDb,
        userDataDir: otherUserData,
        picturesDir: otherUserData,
      })[DESIGN_SCHEME_WIRE_METHODS.get];
      const detail = designSchemeDetailSchema.parse(
        await get.handle(get.input.parse({ id: imported.data.scheme.id })),
      );
      expect(detail.assets.find((asset) => asset.id === externalAsset.id)).toMatchObject(
        expectedMetadata,
      );
      expect(JSON.stringify(detail.assets)).not.toContain(otherUserData);
    } finally {
      otherDb.close();
    }
  });

  it('导出包内容：manifest 声明全部文件哈希，封面与质量门证据随包携带且证据路径脱敏', async () => {
    const packagePath = join(tempRoot(), 'inspect.musefold.design');
    const exported = await exportDesignScheme('dsch_share', packagePath, {
      db,
      userDataDir: userData,
    });
    expect(exported.ok).toBe(true);

    const validated = await readValidatedDesignSchemePackage(packagePath, [SHARE_FORMAT_VERSION]);
    expect(validated.formatVersion).toBe(SHARE_FORMAT_VERSION);
    if (validated.formatVersion !== SHARE_FORMAT_VERSION) return;
    const { manifest } = validated;
    expect(manifest.format).toBe(SHARE_FORMAT);
    expect(manifest.formatVersion).toBe(SHARE_FORMAT_VERSION);
    expect(manifest.content.entries.map((entry) => entry.relativePath).sort()).toEqual([
      expect.stringMatching(/^assets\/dsa_.+\.png$/),
      'scheme.json',
      'sources/snap_share/SKILL.md',
      'sources/snap_share/reference.png',
    ]);
    expect(manifest.sourceSnapshots).toHaveLength(1);
    expect(manifest.sourceSnapshots[0]).toMatchObject({
      id: 'snap_share',
      kind: 'github',
      repositoryUrl: 'https://github.com/acme/illust',
      resolvedRef: 'main',
      commitHash: COMMIT,
    });
    expect(manifest.document.sources[0]).toMatchObject({
      role: 'normative',
      packageId: 'pkg_share',
      snapshotId: 'snap_share',
      license: 'MIT',
    });
    expect(JSON.stringify(manifest)).not.toContain(userData);
  });

  it('导出限制：草稿方案不可导出', async () => {
    const repository = new DesignSchemeRepository(db);
    repository.insertSchemeDraft({
      document: { ...documentFixture(), schemeId: 'dsch_draft', revisionId: 'dsrv_draft' },
      sourceLabel: 'Musefold 创建',
      sourcePresentation: 'musefold-created',
      createdBy: 'agent',
      bindings: [],
    });
    const result = await exportDesignScheme('dsch_draft', join(tempRoot(), 'x.musefold.design'), {
      db,
      userDataDir: userData,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_STATE');
    expect(result.error.message).toContain('正式方案');
  });

  it('导入校验：被篡改的文件（hash 不匹配）与未声明文件都被拒绝', async () => {
    const packagePath = join(tempRoot(), 'tampered.musefold.design');
    const exported = await exportDesignScheme('dsch_share', packagePath, {
      db,
      userDataDir: userData,
    });
    expect(exported.ok).toBe(true);

    const validated = await readValidatedDesignSchemePackage(packagePath, [SHARE_FORMAT_VERSION]);
    if (validated.formatVersion !== SHARE_FORMAT_VERSION) throw new Error('expected v2 package');

    const tamperedPath = join(tempRoot(), 'tampered2.musefold.design');
    await writeCanonicalZipFixture(tamperedPath, validated, {
      'scheme.json': Buffer.from(JSON.stringify({ hacked: true }), 'utf8'),
    });
    const tampered = await importDesignScheme(tamperedPath, {
      db: makeDb(),
      userDataDir: tempRoot(),
    });
    expect(tampered.ok).toBe(false);
    if (tampered.ok) return;
    expect(tampered.error.message).toContain('哈希不匹配');

    const sneakyPath = join(tempRoot(), 'sneaky.musefold.design');
    await writeCanonicalZipFixture(sneakyPath, validated, {}, [
      { name: 'extra.txt', content: 'smuggled' },
    ]);
    const sneaky = await importDesignScheme(sneakyPath, { db: makeDb(), userDataDir: tempRoot() });
    expect(sneaky.ok).toBe(false);
    if (sneaky.ok) return;
    expect(sneaky.error.message).toContain('未声明');
  });

  it('导入校验：格式/版本不符与缺 manifest 被拒绝', async () => {
    const wrongFormat = join(tempRoot(), 'wrong.musefold.design');
    await writeZipFixture(wrongFormat, [
      { name: 'manifest.json', content: JSON.stringify({ format: 'other', formatVersion: 1 }) },
    ]);
    const formatResult = await importDesignScheme(wrongFormat, {
      db: makeDb(),
      userDataDir: tempRoot(),
    });
    expect(formatResult.ok).toBe(false);
    if (formatResult.ok) return;
    expect(formatResult.error.message).toContain('不是 .musefold.design');

    const futureVersion = join(tempRoot(), 'future.musefold.design');
    await writeZipFixture(futureVersion, [
      {
        name: 'manifest.json',
        content: JSON.stringify({
          format: SHARE_FORMAT,
          formatVersion: 99,
          scheme: { name: 'x' },
          files: {},
          snapshots: [],
        }),
      },
    ]);
    const versionResult = await importDesignScheme(futureVersion, {
      db: makeDb(),
      userDataDir: tempRoot(),
    });
    expect(versionResult.ok).toBe(false);
    if (versionResult.ok) return;
    expect(versionResult.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');

    const noManifest = join(tempRoot(), 'empty.musefold.design');
    await writeZipFixture(noManifest, [{ name: 'readme.txt', content: 'hi' }]);
    const manifestResult = await importDesignScheme(noManifest, {
      db: makeDb(),
      userDataDir: tempRoot(),
    });
    expect(manifestResult.ok).toBe(false);
    if (manifestResult.ok) return;
    expect(manifestResult.error.message).toContain('manifest');
  });

  it.each(['ENOSPC', 'EDQUOT', 'EACCES'])(
    '导入文件写入 %s：清理残留并提供不泄漏路径的恢复提示',
    async (code) => {
      const packagePath = join(tempRoot(), 'storage-error.musefold.design');
      expect(
        (await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData })).ok,
      ).toBe(true);
      const output = tempRoot();
      const target = makeDb();
      const original = fs.writeFileSync;
      const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((path, data, options) => {
        if (String(path).startsWith(join(output, 'design-scheme-imports'))) {
          throw Object.assign(new Error(`private path: ${path}`), { code });
        }
        return original(path, data, options);
      });
      syncBuiltinESMExports();
      try {
        const result = await importDesignScheme(packagePath, { db: target, userDataDir: output });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected import failure');
        expect(result.error).toMatchObject(
          code === 'EACCES'
            ? { code: 'INVALID_TYPE', message: '分享包内容无法安全导入', retryable: false }
            : {
                code: 'INVALID_STATE',
                message: '磁盘空间不足，导入未完成。请释放空间后重试。',
                retryable: true,
              },
        );
        expect(result.error.recoveryAction).toBe('retry');
        expect(JSON.stringify(result)).not.toContain(output);
        expect(fs.readdirSync(join(output, 'design-scheme-imports'))).toEqual([]);
        expect(target.prepare('SELECT count(*) AS count FROM design_schemes').get()).toEqual({
          count: 0,
        });
      } finally {
        write.mockRestore();
        syncBuiltinESMExports();
        target.close();
      }
    },
  );

  it('导入数据库 SQLITE_FULL：清理已准备文件并提示释放空间后重试', async () => {
    const packagePath = join(tempRoot(), 'database-full.musefold.design');
    expect(
      (await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData })).ok,
    ).toBe(true);
    const output = tempRoot();
    const target = makeDb();
    const transaction = vi.spyOn(target, 'transaction').mockImplementation(() => {
      expect(fs.readdirSync(join(output, 'design-scheme-imports'))).toHaveLength(1);
      throw Object.assign(new Error(`private database path: ${output}`), { code: 'SQLITE_FULL' });
    });
    try {
      const result = await importDesignScheme(packagePath, { db: target, userDataDir: output });
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'INVALID_STATE',
          message: '磁盘空间不足，导入未完成。请释放空间后重试。',
          retryable: true,
          recoveryAction: 'retry',
        },
      });
      expect(fs.readdirSync(join(output, 'design-scheme-imports'))).toEqual([]);
      expect(target.prepare('SELECT count(*) AS count FROM design_schemes').get()).toEqual({
        count: 0,
      });
    } finally {
      transaction.mockRestore();
      target.close();
    }
  });

  it('导入中途回调清扫：活跃会话目录受保护；完成后 DB 引用接管属主、会话释放', async () => {
    const packagePath = join(tempRoot(), 'mid-import-sweep.musefold.design');
    expect(
      (await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData })).ok,
    ).toBe(true);
    const output = tempRoot();
    const target = makeDb();
    const native = loadManagedFilesystem(
      resolve('packages/managed-fs/build/Release/managed_fs.node'),
    );
    const observations: Array<{ held: number; reclaimed: number; enqueued: number }> = [];
    const original = fs.writeFileSync;
    // §5.103 手法：先转发真实写再观察——在真实导入写回调里同步跑一次清扫，
    // 断言在途目录（此刻 DB 引用尚未提交）只靠会话注册表存活。
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((path, data, options) => {
      if (String(path).startsWith(join(output, 'design-scheme-imports'))) {
        const counts = sweepDesignSchemeImportOrphans({
          db: target,
          userDataDir: output,
          filesystem: native,
        });
        observations.push({
          held: counts.held,
          reclaimed: counts.reclaimed,
          enqueued: counts.enqueued,
        });
      }
      return original(path, data, options);
    });
    syncBuiltinESMExports();
    try {
      const result = await importDesignScheme(packagePath, { db: target, userDataDir: output });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(observations.length).toBeGreaterThan(0);
      for (const observation of observations) {
        expect(observation).toEqual({ held: 1, reclaimed: 0, enqueued: 0 });
      }
      // 导入完成后：目录由 DB 引用属主接管，会话注册表清空，清扫不再回收。
      const rootDirs = fs.readdirSync(join(output, 'design-scheme-imports'));
      expect(rootDirs).toHaveLength(1);
      expect(isDesignSchemeImportSessionHeld(rootDirs[0]!)).toBe(false);
      const after = sweepDesignSchemeImportOrphans({
        db: target,
        userDataDir: output,
        filesystem: native,
      });
      expect(after).toMatchObject({ referenced: 1, reclaimed: 0, enqueued: 0 });
      expect(fs.readdirSync(join(output, 'design-scheme-imports'))).toHaveLength(1);
    } finally {
      write.mockRestore();
      syncBuiltinESMExports();
      target.close();
    }
  });

  it('导出回滚：已有目标在索引失败时保持原文件', async () => {
    const packagePath = join(tempRoot(), 'rollback.musefold.design');
    const original = Buffer.from('existing package', 'utf8');
    writeFileSync(packagePath, original);
    const failingDb = makeDb();
    failingDb.exec(
      `CREATE TRIGGER reject_share_package BEFORE INSERT ON share_packages
       BEGIN SELECT RAISE(ABORT, 'reject share package'); END;`,
    );
    const result = await exportDesignScheme('dsch_share', packagePath, {
      db: failingDb,
      userDataDir: userData,
    });
    expect(result.ok).toBe(false);
    expect(readFileSync(packagePath)).toEqual(original);
  });

  it('导入校验：canonical 引用图拒绝悬空文档引用、错绑来源和不完整内容', async () => {
    const packagePath = join(tempRoot(), 'graph-base.musefold.design');
    await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData });
    const validated = await readValidatedDesignSchemePackage(packagePath, [SHARE_FORMAT_VERSION]);
    if (validated.formatVersion !== SHARE_FORMAT_VERSION) throw new Error('expected v2 package');

    const cases: Array<{
      name: string;
      mutate: (manifest: CanonicalShareManifest, files: Map<string, Buffer>) => void;
      expected: RegExp;
    }> = [
      {
        name: 'dangling-snapshot',
        mutate: (manifest) => {
          manifest.document.sourceSnapshotIds = ['snap_missing'];
        },
        expected: /来源快照引用.*不一致/,
      },
      {
        name: 'dangling-asset',
        mutate: (manifest) => {
          manifest.document.assetIds = ['dsa_missing'];
        },
        expected: /资产引用.*不一致/,
      },
      {
        name: 'unknown-source-snapshot',
        mutate: (manifest) => {
          const source = manifest.document.sources[0];
          if (!source) throw new Error('expected source');
          source.snapshotId = 'snap_missing';
        },
        expected: /未知来源快照/,
      },
      {
        name: 'mismatched-source-package',
        mutate: (manifest) => {
          const source = manifest.document.sources[0];
          if (!source) throw new Error('expected source');
          source.packageId = 'pkg_other';
        },
        expected: /packageId.*不一致/,
      },
      {
        name: 'missing-asset-content',
        mutate: (manifest) => {
          manifest.content.entries = manifest.content.entries.filter(
            (entry) => entry.kind !== 'asset',
          );
        },
        expected: /资产没有完整内容条目/,
      },
      {
        name: 'unreferenced-declared-source-file',
        mutate: (manifest, files) => {
          const sourceEntry = manifest.content.entries.find(
            (entry) => entry.kind === 'source-file',
          );
          if (!sourceEntry) throw new Error('expected source content');
          const originalPath = sourceEntry.relativePath;
          const bytes = files.get(originalPath);
          if (!bytes) throw new Error('expected source file bytes');
          sourceEntry.relativePath = 'sources/snap_share/undeclared.txt';
          files.delete(originalPath);
          files.set(sourceEntry.relativePath, bytes);
        },
        expected: /未声明的来源文件|来源文件内容条目与快照不一致/,
      },
      {
        name: 'unreferenced-source-content',
        mutate: (manifest) => {
          const sourceEntry = manifest.content.entries.find(
            (entry) => entry.kind === 'source-file',
          );
          if (!sourceEntry) throw new Error('expected source content');
          sourceEntry.sourceId = 'snap_missing';
        },
        expected: /未声明的来源文件/,
      },
    ];

    for (const testCase of cases) {
      const target = join(tempRoot(), `${testCase.name}.musefold.design`);
      await writeCanonicalManifestFixture(target, validated, testCase.mutate);
      await expect(readValidatedDesignSchemePackage(target)).rejects.toThrow(testCase.expected);
    }
  });

  it('导入校验：同角色来源重排后仍按显式 snapshotId 绑定', async () => {
    const packagePath = join(tempRoot(), 'reordered-base.musefold.design');
    await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData });
    const validated = await readValidatedDesignSchemePackage(packagePath, [SHARE_FORMAT_VERSION]);
    if (validated.formatVersion !== SHARE_FORMAT_VERSION) throw new Error('expected v2 package');
    const reorderedPath = join(tempRoot(), 'reordered-sources.musefold.design');

    await writeCanonicalManifestFixture(reorderedPath, validated, (manifest, files) => {
      const originalSnapshot = manifest.sourceSnapshots[0];
      const originalSource = manifest.document.sources[0];
      if (!originalSnapshot || !originalSource) throw new Error('expected canonical source');
      const secondSnapshot = {
        ...structuredClone(originalSnapshot),
        id: 'snap_share_2',
        files: originalSnapshot.files.map((file) => ({ ...file })),
      };
      manifest.sourceSnapshots.push(secondSnapshot);
      manifest.document.sourceSnapshotIds.push(secondSnapshot.id);
      manifest.document.sources.push({
        ...structuredClone(originalSource),
        id: 'src_repo_2',
        snapshotId: secondSnapshot.id,
        packageId: secondSnapshot.packageId,
      });
      for (const file of secondSnapshot.files) {
        const originalPath = `sources/${originalSnapshot.id}/${file.relativePath}`;
        const relativePath = `sources/${secondSnapshot.id}/${file.relativePath}`;
        const bytes = files.get(originalPath);
        if (!bytes) throw new Error('expected source file');
        files.set(relativePath, bytes);
        manifest.content.entries.push({
          relativePath,
          kind: 'source-file',
          contentHash: sha256(bytes),
          sizeBytes: bytes.byteLength,
          mimeType: file.mimeType,
          sourceId: secondSnapshot.id,
          assetId: null,
        });
      }
      manifest.document.sources.reverse();
    });

    const importedDb = makeDb();
    const imported = await importDesignScheme(reorderedPath, {
      db: importedDb,
      userDataDir: tempRoot(),
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const sources = new DesignSchemeRepository(importedDb).listSourceFiles(imported.data.scheme.id);
    expect(sources).toHaveLength(2);
    const packageRows = importedDb
      .prepare('SELECT package_id FROM source_snapshots ORDER BY id')
      .all() as Array<{ package_id: string }>;
    expect(packageRows).toHaveLength(2);
    expect(new Set(packageRows.map((row) => row.package_id)).size).toBe(1);
  });

  it('导入校验：伪装成图片的资产（魔数不符）被拒绝', async () => {
    const packagePath = join(tempRoot(), 'base.musefold.design');
    await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData });
    const validated = await readValidatedDesignSchemePackage(packagePath, [SHARE_FORMAT_VERSION]);
    if (validated.formatVersion !== SHARE_FORMAT_VERSION) throw new Error('expected v2 package');
    const assetPath = validated.manifest.content.entries.find(
      (entry) => entry.kind === 'asset',
    )?.relativePath;
    if (!assetPath) throw new Error('expected package asset');

    const evil = Buffer.from('#!/bin/sh\necho pwned', 'utf8');
    const evilPath = join(tempRoot(), 'evil.musefold.design');
    await writeCanonicalZipFixture(evilPath, validated, { [assetPath]: evil }, [], true);
    const result = await importDesignScheme(evilPath, { db: makeDb(), userDataDir: tempRoot() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('MIME 不匹配');
  });
});

async function writeCanonicalManifestFixture(
  path: string,
  validated: Extract<ValidatedDesignSchemePackage, { formatVersion: 2 }>,
  mutate: (manifest: CanonicalShareManifest, files: Map<string, Buffer>) => void,
): Promise<void> {
  const manifest = structuredClone(validated.manifest);
  const files = new Map(validated.entries);
  mutate(manifest, files);
  const documentEntry = manifest.content.entries.find(
    (entry) => entry.kind === 'revision-document',
  );
  if (!documentEntry) throw new Error('expected revision document entry');
  const documentBytes = Buffer.from(JSON.stringify(manifest.document), 'utf8');
  files.set(documentEntry.relativePath, documentBytes);
  documentEntry.contentHash = sha256(documentBytes);
  documentEntry.sizeBytes = documentBytes.byteLength;
  for (const entry of manifest.content.entries) {
    const bytes = files.get(entry.relativePath);
    if (!bytes) throw new Error(`missing package fixture entry: ${entry.relativePath}`);
    entry.contentHash = sha256(bytes);
    entry.sizeBytes = bytes.byteLength;
  }
  manifest.content.sizeBytes = manifest.content.entries.reduce(
    (sum, entry) => sum + entry.sizeBytes,
    0,
  );
  manifest.content.contentHash = stableContentEntriesHash(manifest.content.entries);
  await writeZipFixture(path, [
    { name: 'manifest.json', content: JSON.stringify(manifest) },
    ...manifest.content.entries.map((entry) => ({
      name: entry.relativePath,
      content: files.get(entry.relativePath) as Buffer,
    })),
  ]);
}

async function writeCanonicalZipFixture(
  path: string,
  validated: Extract<ValidatedDesignSchemePackage, { formatVersion: 2 }>,
  overrides: Record<string, Buffer> = {},
  extras: Array<{ name: string; content: string | Buffer }> = [],
  updateManifest = false,
): Promise<void> {
  const manifest = structuredClone(validated.manifest);
  const contentFiles = manifest.content.entries.map((entry) => {
    const bytes = overrides[entry.relativePath] ?? validated.entries.get(entry.relativePath);
    if (!bytes) throw new Error(`missing package fixture entry: ${entry.relativePath}`);
    if (updateManifest && overrides[entry.relativePath]) {
      entry.contentHash = sha256(bytes);
      entry.sizeBytes = bytes.byteLength;
    }
    return { name: entry.relativePath, content: bytes };
  });
  if (updateManifest) {
    manifest.content.sizeBytes = manifest.content.entries.reduce(
      (sum, entry) => sum + entry.sizeBytes,
      0,
    );
    manifest.content.contentHash = stableContentEntriesHash(manifest.content.entries);
  }
  await writeZipFixture(path, [
    { name: 'manifest.json', content: JSON.stringify(manifest) },
    ...contentFiles,
    ...extras,
  ]);
}

function writeZipFixture(
  path: string,
  files: Array<{ name: string; content: string | Buffer }>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(path);
    const archive = archiver('zip');
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) {
      archive.append(
        typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content,
        { name: file.name },
      );
    }
    void archive.finalize();
  });
}
