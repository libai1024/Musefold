import type { z } from 'zod';
import {
  MAX_AGENT_UPLOAD_TOTAL_BYTES,
  designSchemeRepositoryMaterialSchema,
  type AnalystReport,
  type DesignSchemeAgentMaterials,
  type UploadDesignSchemeAssetInput,
  type StagedDesignSchemeAsset,
} from '@musefold/contracts';
import { executionDigest } from '@musefold/db';
import { selectRepositoryImages } from '@musefold/domain/design-scheme/repository-materials';
import type { DesignSchemeSourcePreparationService } from '../design-schemes/source-preparation.js';
import { inspectSchemeImage } from './image.js';
import { AppError } from '../../lib/errors.js';

type Source = Awaited<ReturnType<DesignSchemeSourcePreparationService['readConfirmed']>>;
type Repository = z.infer<typeof designSchemeRepositoryMaterialSchema>;

export async function freezeRepositoryMaterials(
  sources: Source[],
  reports: AnalystReport[],
  stage: (input: UploadDesignSchemeAssetInput) => Promise<StagedDesignSchemeAsset>,
  existing: { count: number; bytes: number },
): Promise<Repository[]> {
  if (sources.length !== reports.length) throw repositoryMaterialsInvalid();
  const plans = sources.map((source, i) => selectRepositoryImages(source.snapshot, reports[i]));
  const count = plans.reduce((count, plan) => count + plan.selected.length, existing.count);
  const total = plans.reduce(
    (sum, plan) => sum + plan.selected.reduce((sum, image) => sum + image.metadata.sizeBytes, 0),
    existing.bytes,
  );
  if (count > 64 || total > MAX_AGENT_UPLOAD_TOTAL_BYTES) throw repositoryMaterialsInvalid();
  const result: Repository[] = [];
  for (const [index, source] of sources.entries()) {
    const snapshot = source.snapshot;
    if (!snapshot.contentHash) throw repositoryMaterialsInvalid();
    const images: Repository['images'] = [];
    for (const selected of plans[index].selected) {
      const file = source.files.find(
        (file) => file.metadata.relativePath === selected.relativePath,
      );
      if (!file) throw repositoryMaterialsInvalid();
      const image = await inspectSchemeImage(file.bytes);
      if (
        image.contentHash !== selected.metadata.contentHash ||
        image.mimeType !== selected.metadata.mimeType ||
        image.byteSize !== selected.metadata.sizeBytes
      )
        throw repositoryMaterialsInvalid();
      const staged = await stage({ name: 'repository-image', bytes: Uint8Array.from(file.bytes) });
      const asset = {
        id: staged.id,
        origin: 'repository' as const,
        role: 'reference' as const,
        license: null,
        mimeType: staged.mimeType,
        width: staged.width,
        height: staged.height,
        byteSize: staged.byteSize,
        contentHash: staged.contentHash,
        createdAt: staged.createdAt,
      };
      images.push({
        asset,
        provenance: {
          snapshotId: snapshot.id,
          sourceContentHash: snapshot.contentHash,
          relativePath: selected.relativePath,
          imageRole: selected.imageRole,
          assetId: asset.id,
          contentHash: asset.contentHash,
        },
      });
    }
    result.push(
      designSchemeRepositoryMaterialSchema.parse({
        snapshotId: snapshot.id,
        sourceContentHash: snapshot.contentHash,
        reportHash: executionDigest(reports[index]),
        images,
        omittedPaths: plans[index].omittedPaths,
      }),
    );
  }
  return result;
}

/** A stored adoption is tied to the exact completed report and confirmed file manifest. */
export function assertRepositoryMaterials(
  sources: Source[],
  reports: AnalystReport[],
  materials: DesignSchemeAgentMaterials,
) {
  if (materials.repositories?.length !== sources.length || reports.length !== sources.length)
    throw repositoryMaterialsInvalid();
  for (const [index, source] of sources.entries()) {
    const stored = materials.repositories[index];
    const plan = selectRepositoryImages(source.snapshot, reports[index]);
    if (
      stored.snapshotId !== source.snapshot.id ||
      stored.sourceContentHash !== source.snapshot.contentHash ||
      stored.reportHash !== executionDigest(reports[index]) ||
      executionDigest(stored.omittedPaths) !== executionDigest(plan.omittedPaths) ||
      stored.images.length !== plan.selected.length ||
      stored.images.some(
        ({ asset, provenance }, i) =>
          provenance.relativePath !== plan.selected[i].relativePath ||
          provenance.imageRole !== plan.selected[i].imageRole ||
          asset.contentHash !== plan.selected[i].metadata.contentHash ||
          asset.byteSize !== plan.selected[i].metadata.sizeBytes ||
          asset.mimeType !== plan.selected[i].metadata.mimeType,
      )
    )
      throw repositoryMaterialsInvalid();
  }
}
export function repositoryMaterialsInvalid() {
  return new AppError(
    'VALIDATION_FAILED',
    '已确认仓库图片的采用记录或字节无效，请重新创建任务',
    409,
    false,
    { reason: 'AGENT_MATERIALS_INVALID' },
  );
}
