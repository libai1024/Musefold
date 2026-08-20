/**
 * .musefold.design 私有分享格式（设计规范 §7）。
 *
 * ZIP 容器：manifest.json + scheme.json + sources/ + assets/ + previews/ + evaluations/。
 * 导出只打包当前 revision 绑定的来源快照与用户可见资产；不包含 API Key、
 * 绝对路径与未选择的文件。导入前校验格式版本、大小、路径穿越、hash 与资产
 * MIME，生成全新的方案 ID / 版本（草稿态），不覆盖现有方案，也不执行包内脚本。
 */
import { createHash, randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, extname, isAbsolute, join } from 'path';
import type Database from 'better-sqlite3';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import { appError, fail, ok, type AppResult } from '@shared/app-result';
import {
  parseDesignSchemeRevisionDocument,
  type DesignSchemeRevisionDocument,
} from '@shared/design-scheme/schema';
import type { DesignSchemeSummary } from '@shared/types/design-scheme';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { getPaths } from '../../system/paths';

export const SHARE_FORMAT = 'musefold.design';
export const SHARE_FORMAT_VERSION = 1;
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 600;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);

type PackageKind = 'github' | 'history' | 'user-brief';

interface ManifestSnapshot {
  /** zip 内目录名（sources/<dir>/、assets/<dir>/）。 */
  dir: string;
  kind: PackageKind;
  role: 'normative' | 'reference' | 'example' | 'context';
  repositoryUrl: string | null;
  ref: string;
  commitHash: string | null;
  license: string | null;
  scan: unknown;
}

interface ShareManifest {
  format: typeof SHARE_FORMAT;
  formatVersion: typeof SHARE_FORMAT_VERSION;
  exportedAt: number;
  scheme: {
    name: string;
    summary: string;
    fidelity: string;
    sourceLabel: string;
    sourcePresentation: 'skill' | 'musefold-created';
  };
  revisionId: string;
  snapshots: ManifestSnapshot[];
  /** zip 内所有数据文件的 sha256（manifest 自身除外）。 */
  files: Record<string, string>;
}

