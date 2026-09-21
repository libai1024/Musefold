import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '../../db';
import { closeDesignSchemeDb } from '../../db/design-scheme';
import { MAX_LOCAL_IMAGE_BYTES, stageLocalImage } from '../../providers/local-image';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import { createLocalUploadOwner, type LocalUploadOwner } from '../../services/local-upload-owner';
import { drainLocalAssetCleanup } from '../../services/local-asset-cleanup';
const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
let root: string, source: string, filesystem: ManagedFilesystem, owner: LocalUploadOwner;
const queue = () => getDb().prepare('SELECT * FROM local_asset_cleanup').all();
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'musefold-copy-candidate-')));
  source = join(root, 'source.png');
  fs.writeFileSync(source, png);
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  configureTestCoreRuntime(root, { managedFilesystem: () => filesystem });
  owner = createLocalUploadOwner();
});
afterEach(() => {
  vi.restoreAllMocks();
  owner.close();
  closeDesignSchemeDb();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
it('copies real bytes under an owner and releases only its unreferenced duplicate', async () => {
  const image = await stageLocalImage(source, owner);
  expect(fs.readFileSync(image.path)).toEqual(png);
  expect(image.sizeBytes).toBe(png.length);
  const due = (queue()[0] as { next_attempt_at: number }).next_attempt_at;
  expect(drainLocalAssetCleanup(due)).toMatchObject({ protected: 1, deleted: 0 });
  owner.close();
  expect(fs.existsSync(image.path)).toBe(false);
  expect(fs.readFileSync(source)).toEqual(png);
  expect(queue()).toEqual([]);
});
it('refuses an outside source even when its bytes are a valid image', async () => {
  const outside = fs.mkdtempSync(join(tmpdir(), 'musefold-outside-copy-'));
  try {
    const path = join(outside, 'original.png');
    fs.writeFileSync(path, png);
    await expect(stageLocalImage(path, owner)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
    expect(fs.readFileSync(path)).toEqual(png);
    expect(queue()).toEqual([]);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
it('rejects both a linked leaf and a linked ancestor', async () => {
  const link = join(root, 'link.png');
  fs.symlinkSync(source, link);
  await expect(stageLocalImage(link, owner)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
  fs.mkdirSync(join(root, 'originals'));
  fs.writeFileSync(join(root, 'originals', 'a.png'), png);
  fs.symlinkSync(join(root, 'originals'), join(root, 'alias'), 'junction');
  await expect(stageLocalImage(join(root, 'alias', 'a.png'), owner)).rejects.toMatchObject({
    code: 'IMAGE_READ_FAILED',
  });
  expect(queue()).toEqual([]);
  expect(fs.readFileSync(source)).toEqual(png);
});
it('rejects an actual oversized file before any destination intent or file', async () => {
  fs.truncateSync(source, MAX_LOCAL_IMAGE_BYTES + 1);
  await expect(stageLocalImage(source, owner)).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
  expect(queue()).toEqual([]);
  expect(fs.existsSync(join(testCorePaths(root).previews, 'uploads'))).toBe(false);
});
it.skipIf(process.platform === 'win32')(
  'rejects an actual FIFO without waiting for a writer',
  async () => {
    const fifo = join(root, 'fifo');
    const child = spawnSync('mkfifo', [fifo], { timeout: 5000 });
    expect(child.status).toBe(0);
    const start = Date.now();
    await expect(stageLocalImage(fifo, owner)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
    expect(Date.now() - start).toBeLessThan(3000);
    expect(queue()).toEqual([]);
  },
);
it('refuses a directory source', async () => {
  await expect(stageLocalImage(root, owner)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
  expect(queue()).toEqual([]);
});
it('rejects owner closure during the first real async source read without publishing a copy', async () => {
  fs.truncateSync(source, 8 * 1024 * 1024);
  vi.spyOn(filesystem, 'openFile').mockImplementationOnce((directory, name, mode) => {
    const fd = native.openFile(directory, name, mode);
    queueMicrotask(() => owner.close());
    return fd;
  });
  await expect(stageLocalImage(source, owner)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
  expect(fs.statSync(source).size).toBe(8 * 1024 * 1024);
  expect(queue()).toEqual([]);
});
it('rejects a source growing after inspection instead of exceeding its approved byte limit', async () => {
  fs.truncateSync(source, 8 * 1024 * 1024);
  vi.spyOn(filesystem, 'openFile').mockImplementationOnce((directory, name, mode) => {
    const fd = native.openFile(directory, name, mode);
    queueMicrotask(() => fs.truncateSync(source, MAX_LOCAL_IMAGE_BYTES + 1));
    return fd;
  });
  await expect(stageLocalImage(source, owner)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
  expect(queue()).toEqual([]);
});
it('refuses an independently replaced source directory without reading the outside target into an upload', async () => {
  const parent = join(root, 'source-directory'),
    detached = join(root, 'detached'),
    outside = join(root, 'outside');
  fs.mkdirSync(parent);
  fs.mkdirSync(outside);
  const path = join(parent, 'a.png');
  fs.writeFileSync(path, png);
  fs.writeFileSync(join(outside, 'a.png'), 'outside original');
  vi.spyOn(filesystem, 'openFile').mockImplementationOnce((directory, name, mode) => {
    const fd = native.openFile(directory, name, mode);
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "const fs=require('node:fs');fs.renameSync(process.argv[1],process.argv[2]);fs.symlinkSync(process.argv[3],process.argv[1],'junction');",
        parent,
        detached,
        outside,
      ],
      { timeout: 5000 },
    );
    expect(child.status).toBe(0);
    return fd;
  });
  await expect(stageLocalImage(path, owner)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
  expect(queue()).toEqual([]);
  expect(fs.readFileSync(join(outside, 'a.png'), 'utf8')).toBe('outside original');
  expect(fs.readFileSync(join(detached, 'a.png'))).toEqual(png);
});
