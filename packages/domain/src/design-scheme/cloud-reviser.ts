import { preserveCloudMaterialNotice } from './cloud-materials';
import {
  compilerOutputSchema,
  designSchemeRevisionDocumentSchema,
  type DesignSchemeRevisionDocument,
  type SourceSnapshot,
} from '@musefold/contracts';
import { buildCloudCompiledDocument, CloudCompilerValidationError } from './cloud-compiler';

/** Revision inherits storage provenance/assets/parameters from the exact host-owned base. */
export function buildCloudRevisedDocument(
  raw: unknown,
  base: DesignSchemeRevisionDocument,
  snapshots: SourceSnapshot[],
  identity: { revisionId: string; now: string; model: string; instruction: string },
) {
  const output = compilerOutputSchema.parse(raw);
  if (
    output.fidelity === 'verified' ||
    (output.fidelity === 'faithful' && !['faithful', 'verified'].includes(base.fidelity))
  )
    throw new CloudCompilerValidationError();
  // Reuse variable/evidence validation; fidelity and existing provenance are checked separately.
  const built = buildCloudCompiledDocument({ ...output, fidelity: 'adapted' }, snapshots, {
    schemeId: base.schemeId,
    revisionId: identity.revisionId,
    now: identity.now,
    model: identity.model,
    brief: identity.instruction,
  });
  const defaultSourceIds = base.sources
    .filter((source) => source.role === 'normative')
    .map((source) => source.id);
  const fallback = base.sources.some((source) => source.kind === 'history-image')
    ? base.sources.map((source) => source.id)
    : defaultSourceIds.length
      ? defaultSourceIds
      : base.sources.map((source) => source.id);
  const used = new Set(
    built.inputs
      .filter((slot) => ['text', 'article', 'choice'].includes(slot.kind))
      .map((slot) => slot.id),
  );
  const inputs = built.inputs.map((slot) => {
    if (['text', 'article', 'choice'].includes(slot.kind)) return slot;
    const candidates = base.inputs.filter(
      (old) =>
        old.kind === slot.kind && old.label === slot.label && old.imageRole === slot.imageRole,
    );
    let id = candidates.length === 1 ? candidates[0].id : slot.id;
    while (used.has(id)) id += '_new';
    used.add(id);
    return { ...(candidates.length === 1 ? candidates[0] : {}), ...slot, id };
  });
  return preserveCloudMaterialNotice(
    designSchemeRevisionDocumentSchema.parse({
      ...built,
      fidelity: output.fidelity,
      sources: base.sources,
      sourceSnapshotIds: base.sourceSnapshotIds,
      assetIds: base.assetIds,
      ...(base.repositoryImages ? { repositoryImages: base.repositoryImages } : {}),
      parameters: base.parameters,
      inputs,
      constraints: built.constraints.map((constraint, index) => ({
        ...constraint,
        sourceIds: output.constraints[index].evidencePaths.length
          ? base.sources
              .filter(
                (binding) =>
                  binding.snapshotId &&
                  snapshots.some(
                    (snapshot) =>
                      snapshot.id === binding.snapshotId &&
                      output.constraints[index].evidencePaths.some((path) =>
                        snapshot.files.some((file) => file.relativePath === path),
                      ),
                  ),
              )
              .map((binding) => binding.id)
          : fallback,
      })),
      promptProgram: built.promptProgram.map((module) => ({ ...module, sourceIds: fallback })),
      parentRevisionId: base.revisionId,
    }),
    base,
  );
}
