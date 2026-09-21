import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import archiver from 'archiver';
import { afterEach, describe, expect, it } from 'vitest';
import { isSafePackagePath, readValidatedDesignSchemePackage } from '../package-archive';

const tempRoots: string[] = [];

function tempFile(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'musefold-package-archive-'));
  tempRoots.push(root);
  return join(root, name);
}

async function writeZip(
  path: string,
  entries: Array<{ name: string; content: string | Buffer }>,
  store = false,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(path);
    const archive = archiver('zip', { store, zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const entry of entries) archive.append(entry.content, { name: entry.name });
    void archive.finalize();
  });
}

async function writeUnsafePathZip(path: string, unsafeName: string): Promise<void> {
  const safeName = 'x'.repeat(Buffer.byteLength(unsafeName));
  await writeZip(path, [{ name: safeName, content: '{}' }]);
  const archive = readFileSync(path);
  const safeBytes = Buffer.from(safeName);
  const unsafeBytes = Buffer.from(unsafeName);
  let replacements = 0;
  for (
    let offset = archive.indexOf(safeBytes);
    offset >= 0;
    offset = archive.indexOf(safeBytes, offset + 1)
  ) {
    unsafeBytes.copy(archive, offset);
    replacements += 1;
  }
  if (replacements !== 2) throw new Error('unexpected ZIP fixture layout');
  writeFileSync(path, archive);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Design Scheme package archive limits', () => {
  it('rejects traversal and backslash paths before accepting a package', async () => {
    for (const name of ['../manifest.json', 'nested/../../manifest.json']) {
      const packagePath = tempFile('unsafe.musefold.design');
      await writeUnsafePathZip(packagePath, name);
      await expect(readValidatedDesignSchemePackage(packagePath)).rejects.toThrow(
        /不安全路径|invalid relative path/,
      );
    }

    const backslashPath = 'nested\\manifest.json';
    expect(isSafePackagePath(backslashPath)).toBe(false);
    const packagePath = tempFile('backslash.musefold.design');
    await writeUnsafePathZip(packagePath, backslashPath);
    await expect(readValidatedDesignSchemePackage(packagePath)).rejects.toThrow();
  });

  it('rejects duplicate file entries', async () => {
    const packagePath = tempFile('duplicate.musefold.design');
    await writeZip(packagePath, [
      { name: 'manifest.json', content: '{}' },
      { name: 'manifest.json', content: '{}' },
    ]);
    await expect(readValidatedDesignSchemePackage(packagePath)).rejects.toThrow('重复条目');
  });

  it('rejects a highly compressed entry before allocating its decompressed body', async () => {
    const packagePath = tempFile('compressed.musefold.design');
    await writeZip(packagePath, [
      { name: 'manifest.json', content: Buffer.alloc(2 * 1024 * 1024, 0x20) },
    ]);
    await expect(readValidatedDesignSchemePackage(packagePath)).rejects.toThrow('压缩比异常');
  });

  it('rejects more than 1024 file entries', async () => {
    const packagePath = tempFile('many.musefold.design');
    const entries = Array.from({ length: 1_025 }, (_, index) => ({
      name: index === 0 ? 'manifest.json' : `entries/${index}.txt`,
      content: '{}',
    }));
    // Entry-count validation does not need 1025 separate compression jobs in the shared pool.
    await writeZip(packagePath, entries, true);
    await expect(readValidatedDesignSchemePackage(packagePath)).rejects.toThrow('条目超过上限');
  });
});
