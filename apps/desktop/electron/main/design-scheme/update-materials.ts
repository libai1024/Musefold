import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  sourceSnapshotSchema,
  type AnalystReport,
  type DesignSchemeAsset,
} from '@musefold/contracts';
import { selectRepositoryImages } from '@musefold/domain/design-scheme/repository-materials';
import {
  probeImageAssetMetadata,
  sniffImageMimeType,
  textMimeTypeForPath,
  type PersistedSnapshot,
  type ResolvedGithubSource,
} from './source-ingestion';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const normalized = (value: string) => value.toLowerCase().replace(/^sha256:/, '');

/** Keep persisted keys portable while checking containment with the host's path semantics. */
export function updatedSourceAssetStoreKey(
  userDataDir: string,
  absolutePath: string,
  hostPath: Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'> = path,
): string {
  const relativePath = hostPath.relative(userDataDir, absolutePath);
  if (
    !relativePath ||
    hostPath.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${hostPath.sep}`)
  )
    throw new Error('更新素材不在受管目录');
  const storeKey = relativePath.split(hostPath.sep).join('/');
  if (storeKey.includes('\\')) throw new Error('更新素材路径无效');
  return storeKey;
}

/** Verify actual source bytes and model selections before publishing a new revision. */
export function prepareUpdatedSourceMaterials(
  db: Database.Database,
  source: ResolvedGithubSource,
  persisted: PersistedSnapshot,
  report: AnalystReport,
  userDataDir: string,
) {
  const files = [
    ...source.textFiles.map((file) => {
      const bytes = Buffer.from(file.text);
      if (bytes.length !== file.sizeBytes || hash(bytes) !== normalized(file.contentHash))
        throw new Error('更新来源文字与固定内容不一致');
      return {
        relativePath: file.path,
        kind: 'text' as const,
        mimeType: textMimeTypeForPath(file.path),
        sizeBytes: bytes.length,
        contentHash: hash(bytes),
        evidencePath: null,
        textExcerpt: file.text.slice(0, 2000),
      };
    }),
    ...source.imageFiles.map((file) => {
      if (hash(file.bytes) !== normalized(file.contentHash))
        throw new Error('更新来源图片与固定内容不一致');
      const mimeType = sniffImageMimeType(file.bytes);
      if (!mimeType) throw new Error('更新来源图片格式无效');
      return {
        relativePath: file.relativePath,
        kind: 'image' as const,
        mimeType,
        sizeBytes: file.bytes.length,
        contentHash: hash(file.bytes),
        evidencePath: null,
        textExcerpt: null,
      };
    }),
  ];
  const contentHash = hash(
    Buffer.from(
      JSON.stringify(
        files
          .map((file) => [file.relativePath, file.contentHash])
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      ),
    ),
  );
  const snapshot = sourceSnapshotSchema.parse({
    id: persisted.snapshotId,
    packageId: persisted.packageId,
    kind: 'github',
    repositoryUrl: source.repositoryUrl,
    resolvedRef: source.resolvedRef,
    commitHash: source.commitHash,
    contentHash,
    files,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    createdAt: Date.now(),
  });
  const choice = selectRepositoryImages(snapshot, report);
  const assets: Array<DesignSchemeAsset & { storeKey: string }> = [];
  const images = choice.selected.map((image) => {
    const stored = persisted.imagePaths.find((file) => file.path === image.relativePath);
    const metadata = stored && probeImageAssetMetadata(stored.absolutePath);
    if (
      !stored ||
      !metadata ||
      metadata.contentHash !== image.metadata.contentHash ||
      metadata.byteSize !== image.metadata.sizeBytes ||
      metadata.mimeType !== image.metadata.mimeType
    )
      throw new Error('更新来源图片缺失或保存内容不一致');
    const storeKey = updatedSourceAssetStoreKey(userDataDir, stored.absolutePath);
    const id = `dsa_${randomUUID()}`;
    assets.push({
      id,
      ...metadata,
      role: 'reference',
      origin: 'repository',
      license: source.license,
      createdAt: Date.now(),
      storeKey,
    });
    return {
      snapshotId: snapshot.id,
      sourceContentHash: contentHash,
      relativePath: image.relativePath,
      imageRole: image.imageRole,
      assetId: id,
      contentHash: metadata.contentHash,
    };
  });
  db.prepare('UPDATE source_snapshots SET content_hash = ? WHERE id = ?').run(
    contentHash,
    snapshot.id,
  );
  return { snapshot, assets, images, omittedPaths: choice.omittedPaths };
}
