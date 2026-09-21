import { expect, it } from 'vitest';
import { designSchemeUpdateContextSchema, sourceSnapshotSchema } from '@musefold/contracts';
import { buildCloudCompiledDocument } from '../cloud-compiler';
import { buildCloudUpdatedDocument } from '../cloud-update';
const now = '2026-09-09T00:00:00Z';
const output = {
  name: 'Poster',
  summary: 'Poster rules',
  fidelity: 'adapted',
  inputs: [{ label: 'Topic', kind: 'text', variable: 'topic', required: true }],
  constraints: [
    {
      domain: 'color',
      statement: 'red',
      mode: 'required',
      userOverridable: false,
      evidencePaths: ['README.md'],
    },
  ],
  promptProgram: [
    { kind: 'input-template', template: '{{topic}}', variables: ['topic'] },
    { kind: 'style-rule', template: 'red', variables: [] },
  ],
  creationSummary: 'Try it',
};
function snapshot(id: string, commit: string) {
  return sourceSnapshotSchema.parse({
    id,
    packageId: `package_${id}`,
    kind: 'github',
    repositoryUrl: 'https://github.com/example/design',
    resolvedRef: commit.repeat(40),
    commitHash: commit.repeat(40),
    contentHash: commit.repeat(64),
    totalBytes: 1,
    createdAt: now,
    files: [
      {
        relativePath: 'README.md',
        evidencePath: 'README.md',
        textExcerpt: 'a',
        kind: 'text',
        mimeType: 'text/markdown',
        sizeBytes: 1,
        contentHash: 'e'.repeat(64),
      },
    ],
  });
}
function fixture() {
  const old = snapshot('old', 'a');
  const unchanged = snapshot('unchanged', 'b');
  const updated = snapshot('new', 'c');
  const document = buildCloudCompiledDocument(output, [old, unchanged], {
    schemeId: 'scheme',
    revisionId: 'base',
    now,
    model: 'text',
    brief: 'Keep my customization',
  });
  document.assetIds = ['image'];
  document.sources[0].license = 'old-license';
  document.sources[0].hash = old.contentHash;
  const context = designSchemeUpdateContextSchema.parse({
    base: { expectedVersion: 2, document },
    snapshots: [old, unchanged],
    sources: [
      {
        snapshotId: 'old',
        executionId: 'source',
        repositoryUrl: 'https://github.com/example/design',
        requestedRef: 'main',
      },
    ],
    checkedSources: 1,
    changes: [
      {
        sourceExecutionId: 'source',
        previousSnapshotId: 'old',
        snapshotId: 'new',
        previousCommit: old.commitHash,
        commit: updated.commitHash,
        contentHash: updated.contentHash,
      },
    ],
    authorizationVersion: 4,
  });
  return { context, updated };
}
const identity = { revisionId: 'revision', now, model: 'text' };
it('replaces only confirmed provenance, preserves other sources/assets and never mutates the base', () => {
  const { context, updated } = fixture();
  const before = structuredClone(context);
  const doc = buildCloudUpdatedDocument(
    { ...output, schemeId: 'attacker', assetIds: ['attacker'] },
    context,
    [updated],
    identity,
  );
  expect(doc).toMatchObject({
    schemeId: 'scheme',
    revisionId: 'revision',
    parentRevisionId: 'base',
    assetIds: ['image'],
    sourceSnapshotIds: ['new', 'unchanged'],
  });
  expect(doc.sources[0]).toMatchObject({
    id: 'source_1',
    snapshotId: 'new',
    packageId: 'package_new',
    commit: 'c'.repeat(40),
    commitHash: 'c'.repeat(40),
    hash: 'c'.repeat(64),
  });
  expect(doc.sources[0].license).toBeUndefined();
  expect(doc.sources[1]).toEqual(context.base.document.sources[1]);
  expect(doc.parameters).toEqual(context.base.document.parameters);
  expect(doc.compilation.briefExcerpt).toBe('Keep my customization');
  expect(doc.compilation.trace[0].detail).toContain('a'.repeat(40));
  expect(context).toEqual(before);
});
it.each(['missing', 'different-hash', 'different-sha', 'verified', 'bad-evidence'])(
  'rejects %s without fabricating an updated revision',
  (mode) => {
    const { context, updated } = fixture();
    if (mode === 'different-hash') updated.contentHash = 'd'.repeat(64);
    if (mode === 'different-sha') updated.commitHash = 'd'.repeat(40);
    const raw =
      mode === 'verified'
        ? { ...output, fidelity: 'verified' }
        : mode === 'bad-evidence'
          ? { ...output, constraints: [{ ...output.constraints[0], evidencePaths: ['absent'] }] }
          : output;
    expect(() =>
      buildCloudUpdatedDocument(raw, context, mode === 'missing' ? [] : [updated], identity),
    ).toThrow();
  },
);
