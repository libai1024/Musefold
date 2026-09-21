import { createHash } from 'node:crypto';
import {
  designSchemeAssetSchema,
  designSchemeRevisionDocumentSchema,
  sourcePackageSchema,
  sourceSnapshotSchema,
  designSchemeDateTimeSchema,
  type DesignSchemeAsset,
  type SourceSnapshot,
} from '@musefold/contracts';
import {
  normalizedHash,
  readValidatedDesignSchemePackageBytes,
  type ValidatedDesignSchemePackage,
} from '@musefold/scheme-package';
import { inspectImportImage, requireBytes, requireMapping } from './import-content-common.js';
import { prepareLegacyImportContent } from './import-legacy-content.js';

/** Server-owned seed and timestamp must be persisted before use by the eventual import transaction. */
export type ImportContentIdentity = { seed: string; createdAt: string };

/**
 * Private content preparation, without database, network or authorization side effects.
 * A valid ZIP is not an import grant. The caller must separately lock the confirmed stage,
 * current account authority and durable import lease before reading and committing this plan.
 */
export async function preparePackageImportContent(
  bytes: Uint8Array,
  identity: ImportContentIdentity,
) {
  const seed = identity.seed;
  const createdAt = designSchemeDateTimeSchema.parse(identity.createdAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seed))
    throw new Error('导入需要服务端固定的随机身份');
  const parsed = await readValidatedDesignSchemePackageBytes(bytes);
  const id = (kind: string, original: string) =>
    `imp_${createHash('sha256')
      .update(JSON.stringify(['package-import-v1', seed, kind, original]))
      .digest('hex')
      .slice(0, 48)}`;
  const content =
    parsed.formatVersion === 2
      ? await prepareCanonical(parsed, id)
      : await prepareLegacyImportContent(parsed, id);
  const document = designSchemeRevisionDocumentSchema.parse({
    ...content.document,
    schemeId: id('scheme', content.document.schemeId),
    revisionId: id('revision', content.document.revisionId),
    parentRevisionId: null,
    createdBy: 'import',
    createdAt,
  });
  // Local rule/source IDs retain meaning inside the new document. All persisted entity IDs
  // are fresh, including source packages shared by multiple snapshots within this import.
  const entityIds = [
    document.schemeId,
    document.revisionId,
    ...content.sourcePackages.map((item) => item.id),
    ...content.sourceSnapshots.map((item) => item.id),
    ...content.assets.map((item) => item.metadata.id),
  ];
  if (
    new Set(entityIds).size !== entityIds.length ||
    entityIds.some((value) => content.originalEntityIds.has(value))
  )
    throw new Error('导入身份冲突');
  const sourceIds = new Set(document.sources.map((source) => source.id));
  if (
    sourceIds.size !== document.sources.length ||
    [...document.constraints, ...document.promptProgram].some((rule) =>
      rule.sourceIds.some((sourceId) => !sourceIds.has(sourceId)),
    )
  )
    throw new Error('方案编译规则引用了未知来源');
  return {
    document,
    sourcePackages: content.sourcePackages,
    sourceSnapshots: content.sourceSnapshots,
    files: content.files,
    assets: content.assets,
    sourcePresentation: content.sourcePresentation,
    sourceLabel: content.sourceLabel,
    // Informational provenance only; never resolve these old IDs in the importing account.
    provenance: content.provenance,
  };
}

