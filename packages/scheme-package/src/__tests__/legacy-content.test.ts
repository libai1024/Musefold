import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { canonicalDesignSchemeDocumentToLegacy } from '@musefold/contracts';
import {
  decodeLegacyDesignSchemePackage,
  prepareLegacyDesignSchemeImportContent,
  readValidatedDesignSchemePackageBytes,
  sha256,
} from '../index.js';
import { mixedPackage, rawZip, PNG } from './fixtures.js';

async function legacy(
  input: {
    invalidText?: boolean;
    ambiguous?: boolean;
    missingIdentity?: boolean;
    duplicate?: boolean;
    collision?: boolean;
    revision?: string;
  } = {},
) {
  const document = canonicalDesignSchemeDocumentToLegacy(mixedPackage().manifest.document);
  document.sources = document.sources.slice(0, 1);
  document.sourceSnapshotIds = [];
  document.assetIds = input.missingIdentity ? ['missing-asset'] : [];
  delete document.repositoryImages;
  const content = new Map([
    ['scheme.json', Buffer.from(JSON.stringify(document))],
    [
      'sources/old/SKILL.md',
      input.invalidText ? Buffer.from([255]) : Buffer.from('完整旧正文'.repeat(500)),
    ],
    ['assets/old/style.png', PNG],
    ['previews/cover.png', PNG],
  ]);
  if (input.collision) content.set('sources/old/style.png', Buffer.from('collision'));
  const snapshot = {
    dir: 'old',
    kind: 'github',
    role: 'normative',
    repositoryUrl: 'https://github.com/example/design',
    ref: 'main',
    commitHash: null,
    license: null,
    scan: { legacyFact: true },
  };
  const manifest = {
    format: 'musefold.design',
    formatVersion: 1,
    exportedAt: 0,
    scheme: {
      name: document.name,
      summary: document.summary,
      fidelity: document.fidelity,
      sourceLabel: '旧来源',
      sourcePresentation: 'skill',
    },
    revisionId: input.revision ?? document.revisionId,
    snapshots: input.duplicate
      ? [snapshot, snapshot]
      : input.ambiguous
        ? [snapshot, { ...snapshot, dir: 'other' }]
        : [snapshot],
    files: Object.fromEntries([...content].map(([path, bytes]) => [path, sha256(bytes)])),
  };
  return rawZip([
    { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
    ...[...content].map(([name, bytes]) => ({ name, bytes })),
  ]);
}
async function decode(bytes: Buffer) {
  const value = await readValidatedDesignSchemePackageBytes(bytes);
  if (value.formatVersion !== 1) throw new Error('Expected legacy');
  return decodeLegacyDesignSchemePackage(value);
}
it('decodes real v1 source text and image references without losing full text or granting preview cover eligibility', async () => {
  const result = await decode(await legacy());
  expect(result.snapshots[0].files.find((file) => file.metadata.kind === 'text')?.text).toBe(
    '完整旧正文'.repeat(500),
  );
  expect(
    result.snapshots[0].files.find((file) => file.metadata.kind === 'image')?.metadata,
  ).toMatchObject({ relativePath: 'style.png', mimeType: 'image/png', contentHash: sha256(PNG) });
  expect(result.snapshots[0].snapshot.scan).toEqual({ legacyFact: true });
  expect(result.previews).toEqual(['previews/cover.png']);
});
it.each([
  { invalidText: true },
  { duplicate: true },
  { collision: true },
  { revision: 'different' },
])('rejects ambiguous or corrupted v1 content %j', async (input) => {
  await expect(decode(await legacy(input))).rejects.toThrow();
});
it('a fresh API Node process consumes the same legacy decoder and document bridge', async () => {
  const script = `import { readValidatedDesignSchemePackageBytes, decodeLegacyDesignSchemePackage } from '@musefold/scheme-package';
    import { legacyDesignSchemeDocumentToCanonical } from '@musefold/contracts';
    const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
    const parsed=await readValidatedDesignSchemePackageBytes(Buffer.concat(chunks),[1]);
    const result=decodeLegacyDesignSchemePackage(parsed);
    process.stdout.write(JSON.stringify({ pid:process.pid, document:legacyDesignSchemeDocumentToCanonical(result.document), result }));`;
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: resolve(import.meta.dirname, '../../../../apps/api'),
      input: await legacy(),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  expect(child.stderr).toBe('');
  expect(child.status).toBe(0);
  const value = JSON.parse(child.stdout);
  expect(value.pid).not.toBe(process.pid);
  expect(value.document.schemeId).toBe('scheme_original');
  expect(value.result.snapshots[0].files[0].text).toBe('完整旧正文'.repeat(500));
});

const mappedId = (kind: string, original: string) =>
  `import_${sha256(Buffer.from(`${kind}:${original}`)).slice(0, 24)}`;
const inspectImage = (bytes: Buffer) => ({
  mimeType: 'image/png',
  width: 1,
  height: 1,
  byteSize: bytes.length,
  contentHash: sha256(bytes),
});
async function prepareLegacyCase(options: Parameters<typeof legacy>[0] = {}) {
  const parsed = await readValidatedDesignSchemePackageBytes(await legacy(options));
  if (parsed.formatVersion !== 1) throw new Error('Expected v1');
  return parsed;
}
it('maps complete legacy sources and preview assets once for both hosts, with no inherited trial or scan authority', async () => {
  const inspect = vi.fn(inspectImage);
  const result = await prepareLegacyDesignSchemeImportContent(
    await prepareLegacyCase(),
    mappedId,
    inspect,
  );
  expect(result.document.sourceSnapshotIds).toEqual(result.sourceSnapshots.map((item) => item.id));
  expect(result.document.assetIds).toEqual(result.assets.map((item) => item.metadata.id));
  expect(result.assets.map((item) => item.metadata.role)).toEqual(['reference', 'example']);
  expect(result.files.find((file) => file.metadata.kind === 'text')?.bytes.toString()).toBe(
    '完整旧正文'.repeat(500),
  );
  expect(result.document.sources[0].snapshotId).toBe(result.sourceSnapshots[0].id);
  expect(result.sourceSnapshots[0].historyItems).toBeUndefined();
  expect(result.provenance.legacySnapshots[0].metadata.scan).toEqual({ legacyFact: true });
  expect(inspect).toHaveBeenCalledTimes(2);
  expect(inspect.mock.calls.every(([bytes]) => bytes.equals(PNG))).toBe(true);
});
it('rejects ambiguous legacy source assignment instead of attaching by array position', async () => {
  await expect(
    prepareLegacyDesignSchemeImportContent(
      await prepareLegacyCase({ ambiguous: true }),
      mappedId,
      inspectImage,
    ),
  ).rejects.toThrow('不能唯一匹配');
});
it('rejects declared asset identities with no portable mapping', async () => {
  await expect(
    prepareLegacyDesignSchemeImportContent(
      await prepareLegacyCase({ missingIdentity: true }),
      mappedId,
      inspectImage,
    ),
  ).rejects.toThrow('无法映射');
});
it('propagates host image decoding failures before producing import content', async () => {
  await expect(
    prepareLegacyDesignSchemeImportContent(await prepareLegacyCase(), mappedId, () => {
      throw new Error('decoder-rejected');
    }),
  ).rejects.toThrow('decoder-rejected');
});
