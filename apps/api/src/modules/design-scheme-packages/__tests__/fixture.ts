import {
  designSchemeRevisionDocumentSchema,
  sharePackageManifestSchema,
} from '@musefold/contracts';
import { stableContentEntriesHash, writeDesignSchemePackageBytes } from '@musefold/scheme-package';
import { packageHash } from '../bytes.js';

export async function packageFixture() {
  const document = designSchemeRevisionDocumentSchema.parse({
    schemaVersion: 1,
    schemeId: 'old_scheme',
    revisionId: 'old_revision',
    name: '导入方案',
    summary: '可恢复上传',
    fidelity: 'adapted',
    sources: [],
    sourceSnapshotIds: [],
    inputs: [],
    parameters: [],
    constraints: [],
    assetIds: [],
    promptProgram: [
      {
        id: 'prompt_main',
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
  const bytes = Buffer.from(JSON.stringify(document));
  const entries = [
    {
      kind: 'revision-document' as const,
      relativePath: 'scheme.json',
      mimeType: 'application/json',
      contentHash: packageHash(bytes),
      sizeBytes: bytes.length,
    },
  ];
  const manifest = sharePackageManifestSchema.parse({
    packageId: 'old_package',
    format: 'musefold.design',
    formatVersion: 2,
    schemeId: document.schemeId,
    revisionId: document.revisionId,
    status: 'formal',
    document,
    sourceSnapshots: [],
    assets: [],
    content: { entries, sizeBytes: bytes.length, contentHash: stableContentEntriesHash(entries) },
  });
  return writeDesignSchemePackageBytes(manifest, new Map([['scheme.json', bytes]]));
}
