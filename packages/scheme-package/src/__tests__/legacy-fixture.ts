import archiver from 'archiver';
import {
  canonicalDesignSchemeDocumentToLegacy,
  type DesignSchemeRevisionDocument,
} from '@musefold/contracts';
import { sha256 } from '../archive.js';
export const FULL_PROMPT = '完整历史正文 Keep all words.\n'.repeat(250);
export async function legacyPackageFixture(
  documentInput: DesignSchemeRevisionDocument,
  png: Buffer,
) {
  const document = canonicalDesignSchemeDocumentToLegacy(documentInput);
  document.sources = [document.sources[0]];
  document.sourceSnapshotIds = [];
  document.assetIds = [];
  document.promptProgram[0].sourceIds = ['repo-source'];
  delete document.repositoryImages;
  const content = new Map([
    ['scheme.json', Buffer.from(JSON.stringify(document))],
    ['sources/old/SKILL.md', Buffer.from(FULL_PROMPT)],
    ['assets/old/style.png', png],
    ['previews/cover.png', png],
  ]);
  const manifest = {
    format: 'musefold.design',
    formatVersion: 1,
    exportedAt: 0,
    scheme: {
      name: document.name,
      summary: document.summary,
      fidelity: document.fidelity,
      sourcePresentation: 'skill',
      sourceLabel: '旧方案来源',
    },
    revisionId: document.revisionId,
    snapshots: [
      {
        dir: 'old',
        kind: 'github',
        role: 'normative',
        repositoryUrl: 'https://github.com/example/design',
        ref: 'main',
        commitHash: 'legacy-commit-'.repeat(8),
        license: 'MIT',
        scan: {
          id: 'arbitrary-id',
          historyItems: [{ imageAssetId: 'victim-asset' }],
          confirmed: true,
          trial: 'success',
        },
      },
    ],
    files: {} as Record<string, string>,
  };
  const encode = async () => {
    content.set('scheme.json', Buffer.from(JSON.stringify(document)));
    manifest.files = Object.fromEntries([...content].map(([path, bytes]) => [path, sha256(bytes)]));
    return zipBytes(
      new Map([['manifest.json', Buffer.from(JSON.stringify(manifest))], ...content]),
    );
  };
  return { document, manifest, content, encode };
}

async function zipBytes(entries: Map<string, Buffer>): Promise<Buffer> {
  const zip = archiver('zip', { store: true });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.on('data', (bytes: Buffer) => chunks.push(bytes));
    zip.on('end', () => resolve(Buffer.concat(chunks)));
    zip.on('error', reject);
  });
  for (const [name, bytes] of entries) zip.append(bytes, { name });
  await zip.finalize();
  return result;
}
