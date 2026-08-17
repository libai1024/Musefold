import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LOCAL_IMAGE_BYTES, readLocalImage, stageLocalImageBytes } from '../local-image';
import { configureTestCoreRuntime } from '../../testing';

const electronPaths = { root: `/tmp/musefold-local-image-${process.pid}` };

configureTestCoreRuntime(electronPaths.root);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const result = await stageLocalImageBytes({ bytes, name: 'pasted.png', mimeType: 'image/png' });

    expect(result).toMatchObject({ source: 'upload', name: 'pasted.png', mimeType: 'image/png', sizeBytes: 12 });
    expect(await readFile(result.path)).toEqual(Buffer.from(bytes));
  });

  it('accepts PNG signatures and reports the actual file metadata', async () => {
    const path = await fixtureFile('reference.png', Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
    ]));

    const result = await readLocalImage({ source: 'upload', path, name: 'chosen.png' });

    expect(result.image).toMatchObject({ mimeType: 'image/png', sizeBytes: 12, name: 'chosen.png' });
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
        0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50,
      ]),
      mimeType: 'image/webp',
    },
  ])('accepts $mimeType signatures', async ({ name, bytes, mimeType }) => {
    const path = await fixtureFile(name, bytes);
    const result = await readLocalImage({ source: 'upload', path, name });
    expect(result.image).toMatchObject({ mimeType, sizeBytes: bytes.length, name });
  });

  it('rejects unsupported content and files over 20 MiB', async () => {
    const textPath = await fixtureFile('not-an-image.txt', Uint8Array.from([0x74, 0x65, 0x78, 0x74]));
    await expect(readLocalImage({ source: 'upload', path: textPath })).rejects.toMatchObject({
      code: 'IMAGE_TYPE_UNSUPPORTED',
    });

    const largePath = await fixtureFile('large.png', Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]));
    const { truncate } = await import('fs/promises');
    await truncate(largePath, MAX_LOCAL_IMAGE_BYTES + 1);
    await expect(readLocalImage({ source: 'upload', path: largePath })).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    });
  });
});
