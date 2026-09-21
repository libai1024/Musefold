import { readRevisionAssetIds } from '@musefold/core/db/design-scheme/revision-assets';
import { retainDesignSchemeOperation } from '@musefold/core/services/design-scheme-lifetime';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import { writeFile } from 'node:fs/promises';
import {
  writeDesignSchemePackageBytes,
  prepareLegacyDesignSchemeImportContent,
} from '@musefold/scheme-package';
import {
  DESIGN_SCHEME_PACKAGE_LIMITS,
  legacyDesignSchemeDocumentToCanonical as toCanonicalDocument,
  canonicalDesignSchemeDocumentToLegacy as toLegacyDocument,
  designSchemeAssetSchema,
  designSchemeHashSchema,
  designSchemeRevisionDocumentSchema,
  relativePathSchema,
  resolvedRefSchema,
  sharePackageManifestSchema,
  sourceCommitSchema,
  sourceSnapshotSchema,
  type DesignSchemeRevisionDocument,
} from '@musefold/contracts';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { retainDesignSchemeImportSession } from '@musefold/core/services/design-scheme-import-gc';
import type {
  DesignSchemeRevisionDocument as LegacyDocument,
  SourceBinding as LegacySourceBinding,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type { DesignSchemeSummary } from '@musefold/desktop-contracts/design-scheme';
import { appError, fail, ok, type AppResult } from '@musefold/domain/app-result';
import { getPaths } from '../../system/paths';
import {
  stableContentEntriesHash,
  DesignSchemePackageValidationError,
  isSafePackagePath,
  normalizedHash,
  readValidatedDesignSchemePackage,
  readValidatedDesignSchemePackageBytes,
  sha256,
  SHARE_FORMAT,
  SHARE_FORMAT_VERSION,
  type CanonicalShareManifest,
  type ValidatedDesignSchemePackage,
} from './package-archive';
import {
  probeImageAssetMetadata,
  sniffImageMimeType,
  textMimeTypeForPath,
} from './source-ingestion';

export { LEGACY_SHARE_FORMAT_VERSION, SHARE_FORMAT, SHARE_FORMAT_VERSION } from './package-archive';

const MAX_PACKAGE_BYTES = DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes;
const MAX_PACKAGE_ENTRIES = DESIGN_SCHEME_PACKAGE_LIMITS.entries - 1;

type SourceRole = 'normative' | 'reference' | 'example' | 'context';
type SourceKind = 'github' | 'history' | 'user-brief';

type ContentEntry = CanonicalShareManifest['content']['entries'][number];
type CanonicalAsset = CanonicalShareManifest['assets'][number];
type CanonicalSnapshot = CanonicalShareManifest['sourceSnapshots'][number];

export interface ShareDeps {
  db: Database.Database;
  userDataDir?: string;
  picturesDir?: string;
}

interface ExportSnapshotRow {
  id: string;
  package_id: string;
  kind: SourceKind;
  repository_url: string | null;
  license: string | null;
  ref: string;
  commit_hash: string | null;
  content_hash: string | null;
  created_at: number;
  role: SourceRole;
  scan_json: string;
}

interface ExportSourceFileRow {
  path: string;
  kind: 'text' | 'image' | 'other';
  content_hash: string;
  size_bytes: number;
  store_key: string | null;
  text_content: string | null;
  mime_type: string | null;
  evidence_path: string | null;
}

interface ExportAssetRow {
  id: string;
  revision_id: string;
  store_key: string;
  role: CanonicalAsset['role'];
  origin: CanonicalAsset['origin'];
  license: string | null;
  created_at: number;
}

interface ExportSnapshot {
  snapshot: CanonicalSnapshot;
  role: SourceRole;
  license: string | null;
}

export interface ExportResult {
  path: string;
  fileName: string;
  sizeBytes: number;
  packageId: string;
  contentHash: string;
  createdAt: number;
}

export interface ImportResult {
  scheme: DesignSchemeSummary;
  revisionId: string;
}

function opaqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function isWithin(root: string, target: string): boolean {
  const offset = relative(root, target);
  return (
    offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
  );
}

function readManagedRegularFile(
  storeKey: string,
  userDataDir: string,
  picturesDir: string,
): { bytes: Buffer; absolutePath: string } {
  const target = resolve(isAbsolute(storeKey) ? storeKey : join(userDataDir, storeKey));
  const roots = [userDataDir, picturesDir].map((root) => resolve(root));
  if (!roots.some((root) => isWithin(root, target))) throw new Error('文件不在受管存储目录');
  const targetStat = lstatSync(target);
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) throw new Error('受管文件不是普通文件');
  const realTarget = realpathSync(target);
  const realRoots = roots.flatMap((root) => {
    try {
      return [realpathSync(root)];
    } catch {
      return [];
    }
  });
  if (!realRoots.some((root) => isWithin(root, realTarget))) {
    throw new Error('受管文件解析到存储目录之外');
  }
  return { bytes: readFileSync(realTarget), absolutePath: realTarget };
}