export interface ShareDeps {
  db: Database.Database;
  userDataDir?: string;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 轻量图片魔数校验：导入的 assets/previews 必须是真实图片文件。 */
function looksLikeImage(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return true;
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return true; // BMP
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return true; // AVIF/HEIF
  return false;
}

/** zip 内路径只允许安全的相对路径（防路径穿越）。 */
function isSafeZipPath(path: string): boolean {
  if (!path || path.length > 512) return false;
  if (path.includes('\\') || path.includes('\0')) return false;
  if (isAbsolute(path)) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

interface SnapshotRow {
  id: string;
  kind: PackageKind;
  repository_url: string | null;
  ref: string;
  commit_hash: string | null;
  license: string | null;
  scan_json: string;
  role: 'normative' | 'reference' | 'example' | 'context';
}

interface SnapshotFileRow {
  path: string;
  kind: 'text' | 'image' | 'other';
  content_hash: string;
  size_bytes: number;
  store_key: string | null;
  text_content: string | null;
}

export interface ExportResult {
  path: string;
  fileName: string;
  sizeBytes: number;
  packageId: string;
}

/** 导出正式方案为 .musefold.design（生命周期表：导出仅对正式方案开放）。 */
export async function exportDesignScheme(
  schemeId: string,
  targetPath: string,
  deps: ShareDeps,
): Promise<AppResult<ExportResult>> {
  const repository = new DesignSchemeRepository(deps.db);
  const userData = deps.userDataDir ?? getPaths().userData;
  const summary = repository.listSummaries().find((item) => item.id === schemeId);
  if (!summary) {
    return fail(appError('MISSING_REFERENCE', '方案不存在或已被移除', { recoveryAction: 'retry' }));
  }
  if (summary.status !== 'formal') {
    return fail(appError('INVALID_STATE', '只有正式方案可以导出；请先完成试运行并转为正式。', { recoveryAction: 'edit-input' }));
  }
  const document = repository.getRevisionDocument(summary.currentRevisionId);
  if (!document) {
    return fail(appError('MISSING_REFERENCE', '方案版本文档缺失', { recoveryAction: 'retry' }));
  }

  // 收集条目（全部先进内存计算 hash，方案包体量受快照预算约束）。
  const entries = new Map<string, Buffer>();
  const manifestFiles: Record<string, string> = {};
  const addEntry = (path: string, buffer: Buffer) => {
    entries.set(path, buffer);
    manifestFiles[path] = sha256(buffer);
  };

  addEntry('scheme.json', Buffer.from(JSON.stringify(document, null, 2), 'utf8'));

  // 绑定的来源快照：文本进 sources/，图片进 assets/。
  const snapshotRows = deps.db.prepare(
    `SELECT snap.id, pkg.kind, pkg.repository_url, snap.ref, snap.commit_hash, pkg.license, snap.scan_json, binding.role
       FROM design_scheme_source_bindings binding
       JOIN source_snapshots snap ON snap.id = binding.source_snapshot_id
       JOIN source_packages pkg ON pkg.id = snap.package_id
      WHERE binding.revision_id = ?
      ORDER BY snap.created_at ASC`,
  ).all(summary.currentRevisionId) as SnapshotRow[];

  const manifestSnapshots: ManifestSnapshot[] = [];
  const fileQuery = deps.db.prepare(
    'SELECT path, kind, content_hash, size_bytes, store_key, text_content FROM source_files WHERE snapshot_id = ? ORDER BY path',
  );
  for (const [index, snapshot] of snapshotRows.entries()) {
    const dir = `snap_${index + 1}`;
    let scan: unknown = {};
    try {
      scan = JSON.parse(snapshot.scan_json);
    } catch {
      // scan_json 损坏时用空对象，不阻断分享包导出。
    }
    manifestSnapshots.push({
      dir,
      kind: snapshot.kind,
      role: snapshot.role,
      repositoryUrl: snapshot.repository_url,
      ref: snapshot.ref,
      commitHash: snapshot.commit_hash,
      license: snapshot.license,
      scan,
    });
    const files = fileQuery.all(snapshot.id) as SnapshotFileRow[];
    for (const file of files) {
      if (!isSafeZipPath(file.path)) continue;
      if (file.kind === 'text' && typeof file.text_content === 'string') {
        addEntry(`sources/${dir}/${file.path}`, Buffer.from(file.text_content, 'utf8'));
        continue;
      }
      if (file.kind === 'image' && file.store_key) {
        const absolute = isAbsolute(file.store_key) ? file.store_key : join(userData, file.store_key);
        if (!existsSync(absolute)) continue;
        addEntry(`assets/${dir}/${file.path}`, readFileSync(absolute));
      }
    }
  }

  // 封面（用户明确选择的资产）作为离线预览。
  if (summary.coverImagePath) {
    const coverAbsolute = isAbsolute(summary.coverImagePath)
      ? summary.coverImagePath
      : join(userData, summary.coverImagePath);
    if (existsSync(coverAbsolute)) {
      const extension = extname(coverAbsolute).toLowerCase() || '.png';
      if (IMAGE_EXTENSIONS.has(extension)) {
        addEntry(`previews/cover${extension}`, readFileSync(coverAbsolute));
      }
    }
  }

  // 最近一次质量门证据（可选）。
  const evaluationRow = deps.db.prepare(
    `SELECT ev.passed, ev.metrics_json, ev.evidence_json, ev.created_at
       FROM design_scheme_evaluations ev
       JOIN design_scheme_runs run ON run.run_id = ev.run_id
      WHERE run.revision_id = ?
      ORDER BY ev.created_at DESC LIMIT 1`,
  ).get(summary.currentRevisionId) as { passed: number; metrics_json: string; evidence_json: string; created_at: number } | undefined;
  if (evaluationRow) {
    addEntry('evaluations/latest.json', Buffer.from(JSON.stringify({
      passed: evaluationRow.passed === 1,
      metrics: JSON.parse(evaluationRow.metrics_json),
      // 证据里的 path 是本机绝对路径：脱敏为文件名。
      evidence: (JSON.parse(evaluationRow.evidence_json) as Array<Record<string, unknown>>).map((item) => ({
        ...item,
        ...(typeof item.path === 'string' ? { path: basename(item.path) } : {}),
      })),
      createdAt: evaluationRow.created_at,
    }, null, 2), 'utf8'));
  }

  const manifest: ShareManifest = {
    format: SHARE_FORMAT,
    formatVersion: SHARE_FORMAT_VERSION,
    exportedAt: Date.now(),
    scheme: {
      name: summary.name,
      summary: summary.summary,
      fidelity: summary.fidelity,
      sourceLabel: summary.sourceLabel,
      sourcePresentation: summary.sourcePresentation,
    },
    revisionId: summary.currentRevisionId,
    snapshots: manifestSnapshots,
    files: manifestFiles,
  };

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    await writeZip(targetPath, entries, manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(appError('UNKNOWN', `写入分享包失败：${message}`, { recoveryAction: 'retry' }));
  }

  const packageId = `share_${randomUUID()}`;
  deps.db.prepare(
    'INSERT INTO share_packages (package_id, scheme_id, manifest_json, path, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(packageId, schemeId, JSON.stringify(manifest), targetPath, Date.now());

  return ok({
    path: targetPath,
    fileName: basename(targetPath),
    sizeBytes: statSync(targetPath).size,
    packageId,
  });
}

function writeZip(targetPath: string, entries: Map<string, Buffer>, manifest: ShareManifest): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(targetPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), { name: 'manifest.json' });
    for (const [name, buffer] of entries) {
      archive.append(buffer, { name });
    }
    void archive.finalize();
  });
}

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { autoClose: false, lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error('无法打开分享包'));
      else resolve(zipFile);
    });
  });
}

