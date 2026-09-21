import type { SourceBinding, SourceSnapshot } from '@musefold/contracts';

const hash = (value: string | null | undefined) =>
  value == null ? value : value.toLowerCase().replace(/^sha256:/, '');
const repository = (value: string | null | undefined) =>
  value == null ? value : value.replace(/\/$/, '').replace(/\.git$/, '');

/** A package may omit redundant metadata, but cannot contradict its fixed source identity. */
export function assertPackageSourceBinding(source: SourceBinding, snapshot: SourceSnapshot): void {
  const groups = [
    [
      source.uri,
      source.repositoryUrl,
      snapshot.uri,
      snapshot.repositoryUri,
      snapshot.repositoryUrl,
    ].map(repository),
    [source.resolvedRef, source.ref, snapshot.resolvedRef, snapshot.ref],
    [source.commitHash, source.commit, snapshot.commitHash, snapshot.commit],
    [source.contentHash, source.hash, snapshot.contentHash].map(hash),
  ];
  for (const values of groups) {
    const declared = values.filter((value) => value !== undefined && value !== null);
    if (new Set(declared).size > 1) throw new Error('方案来源信息与固定快照不一致');
  }
}