function safeOptional<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function canonicalSourceKindToStorageKind(kind: CanonicalSnapshot['kind']): SourceKind {
  return kind === 'share-import' ? 'user-brief' : kind;
}

function sourceKindToBindingKind(kind: CanonicalSnapshot['kind']): LegacySourceBinding['kind'] {
  if (kind === 'github') return 'github-skill';
  if (kind === 'history') return 'history-image';
  return 'user-brief';
}

function bindDocumentSnapshots(
  document: DesignSchemeRevisionDocument,
  snapshots: ExportSnapshot[],
): DesignSchemeRevisionDocument {
  const sources = document.sources.map((source) => ({ ...source }));
  const used = new Set<number>();
  for (const { snapshot, role, license } of snapshots) {
    const identified = sources.filter((source) => source.snapshotId === snapshot.id);
    if (identified.length) {
      for (const source of identified) source.packageId = snapshot.packageId;
      continue;
    }
    let index = sources.findIndex(
      (source, candidateIndex) =>
        !source.snapshotId && !used.has(candidateIndex) && source.role === role,
    );
    if (index < 0)
      index = sources.findIndex((_source, candidateIndex) => !used.has(candidateIndex));
    if (index >= 0) {
      used.add(index);
      const source = sources[index];
      if (source) {
        sources[index] = {
          ...source,
          packageId: snapshot.packageId,
          snapshotId: snapshot.id,
          ...(license ? { license } : {}),
        };
      }
      continue;
    }
    sources.push({
      id: `src_import_${sources.length + 1}`,
      kind: sourceKindToBindingKind(snapshot.kind),
      role,
      packageId: snapshot.packageId,
      snapshotId: snapshot.id,
      ...(snapshot.repositoryUrl ? { repositoryUrl: snapshot.repositoryUrl } : {}),
      ...(license ? { license } : {}),
      resolvedRef: snapshot.resolvedRef ?? snapshot.ref ?? 'import',
      commitHash: snapshot.commitHash ?? snapshot.commit ?? null,
      contentHash: snapshot.contentHash ?? null,
    });
  }
  return designSchemeRevisionDocumentSchema.parse({
    ...document,
    sources,
    sourceSnapshotIds: snapshots.map(({ snapshot }) => snapshot.id),
  });
}

function addPackageEntry(
  entries: Map<string, Buffer>,
  contentEntries: ContentEntry[],
  input: Omit<ContentEntry, 'contentHash' | 'sizeBytes'>,
  bytes: Buffer,
): void {
  if (!isSafePackagePath(input.relativePath) || entries.has(input.relativePath)) {
    throw new Error('分享包内容路径冲突');
  }
  if (entries.size >= MAX_PACKAGE_ENTRIES) throw new Error('分享包内容条目超过上限');
  entries.set(input.relativePath, bytes);
  contentEntries.push({ ...input, contentHash: sha256(bytes), sizeBytes: bytes.byteLength });
}

