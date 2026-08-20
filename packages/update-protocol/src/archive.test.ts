import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { BundleArchiveError, extractBundleArchive, packBundleArchive } from './archive.ts';

const BLOCK = 512;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeTree(files: Record<string, string | Buffer>): string {
  const root = tempDir('musefold-bundle-archive-');
  for (const [relative, content] of Object.entries(files)) {
    const abs = join(root, relative);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function listTree(root: string): Map<string, Buffer | 'dir'> {
  const out = new Map<string, Buffer | 'dir'>();
  const walk = (absDir: string, relDir: string): void => {
    for (const name of readdirSync(absDir)) {
      const relative = relDir === '' ? name : `${relDir}/${name}`;
      const abs = join(absDir, name);
      const stat = lstatSync(abs);
      if (stat.isDirectory()) {
        out.set(relative, 'dir');
        walk(abs, relative);
      } else {
        out.set(relative, readFileSync(abs));
      }
    }
  };
  walk(root, '');
  return out;
}

function writeOctal(buf: Buffer, offset: number, width: number, value: number): void {
  const digits = value.toString(8).padStart(width - 1, '0');
  buf.write(digits, offset, width - 1, 'ascii');
  buf[offset + width - 1] = 0;
}

function ustarHeader(opts: {
  name: string;
  prefix?: string;
  size?: number;
  typeflag: string;
  mode?: number;
}): Buffer {
  const header = Buffer.alloc(BLOCK);
  header.write(opts.name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, opts.mode ?? 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, opts.size ?? 0);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(opts.typeflag, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'ascii');
  if (opts.prefix) header.write(opts.prefix, 345, 155, 'utf8');
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  }
  header.write(sum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function gzipTar(chunks: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(BLOCK * 2)]));
}

