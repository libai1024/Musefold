import { expect, it, vi } from 'vitest';
import { readValidatedDesignSchemePackageBytes } from '@musefold/scheme-package';
import { buildExportBytes } from '../export-content.js';
import { importFixture, FULL_PROMPT } from './import-fixture.js';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value');
  return value;
}

async function frozenHistory() {
  const archive = await readValidatedDesignSchemePackageBytes(
    await (await importFixture()).encode(),
  );
  if (archive.formatVersion !== 2) throw new Error('Expected v2 fixture');
  const manifest = archive.manifest;
  const objects = new Map<string, Buffer>();
  const assets = manifest.assets.map((metadata) => {
    const entry = manifest.content.entries.find((item) => item.assetId === metadata.id);
    if (!entry) throw new Error('Missing fixture asset');
    const objectKey = `managed/${metadata.id}`;
    objects.set(objectKey, Buffer.from(required(archive.entries.get(entry.relativePath))));
    return { metadata, objectKey };
  });
  const files = manifest.sourceSnapshots.flatMap((snapshot) =>
    snapshot.files.map((file) => {
      const entry = manifest.content.entries.find(
        (item) =>
          item.kind === 'source-file' &&
          item.sourceId === snapshot.id &&
          item.relativePath.endsWith(`/${file.relativePath}`),
      );
      if (!entry) throw new Error('Missing fixture source');
      const objectKey = snapshot.kind === 'history' ? null : `source/${entry.relativePath}`;
      if (objectKey)
        objects.set(objectKey, Buffer.from(required(archive.entries.get(entry.relativePath))));
      return {
        ...file,
        snapshotId: snapshot.id,
        objectKey,
        textExcerpt: null,
        userId: 'owner',
        id: 'file',
        createdAt: new Date(0),
      };
    }),
  );
  const basis = {
    document: manifest.document,
    sourceSnapshots: manifest.sourceSnapshots,
    files,
    assets,
    trialId: 'trial',
    version: 1,
    hash: 'basis',
  };
  const storage = {
    read: vi.fn(async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error('Unavailable frozen content');
      return bytes;
    }),
    put: vi.fn(),
  };
  return { basis, storage, objects };
}
it('exports frozen history image and full prompt when source-file rows have no second object', async () => {
  const f = await frozenHistory();
  const bytes = await buildExportBytes('export', f.basis, f.storage, async () => {});
  const result = await readValidatedDesignSchemePackageBytes(bytes);
  if (result.formatVersion !== 2) throw new Error('Expected v2');
  const snapshot = required(
    result.manifest.sourceSnapshots.find((item) => item.kind === 'history'),
  );
  const item = required(snapshot.historyItems?.[0]);
  expect(item.prompt).toBe(FULL_PROMPT);
  expect(result.entries.get(`sources/${snapshot.id}/${item.promptPath}`)?.toString()).toBe(
    FULL_PROMPT,
  );
  expect(result.entries.get(`sources/${snapshot.id}/${item.imagePath}`)).toEqual(
    f.objects.get(`managed/${item.imageAssetId}`),
  );
  expect(f.storage.put).not.toHaveBeenCalled();
});
it.each(['image', 'prompt'] as const)(
  'rejects altered frozen %s bytes instead of exporting inconsistent history',
  async (kind) => {
    const f = await frozenHistory();
    const item = required(
      f.basis.sourceSnapshots.find((snapshot) => snapshot.kind === 'history')?.historyItems?.[0],
    );
    if (kind === 'image') f.objects.set(`managed/${item.imageAssetId}`, Buffer.from('changed'));
    else item.prompt = 'changed';
    await expect(buildExportBytes('export', f.basis, f.storage, async () => {})).rejects.toThrow(
      '重新核对后导出',
    );
    expect(f.storage.put).not.toHaveBeenCalled();
  },
);
