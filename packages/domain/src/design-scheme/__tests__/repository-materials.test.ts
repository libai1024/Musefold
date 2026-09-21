import { describe, expect, it } from 'vitest';
import { analystReportSchema, sourceSnapshotSchema } from '@musefold/contracts';
import { selectRepositoryImages } from '../repository-materials';
const image = {
  relativePath: 'style.png',
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 100,
  contentHash: 'b'.repeat(64),
  evidencePath: 'style.png',
  textExcerpt: null,
};
const snapshot = sourceSnapshotSchema.parse({
  id: 'snapshot',
  packageId: 'package',
  kind: 'github',
  resolvedRef: 'a'.repeat(40),
  commitHash: 'a'.repeat(40),
  contentHash: 'a'.repeat(64),
  totalBytes: 200,
  files: [image, { ...image, relativePath: 'unused.png', evidencePath: 'unused.png' }],
  createdAt: '2026-09-09T00:00:00Z',
});
const report = analystReportSchema.parse({
  repoKind: 'prompt-repo',
  capabilitySummary: 'Filename hints only',
  rules: [],
  variables: [],
  referenceImages: [{ path: 'style.png', role: 'style-reference' }],
});
describe('exact repository image selection', () => {
  it('retains order, deduplicates identical recommendations and distinguishes omitted images', () => {
    const before = structuredClone({ snapshot, report });
    const selected = selectRepositoryImages(snapshot, {
      ...report,
      referenceImages: [...report.referenceImages, ...report.referenceImages],
    });
    expect(selected.selected.map((image) => [image.relativePath, image.imageRole])).toEqual([
      ['style.png', 'style-reference'],
    ]);
    expect(selected.omittedPaths).toEqual(['unused.png']);
    expect({ snapshot, report }).toEqual(before);
  });
  it('rejects conflicting uses, invented paths and nonrepository snapshots rather than silently adopting them', () => {
    expect(() =>
      selectRepositoryImages(snapshot, {
        ...report,
        referenceImages: [...report.referenceImages, { path: 'style.png', role: 'edit-target' }],
      }),
    ).toThrow();
    expect(() =>
      selectRepositoryImages(snapshot, {
        ...report,
        referenceImages: [{ path: 'other/style.png', role: 'style-reference' }],
      }),
    ).toThrow();
    expect(() => selectRepositoryImages({ ...snapshot, kind: 'history' }, report)).toThrow();
  });
});
