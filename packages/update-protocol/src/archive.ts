/**
 * 内容层 bundle 归档：gzip 压缩的严格 ustar 子集。
 *
 * 生产端（CI 打包）与消费端（主进程解压）共用同一实现，避免两边对「合法形态」
 * 的理解漂移。自写解析器只接受本包产出的 typeflag / 路径 / 头字段，攻击面小于
 * 完整 tar 实现。扩展名约定 `.tar.gz`。
 */
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export class BundleArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleArchiveError';
  }
}

/** 协议「数 MiB 量级」上放宽裕量；renderer / web dist 远小于此。 */
export const DEFAULT_MAX_ARCHIVE_ENTRIES = 4096;
export const DEFAULT_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export type ExtractBundleArchiveLimits = {
  maxEntries?: number;
  maxUncompressedBytes?: number;
};

export type ExtractBundleArchiveStats = {
  entries: number;
  bytes: number;
};

export type PackedBundleArchiveFile = {
  bytes: number;
  sha256: string;
};

const BLOCK_SIZE = 512;
const USTAR_NAME_MAX = 100;
const USTAR_PREFIX_MAX = 155;
const GZIP_LEVEL = 6;
/** gzip OS=255（unknown）。Node/zlib 的 OS_CODE 随平台变，不覆盖则跨平台 sha256 不可复现。 */
const GZIP_OS_UNKNOWN = 0xff;

type CollectedFile = { kind: 'file'; relativePath: string; data: Buffer };
type CollectedDirectory = { kind: 'directory'; relativePath: string };
type CollectedEntry = CollectedFile | CollectedDirectory;

export function packBundleArchive(sourceDir: string): Buffer {
  const root = resolve(sourceDir);
  const stat = statSource(root);
  if (stat.isSymbolicLink()) {
    throw new BundleArchiveError('bundle directory contains a symbolic link');
  }
  if (!stat.isDirectory()) {
    throw new BundleArchiveError('bundle directory is not a directory');
  }

  const entries = collectEntries(root);
  entries.sort((left, right) => {
    if (left.relativePath < right.relativePath) return -1;
    if (left.relativePath > right.relativePath) return 1;
    return 0;
  });

  const blocks: Buffer[] = [];
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      blocks.push(buildUstarHeader({ relativePath: entry.relativePath, size: 0, typeflag: '5' }));
      continue;
    }
    blocks.push(
      buildUstarHeader({
        relativePath: entry.relativePath,
        size: entry.data.length,
        typeflag: '0',
      }),
    );
    blocks.push(padToBlock(entry.data));
  }
  blocks.push(Buffer.alloc(BLOCK_SIZE * 2));
  return gzipDeterministic(Buffer.concat(blocks));
}

export function packBundleArchiveToFile(
  sourceDir: string,
  outPath: string,
): PackedBundleArchiveFile {
  const archive = packBundleArchive(sourceDir);
  try {
    writeFileSync(outPath, archive);
  } catch {
    throw new BundleArchiveError('failed to write archive file');
  }
  return {
    bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex'),
  };
}

