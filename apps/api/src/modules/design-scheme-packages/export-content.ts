import type { z } from 'zod';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  type BeginDesignSchemePackageExport,
  type sharePackageContentEntrySchema,
  designSchemeAssetSchema,
  designSchemeRevisionDocumentSchema,
  sharePackageManifestSchema,
  DESIGN_SCHEME_PACKAGE_LIMITS as LIMITS,
} from '@musefold/contracts';
import {
  type MusefoldTransaction,
  designSchemes,
  designSchemeRuns,
  designSchemeAssets,
  designSchemeRevisions,
  designSchemeSourceFiles,
  executionDigest,
} from '@musefold/db';
import {
  normalizedHash,
  sha256,
  stableContentEntriesHash,
  writeDesignSchemePackageBytes,
} from '@musefold/scheme-package';
import type { DesignSchemeService } from '../design-schemes/service.js';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import type { DesignSchemeAssetStorage } from '../design-scheme-assets/storage.js';
import { inspectSchemeImage } from '../design-scheme-assets/image.js';
import { AppError } from '../../lib/errors.js';

type SharePackageContentEntry = z.infer<typeof sharePackageContentEntrySchema>;

export async function collectExportBasis(
  tx: MusefoldTransaction,
  userId: string,
  input: BeginDesignSchemePackageExport,
  schemes: DesignSchemeService,
  assetService: DesignSchemeAssetService,
) {
  const [scheme] = await tx
    .select()
    .from(designSchemes)
    .where(
      and(
        eq(designSchemes.id, input.schemeId),
        eq(designSchemes.userId, userId),
        isNull(designSchemes.deletedAt),
      ),
    )
    .for('share');
  if (!scheme) throw new AppError('VALIDATION_FAILED', '方案不存在', 404);
  if (
    scheme.status !== 'formal' ||
    scheme.currentRevisionId !== input.revisionId ||
    scheme.version !== input.expectedVersion ||
    !scheme.coverAssetId ||
    scheme.fidelity === 'unsupported'
  )
    throw exportConflict();
  const [trial] = await tx
    .select({ runId: designSchemeRuns.runId })
    .from(designSchemeRuns)
    .where(
      and(
        eq(designSchemeRuns.userId, userId),
        eq(designSchemeRuns.schemeId, scheme.id),
        eq(designSchemeRuns.revisionId, input.revisionId),
        eq(designSchemeRuns.mode, 'trial'),
        eq(designSchemeRuns.status, 'completed'),
        isNull(designSchemeRuns.deletedAt),
      ),
    )
    .orderBy(designSchemeRuns.createdAt, designSchemeRuns.runId)
    .limit(1)
    .for('share');
  if (!trial) throw exportConflict();
  const { document: original, sourceSnapshots } = await schemes.readRevisionSources(
    tx,
    userId,
    scheme.id,
    input.revisionId,
  );
  await assetService.requireDocumentAssets(tx, userId, original);
  await assetService.requireRepositoryImages(tx, userId, original);
  const selected = [...new Set([...original.assetIds, scheme.coverAssetId])];
  const rows = await tx
    .select({ asset: designSchemeAssets })
    .from(designSchemeAssets)
    .innerJoin(
      designSchemeRevisions,
      and(
        eq(designSchemeRevisions.revisionId, designSchemeAssets.revisionId),
        eq(designSchemeRevisions.userId, userId),
      ),
    )
    .where(
      and(
        eq(designSchemeAssets.userId, userId),
        eq(designSchemeRevisions.schemeId, scheme.id),
        or(
          eq(designSchemeAssets.revisionId, input.revisionId),
          inArray(designSchemeAssets.id, selected),
        ),
      ),
    )
    .orderBy(designSchemeAssets.id);
  const cover = rows.find(({ asset }) => asset.id === scheme.coverAssetId)?.asset;
  if (!cover || cover.revisionId !== input.revisionId) throw exportConflict();
  const assets = rows.map(({ asset }) => ({
    objectKey: asset.objectKey,
    metadata: designSchemeAssetSchema.parse({
      id: asset.id,
      origin: asset.origin,
      role: asset.role === 'cover' ? 'example' : asset.role,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteSize: asset.byteSize,
      contentHash: normalizedHash(asset.contentHash),
      license: asset.license,
      createdAt: asset.createdAt.toISOString(),
    }),
  }));
  // A selected reference/history image still has its original provenance role. The archive's
  // cover is a separate content identity in that case, so source/history bindings stay intact.
  const coverAsset = assets.find((a) => a.metadata.id === cover.id);
  if (!coverAsset) throw exportConflict();
  const boundCover =
    original.repositoryImages?.some((image) => image.assetId === cover.id) ||
    sourceSnapshots.some((snapshot) =>
      snapshot.historyItems?.some((item) => item.imageAssetId === cover.id),
    );
  if (boundCover) {
    const alias = `cover_${executionDigest(['export-cover', cover.id]).slice(0, 48)}`;
    if (assets.some((a) => a.metadata.id === alias)) throw exportConflict();
    assets.push({
      objectKey: coverAsset.objectKey,
      metadata: { ...coverAsset.metadata, id: alias, role: 'cover' },
    });
  } else coverAsset.metadata.role = 'cover';
  const document = designSchemeRevisionDocumentSchema.parse({
    ...original,
    assetIds: assets.map((a) => a.metadata.id),
  });
  const snapshotIds = sourceSnapshots.map((s) => s.id);
  const files = snapshotIds.length
    ? await tx
        .select()
        .from(designSchemeSourceFiles)
        .where(
          and(
            eq(designSchemeSourceFiles.userId, userId),
            inArray(designSchemeSourceFiles.snapshotId, snapshotIds),
          ),
        )
        .orderBy(designSchemeSourceFiles.snapshotId, designSchemeSourceFiles.relativePath)
    : [];
  if (files.length !== sourceSnapshots.reduce((n, s) => n + s.files.length, 0))
    throw exportConflict();
  for (const snapshot of sourceSnapshots)
    for (const file of snapshot.files) {
      const stored = files.find(
        (f) => f.snapshotId === snapshot.id && f.relativePath === file.relativePath,
      );
      if (
        !stored ||
        stored.sizeBytes !== file.sizeBytes ||
        normalizedHash(stored.contentHash) !== normalizedHash(file.contentHash) ||
        stored.kind !== file.kind ||
        stored.mimeType !== file.mimeType
      )
        throw exportConflict();
    }
  const bytes =
    files.reduce((n, f) => n + f.sizeBytes, 0) +
    assets.reduce((n, a) => n + a.metadata.byteSize, 0);
  if (
    assets.length > 128 ||
    files.length + assets.length + 2 > LIMITS.entries ||
    bytes > LIMITS.expandedBytes ||
    files.some((f) => f.sizeBytes > LIMITS.entryBytes) ||
    assets.some((a) => a.metadata.byteSize > LIMITS.entryBytes)
  )
    throw exportConflict();
  // Keys and full stored source facts are private basis data, never part of a public DTO.
  const basis = {
    document,
    sourceSnapshots,
    files,
    assets,
    trialId: trial.runId,
    version: scheme.version,
  };
  return { ...basis, hash: executionDigest(basis) };
}

