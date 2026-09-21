import { repositoryImageProvenance } from './repository-materials';
import {
  designSchemeAgentMaterialsSchema,
  designSchemeRevisionDocumentSchema,
  type DesignSchemeAgentMaterials,
  type DesignSchemeRevisionDocument,
} from '@musefold/contracts';

/** Runtime, not the model, binds preserved images. A preserved image does not prove visual analysis. */
export function attachCloudAgentMaterials(
  document: DesignSchemeRevisionDocument,
  raw: DesignSchemeAgentMaterials | null,
) {
  if (!raw) return document;
  const materials = designSchemeAgentMaterialsSchema.parse(raw);
  const assets = cloudAgentAssets(materials);
  const omittedImages =
    materials.repositories?.reduce((count, source) => count + source.omittedPaths.length, 0) ?? 0;
  if (!assets.length && !omittedImages) return document;
  const history = materials.history?.snapshot;
  return designSchemeRevisionDocumentSchema.parse({
    ...document,
    assetIds: assets.map((asset) => asset.id),
    ...(materials.repositories ? { repositoryImages: repositoryImageProvenance(materials) } : {}),
    fidelity: assets.length && document.fidelity !== 'unsupported' ? 'adapted' : document.fidelity,
    sources: [
      ...document.sources,
      ...(materials.uploads.length
        ? [{ id: 'source_uploads', kind: 'reference-image', role: 'reference' }]
        : []),
      ...(history?.historyItems?.some((item) => item.prompt !== null)
        ? [
            {
              id: 'source_history_prompt',
              kind: 'conversation-turn',
              role: 'context',
              snapshotId: history.id,
              packageId: history.packageId,
              contentHash: history.contentHash,
            },
          ]
        : []),
    ],
    compilation: {
      ...document.compilation,
      warnings: [
        ...document.compilation.warnings.slice(0, 39),
        `已保留 ${materials.uploads.length} 张上传图片、${materials.history?.assets.length ?? 0} 张历史作品、${materials.repositories?.reduce((count, source) => count + source.images.length, 0) ?? 0} 张仓库图片供预览与试运行选择；未采用 ${omittedImages} 张未被报告选中的仓库图片；本次文本编译未做图片视觉解析。`,
      ],
    },
  });
}

export function cloudAgentAssets(materials: DesignSchemeAgentMaterials | null | undefined) {
  return [
    ...(materials?.uploads.map((item) => item.asset) ?? []),
    ...(materials?.history?.assets ?? []),
    ...(materials?.repositories?.flatMap((source) => source.images.map((item) => item.asset)) ??
      []),
  ];
}
export function cloudAgentSnapshots(materials: DesignSchemeAgentMaterials | null | undefined) {
  return materials?.history ? [materials.history.snapshot] : [];
}
/** A text-only revision cannot silently turn preserved images into new visual analysis. */
export function preserveCloudMaterialNotice(
  document: DesignSchemeRevisionDocument,
  base: DesignSchemeRevisionDocument,
) {
  if (
    !base.repositoryImages?.length &&
    !base.sources.some((source) => ['history-image', 'reference-image'].includes(source.kind))
  )
    return document;
  return designSchemeRevisionDocumentSchema.parse({
    ...document,
    fidelity: document.fidelity === 'unsupported' ? 'unsupported' : 'adapted',
    compilation: {
      ...document.compilation,
      warnings: [
        ...document.compilation.warnings.slice(0, 39),
        '已保留原方案图片；本次文本编译未做图片视觉解析。',
      ],
    },
  });
}
