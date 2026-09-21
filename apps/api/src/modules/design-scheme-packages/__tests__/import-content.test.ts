import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { sha256 } from '@musefold/scheme-package';
import { preparePackageImportContent } from '../import-content.js';
import {
  FULL_PROMPT,
  IMPORT_IDENTITY,
  importFixture,
  legacyImportFixture,
} from './import-fixture.js';

it('rebuilds a v2 mixed package with fresh entities and complete history/repository content', async () => {
  const fixture = await importFixture();
  const before = structuredClone(fixture.manifest);
  const result = await preparePackageImportContent(await fixture.encode(), IMPORT_IDENTITY);
  expect(fixture.manifest.document).toEqual(before.document);
  expect(result.document).toMatchObject({
    parentRevisionId: null,
    createdBy: 'import',
    createdAt: IMPORT_IDENTITY.createdAt,
  });
  expect(result.document.schemeId).not.toBe(before.schemeId);
  expect(result.document.revisionId).not.toBe(before.revisionId);
  expect(result.document.compilation).toEqual(before.document.compilation);
  expect(result.document.promptProgram).toEqual(before.document.promptProgram);
  expect(result.document.sources[0]).toMatchObject({
    id: 'repo-source',
    kind: 'github-skill',
    role: 'normative',
    license: 'MIT',
  });
  const repo = result.sourceSnapshots.find((item) => item.kind === 'github');
  const history = result.sourceSnapshots.find((item) => item.kind === 'history');
  expect(repo?.id).not.toBe('repo-snap');
  expect(history?.packageId).not.toBe('history-package');
  expect(result.document.repositoryImages?.[0]).toMatchObject({
    snapshotId: repo?.id,
    assetId: result.assets[0].metadata.id,
    imageRole: 'style-reference',
  });
  expect(history?.historyItems?.[0]).toMatchObject({
    imageAssetId: result.assets[1].metadata.id,
    prompt: FULL_PROMPT,
    selection: { runId: 'external-run', assetId: 'external-history', includePrompt: true },
  });
  expect(
    result.files.find((item) => item.metadata.relativePath === 'prompt.txt')?.bytes.toString(),
  ).toBe(FULL_PROMPT);
  expect(FULL_PROMPT.length).toBeGreaterThan(2000);
  expect(result.assets[2].metadata.role).toBe('example');
  expect(result.assets.map((item) => item.metadata.role)).not.toContain('cover');
  expect(result.assets.every((item) => item.bytes.equals(fixture.png))).toBe(true);
  expect(result.sourcePresentation).toBe('skill');
  expect(result.provenance).toMatchObject({
    schemeId: before.schemeId,
    revisionId: before.revisionId,
    formatVersion: 2,
  });
  expect(result).not.toHaveProperty('status');
  expect(result).not.toHaveProperty('hasSuccessfulTrial');
});

