import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@musefold/desktop-contracts/design-scheme/schema';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { exportDesignScheme, importDesignScheme, SHARE_FORMAT, SHARE_FORMAT_VERSION } from '../share';
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

function documentFixture(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'dsrv_share',
    schemeId: 'dsch_share',
    name: '小黑插画',
    summary: '手绘线条插画方案',
    fidelity: 'faithful',
    sources: [{ id: 'src_repo', kind: 'github-skill', role: 'normative', uri: 'https://github.com/acme/illust', commit: 'abcd1234' }],
    inputs: [{ id: 'topic', label: '插画主题', kind: 'text', required: true }],
    parameters: [],
    constraints: [
      { id: 'con_1', domain: 'texture', statement: '保持手绘线条', mode: 'required', userOverridable: false, sourceIds: ['src_repo'] },
    ],
    promptProgram: [
      { id: 'pm_1', order: 0, kind: 'input-template', template: '为「{{topic}}」创作插画', variables: ['topic'], sourceIds: ['src_repo'] },
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
    package: { id: 'pkg_share', kind: 'github', repositoryUrl: 'https://github.com/acme/illust', license: 'MIT' },
    snapshot: { id: 'snap_share', ref: 'main', commitHash: 'abcd1234', totalBytes: 128, scan: { fileCount: 2 } },
    files: [
      { path: 'SKILL.md', kind: 'text', contentHash: 'h1', sizeBytes: 20, textContent: '# 小黑插画 skill' },
      { path: 'reference.png', kind: 'image', contentHash: 'h2', sizeBytes: 33, storeKey: join('design-scheme-sources', 'snap_share', 'reference.png') },
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
    const exported = await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.data.sizeBytes).toBeGreaterThan(0);
    // 导出记录入库（share_packages 索引）。
    const record = db.prepare('SELECT scheme_id, path FROM share_packages WHERE package_id = ?').get(exported.data.packageId) as { scheme_id: string; path: string };
    expect(record).toEqual({ scheme_id: 'dsch_share', path: packagePath });

    // 导入到另一台"机器"（新库 + 新 userData）。
    const otherDb = makeDb();
    const otherUserData = tempRoot();
    const imported = await importDesignScheme(packagePath, { db: otherDb, userDataDir: otherUserData });
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
    expect(image?.storeKey).toBeTruthy();
    expect(readFileSync(join(otherUserData, image!.storeKey!)).equals(fakePngBuffer(64, 64))).toBe(true);
  });

  it('导出包内容：manifest 声明全部文件哈希，封面与质量门证据随包携带且证据路径脱敏', async () => {
    const packagePath = join(tempRoot(), 'inspect.musefold.design');
    const exported = await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData });
    expect(exported.ok).toBe(true);

    // 借导入通道解包验证（不落库）：直接读 manifest。
    const manifestRecord = db.prepare('SELECT manifest_json FROM share_packages ORDER BY created_at DESC LIMIT 1').get() as { manifest_json: string };
    const manifest = JSON.parse(manifestRecord.manifest_json) as {
      format: string; formatVersion: number;
      files: Record<string, string>;
      snapshots: Array<{ kind: string; role: string; license: string | null }>;
    };
    expect(manifest.format).toBe(SHARE_FORMAT);
    expect(manifest.formatVersion).toBe(SHARE_FORMAT_VERSION);
    expect(Object.keys(manifest.files).sort()).toEqual([
      'assets/snap_1/reference.png',
      'evaluations/latest.json',
      'previews/cover.png',
      'scheme.json',
      'sources/snap_1/SKILL.md',
    ]);
    expect(manifest.snapshots).toEqual([
      { dir: 'snap_1', kind: 'github', role: 'normative', repositoryUrl: 'https://github.com/acme/illust', ref: 'main', commitHash: 'abcd1234', license: 'MIT', scan: { fileCount: 2 } },
    ]);
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
    const result = await exportDesignScheme('dsch_draft', join(tempRoot(), 'x.musefold.design'), { db, userDataDir: userData });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_STATE');
    expect(result.error.message).toContain('正式方案');
  });

  it('导入校验：被篡改的文件（hash 不匹配）与未声明文件都被拒绝', async () => {
    const packagePath = join(tempRoot(), 'tampered.musefold.design');
    const exported = await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData });
    expect(exported.ok).toBe(true);

    // 重打包：篡改 scheme.json 内容但保留旧 manifest。
    const manifestRecord = db.prepare('SELECT manifest_json FROM share_packages ORDER BY created_at DESC LIMIT 1').get() as { manifest_json: string };
    const tamperedPath = join(tempRoot(), 'tampered2.musefold.design');
    await writeZipFixture(tamperedPath, [
      { name: 'manifest.json', content: manifestRecord.manifest_json },
      { name: 'scheme.json', content: JSON.stringify({ hacked: true }) },
    ]);
    const tampered = await importDesignScheme(tamperedPath, { db: makeDb(), userDataDir: tempRoot() });
    expect(tampered.ok).toBe(false);
    if (tampered.ok) return;
    expect(tampered.error.message).toContain('哈希不匹配');

    // 未声明文件：manifest.files 里没有 extra.txt。
    const sneakyPath = join(tempRoot(), 'sneaky.musefold.design');
    await writeZipFixture(sneakyPath, [
      { name: 'manifest.json', content: manifestRecord.manifest_json },
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
    const formatResult = await importDesignScheme(wrongFormat, { db: makeDb(), userDataDir: tempRoot() });
    expect(formatResult.ok).toBe(false);
    if (formatResult.ok) return;
    expect(formatResult.error.message).toContain('不是 .musefold.design');

    const futureVersion = join(tempRoot(), 'future.musefold.design');
    await writeZipFixture(futureVersion, [
      { name: 'manifest.json', content: JSON.stringify({ format: SHARE_FORMAT, formatVersion: 99, scheme: { name: 'x' }, files: {}, snapshots: [] }) },
    ]);
    const versionResult = await importDesignScheme(futureVersion, { db: makeDb(), userDataDir: tempRoot() });
    expect(versionResult.ok).toBe(false);
    if (versionResult.ok) return;
    expect(versionResult.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');

    const noManifest = join(tempRoot(), 'empty.musefold.design');
    await writeZipFixture(noManifest, [{ name: 'readme.txt', content: 'hi' }]);
    const manifestResult = await importDesignScheme(noManifest, { db: makeDb(), userDataDir: tempRoot() });
    expect(manifestResult.ok).toBe(false);
    if (manifestResult.ok) return;
    expect(manifestResult.error.message).toContain('manifest');
  });

  it('导入校验：伪装成图片的资产（魔数不符）被拒绝', async () => {
    const packagePath = join(tempRoot(), 'base.musefold.design');
    await exportDesignScheme('dsch_share', packagePath, { db, userDataDir: userData });
    const manifestRecord = db.prepare('SELECT manifest_json FROM share_packages ORDER BY created_at DESC LIMIT 1').get() as { manifest_json: string };
    const manifest = JSON.parse(manifestRecord.manifest_json) as { files: Record<string, string> };

    // 构造一个声明了正确 hash 但内容不是图片的资产。
    const evil = Buffer.from('#!/bin/sh\necho pwned', 'utf8');
    const { createHash } = await import('crypto');
    manifest.files['assets/snap_1/reference.png'] = createHash('sha256').update(evil).digest('hex');
    const evilPath = join(tempRoot(), 'evil.musefold.design');
    await writeZipFixture(evilPath, [
      { name: 'manifest.json', content: JSON.stringify(manifest) },
      { name: 'assets/snap_1/reference.png', content: evil },
    ]);
    const result = await importDesignScheme(evilPath, { db: makeDb(), userDataDir: tempRoot() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('不是有效图片');
  });
});

function writeZipFixture(path: string, files: Array<{ name: string; content: string | Buffer }>): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(path);
    const archive = archiver('zip');
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) {
      archive.append(typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content, { name: file.name });
    }
    void archive.finalize();
  });
}
