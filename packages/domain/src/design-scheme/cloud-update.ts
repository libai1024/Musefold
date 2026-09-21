import { preserveCloudMaterialNotice } from './cloud-materials';
import {
  compilerOutputSchema,
  designSchemeRevisionDocumentSchema,
  type DesignSchemeUpdateContext,
  type SourceSnapshot,
} from '@musefold/contracts';
import { buildCloudCompiledDocument, CloudCompilerValidationError } from './cloud-compiler';
import { buildCloudRevisedDocument } from './cloud-reviser';

/** Replace only confirmed changed snapshots; retain all other provenance and local customization context. */
export function buildCloudUpdatedDocument(
  raw: unknown,
  context: DesignSchemeUpdateContext,
  changed: SourceSnapshot[],
  identity: { revisionId: string; now: string; model: string },
) {
  const output = compilerOutputSchema.parse(raw);
  if (changed.length !== context.changes.length || !changed.length)
    throw new CloudCompilerValidationError();
  const replacements = new Map(
    context.changes.map((change) => {
      const snapshot = changed.find((item) => item.id === change.snapshotId);
      if (
        !snapshot ||
        snapshot.commitHash !== change.commit ||
        snapshot.contentHash !== change.contentHash
      )
        throw new CloudCompilerValidationError();
      return [change.previousSnapshotId, snapshot] as const;
    }),
  );
  const original = context.base.document;
  const snapshots = context.snapshots.map((snapshot) => replacements.get(snapshot.id) ?? snapshot);
  const brief = original.compilation.briefExcerpt ?? original.summary;
  const checked = buildCloudCompiledDocument(output, snapshots, {
    ...identity,
    schemeId: original.schemeId,
    brief,
  });
  const base = designSchemeRevisionDocumentSchema.parse({
    ...original,
    sources: original.sources.map((binding) => {
      const snapshot = binding.snapshotId ? replacements.get(binding.snapshotId) : undefined;
      if (!snapshot) return binding;
      return {
        ...binding,
        uri: snapshot.repositoryUrl,
        repositoryUrl: snapshot.repositoryUrl,
        ref: snapshot.resolvedRef,
        resolvedRef: snapshot.resolvedRef,
        commit: snapshot.commitHash,
        commitHash: snapshot.commitHash,
        contentHash: snapshot.contentHash,
        ...(binding.hash !== undefined ? { hash: snapshot.contentHash } : {}),
        packageId: snapshot.packageId,
        snapshotId: snapshot.id,
        // Old commit metadata cannot authorize the new commit's license.
        license: undefined,
      };
    }),
    sourceSnapshotIds: original.sourceSnapshotIds.map((id) => replacements.get(id)?.id ?? id),
  });
  const document = buildCloudRevisedDocument({ ...output, fidelity: 'adapted' }, base, snapshots, {
    ...identity,
    instruction: brief,
  });
  return preserveCloudMaterialNotice(
    designSchemeRevisionDocumentSchema.parse({
      ...document,
      fidelity: checked.fidelity,
      compilation: {
        ...document.compilation,
        trace: [
          ...original.compilation.trace,
          ...context.changes.map((change, index) => ({
            id: `update_${identity.revisionId.slice(0, 32)}_${index + 1}`,
            title: '上游来源更新',
            status: 'success',
            detail: `${change.previousCommit} → ${change.commit}`,
          })),
        ].slice(-60),
      },
    }),
    original,
  );
}