describe('bundle archive', () => {
  it('round-trips a nested tree including empty files', () => {
    const source = writeTree({
      'index.html': '<html>ok</html>',
      'assets/app.js': 'console.log(1)',
      'assets/empty.txt': '',
      'nested/deep/file.bin': Buffer.from([0, 1, 255, 0]),
    });
    mkdirSync(join(source, 'empty-dir'));

    const archive = packBundleArchive(source);
    const dest = tempDir('musefold-bundle-extract-');
    const stats = extractBundleArchive(archive, dest);

    expect(stats.entries).toBeGreaterThan(0);
    expect(stats.bytes).toBe(
      Buffer.byteLength('<html>ok</html>') + Buffer.byteLength('console.log(1)') + 0 + 4,
    );

    const srcTree = listTree(source);
    const destTree = listTree(dest);
    expect([...destTree.keys()].sort()).toEqual([...srcTree.keys()].sort());
    for (const [path, value] of srcTree) {
      const extracted = destTree.get(path);
      if (value === 'dir') {
        expect(extracted).toBe('dir');
      } else {
        expect(extracted).toBeInstanceOf(Buffer);
        expect((extracted as Buffer).equals(value)).toBe(true);
      }
    }
  });

  it('packs the same tree to identical bytes, independent of mtime', () => {
    const source = writeTree({
      'index.html': '<html>det</html>',
      'a/b.txt': 'nested',
    });
    const first = packBundleArchive(source);
    utimesSync(join(source, 'index.html'), 1_700_000_000, 1_700_000_000);
    utimesSync(join(source, 'a', 'b.txt'), 1_800_000_000, 1_800_000_000);
    const second = packBundleArchive(source);
    expect(first.equals(second)).toBe(true);
    expect(createHash('sha256').update(first).digest('hex')).toBe(
      createHash('sha256').update(second).digest('hex'),
    );
  });

  it('rejects a symbolic link in the source tree', () => {
    const source = writeTree({ 'real.txt': 'payload' });
    symlinkSync('real.txt', join(source, 'link.txt'));
    expect(() => packBundleArchive(source)).toThrow(/symbolic link/);
  });

  it('rejects an absolute path entry', () => {
    const dest = tempDir('musefold-bundle-abs-');
    const archive = gzipTar([ustarHeader({ name: '/etc/passwd', typeflag: '0', size: 0 })]);
    expect(() => extractBundleArchive(archive, dest)).toThrow(BundleArchiveError);
    expect(() => extractBundleArchive(archive, dest)).toThrow(/absolute/);
  });

  it('rejects a path-traversal entry', () => {
    const dest = tempDir('musefold-bundle-dotdot-');
    const archive = gzipTar([ustarHeader({ name: '../escape.txt', typeflag: '0', size: 0 })]);
    expect(() => extractBundleArchive(archive, dest)).toThrow(/escapes/);
  });

  it("rejects typeflag '2' (symbolic link)", () => {
    const dest = tempDir('musefold-bundle-symlink-entry-');
    const archive = gzipTar([ustarHeader({ name: 'link', typeflag: '2', size: 0 })]);
    expect(() => extractBundleArchive(archive, dest)).toThrow("typeflag '2'");
  });

  it("rejects typeflag 'x' (PAX)", () => {
    const dest = tempDir('musefold-bundle-pax-');
    const archive = gzipTar([ustarHeader({ name: 'pax', typeflag: 'x', size: 0 })]);
    expect(() => extractBundleArchive(archive, dest)).toThrow("typeflag 'x'");
  });

  it('rejects a bad header checksum', () => {
    const dest = tempDir('musefold-bundle-chksum-');
    const header = ustarHeader({ name: 'ok.txt', typeflag: '0', size: 0 });
    header[0] = 'Z'.charCodeAt(0);
    const archive = gzipTar([header]);
    expect(() => extractBundleArchive(archive, dest)).toThrow(/checksum/);
  });

  it('rejects a truncated archive', () => {
    const dest = tempDir('musefold-bundle-trunc-');
    const source = writeTree({ 'index.html': 'hello' });
    const archive = packBundleArchive(source);
    const truncated = archive.subarray(0, Math.max(8, archive.length - 20));
    expect(() => extractBundleArchive(truncated, dest)).toThrow(BundleArchiveError);
  });

  it('rejects trailing garbage after the end-of-archive marker', () => {
    const dest = tempDir('musefold-bundle-trailing-');
    const tar = Buffer.concat([
      ustarHeader({ name: 'a.txt', typeflag: '0', size: 0 }),
      Buffer.alloc(BLOCK * 2),
      Buffer.alloc(BLOCK, 0x41),
    ]);
    expect(() => extractBundleArchive(gzipSync(tar), dest)).toThrow(/trailing garbage/);
  });

  it('rejects a tar that is not 512-byte aligned', () => {
    const dest = tempDir('musefold-bundle-align-');
    const tar = Buffer.concat([
      ustarHeader({ name: 'a.txt', typeflag: '0', size: 0 }),
      Buffer.alloc(100),
    ]);
    expect(() => extractBundleArchive(gzipSync(tar), dest)).toThrow(/512-byte aligned|truncated/);
  });

  it('rejects more entries than the configured limit', () => {
    const dest = tempDir('musefold-bundle-entry-limit-');
    const archive = gzipTar([
      ustarHeader({ name: 'a.txt', typeflag: '0', size: 0 }),
      ustarHeader({ name: 'b.txt', typeflag: '0', size: 0 }),
      ustarHeader({ name: 'c.txt', typeflag: '0', size: 0 }),
    ]);
    expect(() => extractBundleArchive(archive, dest, { maxEntries: 2 })).toThrow(/entry limit/);
  });

  it('aborts a highly compressible bomb at the uncompressed-size limit', () => {
    const source = writeTree({ zeros: Buffer.alloc(256 * 1024, 0) });
    const archive = packBundleArchive(source);
    expect(archive.length).toBeLessThan(8 * 1024);
    const dest = tempDir('musefold-bundle-bomb-');
    expect(() => extractBundleArchive(archive, dest, { maxUncompressedBytes: 16 * 1024 })).toThrow(
      /size limit/,
    );
  });
});
