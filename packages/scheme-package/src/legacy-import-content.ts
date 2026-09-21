import {
  designSchemeAssetSchema,
  designSchemeRevisionDocumentSchema,
  legacyDesignSchemeDocumentToCanonical,
  sourceCommitSchema,
  sourcePackageSchema,
  sourceSnapshotSchema,
  type SourceBinding,
  type DesignSchemeAsset,
} from '@musefold/contracts';
import { decodeLegacyDesignSchemePackage } from './legacy-content.js';
import { normalizedHash, sha256, type ValidatedDesignSchemePackage } from './archive.js';
function requireBytes(entries: Map<string, Buffer>, path: string) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error('方案包缺少完整内容');
  return bytes;
}
function requireMapping(mapping: Map<string, string>, original: string) {
  const value = mapping.get(original);
  if (!value) throw new Error('方案包包含无法映射的实体引用');
  return value;
}
type ImportImageMetadata = Pick<
  DesignSchemeAsset,
  'mimeType' | 'width' | 'height' | 'byteSize' | 'contentHash'
>;

/** V1 scan is retained as untrusted provenance; it cannot create canonical history/asset authority. */
export async function prepareLegacyDesignSchemeImportContent(
  parsed: Extract<ValidatedDesignSchemePackage, { formatVersion: 1 }>,
  id: (kind: string, original: string) => string,
  inspectImage: (bytes: Buffer) => ImportImageMetadata | Promise<ImportImageMetadata>,
) {
  const decoded = decodeLegacyDesignSchemePackage(parsed);
  const imageCount =
    decoded.previews.length +
    decoded.snapshots.reduce(
      (count, snapshot) =>
        count + snapshot.files.filter((file) => file.metadata.kind === 'image').length,
      0,
    );
  if (imageCount > 128) throw new Error('旧包图片数量超过方案限制');
  const original = legacyDesignSchemeDocumentToCanonical(decoded.document);
  const aliases = new Map<string, string>();
  const packageAliases = new Map<string, string>();
  const assetAliases = new Map<string, string>();
  const snapshots = decoded.snapshots.map(({ snapshot, files }) => {
    const commit = sourceCommitSchema.safeParse(snapshot.commitHash);
    const metadata = sourceSnapshotSchema.parse({
      id: id('legacy-snapshot', snapshot.dir),
      packageId: id('legacy-package', snapshot.dir),
      kind: snapshot.kind,
      repositoryUrl: snapshot.repositoryUrl,
      resolvedRef: snapshot.ref,
      // Noncanonical legacy commits remain in provenance, not a truncated PG commit column.
      commitHash: commit.success ? commit.data : null,
      contentHash: sha256(
        Buffer.from(
          JSON.stringify(
            files
              .map((file) => [file.metadata.relativePath, file.metadata.contentHash])
              .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
          ),
        ),
      ),
      totalBytes: files.reduce((total, file) => total + file.metadata.sizeBytes, 0),
      files: files.map((file) => file.metadata),
      createdAt: parsed.manifest.exportedAt,
    });
    alias(aliases, snapshot.dir, metadata.id);
    return { original: snapshot, metadata, files };
  });
  const sources: SourceBinding[] = original.sources.map((source) => {
    const hasDirectoryIdentity = snapshots.some(
      (snapshot) => snapshot.original.dir === source.snapshotId,
    );
    const candidates = snapshots.filter(
      (snapshot) =>
        (!hasDirectoryIdentity || snapshot.original.dir === source.snapshotId) &&
        matches(source, snapshot),
    );
    if (
      candidates.length === 0 &&
      source.kind === 'user-brief' &&
      !source.packageId &&
      !source.snapshotId
    )
      return source;
    if (candidates.length !== 1) throw new Error('旧包来源不能唯一匹配，请重新导出为新版方案包');
    const chosen = candidates[0];
    if (source.snapshotId) alias(aliases, source.snapshotId, chosen.metadata.id);
    if (source.packageId) alias(packageAliases, source.packageId, chosen.metadata.packageId);
    return {
      ...source,
      packageId: chosen.metadata.packageId,
      snapshotId: chosen.metadata.id,
      // Old hash claims may describe a different historical scan algorithm. Retain them in
      // provenance; only this complete file list supplies the new snapshot hash.
      contentHash: chosen.metadata.contentHash ?? undefined,
      hash: undefined,
      repositoryUrl: chosen.metadata.repositoryUrl ?? undefined,
      resolvedRef: chosen.metadata.resolvedRef,
      commitHash: chosen.metadata.commitHash,
      license: source.license ?? chosen.original.license ?? undefined,
    };
  });
  // Old exports can contain bound snapshots without document-level source entries. Retain their
  // explicit manifest role and attach an ordinary source; never discard their complete bytes.
  for (const snapshot of snapshots) {
    if (sources.some((source) => source.snapshotId === snapshot.metadata.id)) continue;
    sources.push({
      id: id('legacy-source', snapshot.original.dir),
      kind:
        snapshot.original.kind === 'github'
          ? 'github-readme'
          : snapshot.original.kind === 'history'
            ? 'history-image'
            : 'user-brief',
      role: snapshot.original.role,
      snapshotId: snapshot.metadata.id,
      packageId: snapshot.metadata.packageId,
      repositoryUrl: snapshot.original.repositoryUrl ?? undefined,
      resolvedRef: snapshot.original.ref,
      commitHash: snapshot.metadata.commitHash,
      contentHash: snapshot.metadata.contentHash ?? undefined,
      license: snapshot.original.license ?? undefined,
    });
  }
  const files = [];
  const assets: Array<{
    metadata: ReturnType<typeof designSchemeAssetSchema.parse>;
    bytes: Buffer;
  }> = [];
  const imageAssets = new Map<string, string>();
  for (const snapshot of snapshots) {
    for (const file of snapshot.files) {
      const bytes = requireBytes(parsed.entries, file.archivePath);
      files.push({ snapshotId: snapshot.metadata.id, metadata: file.metadata, bytes });
      if (file.metadata.kind !== 'image') continue;
      const image = await inspectImage(bytes);
      if (image.mimeType !== file.metadata.mimeType) throw new Error('旧来源图片格式不一致');
      const metadata = designSchemeAssetSchema.parse({
        ...image,
        id: id('legacy-asset', file.archivePath),
        origin: snapshot.metadata.kind === 'github' ? 'repository' : 'uploaded',
        role: snapshot.metadata.kind === 'github' ? 'reference' : 'example',
        license: snapshot.original.license,
        createdAt: parsed.manifest.exportedAt,
      });
      assets.push({ metadata, bytes });
      imageAssets.set(`${snapshot.metadata.id}\0${file.metadata.relativePath}`, metadata.id);
    }
  }
  for (const path of decoded.previews) {
    const bytes = requireBytes(parsed.entries, path);
    assets.push({
      metadata: designSchemeAssetSchema.parse({
        ...(await inspectImage(bytes)),
        id: id('legacy-preview', path),
        origin: 'uploaded',
        role: 'example',
        license: null,
        createdAt: parsed.manifest.exportedAt,
      }),
      bytes,
    });
  }
  const repositoryImages = original.repositoryImages?.map((image) => {
    const snapshotId = requireMapping(aliases, image.snapshotId);
    const snapshot = snapshots.find((item) => item.metadata.id === snapshotId);
    const assetId = imageAssets.get(`${snapshotId}\0${image.relativePath}`);
    const asset = assets.find((item) => item.metadata.id === assetId);
    if (
      snapshot?.metadata.kind !== 'github' ||
      !asset ||
      asset.metadata.contentHash !== normalizedHash(image.contentHash)
    )
      throw new Error('旧包仓库图片引用与实际文件不一致');
    alias(assetAliases, image.assetId, asset.metadata.id);
    return {
      ...image,
      snapshotId,
      assetId: asset.metadata.id,
      contentHash: asset.metadata.contentHash,
      sourceContentHash: snapshot.metadata.contentHash,
    };
  });
  // Declarations without actual portable content cannot be silently dropped or rebound by order.
  for (const value of original.sourceSnapshotIds) requireMapping(aliases, value);
  for (const value of original.assetIds) requireMapping(assetAliases, value);
  const document = designSchemeRevisionDocumentSchema.parse({
    ...original,
    sources,
    repositoryImages,
    sourceSnapshotIds: snapshots.map((snapshot) => snapshot.metadata.id),
    assetIds: assets.map((asset) => asset.metadata.id),
  });
  return {
    document,
    sourceSnapshots: snapshots.map((snapshot) => snapshot.metadata),
    sourcePackages: snapshots.map((snapshot) =>
      sourcePackageSchema.parse({
        id: snapshot.metadata.packageId,
        kind: snapshot.metadata.kind,
        repositoryUrl: snapshot.metadata.repositoryUrl,
        license: snapshot.original.license,
        createdAt: parsed.manifest.exportedAt,
      }),
    ),
    files,
    assets,
    sourcePresentation: parsed.manifest.scheme.sourcePresentation,
    sourceLabel: parsed.manifest.scheme.sourceLabel || '导入方案',
    provenance: {
      formatVersion: 1 as const,
      schemeId: original.schemeId,
      revisionId: original.revisionId,
      packageId: null,
      // These records stay private to import provenance, outside trusted snapshot.scan.
      legacySnapshots: snapshots.map((snapshot) => ({
        snapshotId: snapshot.metadata.id,
        metadata: snapshot.original,
      })),
      originalSources: decoded.document.sources,
      originalRevision: {
        createdBy: original.createdBy,
        createdAt: original.createdAt,
        parentRevisionId: original.parentRevisionId,
      },
    },
    originalEntityIds: new Set([
      original.schemeId,
      original.revisionId,
      ...original.sourceSnapshotIds,
      ...original.assetIds,
      ...original.sources.flatMap((source) =>
        [source.snapshotId, source.packageId].filter(
          (value): value is string => value !== undefined,
        ),
      ),
    ]),
  };
}