export function extractBundleArchive(
  archive: Uint8Array,
  destDir: string,
  limits: ExtractBundleArchiveLimits = {},
): ExtractBundleArchiveStats {
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES;
  const maxUncompressedBytes = limits.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  const tar = gunzipArchive(archive, maxUncompressedBytes);
  if (tar.length % BLOCK_SIZE !== 0) {
    throw new BundleArchiveError('archive is not 512-byte aligned');
  }

  const destRoot = resolve(destDir);
  mkdirSync(destRoot, { recursive: true });

  let offset = 0;
  let entries = 0;
  let bytes = 0;
  let sawEnd = false;

  while (offset < tar.length) {
    if (offset + BLOCK_SIZE > tar.length) {
      throw new BundleArchiveError('archive is truncated');
    }
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    offset += BLOCK_SIZE;

    if (isZeroBlock(header)) {
      if (offset + BLOCK_SIZE > tar.length) {
        throw new BundleArchiveError('archive is truncated');
      }
      const second = tar.subarray(offset, offset + BLOCK_SIZE);
      if (!isZeroBlock(second)) {
        throw new BundleArchiveError('archive is truncated');
      }
      offset += BLOCK_SIZE;
      if (offset !== tar.length) {
        throw new BundleArchiveError('archive has trailing garbage');
      }
      sawEnd = true;
      break;
    }

    entries += 1;
    if (entries > maxEntries) {
      throw new BundleArchiveError('archive exceeds the entry limit');
    }

    const checksum = readOctal(header, 148, 8);
    if (checksum !== headerChecksum(header)) {
      throw new BundleArchiveError('archive header checksum is invalid');
    }
    assertUstarMagic(header);

    const typeflag = String.fromCharCode(header[156]!);
    if (typeflag !== '0' && typeflag !== '\0' && typeflag !== '5') {
      throw new BundleArchiveError(`archive entry typeflag '${typeflag}' is not allowed`);
    }

    const size = readOctal(header, 124, 12);
    if (typeflag === '5' && size !== 0) {
      throw new BundleArchiveError('archive directory entry must have size 0');
    }

    const padded = paddedSize(size);
    if (offset + padded > tar.length) {
      throw new BundleArchiveError('archive is truncated');
    }
    const data = tar.subarray(offset, offset + size);
    offset += padded;

    const relativePath = readUstarPath(header);
    const target = resolveSafePath(destRoot, relativePath);

    if (typeflag === '5') {
      mkdirSync(target, { recursive: true });
      continue;
    }

    bytes += size;
    if (bytes > maxUncompressedBytes) {
      throw new BundleArchiveError('extracted files exceed the size limit');
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }

  if (!sawEnd) {
    throw new BundleArchiveError('archive is truncated');
  }
  return { entries, bytes };
}

export function runArchiveSelfTest(): boolean {
  const root = mkdtempSync(join(tmpdir(), 'musefold-bundle-archive-self-test-'));
  try {
    const source = join(root, 'src');
    const dest = join(root, 'dest');
    mkdirSync(join(source, 'nested'), { recursive: true });
    writeFileSync(join(source, 'index.html'), '<html>self-test</html>');
    writeFileSync(join(source, 'nested', 'empty.txt'), '');
    writeFileSync(join(source, 'nested', 'data.bin'), Buffer.from([0, 1, 2, 255]));

    const packed = packBundleArchive(source);
    if (!packed.equals(packBundleArchive(source))) return false;

    mkdirSync(dest);
    const stats = extractBundleArchive(packed, dest);
    if (stats.entries < 1) return false;
    if (readFileSync(join(dest, 'index.html'), 'utf8') !== '<html>self-test</html>') return false;
    if (readFileSync(join(dest, 'nested', 'empty.txt')).length !== 0) return false;
    if (!readFileSync(join(dest, 'nested', 'data.bin')).equals(Buffer.from([0, 1, 2, 255]))) {
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function statSource(sourceDir: string): Stats {
  try {
    const stat = lstatSync(sourceDir);
    if (!stat) {
      throw new BundleArchiveError('failed to read bundle directory');
    }
    return stat;
  } catch (error) {
    if (error instanceof BundleArchiveError) throw error;
    throw new BundleArchiveError('failed to read bundle directory');
  }
}

function collectEntries(root: string): CollectedEntry[] {
  const entries: CollectedEntry[] = [];
  walk(root, '', entries);
  return entries;
}

function walk(absDir: string, relDir: string, entries: CollectedEntry[]): void {
  let dirents;
  try {
    dirents = readdirSync(absDir, { withFileTypes: true });
  } catch {
    throw new BundleArchiveError('failed to read bundle directory');
  }
  for (const dirent of dirents) {
    const relativePath = relDir === '' ? dirent.name : `${relDir}/${dirent.name}`;
    assertPackablePath(relativePath);
    const absPath = join(absDir, dirent.name);
    // 符号链接必须先于 isDirectory/isFile 判断：后者在部分平台会反映目标类型。
    if (dirent.isSymbolicLink()) {
      throw new BundleArchiveError('bundle directory contains a symbolic link');
    }
    if (dirent.isDirectory()) {
      entries.push({ kind: 'directory', relativePath });
      walk(absPath, relativePath, entries);
      continue;
    }
    if (dirent.isFile()) {
      let data: Buffer;
      try {
        data = readFileSync(absPath);
      } catch {
        throw new BundleArchiveError('failed to read bundle directory');
      }
      entries.push({ kind: 'file', relativePath, data });
      continue;
    }
    throw new BundleArchiveError('bundle directory contains an unsupported entry');
  }
}

function assertPackablePath(relativePath: string): void {
  if (relativePath.includes('\\') || relativePath.includes('\0')) {
    throw new BundleArchiveError('bundle directory contains an unsupported entry');
  }
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new BundleArchiveError('bundle directory contains an unsupported entry');
    }
  }
}

function splitUstarPath(relativePath: string): { name: string; prefix: string } {
  if (Buffer.byteLength(relativePath, 'utf8') <= USTAR_NAME_MAX) {
    return { name: relativePath, prefix: '' };
  }
  let splitAt = -1;
  for (let index = 0; index < relativePath.length; index += 1) {
    if (relativePath[index] !== '/') continue;
    const prefix = relativePath.slice(0, index);
    const name = relativePath.slice(index + 1);
    if (
      name.length > 0 &&
      Buffer.byteLength(prefix, 'utf8') <= USTAR_PREFIX_MAX &&
      Buffer.byteLength(name, 'utf8') <= USTAR_NAME_MAX
    ) {
      splitAt = index;
    }
  }
  if (splitAt === -1) {
    throw new BundleArchiveError('archive entry path exceeds ustar name and prefix limits');
  }
  return {
    prefix: relativePath.slice(0, splitAt),
    name: relativePath.slice(splitAt + 1),
  };
}

function buildUstarHeader(entry: {
  relativePath: string;
  size: number;
  typeflag: '0' | '5';
}): Buffer {
  const { name, prefix } = splitUstarPath(entry.relativePath);
  const header = Buffer.alloc(BLOCK_SIZE);
  writeString(header, 0, USTAR_NAME_MAX, name);
  writeOctal(header, 100, 8, entry.typeflag === '5' ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(entry.typeflag, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'ascii');
  writeString(header, 345, USTAR_PREFIX_MAX, prefix);

  const checksum = headerChecksum(header);
  const checksumText = checksum.toString(8).padStart(6, '0');
  header.write(checksumText, 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function gzipDeterministic(ustar: Buffer): Buffer {
  const gzipped = gzipSync(ustar, { level: GZIP_LEVEL });
  // gzipSync 实测已把 mtime（字节 4–7）写成 0；仍显式清零，避免实现变动悄悄引入墙钟。
  gzipped.writeUInt32LE(0, 4);
  gzipped[9] = GZIP_OS_UNKNOWN;
  return gzipped;
}

function gunzipArchive(archive: Uint8Array, maxUncompressedBytes: number): Buffer {
  try {
    return gunzipSync(archive, { maxOutputLength: maxUncompressedBytes });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_BUFFER_TOO_LARGE') {
      throw new BundleArchiveError('uncompressed archive exceeds the size limit');
    }
    throw new BundleArchiveError('archive gzip stream is invalid');
  }
}

function readUstarPath(header: Buffer): string {
  const name = readFixedString(header, 0, USTAR_NAME_MAX);
  const prefix = readFixedString(header, 345, USTAR_PREFIX_MAX);
  if (prefix === '') return name;
  if (name === '') return prefix;
  return `${prefix}/${name}`;
}

function resolveSafePath(destRoot: string, relativePath: string): string {
  if (relativePath === '' || relativePath === '.') {
    throw new BundleArchiveError('archive entry path is empty');
  }
  if (relativePath.includes('\\') || relativePath.includes('\0')) {
    throw new BundleArchiveError('archive entry path is not a safe relative path');
  }
  if (relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    throw new BundleArchiveError('archive entry path is absolute');
  }
  const segments = relativePath.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new BundleArchiveError(
        segment === '..'
          ? 'archive entry path escapes the destination directory'
          : 'archive entry path is not a safe relative path',
      );
    }
  }
  const target = resolve(destRoot, ...segments);
  const prefix = destRoot.endsWith(sep) ? destRoot : `${destRoot}${sep}`;
  if (target === destRoot || !target.startsWith(prefix)) {
    throw new BundleArchiveError('archive entry path escapes the destination directory');
  }
  return target;
}

function assertUstarMagic(header: Buffer): void {
  const magic = header.subarray(257, 263);
  const version = header.subarray(263, 265);
  if (!magic.equals(Buffer.from('ustar\0', 'utf8')) || !version.equals(Buffer.from('00', 'utf8'))) {
    throw new BundleArchiveError('archive entry is not a ustar header');
  }
}

function headerChecksum(header: Buffer): number {
  let sum = 0;
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  return sum;
}

function readOctal(header: Buffer, offset: number, length: number): number {
  const field = header.subarray(offset, offset + length);
  if (field.length > 0 && field[0]! >= 0x80) {
    throw new BundleArchiveError('archive header uses non-octal size encoding');
  }
  let digits = '';
  for (const byte of field) {
    if (byte === 0 || byte === 0x20) continue;
    if (byte < 0x30 || byte > 0x37) {
      throw new BundleArchiveError('archive header has an invalid octal field');
    }
    digits += String.fromCharCode(byte);
  }
  if (digits === '') return 0;
  const value = Number.parseInt(digits, 8);
  if (!Number.isSafeInteger(value)) {
    throw new BundleArchiveError('archive header octal field is too large');
  }
  return value;
}

function writeOctal(header: Buffer, offset: number, width: number, value: number): void {
  const digits = value.toString(8).padStart(width - 1, '0');
  if (digits.length > width - 1) {
    throw new BundleArchiveError('archive header octal field is too large');
  }
  header.write(digits, offset, width - 1, 'ascii');
  header[offset + width - 1] = 0;
}

function writeString(header: Buffer, offset: number, maxBytes: number, value: string): void {
  const written = header.write(value, offset, maxBytes, 'utf8');
  if (written < Buffer.byteLength(value, 'utf8')) {
    throw new BundleArchiveError('archive entry path exceeds ustar name and prefix limits');
  }
}

function readFixedString(header: Buffer, offset: number, length: number): string {
  const slice = header.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  const bytes = nul === -1 ? slice : slice.subarray(0, nul);
  return bytes.toString('utf8');
}

function padToBlock(data: Buffer): Buffer {
  const padded = paddedSize(data.length);
  if (padded === data.length) return data;
  return Buffer.concat([data, Buffer.alloc(padded - data.length)]);
}

function paddedSize(size: number): number {
  if (size === 0) return 0;
  return Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}