function readAllZipEntries(zipFile: yauzl.ZipFile): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const buffers = new Map<string, Buffer>();
    let total = 0;
    zipFile.on('error', reject);
    zipFile.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith('/')) {
        zipFile.readEntry();
        return;
      }
      if (buffers.size >= MAX_ENTRIES) {
        reject(new Error(`分享包条目超过上限 ${MAX_ENTRIES}`));
        return;
      }
      if (!isSafeZipPath(entry.fileName)) {
        reject(new Error(`分享包包含不安全路径：${entry.fileName}`));
        return;
      }
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        reject(new Error(`分享包内文件过大：${entry.fileName}`));
        return;
      }
      zipFile.openReadStream(entry, (openError, stream) => {
        if (openError || !stream) {
          reject(openError ?? new Error(`无法读取条目：${entry.fileName}`));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_PACKAGE_BYTES) {
            stream.destroy();
            reject(new Error('分享包解压后超过大小上限'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', () => {
          buffers.set(entry.fileName, Buffer.concat(chunks));
          zipFile.readEntry();
        });
      });
    });
    zipFile.on('end', () => resolve(buffers));
    zipFile.readEntry();
  });
}

const PACKAGE_KINDS: ReadonlySet<string> = new Set(['github', 'history', 'user-brief']);
const BINDING_ROLES: ReadonlySet<string> = new Set(['normative', 'reference', 'example', 'context']);

function validateManifest(candidate: unknown): AppResult<ShareManifest> {
  if (!candidate || typeof candidate !== 'object') {
    return fail(appError('INVALID_TYPE', 'manifest.json 不是有效对象', { recoveryAction: 'retry' }));
  }
  const manifest = candidate as ShareManifest;
  if (manifest.format !== SHARE_FORMAT) {
    return fail(appError('INVALID_TYPE', '不是 .musefold.design 分享包', { recoveryAction: 'retry' }));
  }
  if (manifest.formatVersion !== SHARE_FORMAT_VERSION) {
    return fail(appError('UNSUPPORTED_SCHEMA_VERSION', `分享包格式版本 ${String(manifest.formatVersion)} 不受支持`, { recoveryAction: 'upgrade-app' }));
  }
  if (!manifest.scheme || typeof manifest.scheme.name !== 'string' || !manifest.files || typeof manifest.files !== 'object') {
    return fail(appError('INVALID_TYPE', 'manifest.json 缺少必要字段', { recoveryAction: 'retry' }));
  }
  const snapshots = Array.isArray(manifest.snapshots) ? manifest.snapshots : [];
  for (const snapshot of snapshots) {
    if (!PACKAGE_KINDS.has(snapshot.kind) || !BINDING_ROLES.has(snapshot.role) || typeof snapshot.dir !== 'string' || !/^[a-z0-9_-]+$/i.test(snapshot.dir)) {
      return fail(appError('INVALID_TYPE', 'manifest.json 中来源快照描述无效', { recoveryAction: 'retry' }));
    }
  }
  return ok(manifest);
}

export interface ImportResult {
  scheme: DesignSchemeSummary;
  revisionId: string;
}

