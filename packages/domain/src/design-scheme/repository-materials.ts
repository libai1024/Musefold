import type { z } from 'zod';
import {
  designSchemeRevisionDocumentSchema,
  type DesignSchemeAgentMaterials,
  type DesignSchemeRevisionDocument,
  type SourceSnapshot,
  type AnalystReport,
  type designSchemeRepositoryImageSchema,
} from '@musefold/contracts';
import { validateCloudAnalystReport, CloudCompilerValidationError } from './cloud-compiler';

/** Select exact confirmed paths; identical duplicates share one copy, conflicting roles are invalid. */
export function selectRepositoryImages(snapshot: SourceSnapshot, raw: AnalystReport) {
  if (snapshot.kind !== 'github' || !snapshot.contentHash) throw new CloudCompilerValidationError();
  const report = validateCloudAnalystReport(raw, snapshot);
  const selected: Array<{
    relativePath: string;
    imageRole: AnalystReport['referenceImages'][number]['role'];
    metadata: SourceSnapshot['files'][number];
  }> = [];
  for (const image of report.referenceImages) {
    const previous = selected.find((item) => item.relativePath === image.path);
    if (previous) {
      if (previous.imageRole !== image.role) throw new CloudCompilerValidationError();
      continue;
    }
    const metadata = snapshot.files.find(
      (file) => file.kind === 'image' && file.relativePath === image.path,
    );
    if (!metadata) throw new CloudCompilerValidationError();
    selected.push({ relativePath: image.path, imageRole: image.role, metadata });
  }
  return {
    selected,
    omittedPaths: snapshot.files
      .filter(
        (file) =>
          file.kind === 'image' &&
          !selected.some((item) => item.relativePath === file.relativePath),
      )
      .map((file) => file.relativePath),
  };
}

export function repositoryImageProvenance(
  materials: DesignSchemeAgentMaterials | null | undefined,
): z.infer<typeof designSchemeRepositoryImageSchema>[] {
  return (
    materials?.repositories?.flatMap((source) => source.images.map((item) => item.provenance)) ?? []
  );
}

/** Replace only changed-source copies in the new revision. Old revisions retain their own image IDs. */
export function applyRepositoryImages(
  document: DesignSchemeRevisionDocument,
  materials: DesignSchemeAgentMaterials | null | undefined,
  replacedSnapshotIds: string[] = [],
) {
  const removed = new Set(
    (document.repositoryImages ?? [])
      .filter((image) => replacedSnapshotIds.includes(image.snapshotId))
      .map((image) => image.assetId),
  );
  const retained = (document.repositoryImages ?? []).filter((image) => !removed.has(image.assetId));
  const adopted = repositoryImageProvenance(materials);
  if (!document.repositoryImages && !materials?.repositories) return document;
  const images = [...retained, ...adopted];
  const assets = [
    ...document.assetIds.filter((id) => !removed.has(id)),
    ...adopted.map((image) => image.assetId),
  ];
  return designSchemeRevisionDocumentSchema.parse({
    ...document,
    assetIds: [...new Set(assets)],
    repositoryImages: images,
    fidelity: images.length && document.fidelity !== 'unsupported' ? 'adapted' : document.fidelity,
    compilation: {
      ...document.compilation,
      warnings: [
        ...document.compilation.warnings
          .filter(
            (warning) =>
              !removed.size || warning !== '已保留原方案图片；本次文本编译未做图片视觉解析。',
          )
          .slice(0, 39),
        `已采用 ${adopted.length} 张已确认仓库图片，移除新修订中 ${removed.size} 张被替代来源图片；未选择的图片不采用，本次文本编译未做图片视觉解析。`,
      ],
    },
  });
}