function collectSnapshots(
  db: Database.Database,
  revisionId: string,
  entries: Map<string, Buffer>,
  contentEntries: ContentEntry[],
  userDataDir: string,
  picturesDir: string,
): ExportSnapshot[] {
  const rows = db
    .prepare(
      `SELECT snap.id, snap.package_id, pkg.kind, pkg.repository_url, pkg.license,
              snap.ref, snap.commit_hash, snap.content_hash, snap.created_at, snap.scan_json, binding.role
         FROM design_scheme_source_bindings binding
         JOIN source_snapshots snap ON snap.id = binding.source_snapshot_id
         JOIN source_packages pkg ON pkg.id = snap.package_id
        WHERE binding.revision_id = ?
        ORDER BY snap.created_at ASC, snap.id ASC`,
    )
    .all(revisionId) as ExportSnapshotRow[];
  const fileQuery = db.prepare(
    `SELECT path, kind, content_hash, size_bytes, store_key, text_content, mime_type, evidence_path
       FROM source_files WHERE snapshot_id = ? ORDER BY path`,
  );

  return rows.map((row) => {
    const files: CanonicalSnapshot['files'] = [];
    const sourceContentEntries: ContentEntry[] = [];
    for (const file of fileQuery.all(row.id) as ExportSourceFileRow[]) {
      const relativePath = relativePathSchema.parse(file.path);
      let bytes: Buffer;
      let mimeType = file.mime_type;
      if (file.kind === 'text' && file.text_content != null) {
        bytes = Buffer.from(file.text_content, 'utf8');
        // Imported text already has admitted metadata; infer only for legacy rows.
        mimeType ??= textMimeTypeForPath(relativePath);
      } else if (file.store_key) {
        bytes = readManagedRegularFile(file.store_key, userDataDir, picturesDir).bytes;
        if (file.kind === 'image') {
          mimeType = sniffImageMimeType(bytes);
          if (!mimeType) throw new Error('来源图片不是受支持的真实图片');
        }
      } else {
        throw new Error('来源快照文件缺少可导出的内容');
      }
      const hash = sha256(bytes);
      const packagePath = `sources/${row.id}/${relativePath}`;
      const entry: Omit<ContentEntry, 'contentHash' | 'sizeBytes'> = {
        relativePath: packagePath,
        kind: 'source-file',
        mimeType,
        sourceId: row.id,
        assetId: null,
      };
      addPackageEntry(entries, contentEntries, entry, bytes);
      const added = contentEntries.at(-1);
      if (added) sourceContentEntries.push(added);
      files.push({
        relativePath,
        kind: file.kind,
        mimeType,
        sizeBytes: bytes.byteLength,
        contentHash: hash,
        evidencePath: safeOptional(relativePathSchema, file.evidence_path) ?? null,
        textExcerpt: file.kind === 'text' ? bytes.toString('utf8').slice(0, 2_000) : null,
      });
    }
    const ref = safeOptional(resolvedRefSchema, row.ref) ?? 'import';
    const commit = safeOptional(sourceCommitSchema, row.commit_hash) ?? null;
    const contentHash =
      safeOptional(designSchemeHashSchema, row.content_hash) ??
      stableContentEntriesHash(sourceContentEntries);
    const scan = JSON.parse(row.scan_json) as { importedSnapshot?: unknown };
    const imported = scan.importedSnapshot
      ? sourceSnapshotSchema.parse(scan.importedSnapshot)
      : null;
    if (imported && (imported.id !== row.id || imported.packageId !== row.package_id))
      throw new Error('已导入来源身份与存储不一致');
    const snapshot = {
      id: row.id,
      packageId: row.package_id,
      kind: imported?.kind ?? row.kind,
      repositoryUrl: row.repository_url,
      resolvedRef: ref,
      commitHash: commit,
      contentHash,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      files,
      createdAt: row.created_at,
      ...(imported?.historyItems ? { historyItems: imported.historyItems } : {}),
    };
    return {
      snapshot: sharePackageManifestSchema.shape.sourceSnapshots.element.parse(snapshot),
      role: row.role,
      license: row.license,
    };
  });
}

function mimeExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/bmp':
      return '.bmp';
    case 'image/avif':
      return '.avif';
    default:
      return '.png';
  }
}

function collectAssets(
  db: Database.Database,
  schemeId: string,
  revisionId: string,
  entries: Map<string, Buffer>,
  contentEntries: ContentEntry[],
  userDataDir: string,
  picturesDir: string,
): CanonicalAsset[] {
  const selectedIds = readRevisionAssetIds(db, schemeId, revisionId);
  const rows = db
    .prepare(
      `SELECT asset.id, asset.revision_id, asset.store_key, asset.role, asset.origin,
              asset.license, asset.created_at
         FROM design_scheme_assets asset
         JOIN design_scheme_revisions revision ON revision.revision_id = asset.revision_id
        WHERE revision.scheme_id = ? AND asset.id IN (SELECT value FROM json_each(?))
        ORDER BY asset.created_at ASC, asset.id ASC`,
    )
    .all(schemeId, JSON.stringify(selectedIds)) as ExportAssetRow[];

  return rows.map((row) => {
    const managed = readManagedRegularFile(row.store_key, userDataDir, picturesDir);
    const metadata = probeImageAssetMetadata(managed.absolutePath);
    if (!metadata) throw new Error('方案资产缺失或不是受支持的图片');
    const asset = designSchemeAssetSchema.parse({
      id: row.id,
      origin: row.origin,
      mimeType: metadata.mimeType,
      width: metadata.width,
      height: metadata.height,
      byteSize: metadata.byteSize,
      contentHash: metadata.contentHash,
      role: row.role,
      license: row.license,
      createdAt: row.created_at,
    });
    addPackageEntry(
      entries,
      contentEntries,
      {
        relativePath: `assets/${asset.id}${mimeExtension(asset.mimeType)}`,
        kind: 'asset',
        mimeType: asset.mimeType,
        sourceId: null,
        assetId: asset.id,
      },
      managed.bytes,
    );
    return asset;
  });
}

