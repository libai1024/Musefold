import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { collectImageDiskUsage } from '../disk-usage';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('collectImageDiskUsage', () => {
  it('counts image files recursively and ignores non-images', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'musefold-disk-usage-'));
    await mkdir(join(tempDir, 'nested'));
    await writeFile(join(tempDir, 'a.png'), Buffer.alloc(7));
    await writeFile(join(tempDir, 'nested', 'b.webp'), Buffer.alloc(11));
    await writeFile(join(tempDir, 'notes.txt'), Buffer.alloc(100));

    await expect(collectImageDiskUsage(tempDir)).resolves.toEqual({
      dir: tempDir,
      imagesCount: 2,
      imagesBytes: 18,
    });
  });

  it('creates a missing directory and reports zero usage', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'musefold-disk-usage-'));
    const missing = join(tempDir, 'missing');

    await expect(collectImageDiskUsage(missing)).resolves.toEqual({
      dir: missing,
      imagesCount: 0,
      imagesBytes: 0,
    });
  });
});
