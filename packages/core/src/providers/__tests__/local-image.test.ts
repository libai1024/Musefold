import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import * as nativeFs from 'node:fs';
import { vi } from 'vitest';
const readProbe = vi.hoisted(() => ({
  path: '',
  closeFailure: false,
  beforeOpen: undefined as (() => void | Promise<void>) | undefined,
  afterRead: undefined as (() => void | Promise<void>) | undefined,
  opened: 0,
  closed: 0,
  requested: [] as number[],
  unboundedReturned: 0,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const observed = String(args[0]) === readProbe.path;
      if (observed && readProbe.beforeOpen) {
        const mutate = readProbe.beforeOpen;
        readProbe.beforeOpen = undefined;
        await mutate();
      }
      const handle = await actual.open(...args);
      if (!observed) return handle;
      readProbe.opened += 1;
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'read')
            return async (...args: unknown[]) => {
              readProbe.requested.push(typeof args[2] === 'number' ? args[2] : 0);
              const result = await Reflect.apply(target.read, target, args);
              if (readProbe.afterRead) {
                const mutate = readProbe.afterRead;
                readProbe.afterRead = undefined;
                await mutate();
              }
              return result;
            };
          if (key === 'close')
            return async () => {
              await target.close();
              readProbe.closed += 1;
              if (readProbe.closeFailure) throw new Error('controlled close failure');
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const result = await actual.readFile(...args);
      if (String(args[0]) === readProbe.path) readProbe.unboundedReturned += result.length;
      return result;
    },
  };
});
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { loadManagedFilesystem } from '@musefold/managed-fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LOCAL_IMAGE_BYTES, readLocalImage, stageLocalImageBytes } from '../local-image';
import { configureTestCoreRuntime } from '../../testing';
import { closeDb } from '../../db';
import { closeDesignSchemeDb } from '../../db/design-scheme';
import { createLocalUploadOwner } from '../../services/local-upload-owner';

const electronPaths = { root: `/tmp/musefold-local-image-${process.pid}` };

configureTestCoreRuntime(electronPaths.root, {
  managedFilesystem: () =>
    loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node')),
});

const tempDirs: string[] = [];

afterEach(async () => {
  closeDesignSchemeDb();
  closeDb();
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
  await rm(electronPaths.root, { recursive: true, force: true });
});

async function fixtureFile(name: string, bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'musefold-image-'));
  tempDirs.push(directory);
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

describe('local image validation', () => {
  it('stages clipboard bytes into the managed uploads directory', async () => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ]);
    const owner = createLocalUploadOwner();
    const result = await stageLocalImageBytes(
      { bytes, name: 'pasted.png', mimeType: 'image/png' },
      owner,
    );

    expect(result).toMatchObject({
      source: 'upload',
      name: 'pasted.png',
      mimeType: 'image/png',
      sizeBytes: 12,
    });
    expect(await readFile(result.path)).toEqual(Buffer.from(bytes));
    owner.close();
  });

  it('accepts PNG signatures and reports the actual file metadata', async () => {
    const path = await fixtureFile(
      'reference.png',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]),
    );

    const result = await readLocalImage({ source: 'upload', path, name: 'chosen.png' });

    expect(result.image).toMatchObject({
      mimeType: 'image/png',
      sizeBytes: 12,
      name: 'chosen.png',
    });
    expect(await readFile(path)).toEqual(result.bytes);
  });

  it.each([
    {
      name: 'reference.jpg',
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      mimeType: 'image/jpeg',
    },
    {
      name: 'reference.webp',
      bytes: Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]),
      mimeType: 'image/webp',
    },
  ])('accepts $mimeType signatures', async ({ name, bytes, mimeType }) => {
    const path = await fixtureFile(name, bytes);
    const result = await readLocalImage({ source: 'upload', path, name });
    expect(result.image).toMatchObject({ mimeType, sizeBytes: bytes.length, name });
  });

  it('rejects unsupported content and files over 20 MiB', async () => {
    const textPath = await fixtureFile(
      'not-an-image.txt',
      Uint8Array.from([0x74, 0x65, 0x78, 0x74]),
    );
    await expect(readLocalImage({ source: 'upload', path: textPath })).rejects.toMatchObject({
      code: 'IMAGE_TYPE_UNSUPPORTED',
    });

    const largePath = await fixtureFile(
      'large.png',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const { truncate } = await import('fs/promises');
    await truncate(largePath, MAX_LOCAL_IMAGE_BYTES + 1);
    await expect(readLocalImage({ source: 'upload', path: largePath })).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    });
  });
});