function alias(mapping: Map<string, string>, original: string, replacement: string) {
  const previous = mapping.get(original);
  if (previous && previous !== replacement) throw new Error('旧包实体引用有歧义');
  mapping.set(original, replacement);
}

function matches(
  source: SourceBinding,
  snapshot: {
    original: ReturnType<typeof decodeLegacyDesignSchemePackage>['snapshots'][number]['snapshot'];
    metadata: ReturnType<typeof sourceSnapshotSchema.parse>;
    files: ReturnType<typeof decodeLegacyDesignSchemePackage>['snapshots'][number]['files'];
  },
) {
  const expected = source.kind.startsWith('github-')
    ? 'github'
    : ['history-image', 'conversation-turn'].includes(source.kind)
      ? 'history'
      : source.kind === 'user-brief'
        ? 'user-brief'
        : null;
  if (expected && snapshot.original.kind !== expected) return false;
  const repo = (value: string) => value.replace(/\/$/, '').replace(/\.git$/, '');
  const uri = source.repositoryUrl ?? source.uri;
  if (
    uri &&
    (!snapshot.original.repositoryUrl || repo(uri) !== repo(snapshot.original.repositoryUrl))
  )
    return false;
  const ref = source.resolvedRef ?? source.ref;
  if (ref && ref !== snapshot.original.ref) return false;
  const commit = source.commitHash ?? source.commit;
  if (commit && commit !== snapshot.original.commitHash) return false;
  const path = source.relativePath ?? source.evidencePath;
  if (path && !snapshot.files.some((file) => file.metadata.relativePath === path)) return false;
  return true;
}
