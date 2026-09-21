import type { DesignSchemeDetail } from '@musefold/contracts';

/** Compare content while allowing the required new owner-local IDs, timestamps and draft identity. */
export function packageMeaning(
  value: Pick<DesignSchemeDetail, 'document' | 'sourceSnapshots' | 'assets'>,
) {
  const { document, sourceSnapshots, assets } = value;
  const ordered = <T>(items: T[]) =>
    items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const source = (id: string) => {
    const item = document.sources.find((source) => source.id === id);
    return item ? { kind: item.kind, role: item.role, license: item.license ?? null } : null;
  };
  return {
    name: document.name,
    summary: document.summary,
    fidelity: document.fidelity,
    inputs: document.inputs,
    parameters: document.parameters,
    constraints: document.constraints,
    prompts: document.promptProgram.map(({ id: _id, sourceIds, ...module }) => ({
      ...module,
      sources: sourceIds.map(source),
    })),
    compilation: document.compilation
      ? {
          ...document.compilation,
          // Canonical dates allow ISO text and epoch milliseconds; compare the same instant.
          compiledAt: new Date(document.compilation.compiledAt).toISOString(),
        }
      : document.compilation,
    sources: ordered(document.sources.map((item) => source(item.id))),
    snapshots: ordered(
      sourceSnapshots.map((snapshot) => ({
        kind: snapshot.kind,
        repositoryUrl: snapshot.repositoryUrl ?? null,
        resolvedRef: snapshot.resolvedRef,
        // The contract permits both absent and null for a source without a Git commit.
        commitHash: snapshot.commitHash ?? null,
        contentHash: snapshot.contentHash,
        license:
          snapshot.license ??
          document.sources.find((source) => source.snapshotId === snapshot.id)?.license ??
          null,
        files: ordered(
          snapshot.files.map(({ relativePath, kind, mimeType, sizeBytes, contentHash }) => ({
            relativePath,
            kind,
            mimeType,
            sizeBytes,
            contentHash,
          })),
        ),
        history:
          snapshot.historyItems?.map(({ prompt, imagePath, promptPath }) => ({
            prompt,
            imagePath,
            promptPath,
          })) ?? [],
      })),
    ),
    repositoryImages: ordered(
      (document.repositoryImages ?? []).map(
        ({ relativePath, sourceContentHash, imageRole, contentHash }) => ({
          relativePath,
          sourceContentHash,
          imageRole,
          contentHash,
        }),
      ),
    ),
    assets: ordered(
      assets.map(({ role, origin, license, mimeType, width, height, byteSize, contentHash }) => ({
        role: role === 'cover' || role === 'output' ? 'example' : role,
        origin,
        license,
        mimeType,
        width,
        height,
        byteSize,
        contentHash,
      })),
    ),
  };
}