async function prepareCanonical(
  parsed: Extract<ValidatedDesignSchemePackage, { formatVersion: 2 }>,
  id: (kind: string, original: string) => string,
) {
  const { manifest, entries } = parsed;
  const original = manifest.document;
  const snapshotIds = new Map(
    manifest.sourceSnapshots.map((item) => [item.id, id('snapshot', item.id)]),
  );
  const packageIds = new Map(
    manifest.sourceSnapshots.map((item) => [item.packageId, id('package', item.packageId)]),
  );
  const assetIds = new Map(manifest.assets.map((item) => [item.id, id('asset', item.id)]));
  const sourceSnapshots = manifest.sourceSnapshots.map((snapshot) =>
    sourceSnapshotSchema.parse({
      ...snapshot,
      id: requireMapping(snapshotIds, snapshot.id),
      packageId: requireMapping(packageIds, snapshot.packageId),
      contentHash: snapshot.contentHash
        ? normalizedHash(snapshot.contentHash)
        : snapshot.contentHash,
      files: snapshot.files.map((file) => ({
        ...file,
        contentHash: normalizedHash(file.contentHash),
      })),
      historyItems: snapshot.historyItems?.map((item) => ({
        ...item,
        // selection is external provenance, not an owned run/asset lookup or a trial receipt.
        imageAssetId: requireMapping(assetIds, item.imageAssetId),
      })),
    }),
  );
  const sourcePackages = packagesForSnapshots(sourceSnapshots);
  const files = [];
  for (const snapshot of manifest.sourceSnapshots) {
    for (const metadata of snapshot.files) {
      const bytes = requireBytes(entries, `sources/${snapshot.id}/${metadata.relativePath}`);
      if (metadata.kind === 'image' || metadata.mimeType?.startsWith('image/')) {
        const image = await inspectImportImage(bytes);
        if (image.mimeType !== metadata.mimeType) throw new Error('来源图片格式不一致');
      }
      files.push({
        snapshotId: requireMapping(snapshotIds, snapshot.id),
        metadata: {
          ...metadata,
          contentHash: normalizedHash(metadata.contentHash),
        },
        bytes,
      });
    }
  }
  const assets = [];
  for (const asset of manifest.assets) {
    const entry = manifest.content.entries.find(
      (item) => item.kind === 'asset' && item.assetId === asset.id,
    );
    if (!entry) throw new Error('资产缺少实际内容');
    const bytes = requireBytes(entries, entry.relativePath);
    await assertImportAsset(asset, bytes);
    assets.push({
      metadata: designSchemeAssetSchema.parse({
        ...asset,
        id: requireMapping(assetIds, asset.id),
        contentHash: normalizedHash(asset.contentHash),
        // A copied output is an example, never this new revision's successful trial/cover.
        role: asset.role === 'cover' || asset.role === 'output' ? 'example' : asset.role,
      }),
      bytes,
    });
  }
  const document = designSchemeRevisionDocumentSchema.parse({
    ...original,
    sources: original.sources.map((source) => ({
      ...source,
      contentHash: source.contentHash ? normalizedHash(source.contentHash) : source.contentHash,
      hash: source.hash ? normalizedHash(source.hash) : source.hash,
      snapshotId: source.snapshotId ? requireMapping(snapshotIds, source.snapshotId) : undefined,
      packageId: source.packageId ? requireMapping(packageIds, source.packageId) : undefined,
    })),
    sourceSnapshotIds: original.sourceSnapshotIds.map((value) =>
      requireMapping(snapshotIds, value),
    ),
    assetIds: original.assetIds.map((value) => requireMapping(assetIds, value)),
    repositoryImages: original.repositoryImages?.map((image) => ({
      ...image,
      contentHash: normalizedHash(image.contentHash),
      sourceContentHash: normalizedHash(image.sourceContentHash),
      snapshotId: requireMapping(snapshotIds, image.snapshotId),
      assetId: requireMapping(assetIds, image.assetId),
    })),
  });
  // V2 has no presentation field. Derive it from preserved source kinds, not the import action.
  const hasGithub = original.sources.some((source) => source.kind.startsWith('github-'));
  return {
    document,
    sourcePackages,
    sourceSnapshots,
    files,
    assets,
    sourcePresentation: hasGithub ? ('skill' as const) : ('musefold-created' as const),
    sourceLabel: hasGithub ? 'GitHub 来源' : '导入方案',
    provenance: {
      formatVersion: 2 as const,
      schemeId: manifest.schemeId,
      revisionId: manifest.revisionId,
      packageId: manifest.packageId,
      originalRevision: {
        createdBy: original.createdBy,
        createdAt: original.createdAt,
        parentRevisionId: original.parentRevisionId,
      },
      legacySnapshots: [],
    },
    originalEntityIds: new Set([
      manifest.schemeId,
      manifest.revisionId,
      manifest.packageId,
      ...snapshotIds.keys(),
      ...packageIds.keys(),
      ...assetIds.keys(),
    ]),
  };
}

async function assertImportAsset(asset: DesignSchemeAsset, bytes: Buffer) {
  const image = await inspectImportImage(bytes);
  if (
    image.width !== asset.width ||
    image.height !== asset.height ||
    image.mimeType !== asset.mimeType ||
    image.byteSize !== asset.byteSize ||
    image.contentHash !== normalizedHash(asset.contentHash)
  )
    throw new Error('方案包图片声明与实际像素不一致');
}

function packagesForSnapshots(snapshots: SourceSnapshot[]) {
  const result = new Map<string, ReturnType<typeof sourcePackageSchema.parse>>();
  for (const snapshot of snapshots) {
    // V2 licenses remain on each source binding; no package-wide grant is inferred.
    const value = sourcePackageSchema.parse({
      id: snapshot.packageId,
      kind: snapshot.kind,
      repositoryUrl: snapshot.repositoryUrl ?? snapshot.repositoryUri ?? snapshot.uri ?? null,
      license: null,
      createdAt: snapshot.createdAt,
    });
    const previous = result.get(value.id);
    if (
      previous &&
      (previous.kind !== value.kind || previous.repositoryUrl !== value.repositoryUrl)
    )
      throw new Error('同一来源包的种类或仓库不一致');
    result.set(value.id, previous ?? value);
  }
  // Individual source licenses are retained verbatim on document.sources.
  return [...result.values()];
}