it('reproduces the same identities across retries and a real fresh Node PID, while a new seed stays isolated', async () => {
  const bytes = await (await importFixture()).encode();
  const plan = await preparePackageImportContent(bytes, IMPORT_IDENTITY);
  expect(await preparePackageImportContent(bytes, IMPORT_IDENTITY)).toEqual(plan);
  const other = await preparePackageImportContent(bytes, {
    ...IMPORT_IDENTITY,
    seed: randomUUID(),
  });
  const allIds = (value: typeof plan) => [
    value.document.schemeId,
    value.document.revisionId,
    ...value.sourcePackages.map((item) => item.id),
    ...value.sourceSnapshots.map((item) => item.id),
    ...value.assets.map((item) => item.metadata.id),
  ];
  expect(allIds(other).some((id) => allIds(plan).includes(id))).toBe(false);
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { preparePackageImportContent } from './src/modules/design-scheme-packages/import-content.ts';
    const input=[];for await(const part of process.stdin) input.push(part);
    const plan=await preparePackageImportContent(Buffer.concat(input),${JSON.stringify(IMPORT_IDENTITY)});
    process.stdout.write(JSON.stringify({pid:process.pid,plan}));
  `,
    ],
    { input: bytes, encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
  );
  expect(child.status, child.stderr).toBe(0);
  const reply = JSON.parse(child.stdout);
  expect(reply.pid).not.toBe(process.pid);
  expect(reply.plan).toEqual(JSON.parse(JSON.stringify(plan)));
});

it.each(['cover', 'output'] as const)(
  'does not carry %s eligibility into a new revision',
  async (role) => {
    const fixture = await importFixture();
    fixture.manifest.assets[2].role = role;
    const plan = await preparePackageImportContent(await fixture.encode(), IMPORT_IDENTITY);
    expect(plan.assets[2].metadata).toMatchObject({ role: 'example', origin: 'cloud-run' });
  },
);

it('rejects a valid archive whose declared image dimensions are false', async () => {
  const fixture = await importFixture();
  fixture.manifest.assets[2].width = 100;
  const bytes = await fixture.encode();
  await expect(preparePackageImportContent(bytes, IMPORT_IDENTITY)).rejects.toThrow('像素');
});

it('fully decodes pixels, rejecting truncated PNG content even with internally correct hashes and signatures', async () => {
  const fixture = await importFixture();
  const broken = fixture.png.subarray(0, 33);
  fixture.content.set('assets/cover-asset.png', broken);
  fixture.manifest.assets[2].contentHash = sha256(broken);
  fixture.manifest.assets[2].byteSize = broken.length;
  const bytes = await fixture.encode();
  await expect(preparePackageImportContent(bytes, IMPORT_IDENTITY)).rejects.toThrow();
});

it('rejects dangling compilation source references even when the ZIP graph is otherwise valid', async () => {
  const fixture = await importFixture();
  fixture.manifest.document.promptProgram[0].sourceIds = ['external-source'];
  const bytes = await fixture.encode();
  await expect(preparePackageImportContent(bytes, IMPORT_IDENTITY)).rejects.toThrow('未知来源');
});

it('preserves a v1 full body, actual source image and preview without trusting scan or legacy commit claims', async () => {
  const fixture = await legacyImportFixture();
  const plan = await preparePackageImportContent(await fixture.encode(), IMPORT_IDENTITY);
  expect(plan.files.find((file) => file.metadata.kind === 'text')?.bytes.toString()).toBe(
    FULL_PROMPT,
  );
  expect(plan.assets).toHaveLength(2);
  expect(plan.assets[0].metadata).toMatchObject({
    origin: 'repository',
    role: 'reference',
    width: 2,
    height: 3,
    license: 'MIT',
  });
  expect(plan.assets[1].metadata).toMatchObject({
    origin: 'uploaded',
    role: 'example',
    license: null,
  });
  expect(plan.document.sources[0]).toMatchObject({
    snapshotId: plan.sourceSnapshots[0].id,
    packageId: plan.sourcePackages[0].id,
    role: 'normative',
  });
  expect(plan.sourceSnapshots[0].commitHash).toBeNull();
  expect(plan.sourceSnapshots[0]).not.toHaveProperty('historyItems');
  expect(plan.sourceSnapshots[0]).not.toHaveProperty('scan');
  expect(plan.provenance.legacySnapshots[0]).toMatchObject({
    metadata: fixture.manifest.snapshots[0],
  });
  expect(plan.sourceLabel).toBe('旧方案来源');
  expect(plan.document.parentRevisionId).toBeNull();
});

it('retains old manifest-only sources with their role so a later export has a complete source graph', async () => {
  const fixture = await legacyImportFixture();
  fixture.document.sources = [];
  fixture.document.promptProgram[0].sourceIds = [];
  const plan = await preparePackageImportContent(await fixture.encode(), IMPORT_IDENTITY);
  expect(plan.document.sources).toHaveLength(1);
  expect(plan.document.sources[0]).toMatchObject({
    role: 'normative',
    snapshotId: plan.sourceSnapshots[0].id,
  });
});

it('rejects ambiguous legacy source matching instead of binding snapshots by array order', async () => {
  const fixture = await legacyImportFixture();
  fixture.manifest.snapshots.push({ ...fixture.manifest.snapshots[0], dir: 'another' });
  const bytes = await fixture.encode();
  await expect(preparePackageImportContent(bytes, IMPORT_IDENTITY)).rejects.toThrow('唯一匹配');
});

it('uses an exact legacy directory reference to disambiguate otherwise identical repository metadata', async () => {
  const fixture = await legacyImportFixture();
  fixture.manifest.snapshots.push({ ...fixture.manifest.snapshots[0], dir: 'another' });
  fixture.document.sources[0].snapshotId = 'old';
  const plan = await preparePackageImportContent(await fixture.encode(), IMPORT_IDENTITY);
  expect(plan.document.sources[0].snapshotId).toBe(plan.sourceSnapshots[0].id);
  expect(plan.document.sources).toHaveLength(2);
});

it.each(['asset', 'snapshot'] as const)(
  'rejects legacy %s references without portable content',
  async (kind) => {
    const fixture = await legacyImportFixture();
    if (kind === 'asset') fixture.document.assetIds = ['victim-asset'];
    else fixture.document.sourceSnapshotIds = ['unbound-snapshot'];
    const bytes = await fixture.encode();
    await expect(preparePackageImportContent(bytes, IMPORT_IDENTITY)).rejects.toThrow('映射');
  },
);

it('requires the private caller to supply a correctly shaped persistent seed', async () => {
  const bytes = await (await importFixture()).encode();
  await expect(
    preparePackageImportContent(bytes, { ...IMPORT_IDENTITY, seed: 'external-user' }),
  ).rejects.toThrow('随机身份');
});

it('normalizes legacy hash spellings for cloud asset/source equality without changing their content', async () => {
  const fixture = await importFixture();
  const prefixed = (hash: string) => `sha256:${hash.toUpperCase()}`;
  for (const snapshot of fixture.manifest.sourceSnapshots) {
    if (snapshot.contentHash) snapshot.contentHash = prefixed(snapshot.contentHash);
    for (const file of snapshot.files) file.contentHash = prefixed(file.contentHash);
  }
  for (const asset of fixture.manifest.assets) asset.contentHash = prefixed(asset.contentHash);
  for (const image of fixture.manifest.document.repositoryImages ?? []) {
    image.contentHash = prefixed(image.contentHash);
    image.sourceContentHash = prefixed(image.sourceContentHash);
  }
  const result = await preparePackageImportContent(await fixture.encode(), IMPORT_IDENTITY);
  const image = result.document.repositoryImages?.[0];
  expect(image?.contentHash).toBe(sha256(fixture.png));
  expect(result.sourceSnapshots[0].contentHash).toBe(image?.sourceContentHash);
  expect(result.sourceSnapshots[0].files[0].contentHash).toBe(image?.contentHash);
  expect(result.assets[0].metadata.contentHash).toBe(image?.contentHash);
  expect(result.files[0].metadata.contentHash).toBe(image?.contentHash);
});

it('freezes identity inputs before asynchronous archive decoding', async () => {
  const bytes = await (await importFixture()).encode();
  const identity = { ...IMPORT_IDENTITY };
  const pending = preparePackageImportContent(bytes, identity);
  identity.seed = randomUUID();
  identity.createdAt = '2027-01-01T00:00:00.000Z';
  expect(await pending).toEqual(await preparePackageImportContent(bytes, IMPORT_IDENTITY));
});

it.each([1, 2] as const)(
  'a prepared v%s content graph can be encoded and re-read with all byte content intact',
  async (version) => {
    const source = version === 1 ? await legacyImportFixture() : await importFixture();
    const plan = await preparePackageImportContent(await source.encode(), IMPORT_IDENTITY);
    // Codec-only synthetic formal envelope, not a server export or trial/qualification test.
    const carrier = await importFixture();
    carrier.manifest.schemeId = plan.document.schemeId;
    carrier.manifest.revisionId = plan.document.revisionId;
    carrier.manifest.document = plan.document;
    carrier.manifest.sourceSnapshots = plan.sourceSnapshots;
    carrier.manifest.assets = plan.assets.map((asset) => asset.metadata);
    carrier.content.clear();
    for (const file of plan.files)
      carrier.content.set(`sources/${file.snapshotId}/${file.metadata.relativePath}`, file.bytes);
    for (const asset of plan.assets)
      carrier.content.set(`assets/${asset.metadata.id}.png`, asset.bytes);
    const again = await preparePackageImportContent(await carrier.encode(), {
      ...IMPORT_IDENTITY,
      seed: randomUUID(),
    });
    expect(again.files.map((file) => file.bytes)).toEqual(plan.files.map((file) => file.bytes));
    expect(again.assets.map((asset) => asset.bytes)).toEqual(
      plan.assets.map((asset) => asset.bytes),
    );
    expect(again.document.compilation).toEqual(plan.document.compilation);
    expect(again.document.schemeId).not.toBe(plan.document.schemeId);
  },
);

it('maps declared v1 repository images through their actual source files', async () => {
  const fixture = await legacyImportFixture();
  const imageBytes = fixture.content.get('assets/old/style.png');
  if (!imageBytes) throw new Error('Missing fixture image');
  const hash = sha256(imageBytes);
  fixture.document.repositoryImages = [
    {
      snapshotId: 'repo-snap',
      assetId: 'repo-asset',
      relativePath: 'style.png',
      sourceContentHash: 'a'.repeat(64),
      contentHash: `sha256:${hash.toUpperCase()}`,
      imageRole: 'style-reference',
    },
  ];
  fixture.document.assetIds = ['repo-asset'];
  fixture.document.sourceSnapshotIds = ['repo-snap'];
  const plan = await preparePackageImportContent(await fixture.encode(), IMPORT_IDENTITY);
  expect(plan.document.repositoryImages?.[0]).toMatchObject({
    snapshotId: plan.sourceSnapshots[0].id,
    assetId: plan.assets[0].metadata.id,
    contentHash: hash,
    sourceContentHash: plan.sourceSnapshots[0].contentHash,
  });
});

it('rejects reusing a canonical source package ID for unrelated repository snapshots', async () => {
  const fixture = await importFixture();
  fixture.manifest.sourceSnapshots[1].packageId = 'repo-package';
  fixture.manifest.document.sources[1].packageId = 'repo-package';
  const bytes = await fixture.encode();
  await expect(preparePackageImportContent(bytes, IMPORT_IDENTITY)).rejects.toThrow('同一来源包');
});
