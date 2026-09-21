import { importDesignSchemeResultSchema, sourceSnapshotSchema } from '@musefold/contracts';
import {
  type MusefoldTransaction,
  designSchemes,
  designSchemeRevisions,
  designSchemeAssets,
  designSchemeSourcePackages,
  designSchemeSourceSnapshots,
  designSchemeSourceFiles,
  designSchemeSourceBindings,
  executionDigest,
} from '@musefold/db';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import type { preparePackageImportContent } from './import-content.js';

export type ImportContent = Awaited<ReturnType<typeof preparePackageImportContent>>;
export const sourceObjectId = (snapshotId: string, path: string) =>
  executionDigest(['source', snapshotId, path]);
export const assetObjectId = (assetId: string) => executionDigest(['asset', assetId]);

/** Called only inside the confirmed-import transaction. Public create authority stays unchanged. */
export async function persistPackageImport(
  tx: MusefoldTransaction,
  userId: string,
  plan: ImportContent,
  objectPrefix: string,
  assets: DesignSchemeAssetService,
) {
  const document = plan.document;
  const createdAt = date(document.createdAt ?? 0);
  await tx.insert(designSchemes).values({
    id: document.schemeId,
    userId,
    name: document.name,
    summary: document.summary,
    status: 'draft',
    sourcePresentation: plan.sourcePresentation,
    sourceLabel: plan.sourceLabel,
    currentRevisionId: document.revisionId,
    fidelity: document.fidelity,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  });
  await tx.insert(designSchemeRevisions).values({
    revisionId: document.revisionId,
    schemeId: document.schemeId,
    userId,
    schemaVersion: document.schemaVersion,
    document,
    createdBy: 'import',
    createdAt,
  });
  for (const item of plan.sourcePackages) {
    await tx.insert(designSchemeSourcePackages).values({
      id: item.id,
      userId,
      kind: item.kind,
      repositoryUrl: item.repositoryUrl,
      license: item.license,
      createdAt: date(item.createdAt),
    });
  }
  for (const raw of plan.sourceSnapshots) {
    const snapshot = sourceSnapshotSchema.parse(raw);
    await tx.insert(designSchemeSourceSnapshots).values({
      id: snapshot.id,
      userId,
      packageId: snapshot.packageId,
      resolvedRef: snapshot.resolvedRef ?? snapshot.ref ?? '',
      commitHash: snapshot.commitHash ?? snapshot.commit ?? null,
      contentHash: snapshot.contentHash ?? null,
      totalBytes: snapshot.totalBytes,
      scan: snapshot,
      createdAt: date(snapshot.createdAt),
    });
  }
  for (const file of plan.files) {
    await tx.insert(designSchemeSourceFiles).values({
      ...file.metadata,
      userId,
      snapshotId: file.snapshotId,
      objectKey: objectPrefix + sourceObjectId(file.snapshotId, file.metadata.relativePath),
    });
  }
  const rank = { context: 0, example: 1, reference: 2, normative: 3 };
  for (const snapshot of plan.sourceSnapshots) {
    const role = document.sources
      .filter((source) => source.snapshotId === snapshot.id)
      .reduce<keyof typeof rank>(
        (current, source) => (rank[source.role] > rank[current] ? source.role : current),
        'context',
      );
    await tx.insert(designSchemeSourceBindings).values({
      revisionId: document.revisionId,
      sourceSnapshotId: snapshot.id,
      userId,
      role,
    });
  }
  for (const { metadata } of plan.assets) {
    await tx.insert(designSchemeAssets).values({
      ...metadata,
      userId,
      revisionId: document.revisionId,
      objectKey: objectPrefix + assetObjectId(metadata.id),
      createdAt: date(metadata.createdAt),
    });
  }
  await assets.requireDocumentAssets(tx, userId, document);
  await assets.requireRepositoryImages(tx, userId, document);
  return importDesignSchemeResultSchema.parse({
    status: 'draft',
    revisionId: document.revisionId,
    scheme: {
      id: document.schemeId,
      name: document.name,
      summary: document.summary,
      status: 'draft',
      sourcePresentation: plan.sourcePresentation,
      sourceLabel: plan.sourceLabel,
      currentRevisionId: document.revisionId,
      version: 1,
      workingDraftRevisionId: null,
      coverAssetId: null,
      fidelity: document.fidelity,
      inputLabels: document.inputs.map((input) =>
        input.required ? `${input.label} · 必需` : input.label,
      ),
      hasSuccessfulTrial: false,
      lastRunAt: null,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    },
  });
}

function date(value: string | number) {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('方案包时间超出数据库范围');
  return result;
}
