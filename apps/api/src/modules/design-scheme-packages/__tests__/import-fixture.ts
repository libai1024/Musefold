import {
  legacyPackageFixture,
  FULL_PROMPT,
} from '../../../../../../packages/scheme-package/src/__tests__/legacy-fixture.js';
import sharp from 'sharp';
import { sourceSnapshotSchema, designSchemeAssetSchema } from '@musefold/contracts';
import {
  readValidatedDesignSchemePackageBytes,
  sha256,
  stableContentEntriesHash,
  writeDesignSchemePackageBytes,
} from '@musefold/scheme-package';
import { packageFixture } from './fixture.js';

export const IMPORT_IDENTITY = {
  seed: '713188f7-5410-488f-a849-5b736df58b45',
  createdAt: '2026-09-09T00:00:00.000Z',
};
export { FULL_PROMPT } from '../../../../../../packages/scheme-package/src/__tests__/legacy-fixture.js';

export async function importFixture() {
  const value = await readValidatedDesignSchemePackageBytes(await packageFixture());
  if (value.formatVersion !== 2) throw new Error('Expected v2 fixture');
  const { manifest } = value;
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#cc3366' } })
    .png()
    .toBuffer();
  const text = Buffer.from(FULL_PROMPT);
  const imageFile = (relativePath: string) => ({
    relativePath,
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: png.length,
    contentHash: sha256(png),
    evidencePath: null,
    textExcerpt: null,
  });
  manifest.document.sources = [
    {
      id: 'repo-source',
      kind: 'github-skill',
      role: 'normative',
      snapshotId: 'repo-snap',
      packageId: 'repo-package',
      license: 'MIT',
    },
    {
      id: 'history-source',
      kind: 'history-image',
      role: 'example',
      snapshotId: 'history-snap',
      packageId: 'history-package',
    },
  ];
  manifest.document.parentRevisionId = 'external-parent';
  manifest.document.createdAt = 0;
  manifest.document.sourceSnapshotIds = ['repo-snap', 'history-snap'];
  manifest.document.assetIds = ['repo-asset', 'history-asset', 'cover-asset'];
  manifest.document.promptProgram[0].sourceIds = ['repo-source', 'history-source'];
  manifest.document.compilation.adopted = ['Preserve the source style'];
  manifest.document.repositoryImages = [
    {
      snapshotId: 'repo-snap',
      sourceContentHash: 'a'.repeat(64),
      relativePath: 'style.png',
      imageRole: 'style-reference',
      assetId: 'repo-asset',
      contentHash: sha256(png),
    },
  ];
  manifest.sourceSnapshots = [
    sourceSnapshotSchema.parse({
      id: 'repo-snap',
      packageId: 'repo-package',
      kind: 'github',
      repositoryUrl: 'https://github.com/example/design',
      resolvedRef: 'main',
      commitHash: 'b'.repeat(40),
      contentHash: 'a'.repeat(64),
      totalBytes: png.length,
      files: [imageFile('style.png')],
      createdAt: 0,
    }),
    sourceSnapshotSchema.parse({
      id: 'history-snap',
      packageId: 'history-package',
      kind: 'history',
      resolvedRef: 'history',
      contentHash: 'c'.repeat(64),
      totalBytes: png.length + text.length,
      files: [
        imageFile('image.png'),
        {
          relativePath: 'prompt.txt',
          kind: 'text',
          mimeType: 'text/plain',
          sizeBytes: text.length,
          contentHash: sha256(text),
          evidencePath: null,
          textExcerpt: FULL_PROMPT.slice(0, 2000),
        },
      ],
      createdAt: 0,
      historyItems: [
        {
          selection: { runId: 'external-run', assetId: 'external-history', includePrompt: true },
          imageAssetId: 'history-asset',
          imagePath: 'image.png',
          promptPath: 'prompt.txt',
          prompt: FULL_PROMPT,
        },
      ],
    }),
  ];
  manifest.assets = ['repo', 'history', 'cover'].map((name) =>
    designSchemeAssetSchema.parse({
      id: `${name}-asset`,
      origin: name === 'repo' ? 'repository' : 'cloud-run',
      role: name === 'repo' ? 'reference' : name === 'cover' ? 'cover' : 'example',
      mimeType: 'image/png',
      width: 2,
      height: 3,
      byteSize: png.length,
      contentHash: sha256(png),
      license: name === 'repo' ? 'MIT' : null,
      createdAt: 0,
    }),
  );
  const content = new Map([
    ['scheme.json', Buffer.from(JSON.stringify(manifest.document))],
    ['sources/repo-snap/style.png', png],
    ['sources/history-snap/image.png', png],
    ['sources/history-snap/prompt.txt', text],
    ...manifest.assets.map((asset): [string, Buffer] => [`assets/${asset.id}.png`, png]),
  ]);
  const encode = async () => {
    content.set('scheme.json', Buffer.from(JSON.stringify(manifest.document)));
    manifest.content.entries = [...content].map(([path, bytes]) => ({
      relativePath: path,
      kind:
        path === 'scheme.json'
          ? 'revision-document'
          : path.startsWith('sources/')
            ? 'source-file'
            : 'asset',
      contentHash: sha256(bytes),
      sizeBytes: bytes.length,
      mimeType: path.startsWith('sources/')
        ? (manifest.sourceSnapshots
            .find((snapshot) => snapshot.id === path.split('/')[1])
            ?.files.find((file) => `sources/${path.split('/')[1]}/${file.relativePath}` === path)
            ?.mimeType ?? null)
        : path.endsWith('.png')
          ? 'image/png'
          : 'application/json',
      sourceId: path.startsWith('sources/') ? path.split('/')[1] : null,
      assetId: path.startsWith('assets/') ? path.slice(7, -4) : null,
    }));
    manifest.content.sizeBytes = [...content.values()].reduce(
      (total, bytes) => total + bytes.length,
      0,
    );
    manifest.content.contentHash = stableContentEntriesHash(manifest.content.entries);
    return writeDesignSchemePackageBytes(manifest, content);
  };
  return { manifest, content, png, encode };
}

export async function legacyImportFixture() {
  const fixture = await importFixture();
  return legacyPackageFixture(fixture.manifest.document, fixture.png);
}
