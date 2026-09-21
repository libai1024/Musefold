import { expect, it } from 'vitest';
import { writeDesignSchemePackageBytes } from '../index.js';
import { mixedPackage, refreshDocument } from './fixtures.js';

it.each([
  { repositoryUrl: 'https://github.com/other/design' },
  { resolvedRef: 'other-branch' },
  { commitHash: 'd'.repeat(40) },
  { contentHash: 'b'.repeat(64) },
  { hash: 'b'.repeat(64) },
])('rejects source metadata contradicting the fixed package snapshot %j', async (fields) => {
  const { manifest, content } = mixedPackage();
  Object.assign(manifest.document.sources[0], fields);
  refreshDocument(manifest, content);
  await expect(writeDesignSchemePackageBytes(manifest, content)).rejects.toThrow('固定快照');
});
it('allows omitted redundant metadata and equivalent hash prefixes/repository suffixes', async () => {
  const { manifest, content } = mixedPackage();
  Object.assign(manifest.document.sources[0], {
    repositoryUrl: 'https://github.com/example/design.git',
    contentHash: `sha256:${'a'.repeat(64)}`,
  });
  refreshDocument(manifest, content);
  await expect(writeDesignSchemePackageBytes(manifest, content)).resolves.toBeInstanceOf(Buffer);
});
