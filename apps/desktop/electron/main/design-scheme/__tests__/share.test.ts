import {
  createWriteStream,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import archiver from 'archiver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import {
  contentEntriesHash,
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
  manifest.content.contentHash = contentEntriesHash(manifest.content.entries);
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
    manifest.content.contentHash = contentEntriesHash(manifest.content.entries);
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
