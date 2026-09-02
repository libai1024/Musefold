import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION,
  designSchemeHashSchema,
  designSchemeRevisionDocumentSchema,
  httpsRepositoryUriSchema,
  relativePathSchema,
  resolvedRefSchema,
  sharePackageManifestSchema,
  type DesignSchemePackageFormatVersion,
} from '@musefold/contracts';
import * as yauzl from 'yauzl';
import { z } from 'zod';
import { sniffImageMimeType } from './source-ingestion';

export const SHARE_FORMAT = 'musefold.design' as const;
export const SHARE_FORMAT_VERSION = DESIGN_SCHEME_PACKAGE_FORMAT_VERSION;
export const LEGACY_SHARE_FORMAT_VERSION = LEGACY_DESIGN_SCHEME_PACKAGE_FORMAT_VERSION;
export const MAX_DESIGN_SCHEME_PACKAGE_BYTES = 256 * 1024 * 1024;

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 1_024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_REGULAR_FILE = 0x8000;
const UNIX_DIRECTORY = 0x4000;
const UNIX_SYMLINK = 0xa000;

const legacySnapshotSchema = z
  .object({
    dir: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    kind: z.enum(['github', 'history', 'user-brief']),
    role: z.enum(['normative', 'reference', 'example', 'context']),
    repositoryUrl: httpsRepositoryUriSchema.nullable(),
    ref: resolvedRefSchema,
    commitHash: z.string().trim().min(1).max(128).nullable(),
    license: z.string().trim().min(1).max(256).nullable(),
    scan: z.unknown(),
  })
  .strict();

const legacyManifestSchema = z
  .object({
    format: z.literal(SHARE_FORMAT),
    formatVersion: z.literal(LEGACY_SHARE_FORMAT_VERSION),
    exportedAt: z.number().int().nonnegative(),
    scheme: z
      .object({
        name: z.string().trim().min(1).max(120),
        summary: z.string().trim().max(500),
        fidelity: z.enum(['verified', 'faithful', 'adapted', 'unsupported']),
        sourceLabel: z.string().trim().max(160),
        sourcePresentation: z.enum(['skill', 'musefold-created']),
      })
      .strict(),
    revisionId: z.string().trim().min(1).max(128),
    snapshots: z.array(legacySnapshotSchema).max(32),
    files: z.record(relativePathSchema, designSchemeHashSchema),
  })
  .strict();

export type CanonicalShareManifest = z.output<typeof sharePackageManifestSchema>;
export type LegacyShareManifest = z.output<typeof legacyManifestSchema>;

export type ValidatedDesignSchemePackage =
  | {
      formatVersion: typeof SHARE_FORMAT_VERSION;
      manifest: CanonicalShareManifest;
      entries: Map<string, Buffer>;
    }
  | {
      formatVersion: typeof LEGACY_SHARE_FORMAT_VERSION;
      manifest: LegacyShareManifest;
      entries: Map<string, Buffer>;
    };

export class DesignSchemePackageValidationError extends Error {
  constructor(
    readonly code: 'INVALID_TYPE' | 'UNSUPPORTED_SCHEMA_VERSION',
    message: string,
  ) {
    super(message);
    this.name = 'DesignSchemePackageValidationError';
  }
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function normalizedHash(hash: string): string {
  return hash.toLowerCase().replace(/^sha256:/, '');
}

export function isSafePackagePath(path: string): boolean {
  if (!path || path.length > 1_024 || path.includes('\\') || path.includes('\0')) return false;
  if (isAbsolute(path)) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function archiveEntryKind(entry: yauzl.Entry): 'file' | 'directory' | 'unsupported' {
  const madeBy = entry.versionMadeBy >>> 8;
  if (madeBy === 3) {
    const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
    const type = mode & UNIX_FILE_TYPE_MASK;
    if (type === UNIX_SYMLINK) return 'unsupported';
    if (type === UNIX_DIRECTORY) return 'directory';
    if (type !== 0 && type !== UNIX_REGULAR_FILE) return 'unsupported';
  }
  if (entry.fileName.endsWith('/') || (entry.externalFileAttributes & 0x10) !== 0) {
    return 'directory';
  }
  return 'file';
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { autoClose: false, lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, zipFile) => {
        if (error || !zipFile) reject(error ?? new Error('无法打开分享包'));
        else resolve(zipFile);
      },
    );
  });
}

