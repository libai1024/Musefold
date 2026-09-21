import archiver from 'archiver';
import {
  designSchemeRevisionDocumentSchema,
  sharePackageManifestSchema,
  type CanonicalDesignSchemePackageManifest,
} from '@musefold/contracts';
import { contentEntriesHash, sha256 } from '../archive.js';

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
export function mixedPackage() {
  const text = Buffer.from('原始提示词\nKeep all selected text.');
  const hash = sha256(PNG);
  const document = designSchemeRevisionDocumentSchema.parse({
    schemaVersion: 1,
    revisionId: 'rev_original',
    schemeId: 'scheme_original',
    name: '包往返',
    summary: '固定来源与图片',
    fidelity: 'adapted',
    sources: [
      {
        id: 'src_repo',
        kind: 'github-skill',
        role: 'normative',
        snapshotId: 'snap_repo',
        packageId: 'pkg_repo',
      },
      {
        id: 'src_history',
        kind: 'history-image',
        role: 'example',
        snapshotId: 'snap_history',
        packageId: 'pkg_history',
      },
    ],
    sourceSnapshotIds: ['snap_repo', 'snap_history'],
    assetIds: ['asset_repo', 'asset_history'],
    repositoryImages: [
      {
        snapshotId: 'snap_repo',
        sourceContentHash: 'a'.repeat(64),
        relativePath: 'style.png',
        imageRole: 'style-reference',
        assetId: 'asset_repo',
        contentHash: hash,
      },
    ],
    inputs: [],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'prompt_1',
        order: 0,
        kind: 'input-template',
        template: 'Draw a tree',
        variables: [],
        sourceIds: [],
      },
    ],
    compilation: {
      compiledAt: 0,
      model: { model: 'fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  });
  const imageFile = (path: string) => ({
    relativePath: path,
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: PNG.length,
    contentHash: hash,
    evidencePath: null,
    textExcerpt: null,
  });
  const content = new Map([
    ['scheme.json', Buffer.from(JSON.stringify(document))],
    ['sources/snap_repo/style.png', PNG],
    ['sources/snap_history/image.png', PNG],
    ['sources/snap_history/prompt.txt', text],
    ['assets/asset_repo.png', PNG],
    ['assets/asset_history.png', PNG],
  ]);
  const entries = [...content].map(([relativePath, bytes]) => ({
    relativePath,
    contentHash: sha256(bytes),
    sizeBytes: bytes.length,
    kind:
      relativePath === 'scheme.json'
        ? 'revision-document'
        : relativePath.startsWith('sources/')
          ? 'source-file'
          : 'asset',
    mimeType: relativePath.endsWith('.png')
      ? 'image/png'
      : relativePath.endsWith('.json')
        ? 'application/json'
        : 'text/plain',
    sourceId: relativePath.startsWith('sources/') ? relativePath.split('/')[1] : null,
    assetId: relativePath.startsWith('assets/')
      ? relativePath.endsWith('asset_repo.png')
        ? 'asset_repo'
        : 'asset_history'
      : null,
  }));
  const manifest = sharePackageManifestSchema.parse({
    packageId: 'package_original',
    format: 'musefold.design',
    formatVersion: 2,
    schemeId: document.schemeId,
    revisionId: document.revisionId,
    status: 'formal',
    document,
    sourceSnapshots: [
      {
        id: 'snap_repo',
        packageId: 'pkg_repo',
        kind: 'github',
        repositoryUrl: 'https://github.com/example/design',
        resolvedRef: 'main',
        commitHash: 'b'.repeat(40),
        contentHash: 'a'.repeat(64),
        totalBytes: PNG.length,
        files: [imageFile('style.png')],
        createdAt: 0,
      },
      {
        id: 'snap_history',
        packageId: 'pkg_history',
        kind: 'history',
        resolvedRef: 'history',
        contentHash: 'c'.repeat(64),
        totalBytes: PNG.length + text.length,
        files: [
          imageFile('image.png'),
          {
            relativePath: 'prompt.txt',
            kind: 'text',
            mimeType: 'text/plain',
            sizeBytes: text.length,
            contentHash: sha256(text),
            evidencePath: null,
            textExcerpt: null,
          },
        ],
        createdAt: 0,
        historyItems: [
          {
            selection: { runId: 'old_run', assetId: 'old_asset', includePrompt: true },
            imageAssetId: 'asset_history',
            imagePath: 'image.png',
            promptPath: 'prompt.txt',
            prompt: text.toString('utf8'),
          },
        ],
      },
    ],
    assets: ['repo', 'history'].map((kind) => ({
      id: `asset_${kind}`,
      origin: kind === 'repo' ? 'repository' : 'cloud-run',
      role: kind === 'repo' ? 'reference' : 'example',
      license: null,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteSize: PNG.length,
      contentHash: hash,
      createdAt: 0,
    })),
    content: {
      entries,
      sizeBytes: [...content.values()].reduce((sum, bytes) => sum + bytes.length, 0),
      contentHash: contentEntriesHash(entries),
    },
  });
  return { manifest, content };
}

export function refreshDocument(
  manifest: CanonicalDesignSchemePackageManifest,
  content: Map<string, Buffer>,
) {
  const bytes = Buffer.from(JSON.stringify(manifest.document));
  content.set('scheme.json', bytes);
  const entry = manifest.content.entries.find((item) => item.kind === 'revision-document');
  if (!entry) throw new Error('Missing document fixture');
  entry.sizeBytes = bytes.length;
  entry.contentHash = sha256(bytes);
  manifest.content.sizeBytes = manifest.content.entries.reduce(
    (sum, item) => sum + item.sizeBytes,
    0,
  );
  manifest.content.contentHash = contentEntriesHash(manifest.content.entries);
}
export function rawZip(
  entries: Array<{ name: string; bytes: Buffer; type?: 'file' | 'directory'; mode?: number }>,
  store = true,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = archiver('zip', { store, zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    zip.on('data', (part: Buffer) => chunks.push(part));
    zip.on('error', reject);
    zip.on('end', () => resolve(Buffer.concat(chunks)));
    for (const item of entries) zip.append(item.bytes, { name: item.name, mode: item.mode });
    void zip.finalize().catch(reject);
  });
}
export function rawPackage(
  manifest: CanonicalDesignSchemePackageManifest,
  content: Map<string, Buffer>,
) {
  refreshDocument(manifest, content);
  return rawZip([
    { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
    ...[...content].map(([name, bytes]) => ({ name, bytes })),
  ]);
}