async function writeZip(
  targetPath: string,
  entries: Map<string, Buffer>,
  manifest: CanonicalShareManifest,
): Promise<void> {
  const bytes = await writeDesignSchemePackageBytes(manifest, entries);
  await writeFile(targetPath, bytes, { flag: 'wx', mode: 0o600 });
}

export async function exportDesignScheme(
  schemeId: string,
  targetPath: string,
  deps: ShareDeps,
  revisionId?: string,
): Promise<AppResult<ExportResult>> {
  const release = retainDesignSchemeOperation(deps.db, schemeId);
  try {
    return await exportRetainedDesignScheme(schemeId, targetPath, deps, revisionId);
  } finally {
    release();
  }
}

async function exportRetainedDesignScheme(
  schemeId: string,
  targetPath: string,
  deps: ShareDeps,
  revisionId?: string,
): Promise<AppResult<ExportResult>> {
  const repository = new DesignSchemeRepository(deps.db);
  const paths = getPaths();
  const userDataDir = deps.userDataDir ?? paths.userData;
  const picturesDir = deps.picturesDir ?? paths.pictures;
  let summary: DesignSchemeSummary;
  try {
    summary = repository.requireSummary(schemeId);
  } catch {
    return fail(appError('MISSING_REFERENCE', '方案不存在或已被移除', { recoveryAction: 'retry' }));
  }
  if (summary.status !== 'formal') {
    return fail(
      appError('INVALID_STATE', '只有正式方案可以导出；请先完成试运行并转为正式。', {
        recoveryAction: 'edit-input',
      }),
    );
  }
  const selectedRevisionId = revisionId ?? summary.currentRevisionId;
  if (selectedRevisionId !== summary.currentRevisionId) {
    return fail(appError('INVALID_STATE', '只能导出当前正式版本', { recoveryAction: 'retry' }));
  }
  const legacyDocument = repository.getRevisionDocument(selectedRevisionId);
  if (!legacyDocument) {
    return fail(appError('MISSING_REFERENCE', '方案版本文档缺失', { recoveryAction: 'retry' }));
  }

  const packageId = opaqueId('share');
  const createdAt = Date.now();
  const entries = new Map<string, Buffer>();
  const contentEntries: ContentEntry[] = [];
  let manifest: CanonicalShareManifest;
  try {
    const snapshots = collectSnapshots(
      deps.db,
      selectedRevisionId,
      entries,
      contentEntries,
      userDataDir,
      picturesDir,
    );
    const assets = collectAssets(
      deps.db,
      schemeId,
      selectedRevisionId,
      entries,
      contentEntries,
      userDataDir,
      picturesDir,
    );
    let document = bindDocumentSnapshots(toCanonicalDocument(legacyDocument), snapshots);
    document = designSchemeRevisionDocumentSchema.parse({
      ...document,
      assetIds: assets.map((asset) => asset.id),
    });
    addPackageEntry(
      entries,
      contentEntries,
      {
        relativePath: 'scheme.json',
        kind: 'revision-document',
        mimeType: 'application/json',
        sourceId: null,
        assetId: null,
      },
      Buffer.from(JSON.stringify(document), 'utf8'),
    );
    const contentSize = contentEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    manifest = sharePackageManifestSchema.parse({
      packageId,
      format: SHARE_FORMAT,
      formatVersion: SHARE_FORMAT_VERSION,
      schemeId,
      revisionId: selectedRevisionId,
      status: 'formal',
      document,
      sourceSnapshots: snapshots.map(({ snapshot }) => snapshot),
      assets,
      content: {
        contentHash: stableContentEntriesHash(contentEntries),
        sizeBytes: contentSize,
        entries: contentEntries,
      },
    });
  } catch {
    return fail(
      appError('INVALID_STATE', '方案内容无法安全转换为 v2 分享包', {
        recoveryAction: 'retry',
      }),
    );
  }

  const absoluteTarget = resolve(targetPath);
  const partialPath = join(
    dirname(absoluteTarget),
    `.${basename(absoluteTarget)}.${randomUUID()}.partial`,
  );
  let backupPath: string | undefined;
  let installed = false;
  try {
    mkdirSync(dirname(absoluteTarget), { recursive: true });
    await writeZip(partialPath, entries, manifest);
    const sizeBytes = statSync(partialPath).size;
    if (sizeBytes <= 0 || sizeBytes > MAX_PACKAGE_BYTES) throw new Error('分享包大小无效');
    const bytes = readFileSync(partialPath);
    const contentHash = sha256(bytes);
    if (existsSync(absoluteTarget)) {
      backupPath = join(
        dirname(absoluteTarget),
        `.${basename(absoluteTarget)}.${randomUUID()}.backup`,
      );
      renameSync(absoluteTarget, backupPath);
    }
    renameSync(partialPath, absoluteTarget);
    installed = true;
    deps.db
      .prepare(
        'INSERT INTO share_packages (package_id, scheme_id, manifest_json, path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(packageId, schemeId, JSON.stringify(manifest), absoluteTarget, createdAt);
    if (backupPath) {
      try {
        rmSync(backupPath, { force: true });
      } catch {
        // A stale backup is harmless after the new package is indexed.
      }
    }
    return ok({
      path: absoluteTarget,
      fileName: basename(absoluteTarget),
      sizeBytes,
      packageId,
      contentHash,
      createdAt,
    });
  } catch {
    rmSync(partialPath, { force: true });
    if (installed) rmSync(absoluteTarget, { force: true });
    if (backupPath && existsSync(backupPath)) {
      try {
        renameSync(backupPath, absoluteTarget);
      } catch {
        rmSync(backupPath, { force: true });
      }
    }
    return fail(appError('UNKNOWN', '写入分享包失败', { recoveryAction: 'retry' }));
  }
}

interface PreparedSnapshot {
  package: {
    id: string;
    kind: SourceKind;
    repositoryUrl?: string;
    license?: string;
  };
  snapshot: {
    id: string;
    ref: string;
    commitHash: string | null;
    contentHash?: string;
    totalBytes: number;
    scan: unknown;
  };
  files: Array<{
    path: string;
    kind: 'text' | 'image' | 'other';
    contentHash: string;
    sizeBytes: number;
    storeKey?: string;
    textContent?: string;
    mimeType?: string | null;
    evidencePath?: string | null;
  }>;
  role: SourceRole;
}

interface PreparedAsset {
  id: string;
  storeKey: string;
  role: CanonicalAsset['role'];
  origin: CanonicalAsset['origin'];
  license: string | null;
  createdAt: number;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  contentHash: string;
}

interface PreparedImport {
  document: LegacyDocument;
  sourceLabel: string;
  sourcePresentation: 'skill' | 'musefold-created';
  snapshots: PreparedSnapshot[];
  assets: PreparedAsset[];
  importRoot: string;
}

function safeWriteManagedFile(root: string, relativePath: string, bytes: Buffer): string {
  const safeRelative = relativePathSchema.parse(relativePath);
  const absolute = resolve(root, safeRelative);
  if (!isWithin(resolve(root), absolute)) throw new Error('导入内容路径越界');
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  writeFileSync(absolute, bytes, { flag: 'wx', mode: 0o600 });
  return absolute;
}

function prepareCanonicalImport(
  validated: Extract<ValidatedDesignSchemePackage, { formatVersion: 2 }>,
  userDataDir: string,
  newSchemeId: string,
): PreparedImport {
  const { manifest, entries } = validated;
  const newRevisionId = opaqueId('dsrv');
  const importRoot = join(userDataDir, 'design-scheme-imports', newSchemeId);
  mkdirSync(importRoot, { recursive: true, mode: 0o700 });

  try {
    const snapshotIds = new Map<string, string>();
    const packageIds = new Map<string, string>();
    for (const snapshot of manifest.sourceSnapshots) {
      snapshotIds.set(snapshot.id, opaqueId('snap'));
      if (!packageIds.has(snapshot.packageId)) {
        packageIds.set(snapshot.packageId, opaqueId('pkg'));
      }
    }
    const assetIds = new Map(manifest.assets.map((asset) => [asset.id, opaqueId('dsa')]));
    const roleBySnapshot = new Map<string, SourceRole>();
    const licenseBySnapshot = new Map<string, string>();
    for (const source of manifest.document.sources) {
      if (source.snapshotId) {
        roleBySnapshot.set(source.snapshotId, source.role);
        if (source.license) licenseBySnapshot.set(source.snapshotId, source.license);
      }
    }

    const snapshots: PreparedSnapshot[] = manifest.sourceSnapshots.map((snapshot) => {
      const newSnapshotId = snapshotIds.get(snapshot.id);
      const newPackageId = packageIds.get(snapshot.packageId);
      if (!newSnapshotId || !newPackageId) throw new Error('来源快照标识映射失败');
      const files = snapshot.files.map((file) => {
        const packagePath = `sources/${snapshot.id}/${file.relativePath}`;
        const contentEntry = manifest.content.entries.find(
          (entry) =>
            entry.kind === 'source-file' &&
            entry.sourceId === snapshot.id &&
            entry.relativePath === packagePath,
        );
        const bytes = contentEntry ? entries.get(contentEntry.relativePath) : undefined;
        if (!contentEntry || !bytes) throw new Error('来源文件内容缺失');
        if (file.kind === 'text') {
          return {
            path: file.relativePath,
            kind: file.kind,
            contentHash: sha256(bytes),
            sizeBytes: bytes.byteLength,
            textContent: bytes.toString('utf8'),
            mimeType: file.mimeType ?? textMimeTypeForPath(file.relativePath),
            evidencePath: file.evidencePath,
          };
        }
        const storedRelative = join('sources', newSnapshotId, file.relativePath).replaceAll(
          '\\',
          '/',
        );
        safeWriteManagedFile(importRoot, storedRelative, bytes);
        return {
          path: file.relativePath,
          kind: file.kind,
          contentHash: sha256(bytes),
          sizeBytes: bytes.byteLength,
          storeKey: join('design-scheme-imports', newSchemeId, storedRelative),
          mimeType: file.mimeType,
          evidencePath: file.evidencePath,
        };
      });
      return {
        package: {
          id: newPackageId,
          kind: canonicalSourceKindToStorageKind(snapshot.kind),
          ...(snapshot.repositoryUrl ? { repositoryUrl: snapshot.repositoryUrl } : {}),
          ...(licenseBySnapshot.has(snapshot.id)
            ? { license: licenseBySnapshot.get(snapshot.id) }
            : {}),
        },
        snapshot: {
          id: newSnapshotId,
          ref: snapshot.resolvedRef ?? snapshot.ref ?? 'import',
          commitHash: snapshot.commitHash ?? snapshot.commit ?? null,
          contentHash: snapshot.contentHash ?? undefined,
          totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
          scan: {
            importedFromPackageId: manifest.packageId,
            formatVersion: SHARE_FORMAT_VERSION,
            importedSnapshot: {
              ...snapshot,
              id: newSnapshotId,
              packageId: newPackageId,
              ...(snapshot.historyItems
                ? {
                    historyItems: snapshot.historyItems.map((item) => {
                      const imageAssetId = assetIds.get(item.imageAssetId);
                      if (!imageAssetId) throw new Error('历史图片资产标识映射失败');
                      return { ...item, imageAssetId };
                    }),
                  }
                : {}),
            },
          },
        },
        files,
        role: roleBySnapshot.get(snapshot.id) ?? 'context',
      };
    });

    const assets: PreparedAsset[] = manifest.assets.map((asset) => {
      const contentEntry = manifest.content.entries.find(
        (entry) => entry.kind === 'asset' && entry.assetId === asset.id,
      );
      const bytes = contentEntry ? entries.get(contentEntry.relativePath) : undefined;
      const newAssetId = assetIds.get(asset.id);
      if (!contentEntry || !bytes || !newAssetId) throw new Error('方案资产内容缺失');
      const storedRelative = `assets/${newAssetId}${extname(contentEntry.relativePath) || mimeExtension(asset.mimeType)}`;
      safeWriteManagedFile(importRoot, storedRelative, bytes);
      return {
        ...asset,
        id: newAssetId,
        storeKey: join('design-scheme-imports', newSchemeId, storedRelative),
        createdAt:
          typeof asset.createdAt === 'number' ? asset.createdAt : Date.parse(asset.createdAt),
        // Imported schemes need their own successful trial; only the previous cover is demoted.
        role: asset.role === 'cover' ? 'example' : asset.role,
      };
    });

    const document = designSchemeRevisionDocumentSchema.parse({
      ...manifest.document,
      schemeId: newSchemeId,
      revisionId: newRevisionId,
      parentRevisionId: null,
      createdBy: 'import',
      ...(manifest.document.repositoryImages
        ? {
            repositoryImages: manifest.document.repositoryImages.map((image) => {
              const snapshotId = snapshotIds.get(image.snapshotId);
              const assetId = assetIds.get(image.assetId);
              if (!snapshotId || !assetId) throw new Error('仓库图片来源或资产标识映射失败');
              return { ...image, snapshotId, assetId };
            }),
          }
        : {}),
      sourceSnapshotIds: manifest.document.sourceSnapshotIds.map((id) => {
        const mappedId = snapshotIds.get(id);
        if (!mappedId) throw new Error('方案文档来源快照标识映射失败');
        return mappedId;
      }),
      assetIds: manifest.document.assetIds.map((id) => {
        const mappedId = assetIds.get(id);
        if (!mappedId) throw new Error('方案文档资产标识映射失败');
        return mappedId;
      }),
      sources: manifest.document.sources.map((source) => {
        const packageId = source.packageId ? packageIds.get(source.packageId) : undefined;
        const snapshotId = source.snapshotId ? snapshotIds.get(source.snapshotId) : undefined;

        if (source.packageId && !packageId) throw new Error('方案来源 packageId 映射失败');
        if (source.snapshotId && !snapshotId) throw new Error('方案来源快照标识映射失败');
        const snapshot = manifest.sourceSnapshots.find((item) => item.id === source.snapshotId);
        return {
          ...source,
          ...(snapshot?.repositoryUrl && !source.repositoryUrl
            ? { repositoryUrl: snapshot.repositoryUrl }
            : {}),
          ...(snapshot?.resolvedRef && !source.resolvedRef
            ? { resolvedRef: snapshot.resolvedRef }
            : {}),
          ...(snapshot?.commitHash && !source.commitHash
            ? { commitHash: snapshot.commitHash }
            : {}),
          ...(snapshot?.contentHash && !source.contentHash
            ? { contentHash: snapshot.contentHash }
            : {}),
          ...(packageId ? { packageId } : {}),
          ...(snapshotId ? { snapshotId } : {}),
        };
      }),
    });
    return {
      document: toLegacyDocument(document),
      sourceLabel:
        document.sources.find((source) => source.repositoryUrl || source.uri)?.repositoryUrl ??
        document.sources.find((source) => source.repositoryUrl || source.uri)?.uri ??
        '导入的分享包',
      sourcePresentation: document.sources.some(
        (source) => source.kind === 'github-skill' || source.kind === 'github-prompt-repo',
      )
        ? 'skill'
        : 'musefold-created',
      snapshots,
      assets,
      importRoot,
    };
  } catch (error) {
    rmSync(importRoot, { recursive: true, force: true });
    throw error;
  }
}

async function prepareLegacyImport(
  validated: Extract<ValidatedDesignSchemePackage, { formatVersion: 1 }>,
  userDataDir: string,
  newSchemeId: string,
): Promise<PreparedImport> {
  const newRevisionId = opaqueId('dsrv');
  const importRoot = join(userDataDir, 'design-scheme-imports', newSchemeId);
  mkdirSync(importRoot, { recursive: true, mode: 0o700 });
  const ids = new Map<string, string>();
  try {
    const content = await prepareLegacyDesignSchemeImportContent(
      validated,
      (kind, original) => {
        const key = `${kind}\0${original}`;
        let value = ids.get(key);
        if (!value) {
          value = opaqueId('import');
          ids.set(key, value);
        }
        return value;
      },
      (bytes) => {
        // Reuse the existing desktop image probe. Files stay in the isolated import root.
        const path = safeWriteManagedFile(importRoot, `probe-${opaqueId('image')}`, bytes);
        try {
          const metadata = probeImageAssetMetadata(path);
          if (!metadata) throw new Error('旧包图片无法读取');
          return metadata;
        } finally {
          rmSync(path, { force: true });
        }
      },
    );
    const snapshots: PreparedSnapshot[] = content.sourceSnapshots.map((metadata) => {
      const sourcePackage = content.sourcePackages.find((item) => item.id === metadata.packageId);
      if (!sourcePackage) throw new Error('旧包来源所属包缺失');
      const files = content.files
        .filter((file) => file.snapshotId === metadata.id)
        .map((file) => {
          const common = {
            path: file.metadata.relativePath,
            kind: file.metadata.kind,
            contentHash: file.metadata.contentHash,
            sizeBytes: file.bytes.length,
            mimeType: file.metadata.mimeType,
            evidencePath: file.metadata.evidencePath,
          };
          if (file.metadata.kind === 'text')
            return { ...common, textContent: file.bytes.toString('utf8') };
          const stored = `sources/${metadata.id}/${file.metadata.relativePath}`;
          safeWriteManagedFile(importRoot, stored, file.bytes);
          return { ...common, storeKey: join('design-scheme-imports', newSchemeId, stored) };
        });
      return {
        package: {
          id: metadata.packageId,
          kind: canonicalSourceKindToStorageKind(metadata.kind),
          repositoryUrl: sourcePackage.repositoryUrl ?? undefined,
          license: sourcePackage.license ?? undefined,
        },
        snapshot: {
          id: metadata.id,
          ref: resolvedRefSchema.parse(metadata.resolvedRef),
          commitHash: metadata.commitHash ?? null,
          contentHash: metadata.contentHash ?? undefined,
          totalBytes: metadata.totalBytes,
          scan: {
            formatVersion: 1,
            importedSnapshot: metadata,
            legacyProvenance: content.provenance.legacySnapshots.find(
              (item) => item.snapshotId === metadata.id,
            ),
          },
        },
        files,
        role:
          content.document.sources.find((source) => source.snapshotId === metadata.id)?.role ??
          'context',
      };
    });
    const assets: PreparedAsset[] = content.assets.map(({ metadata, bytes }) => {
      const stored = `assets/${metadata.id}${mimeExtension(metadata.mimeType)}`;
      safeWriteManagedFile(importRoot, stored, bytes);
      return {
        ...metadata,
        storeKey: join('design-scheme-imports', newSchemeId, stored),
        createdAt:
          typeof metadata.createdAt === 'number'
            ? metadata.createdAt
            : Date.parse(metadata.createdAt),
      };
    });
    return {
      document: toLegacyDocument(
        designSchemeRevisionDocumentSchema.parse({
          ...content.document,
          schemeId: newSchemeId,
          revisionId: newRevisionId,
          createdBy: 'import',
          parentRevisionId: null,
        }),
      ),
      sourceLabel: content.sourceLabel,
      sourcePresentation: content.sourcePresentation,
      snapshots,
      assets,
      importRoot,
    };
  } catch (error) {
    rmSync(importRoot, { recursive: true, force: true });
    throw error;
  }
}

function persistPreparedImport(
  prepared: PreparedImport,
  deps: ShareDeps,
): { scheme: DesignSchemeSummary; revisionId: string } {
  const repository = new DesignSchemeRepository(deps.db);
  return deps.db.transaction(() => {
    for (const snapshot of prepared.snapshots) repository.saveSourceSnapshot(snapshot);
    const summary = repository.insertSchemeDraft({
      document: prepared.document,
      sourceLabel: prepared.sourceLabel,
      sourcePresentation: prepared.sourcePresentation,
      createdBy: 'import',
      bindings: prepared.snapshots.map((snapshot) => ({
        snapshotId: snapshot.snapshot.id,
        role: snapshot.role,
      })),
    });
    const insertAsset = deps.db.prepare(
      `INSERT INTO design_scheme_assets
         (id, revision_id, store_key, role, origin, license, mime_type, width, height,
          byte_size, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const asset of prepared.assets) {
      insertAsset.run(
        asset.id,
        prepared.document.revisionId,
        asset.storeKey,
        asset.role,
        asset.origin,
        asset.license,
        asset.mimeType,
        asset.width,
        asset.height,
        asset.byteSize,
        normalizedHash(asset.contentHash),
        asset.createdAt,
      );
    }
    return { scheme: summary, revisionId: prepared.document.revisionId };
  })();
}

function importFailure(error: unknown, code: 'INVALID_TYPE' | 'INVALID_STATE', message: string) {
  const storageCode =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (storageCode === 'ENOSPC' || storageCode === 'EDQUOT' || storageCode === 'SQLITE_FULL') {
    return fail(
      appError('INVALID_STATE', '磁盘空间不足，导入未完成。请释放空间后重试。', {
        retryable: true,
        recoveryAction: 'retry',
      }),
    );
  }
  return fail(appError(code, message, { recoveryAction: 'retry' }));
}

export async function importDesignScheme(
  filePath: string,
  deps: ShareDeps,
  packageBytes?: Buffer,
): Promise<AppResult<ImportResult>> {
  const userDataDir = deps.userDataDir ?? getPaths().userData;
  let validated: ValidatedDesignSchemePackage;
  try {
    validated = packageBytes
      ? await readValidatedDesignSchemePackageBytes(packageBytes)
      : await readValidatedDesignSchemePackage(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '分享包校验失败';
    const code = error instanceof DesignSchemePackageValidationError ? error.code : 'INVALID_TYPE';
    return fail(appError(code, `分享包校验失败：${message}`, { recoveryAction: 'retry' }));
  }

  // 会话持有先于目录创建（hold 先行）：清扫把在途导入视为活跃属主，
  // 即使此刻 DB 引用尚未提交；提交/回滚/抛错路径在 finally 统一释放。
  const newSchemeId = opaqueId('dsch');
  const releaseImportSession = retainDesignSchemeImportSession(newSchemeId);
  let prepared: PreparedImport;
  try {
    try {
      prepared =
        validated.formatVersion === SHARE_FORMAT_VERSION
          ? prepareCanonicalImport(validated, userDataDir, newSchemeId)
          : await prepareLegacyImport(validated, userDataDir, newSchemeId);
    } catch (error) {
      return importFailure(error, 'INVALID_TYPE', '分享包内容无法安全导入');
    }

    try {
      return ok(persistPreparedImport(prepared, deps));
    } catch (error) {
      rmSync(prepared.importRoot, { recursive: true, force: true });
      return importFailure(error, 'INVALID_STATE', '导入方案失败');
    }
  } finally {
    releaseImportSession();
  }
}

export function packageFileExists(path: string): boolean {
  return existsSync(path);
}