function readAllZipEntries(zipFile: yauzl.ZipFile): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const buffers = new Map<string, Buffer>();
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    zipFile.on('error', (error) => fail(error));
    zipFile.on('entry', (entry: yauzl.Entry) => {
      if (settled) return;
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
        fail(new Error('分享包不能包含加密条目'));
        return;
      }
      const kind = archiveEntryKind(entry);
      const candidatePath =
        kind === 'directory' ? entry.fileName.replace(/\/+$/, '') : entry.fileName;
      if (!isSafePackagePath(candidatePath)) {
        fail(new Error('分享包包含不安全路径'));
        return;
      }
      if (kind === 'unsupported') {
        fail(new Error('分享包不能包含符号链接或特殊文件'));
        return;
      }
      if (kind === 'directory') {
        zipFile.readEntry();
        return;
      }
      if (buffers.size >= MAX_ENTRIES) {
        fail(new Error(`分享包条目超过上限 ${MAX_ENTRIES}`));
        return;
      }
      if (buffers.has(entry.fileName)) {
        fail(new Error('分享包包含重复条目'));
        return;
      }
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        fail(new Error('分享包内文件超过大小上限'));
        return;
      }
      const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
      if (entry.uncompressedSize > 1024 * 1024 && ratio > MAX_COMPRESSION_RATIO) {
        fail(new Error('分享包条目压缩比异常'));
        return;
      }

      zipFile.openReadStream(entry, (openError, stream) => {
        if (openError || !stream) {
          fail(openError ?? new Error('无法读取分享包条目'));
          return;
        }
        const chunks: Buffer[] = [];
        let entryBytes = 0;
        stream.on('data', (chunk: Buffer) => {
          if (settled) return;
          entryBytes += chunk.length;
          total += chunk.length;
          if (entryBytes > MAX_ENTRY_BYTES || total > MAX_DESIGN_SCHEME_PACKAGE_BYTES) {
            stream.destroy();
            fail(new Error('分享包解压后超过大小上限'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('error', (error) => fail(error));
        stream.on('end', () => {
          if (settled) return;
          if (entryBytes !== entry.uncompressedSize) {
            fail(new Error('分享包条目大小与目录记录不一致'));
            return;
          }
          buffers.set(entry.fileName, Buffer.concat(chunks));
          zipFile.readEntry();
        });
      });
    });
    zipFile.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(buffers);
    });
    zipFile.readEntry();
  });
}

function parseManifest(entries: Map<string, Buffer>): unknown {
  const bytes = entries.get('manifest.json');
  if (!bytes) throw new Error('分享包缺少 manifest.json');
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('manifest.json 超过大小上限');
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('manifest.json 不是有效 JSON');
  }
}

