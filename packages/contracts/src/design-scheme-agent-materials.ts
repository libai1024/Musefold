import { z } from 'zod';
import {
  opaqueIdSchema,
  referenceAssetMetadataSchema,
  sourceSnapshotSchema,
  designSchemeRepositoryImageSchema,
  designSchemeHashSchema,
  relativePathSchema,
} from './design-scheme';

export const designSchemeRepositoryMaterialSchema = z
  .object({
    snapshotId: opaqueIdSchema,
    sourceContentHash: designSchemeHashSchema,
    reportHash: designSchemeHashSchema,
    images: z
      .array(
        z
          .object({
            provenance: designSchemeRepositoryImageSchema,
            asset: referenceAssetMetadataSchema,
          })
          .strict(),
      )
      .max(24),
    /** Exact image paths not selected by the Analyst; no implicit adoption. */
    omittedPaths: z.array(relativePathSchema).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    const paths = value.images.map((item) => item.provenance.relativePath);
    if (
      new Set(paths).size !== paths.length ||
      new Set(value.omittedPaths).size !== value.omittedPaths.length ||
      value.omittedPaths.some((path) => paths.includes(path)) ||
      value.images.some(
        ({ provenance, asset }) =>
          provenance.snapshotId !== value.snapshotId ||
          provenance.sourceContentHash !== value.sourceContentHash ||
          provenance.assetId !== asset.id ||
          provenance.contentHash !== asset.contentHash ||
          asset.origin !== 'repository' ||
          asset.role !== 'reference' ||
          asset.license !== null,
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid repository image adoption' });
  });
export const MAX_AGENT_UPLOAD_TOTAL_BYTES = 128 * 1024 * 1024;
/** Server-authored copies. Source IDs identify the selection; asset IDs identify immutable copies. */
export const designSchemeAgentMaterialsSchema = z
  .object({
    repositories: z.array(designSchemeRepositoryMaterialSchema).max(16).optional(),
    history: z
      .object({
        snapshot: sourceSnapshotSchema,
        assets: z.array(referenceAssetMetadataSchema).min(1).max(64),
      })
      .strict()
      .optional(),
    uploads: z
      .array(
        z
          .object({
            sourceAssetId: opaqueIdSchema,
            asset: referenceAssetMetadataSchema,
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .superRefine((value, ctx) => {
    const all = [
      ...value.uploads.map((item) => item.asset),
      ...(value.history?.assets ?? []),
      ...(value.repositories?.flatMap((source) => source.images.map((item) => item.asset)) ?? []),
    ];
    if (
      value.repositories &&
      new Set(value.repositories.map((item) => item.snapshotId)).size !== value.repositories.length
    )
      ctx.addIssue({ code: 'custom', message: 'Repository adoption snapshots must be unique' });
    if (value.history) {
      const items = value.history.snapshot.historyItems;
      if (
        value.history.snapshot.kind !== 'history' ||
        !items ||
        items.length !== value.history.assets.length ||
        items.some((item, index) => item.imageAssetId !== value.history?.assets[index]?.id) ||
        value.history.assets.some(
          (asset) =>
            asset.origin !== 'cloud-run' || asset.role !== 'example' || asset.license !== null,
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'History assets must match the frozen history snapshot',
        });
    }
    if (
      all.length > 64 ||
      new Set(all.map((asset) => asset.id)).size !== all.length ||
      all.reduce((sum, asset) => sum + asset.byteSize, 0) > MAX_AGENT_UPLOAD_TOTAL_BYTES
    )
      ctx.addIssue({ code: 'custom', message: 'Combined Agent materials exceed limits' });
    if (
      new Set(value.uploads.map((item) => item.sourceAssetId)).size !== value.uploads.length ||
      new Set(value.uploads.map((item) => item.asset.id)).size !== value.uploads.length ||
      value.uploads.some(
        (item) =>
          item.asset.origin !== 'uploaded' ||
          item.asset.role !== 'reference' ||
          item.asset.license !== null ||
          item.sourceAssetId === item.asset.id,
      ) ||
      value.uploads.reduce((sum, item) => sum + item.asset.byteSize, 0) >
        MAX_AGENT_UPLOAD_TOTAL_BYTES
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid frozen Agent uploads' });
    }
  });
export type DesignSchemeAgentMaterials = z.infer<typeof designSchemeAgentMaterialsSchema>;