export async function buildExportBytes(
  packageId: string,
  basis: Awaited<ReturnType<typeof collectExportBasis>>,
  storage: DesignSchemeAssetStorage,
  renew: () => Promise<void>,
) {
  const content = new Map<string, Buffer>();
  const entries: SharePackageContentEntry[] = [];
  let total = 0;
  const add = (
    path: string,
    bytes: Buffer,
    metadata: Omit<SharePackageContentEntry, 'relativePath' | 'contentHash' | 'sizeBytes'>,
  ) => {
    total += bytes.length;
    if (content.has(path) || bytes.length > LIMITS.entryBytes || total > LIMITS.expandedBytes)
      throw exportConflict();
    content.set(path, bytes);
    entries.push({
      ...metadata,
      relativePath: path,
      contentHash: sha256(bytes),
      sizeBytes: bytes.length,
    });
  };
  add('revision.json', Buffer.from(JSON.stringify(basis.document)), {
    kind: 'revision-document',
    mimeType: 'application/json',
  });
  for (const file of basis.files) {
    await renew();
    // A legacy inline body is usable only if its actual full bytes match the fixed size/hash.
    const snapshot = basis.sourceSnapshots.find((source) => source.id === file.snapshotId);
    const history =
      snapshot?.kind === 'history'
        ? snapshot.historyItems?.find(
            (item) => item.imagePath === file.relativePath || item.promptPath === file.relativePath,
          )
        : undefined;
    // Native cloud history freezes its full prompt in the snapshot and its image in a
    // managed asset. It does not have a second source-file object or an inline excerpt.
    // Read only that admitted copy; never revisit mutable generation history.
    const historyImage =
      history?.imagePath === file.relativePath
        ? basis.assets.find((asset) => asset.metadata.id === history.imageAssetId)
        : undefined;
    const bytes = file.objectKey
      ? Buffer.from(await storage.read(file.objectKey, LIMITS.entryBytes))
      : historyImage
        ? Buffer.from(await storage.read(historyImage.objectKey, LIMITS.entryBytes))
        : history?.promptPath === file.relativePath && history.prompt !== null
          ? Buffer.from(history.prompt, 'utf8')
          : Buffer.from(file.textExcerpt ?? '');
    verify(bytes, file.sizeBytes, file.contentHash);
    if (file.kind === 'image') {
      const inspected = await inspectSchemeImage(bytes, { maxBytes: LIMITS.entryBytes });
      if (file.mimeType !== inspected.mimeType) throw exportConflict();
    }
    add(`sources/${file.snapshotId}/${file.relativePath}`, bytes, {
      kind: 'source-file',
      sourceId: file.snapshotId,
      mimeType: file.mimeType,
    });
  }
  for (const asset of basis.assets) {
    await renew();
    const bytes = Buffer.from(await storage.read(asset.objectKey, LIMITS.entryBytes));
    verify(bytes, asset.metadata.byteSize, asset.metadata.contentHash);
    const inspected = await inspectSchemeImage(bytes, { maxBytes: LIMITS.entryBytes });
    if (
      inspected.width !== asset.metadata.width ||
      inspected.height !== asset.metadata.height ||
      inspected.mimeType !== asset.metadata.mimeType
    )
      throw exportConflict();
    add(`assets/${asset.metadata.id}.${inspected.mimeType.split('/')[1]}`, bytes, {
      kind: 'asset',
      assetId: asset.metadata.id,
      mimeType: inspected.mimeType,
    });
  }
  await renew();
  const manifest = sharePackageManifestSchema.parse({
    packageId,
    format: 'musefold.design',
    formatVersion: 2,
    schemeId: basis.document.schemeId,
    revisionId: basis.document.revisionId,
    status: 'formal',
    document: basis.document,
    sourceSnapshots: basis.sourceSnapshots,
    assets: basis.assets.map((a) => a.metadata),
    content: { contentHash: stableContentEntriesHash(entries), sizeBytes: total, entries },
  });
  return writeDesignSchemePackageBytes(manifest, content);
}
function verify(bytes: Buffer, size: number, hash: string) {
  if (bytes.length !== size || sha256(bytes) !== normalizedHash(hash)) throw exportConflict();
}
export function exportConflict() {
  return new AppError(
    'VALIDATION_FAILED',
    '正式版本、试运行、封面或素材已变化，请重新核对后导出',
    409,
    false,
    { reason: 'SCHEME_PACKAGE_EXPORT_CONFLICT' },
  );
}