export function contentEntriesHash(
  entries: Array<{ relativePath: string; contentHash: string; sizeBytes: number }>,
): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )) {
    hash.update(entry.relativePath);
    hash.update('\0');
    hash.update(normalizedHash(entry.contentHash));
    hash.update('\0');
    hash.update(String(entry.sizeBytes));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function assertExactArchiveEntries(entries: Map<string, Buffer>, declaredPaths: Set<string>): void {
  for (const name of entries.keys()) {
    if (name === 'manifest.json') continue;
    if (!declaredPaths.has(name)) throw new Error('分享包包含未声明的文件');
  }
  for (const path of declaredPaths) {
    if (!entries.has(path)) throw new Error('分享包缺少已声明的文件');
  }
}

function validateLegacyPackage(
  candidate: unknown,
  entries: Map<string, Buffer>,
): ValidatedDesignSchemePackage {
  const parsed = legacyManifestSchema.safeParse(candidate);
  if (!parsed.success) throw new Error('legacy manifest.json 字段无效');
  const manifest = parsed.data;
  const declaredPaths = new Set(Object.keys(manifest.files));
  assertExactArchiveEntries(entries, declaredPaths);
  for (const [name, declaredHash] of Object.entries(manifest.files)) {
    const bytes = entries.get(name);
    if (!bytes || sha256(bytes) !== normalizedHash(declaredHash)) {
      throw new Error('分享包文件哈希不匹配');
    }
    if (name.startsWith('assets/') || name.startsWith('previews/')) {
      if (!sniffImageMimeType(bytes)) throw new Error('分享包资产不是有效图片');
    }
  }
  if (!entries.has('scheme.json')) throw new Error('分享包缺少 scheme.json');
  return { formatVersion: LEGACY_SHARE_FORMAT_VERSION, manifest, entries };
}

function assertUniqueIds(ids: string[], message: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(message);
}

function validateCanonicalReferenceGraph(manifest: CanonicalShareManifest): void {
  const snapshotIds = manifest.sourceSnapshots.map((snapshot) => snapshot.id);
  const assetIds = manifest.assets.map((asset) => asset.id);
  assertUniqueIds(snapshotIds, 'manifest 来源快照标识重复');
  assertUniqueIds(assetIds, 'manifest 资产标识重复');

  const documentSnapshotIds = manifest.document.sourceSnapshotIds;
  const documentAssetIds = manifest.document.assetIds;
  assertUniqueIds(documentSnapshotIds, '方案文档来源快照标识重复');
  assertUniqueIds(documentAssetIds, '方案文档资产标识重复');
  if (
    documentSnapshotIds.length !== snapshotIds.length ||
    documentSnapshotIds.some((id) => !new Set(snapshotIds).has(id))
  ) {
    throw new Error('方案文档来源快照引用与 manifest 不一致');
  }
  if (
    documentAssetIds.length !== assetIds.length ||
    documentAssetIds.some((id) => !new Set(assetIds).has(id))
  ) {
    throw new Error('方案文档资产引用与 manifest 不一致');
  }

  const snapshotsById = new Map(
    manifest.sourceSnapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  const referencedSnapshotIds = new Set<string>();
  for (const source of manifest.document.sources) {
    if (!source.snapshotId) {
      if (source.packageId) throw new Error('没有来源快照的来源不能声明 packageId');
      continue;
    }
    const snapshot = snapshotsById.get(source.snapshotId);
    if (!snapshot) throw new Error('方案来源引用了未知来源快照');
    if (source.packageId && source.packageId !== snapshot.packageId) {
      throw new Error('方案来源 packageId 与来源快照不一致');
    }
    referencedSnapshotIds.add(snapshot.id);
  }
  if (referencedSnapshotIds.size !== snapshotIds.length) {
    throw new Error('manifest 来源快照没有被方案来源完整引用');
  }

  const contentPaths = new Set<string>();
  const sourceFileKeys = new Set<string>();
  for (const snapshot of manifest.sourceSnapshots) {
    const snapshotFilePaths = new Set<string>();
    for (const file of snapshot.files) {
      if (snapshotFilePaths.has(file.relativePath)) {
        throw new Error('来源快照包含重复文件路径');
      }
      snapshotFilePaths.add(file.relativePath);
      sourceFileKeys.add(`${snapshot.id}\0sources/${snapshot.id}/${file.relativePath}`);
    }
  }
  const assetEntryIds = new Set<string>();
  let revisionDocumentCount = 0;
  for (const entry of manifest.content.entries) {
    if (contentPaths.has(entry.relativePath)) throw new Error('manifest 包含重复内容路径');
    contentPaths.add(entry.relativePath);
    if (entry.kind === 'revision-document') {
      revisionDocumentCount += 1;
      if (entry.sourceId || entry.assetId) throw new Error('方案版本文档条目不能绑定来源或资产');
    } else if (entry.kind === 'source-file') {
      if (!entry.sourceId) throw new Error('来源文件没有来源快照标识');
      const key = `${entry.sourceId}\0${entry.relativePath}`;
      if (!sourceFileKeys.has(key)) throw new Error('manifest 包含未声明的来源文件');
    } else {
      if (!entry.assetId || !assetIds.includes(entry.assetId)) {
        throw new Error('manifest 资产条目引用了未知资产');
      }
      if (assetEntryIds.has(entry.assetId)) throw new Error('manifest 资产内容条目重复');
      assetEntryIds.add(entry.assetId);
    }
  }
  if (revisionDocumentCount !== 1) throw new Error('分享包必须包含一个方案版本文档');
  if (assetEntryIds.size !== assetIds.length) throw new Error('manifest 资产没有完整内容条目');

  const actualSourceKeys = new Set(
    manifest.content.entries
      .filter((entry) => entry.kind === 'source-file')
      .map((entry) => `${entry.sourceId}\0${entry.relativePath}`),
  );
  if (
    sourceFileKeys.size !== actualSourceKeys.size ||
    [...sourceFileKeys].some((key) => !actualSourceKeys.has(key))
  ) {
    throw new Error('manifest 来源文件内容条目与快照不一致');
  }
}

function validateCanonicalPackage(
  candidate: unknown,
  entries: Map<string, Buffer>,
): ValidatedDesignSchemePackage {
  const parsed = sharePackageManifestSchema.safeParse(candidate);
  if (!parsed.success) throw new Error('canonical manifest.json 字段无效');
  const manifest = parsed.data;
  validateCanonicalReferenceGraph(manifest);
  const paths = new Set<string>();
  for (const contentEntry of manifest.content.entries) {
    if (paths.has(contentEntry.relativePath)) throw new Error('manifest 包含重复内容路径');
    paths.add(contentEntry.relativePath);
  }
  assertExactArchiveEntries(entries, paths);

  let totalBytes = 0;
  let revisionDocumentCount = 0;
  const assetsById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const sourceIds = new Set(manifest.sourceSnapshots.map((snapshot) => snapshot.id));
  for (const contentEntry of manifest.content.entries) {
    const bytes = entries.get(contentEntry.relativePath);
    if (!bytes) throw new Error('分享包缺少内容条目');
    totalBytes += bytes.byteLength;
    if (
      bytes.byteLength !== contentEntry.sizeBytes ||
      sha256(bytes) !== normalizedHash(contentEntry.contentHash)
    ) {
      throw new Error('分享包内容大小或哈希不匹配');
    }
    if (contentEntry.kind === 'revision-document') {
      revisionDocumentCount += 1;
      let documentJson: unknown;
      try {
        documentJson = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw new Error('方案版本文档不是有效 JSON');
      }
      const document = designSchemeRevisionDocumentSchema.safeParse(documentJson);
      if (
        !document.success ||
        JSON.stringify(document.data) !== JSON.stringify(manifest.document)
      ) {
        throw new Error('方案版本文档与 manifest 不一致');
      }
    } else if (contentEntry.kind === 'source-file') {
      if (!contentEntry.sourceId || !sourceIds.has(contentEntry.sourceId)) {
        throw new Error('来源文件没有有效来源快照');
      }
      if (contentEntry.mimeType?.startsWith('image/')) {
        const actualMime = sniffImageMimeType(bytes);
        if (actualMime !== contentEntry.mimeType) throw new Error('来源图片 MIME 不匹配');
      }
    } else {
      const asset = contentEntry.assetId ? assetsById.get(contentEntry.assetId) : undefined;
      const actualMime = sniffImageMimeType(bytes);
      if (!asset || !actualMime || actualMime !== asset.mimeType) {
        throw new Error('分享包资产元数据或 MIME 不匹配');
      }
      if (contentEntry.mimeType !== asset.mimeType) throw new Error('资产内容类型不一致');
    }
  }
  if (revisionDocumentCount !== 1) throw new Error('分享包必须包含一个方案版本文档');
  if (totalBytes !== manifest.content.sizeBytes) throw new Error('分享包内容总大小不匹配');
  if (
    contentEntriesHash(manifest.content.entries) !== normalizedHash(manifest.content.contentHash)
  ) {
    throw new Error('分享包内容索引哈希不匹配');
  }
  return { formatVersion: SHARE_FORMAT_VERSION, manifest, entries };
}

export async function readValidatedDesignSchemePackage(
  filePath: string,
  acceptedFormatVersions: readonly DesignSchemePackageFormatVersion[] = [
    LEGACY_SHARE_FORMAT_VERSION,
    SHARE_FORMAT_VERSION,
  ],
): Promise<ValidatedDesignSchemePackage> {
  const file = await stat(filePath);
  if (!file.isFile() || file.size <= 0 || file.size > MAX_DESIGN_SCHEME_PACKAGE_BYTES) {
    throw new Error('分享包不是普通文件或超过大小上限');
  }
  let zipFile: yauzl.ZipFile | null = null;
  try {
    zipFile = await openZip(filePath);
    const entries = await readAllZipEntries(zipFile);
    const candidate = parseManifest(entries);
    if (!candidate || typeof candidate !== 'object') throw new Error('manifest.json 不是有效对象');
    const header = candidate as { format?: unknown; formatVersion?: unknown };
    if (header.format !== SHARE_FORMAT) {
      throw new DesignSchemePackageValidationError(
        'INVALID_TYPE',
        '所选文件不是 .musefold.design 文件',
      );
    }
    const version = header.formatVersion;
    if (version !== LEGACY_SHARE_FORMAT_VERSION && version !== SHARE_FORMAT_VERSION) {
      throw new DesignSchemePackageValidationError(
        'UNSUPPORTED_SCHEMA_VERSION',
        '分享包格式版本不受支持',
      );
    }
    if (!acceptedFormatVersions.includes(version))
      throw new Error('分享包格式版本未被当前操作接受');
    return version === LEGACY_SHARE_FORMAT_VERSION
      ? validateLegacyPackage(candidate, entries)
      : validateCanonicalPackage(candidate, entries);
  } finally {
    zipFile?.close();
  }
}

export async function inspectDesignSchemePackage(
  filePath: string,
  acceptedFormatVersions?: readonly DesignSchemePackageFormatVersion[],
): Promise<{ formatVersion: DesignSchemePackageFormatVersion }> {
  const validated = await readValidatedDesignSchemePackage(filePath, acceptedFormatVersions);
  return { formatVersion: validated.formatVersion };
}