describe('bounded reference read', () => {
  async function readReceipt(reference: Parameters<typeof readLocalImage>[0]) {
    const result = await readLocalImage(reference);
    return { size: result.bytes.length, mimeType: result.image.mimeType };
  }
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  async function observedFile(size = png.length) {
    const path = nativeFs.realpathSync(await fixtureFile('selected.png', png));
    nativeFs.truncateSync(path, size);
    Object.assign(readProbe, {
      path,
      closeFailure: false,
      beforeOpen: undefined,
      afterRead: undefined,
      opened: 0,
      closed: 0,
      requested: [],
      unboundedReturned: 0,
    });
    return path;
  }
  afterEach(() => {
    Object.assign(readProbe, {
      path: '',
      closeFailure: false,
      beforeOpen: undefined,
      afterRead: undefined,
    });
  });
  it('refuses replacement between inspection and opening before reading the replacement bytes', async () => {
    const path = await observedFile();
    readProbe.beforeOpen = () => {
      nativeFs.renameSync(path, `${path}.original`);
      nativeFs.writeFileSync(path, png);
    };
    await expect(readReceipt({ source: 'upload', path })).rejects.toMatchObject({
      code: 'IMAGE_READ_FAILED',
    });
    expect(readProbe.requested).toEqual([]);
    expect(readProbe.closed).toBe(readProbe.opened);
    expect(nativeFs.readFileSync(`${path}.original`)).toEqual(png);
  });
  it('refuses growth during reading and never reads more than the initially bounded allocation', async () => {
    const originalSize = 8 * 1024 * 1024;
    const path = await observedFile(originalSize);
    readProbe.afterRead = () => nativeFs.truncateSync(path, MAX_LOCAL_IMAGE_BYTES + 1);
    await expect(readReceipt({ source: 'upload', path })).rejects.toMatchObject({
      code: 'IMAGE_READ_FAILED',
    });
    expect(readProbe.requested.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThanOrEqual(
      originalSize + 1,
    );
    expect(readProbe.unboundedReturned).toBe(0);
    expect(readProbe.closed).toBe(readProbe.opened);
  });
  it('refuses same-inode content mutation after the first chunk', async () => {
    const path = await observedFile(8 * 1024 * 1024);
    readProbe.afterRead = () => {
      const fd = nativeFs.openSync(path, 'r+');
      try {
        nativeFs.writeSync(fd, Buffer.from('changed payload'), 0, 15, 4 * 1024 * 1024);
        // Ensure an observable timestamp change without depending on clock tick precision.
        nativeFs.futimesSync(fd, new Date('2020-01-01'), new Date('2020-01-01'));
      } finally {
        nativeFs.closeSync(fd);
      }
    };
    await expect(readReceipt({ source: 'history', path })).rejects.toMatchObject({
      code: 'IMAGE_READ_FAILED',
    });
    expect(readProbe.closed).toBe(readProbe.opened);
  });
  it('refuses an atomic leaf replacement after reading from the original descriptor', async () => {
    const path = await observedFile();
    readProbe.afterRead = () => {
      nativeFs.renameSync(path, `${path}.original`);
      nativeFs.writeFileSync(path, Buffer.concat([png, Buffer.from('replacement')]));
    };
    await expect(readReceipt({ source: 'history', path })).rejects.toMatchObject({
      code: 'IMAGE_READ_FAILED',
    });
    expect(nativeFs.readFileSync(`${path}.original`)).toEqual(png);
    expect(readProbe.closed).toBe(readProbe.opened);
  });
  it('refuses a namespace redirect after the first read without returning outside bytes', async () => {
    const path = await observedFile();
    const directory = dirname(path);
    const outside = await fixtureFile('selected.png', Buffer.concat([png, Buffer.from('outside')]));
    const outsideDirectory = dirname(nativeFs.realpathSync(outside));
    const detached = `${directory}.detached`;
    tempDirs.push(detached);
    readProbe.afterRead = () => {
      nativeFs.renameSync(directory, detached);
      nativeFs.symlinkSync(outsideDirectory, directory, 'junction');
    };
    await expect(readReceipt({ source: 'upload', path })).rejects.toMatchObject({
      code: 'IMAGE_READ_FAILED',
    });
    expect(nativeFs.readFileSync(join(detached, 'selected.png'))).toEqual(png);
    expect(nativeFs.readFileSync(outside)).toEqual(Buffer.concat([png, Buffer.from('outside')]));
    expect(readProbe.closed).toBe(readProbe.opened);
  });
  it('refuses a file unlinked during reading and closes its descriptor', async () => {
    const path = await observedFile();
    readProbe.afterRead = () => nativeFs.unlinkSync(path);
    await expect(readReceipt({ source: 'history', path })).rejects.toMatchObject({
      code: 'IMAGE_READ_FAILED',
    });
    expect(readProbe.closed).toBe(readProbe.opened);
  });
  it('preserves system-selected external files and stable aliases', async () => {
    const path = await observedFile();
    const aliasDirectory = `${dirname(path)}.alias`;
    tempDirs.push(aliasDirectory);
    nativeFs.symlinkSync(dirname(path), aliasDirectory, 'junction');
    const alias = join(aliasDirectory, 'selected.png');
    const image = await readLocalImage({ source: 'upload', path: alias, name: 'chosen.png' });
    expect(image.bytes).toEqual(png);
    expect(image.image).toMatchObject({
      path: alias,
      name: 'chosen.png',
      mimeType: 'image/png',
      sizeBytes: png.length,
    });
  });
  it('accepts exactly 20 MiB with one descriptor and a bounded end-of-file probe', async () => {
    const path = await observedFile(MAX_LOCAL_IMAGE_BYTES);
    const image = await readLocalImage({ source: 'upload', path });
    expect(image.bytes.length).toBe(MAX_LOCAL_IMAGE_BYTES);
    expect(image.image.sizeBytes).toBe(image.bytes.length);
    expect(image.bytes.subarray(0, png.length)).toEqual(png);
    expect(readProbe.opened).toBe(1);
    expect(readProbe.closed).toBe(1);
    expect(readProbe.unboundedReturned).toBe(0);
    expect(readProbe.requested.reduce((sum, bytes) => sum + bytes, 0)).toBe(
      MAX_LOCAL_IMAGE_BYTES + 1,
    );
  });
  it('closes its descriptor and normalizes a read error without returning selected bytes', async () => {
    const path = await observedFile();
    readProbe.afterRead = () => {
      throw new Error('controlled read failure');
    };
    await expect(readReceipt({ source: 'upload', path })).rejects.toMatchObject({
      code: 'IMAGE_READ_FAILED',
      message: '图片读取失败，请重新选择',
    });
    expect(readProbe.opened).toBe(1);
    expect(readProbe.closed).toBe(1);
  });
  it('does not return bytes when closing the read descriptor fails', async () => {
    const path = await observedFile();
    readProbe.closeFailure = true;
    await expect(readReceipt({ source: 'upload', path })).rejects.toMatchObject({
      code: 'IMAGE_READ_FAILED',
      message: '图片读取失败，请重新选择',
    });
    expect(readProbe.closed).toBe(1);
  });
  it.skipIf(process.platform === 'win32')(
    'returns promptly when a regular file becomes an actual FIFO before open',
    async () => {
      const path = await observedFile();
      readProbe.beforeOpen = () => {
        nativeFs.unlinkSync(path);
        const child = spawnSync('mkfifo', [path], { timeout: 5000 });
        expect(child.status).toBe(0);
      };
      const started = Date.now();
      await expect(readReceipt({ source: 'upload', path })).rejects.toMatchObject({
        code: 'IMAGE_READ_FAILED',
      });
      expect(Date.now() - started).toBeLessThan(3000);
      expect(readProbe.requested).toEqual([]);
      expect(readProbe.closed).toBe(1);
    },
  );
  it.each([false, true])(
    'real image-edit provider sends only a stable selected image (mutated: %s)',
    async (mutated) => {
      const path = await observedFile();
      const incoming: Buffer[] = [];
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        incoming.push(Buffer.concat(chunks));
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'test endpoint rejects generation' } }));
      });
      try {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No local test port');
        configureTestCoreRuntime(electronPaths.root, {
          managedFilesystem: () =>
            loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node')),
          loadApiKey: () => 'local-image-read-test',
        });
        const { OpenAICompatibleProvider } = await import('../openai-compatible');
        const { withLocalAssetWriteScope } = await import('../../services/local-asset-writes');
        const provider = new OpenAICompatibleProvider(
          'reference-test',
          `http://127.0.0.1:${address.port}/v1`,
          'test-image-model',
          'Local test',
        );
        if (mutated)
          readProbe.afterRead = () => {
            nativeFs.renameSync(path, `${path}.original`);
            nativeFs.writeFileSync(path, Buffer.concat([png, Buffer.from('replacement')]));
          };
        const outcome = await withLocalAssetWriteScope(() =>
          provider.generateImage({
            jobId: 'read-boundary-test',
            providerId: 'reference-test',
            prompt: 'local reference test',
            size: 'auto',
            quality: 'auto',
            n: 1,
            referenceImages: [{ source: 'upload', path, name: 'chosen.png' }],
          }),
        ).then(
          () => ({ code: 'unexpected-success' }),
          (error: { code?: string }) => ({ code: error.code }),
        );
        expect(outcome.code).toBe(mutated ? 'IMAGE_READ_FAILED' : 'BAD_REQUEST');
        expect(incoming).toHaveLength(mutated ? 0 : 1);
        if (!mutated) {
          expect(incoming[0]?.includes(png)).toBe(true);
          expect(incoming[0]?.includes(Buffer.from('filename="chosen.png"'))).toBe(true);
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
