import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectImageFile, saveImageFile, saveImageFiles } from '../image-actions';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('image actions', () => {
  it('copies image bytes to paths containing spaces and Chinese characters', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'musefold-image-actions-'));
    const source = join(tempDir, 'source image.png');
    const target = join(tempDir, '另存 图片.png');
    await writeFile(source, Buffer.from('musefold-image'));

    await expect(saveImageFile(source, target)).resolves.toBe(target);
    await expect(readFile(target, 'utf8')).resolves.toBe('musefold-image');
  });

  it('rejects missing files and unsupported extensions', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'musefold-image-actions-'));
    const textFile = join(tempDir, 'notes.txt');
    await writeFile(textFile, 'not an image');

    await expect(inspectImageFile(join(tempDir, 'missing.png'))).rejects.toThrow('图片不存在');
    await expect(inspectImageFile(textFile)).rejects.toThrow('不支持的图片格式');
  });

  it('treats saving to the source path as a no-op', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'musefold-image-actions-'));
    const source = join(tempDir, 'same.webp');
    await writeFile(source, Buffer.from('same-image'));

    await expect(saveImageFile(source, source)).resolves.toBe(source);
    await expect(readFile(source, 'utf8')).resolves.toBe('same-image');
  });

  it('saves a selected image batch without overwriting existing names', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'musefold-image-actions-'));
    const sourceDir = join(tempDir, 'sources');
    const targetDir = join(tempDir, 'downloads');
    await Promise.all([mkdir(sourceDir), mkdir(targetDir)]);
    const first = join(sourceDir, 'result.png');
    const second = join(sourceDir, 'second.webp');
    await writeFile(first, Buffer.from('first'));
    await writeFile(second, Buffer.from('second'));
    await writeFile(join(targetDir, 'result.png'), Buffer.from('existing'));

    const saved = await saveImageFiles([first, second], targetDir);

    expect(saved).toEqual([join(targetDir, 'result (2).png'), join(targetDir, 'second.webp')]);
    await expect(readFile(saved[0], 'utf8')).resolves.toBe('first');
    await expect(readFile(join(targetDir, 'result.png'), 'utf8')).resolves.toBe('existing');
  });
});