/** 导入 .musefold.design：校验后生成全新方案（草稿态），不覆盖现有方案。 */
export async function importDesignScheme(
  filePath: string,
  deps: ShareDeps,
): Promise<AppResult<ImportResult>> {
  const userData = deps.userDataDir ?? getPaths().userData;
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return fail(appError('MISSING_REFERENCE', '分享包文件不存在', { recoveryAction: 'retry' }));
  }
  if (!stat.isFile() || stat.size > MAX_PACKAGE_BYTES) {
    return fail(appError('INVALID_TYPE', '分享包不是普通文件或超过大小上限', { recoveryAction: 'retry' }));
  }

  let zipFile: yauzl.ZipFile | null = null;
  let entries: Map<string, Buffer>;
  try {
    zipFile = await openZip(filePath);
    entries = await readAllZipEntries(zipFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(appError('INVALID_TYPE', `分享包读取失败：${message}`, { recoveryAction: 'retry' }));
  } finally {
    zipFile?.close();
  }

  const manifestBuffer = entries.get('manifest.json');
  if (!manifestBuffer) {
    return fail(appError('INVALID_TYPE', '分享包缺少 manifest.json', { recoveryAction: 'retry' }));
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestBuffer.toString('utf8'));
  } catch {
    return fail(appError('INVALID_TYPE', 'manifest.json 不是有效 JSON', { recoveryAction: 'retry' }));
  }
  const manifestResult = validateManifest(manifestJson);
  if (!manifestResult.ok) return manifestResult;
  const manifest = manifestResult.data;

  // hash 校验：包内每个数据文件都必须在 manifest 声明且哈希一致（防篡改/防夹带）。
  for (const [name, buffer] of entries) {
    if (name === 'manifest.json') continue;
    const declared = manifest.files[name];
    if (!declared) {
      return fail(appError('INVALID_TYPE', `分享包包含未声明的文件：${name}`, { recoveryAction: 'retry' }));
    }
    if (sha256(buffer) !== declared) {
      return fail(appError('INVALID_TYPE', `文件哈希不匹配：${name}`, { recoveryAction: 'retry' }));
    }
    // 资产与预览必须是真实图片（扩展名 + 魔数双重校验）。
    if (name.startsWith('assets/') || name.startsWith('previews/')) {
      if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase()) || !looksLikeImage(buffer)) {
        return fail(appError('INVALID_TYPE', `资产不是有效图片：${name}`, { recoveryAction: 'retry' }));
      }
    }
  }

  const schemeBuffer = entries.get('scheme.json');
  if (!schemeBuffer) {
    return fail(appError('INVALID_TYPE', '分享包缺少 scheme.json', { recoveryAction: 'retry' }));
  }
  let schemeJson: unknown;
  try {
    schemeJson = JSON.parse(schemeBuffer.toString('utf8'));
  } catch {
    return fail(appError('INVALID_TYPE', 'scheme.json 不是有效 JSON', { recoveryAction: 'retry' }));
  }
  const parsed = parseDesignSchemeRevisionDocument(schemeJson);
  if (!parsed.ok) {
    const issues = parsed.issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join('；');
    return fail(appError('INVALID_TYPE', `方案文档校验失败：${issues}`, { recoveryAction: 'retry' }));
  }

  // 生成全新 ID；导入永远是草稿，需要本机试运行验证（设计规范 §7）。
  const repository = new DesignSchemeRepository(deps.db);
  const newSchemeId = `dsch_${randomUUID()}`;
  const newRevisionId = `dsrv_${randomUUID()}`;
  const document: DesignSchemeRevisionDocument = {
    ...parsed.value,
    schemeId: newSchemeId,
    revisionId: newRevisionId,
  };

  // 重建来源快照（新 id + 图片落盘），保持原 kind/role 语义。
  const bindings: Array<{ snapshotId: string; role: 'normative' | 'reference' | 'example' | 'context' }> = [];
  for (const snapshot of manifest.snapshots) {
    const snapshotId = `snap_${randomUUID()}`;
    const packageId = `pkg_import_${randomUUID().slice(0, 20)}`;
    const files: Array<{ path: string; kind: 'text' | 'image'; contentHash: string; sizeBytes: number; storeKey?: string; textContent?: string }> = [];

    const textPrefix = `sources/${snapshot.dir}/`;
    const assetPrefix = `assets/${snapshot.dir}/`;
    for (const [name, buffer] of entries) {
      if (name.startsWith(textPrefix)) {
        const relative = name.slice(textPrefix.length);
        if (!isSafeZipPath(relative)) continue;
        files.push({
          path: relative,
          kind: 'text',
          contentHash: sha256(buffer),
          sizeBytes: buffer.byteLength,
          textContent: buffer.toString('utf8'),
        });
      } else if (name.startsWith(assetPrefix)) {
        const relative = name.slice(assetPrefix.length);
        if (!isSafeZipPath(relative)) continue;
        const absolute = join(userData, 'design-scheme-sources', snapshotId, relative);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, buffer);
        files.push({
          path: relative,
          kind: 'image',
          contentHash: sha256(buffer),
          sizeBytes: buffer.byteLength,
          storeKey: join('design-scheme-sources', snapshotId, relative),
        });
      }
    }

    repository.saveSourceSnapshot({
      package: {
        id: packageId,
        kind: snapshot.kind,
        repositoryUrl: snapshot.repositoryUrl ?? undefined,
        license: snapshot.license ?? undefined,
      },
      snapshot: {
        id: snapshotId,
        ref: snapshot.ref || 'import',
        commitHash: snapshot.commitHash,
        totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        scan: snapshot.scan ?? {},
      },
      files,
    });
    bindings.push({ snapshotId, role: snapshot.role });
  }

  try {
    const summary = repository.insertSchemeDraft({
      document,
      sourceLabel: manifest.scheme.sourceLabel || manifest.scheme.name,
      sourcePresentation: manifest.scheme.sourcePresentation === 'skill' ? 'skill' : 'musefold-created',
      createdBy: 'import',
      bindings,
    });
    return ok({ scheme: summary, revisionId: newRevisionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(appError('INVALID_STATE', `导入方案失败：${message}`, { recoveryAction: 'retry' }));
  }
}
