import { createHash } from 'node:crypto';
import { crc32, createInflateRaw } from 'node:zlib';
import { relativePathSchema, sourceFileMetadataSchema } from '@musefold/contracts';
import * as yauzl from 'yauzl';
import { inspectSchemeImage } from '../design-scheme-assets/image.js';
import { type GithubSourceLimits, invalidArchive, withAbort } from './github-source-common.js';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const ignoredSegments = new Set(['.git', '.hg', '.svn', '__macosx', 'node_modules']);
const textExtensions = new Set(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'toml', 'csv']);
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp']);

function hash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Inspect both directories. ZIP64/multi-disk archives are unnecessary within these budgets. */
function centralDirectory(bytes: Buffer) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    if (offset + 22 + bytes.readUInt16LE(offset + 20) !== bytes.length) continue;
    const entries = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 12);
    const start = bytes.readUInt32LE(offset + 16);
    if (
      bytes.readUInt16LE(offset + 4) !== 0 ||
      bytes.readUInt16LE(offset + 6) !== 0 ||
      bytes.readUInt16LE(offset + 8) !== entries ||
      entries === 0xffff ||
      start + size !== offset
    )
      throw invalidArchive();
    return { start, size, entries };
  }
  throw invalidArchive();
}

function validateLocalHeader(bytes: Buffer, entry: yauzl.Entry, directoryStart: number) {
  const start = entry.relativeOffsetOfLocalHeader;
  if (!Number.isSafeInteger(start) || start < 0 || start + 30 > directoryStart)
    throw invalidArchive();
  if (
    bytes.readUInt32LE(start) !== 0x04034b50 ||
    bytes.readUInt16LE(start + 6) !== entry.generalPurposeBitFlag ||
    bytes.readUInt16LE(start + 8) !== entry.compressionMethod
  )
    throw invalidArchive();
  const nameLength = bytes.readUInt16LE(start + 26);
  const extraLength = bytes.readUInt16LE(start + 28);
  const dataStart = start + 30 + nameLength + extraLength;
  if (dataStart + entry.compressedSize > directoryStart) throw invalidArchive();
  if (utf8.decode(bytes.subarray(start + 30, start + 30 + nameLength)) !== entry.fileName)
    throw invalidArchive();
  if (!(entry.generalPurposeBitFlag & 8)) {
    if (
      bytes.readUInt32LE(start + 14) !== entry.crc32 ||
      bytes.readUInt32LE(start + 18) !== entry.compressedSize ||
      bytes.readUInt32LE(start + 22) !== entry.uncompressedSize
    )
      throw invalidArchive();
  }
  let end = dataStart + entry.compressedSize;
  if (entry.generalPurposeBitFlag & 8) {
    if (end + 12 > directoryStart) throw invalidArchive();
    const descriptor = bytes.readUInt32LE(end) === 0x08074b50 ? end + 4 : end;
    if (
      descriptor + 12 > directoryStart ||
      bytes.readUInt32LE(descriptor) !== entry.crc32 ||
      bytes.readUInt32LE(descriptor + 4) !== entry.compressedSize ||
      bytes.readUInt32LE(descriptor + 8) !== entry.uncompressedSize
    )
      throw invalidArchive();
    end = descriptor + 12;
  }
  return { start, end, dataStart };
}

async function openZip(bytes: Buffer, signal: AbortSignal) {
  return withAbort(
    new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.fromBuffer(
        bytes,
        { lazyEntries: true, strictFileNames: true, validateEntrySizes: true, autoClose: false },
        (error, zip) => {
          if (error) return reject(error);
          if (signal.aborted) {
            zip.close();
            return reject(signal.reason);
          }
          resolve(zip);
        },
      );
    }),
    signal,
  );
}

async function listEntries(zip: yauzl.ZipFile, signal: AbortSignal, maxEntries: number) {
  return new Promise<yauzl.Entry[]>((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    function finish(error?: unknown) {
      zip.removeListener('entry', onEntry);
      zip.removeListener('end', onEnd);
      zip.removeListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(entries);
    }
    function onEntry(entry: yauzl.Entry) {
      if (entries.length >= maxEntries) return finish(invalidArchive());
      entries.push(entry);
      zip.readEntry();
    }
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);
    const onAbort = () => finish(signal.reason);
    zip.on('entry', onEntry);
    zip.once('end', onEnd);
    zip.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else zip.readEntry();
  });
}

/** Use native zlib teardown: yauzl 2's patched stream.destroy does not close the
 * inflater on size-validation errors and can leave async iteration waiting. */
async function readEntry(compressed: Buffer, entry: yauzl.Entry, signal: AbortSignal) {
  signal.throwIfAborted();
  let bytes: Buffer;
  if (entry.compressionMethod === 0) bytes = Buffer.from(compressed);
  else
    bytes = await new Promise<Buffer>((resolve, reject) => {
      const stream = createInflateRaw();
      const chunks: Buffer[] = [];
      let length = 0;
      let failure: unknown;
      let result: Buffer | undefined;
      const fail = (error: unknown) => {
        failure ??= error;
        stream.destroy();
      };
      const onAbort = () => fail(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      stream.on('data', (chunk: Buffer) => {
        if (failure) return;
        length += chunk.length;
        if (length > entry.uncompressedSize) return fail(invalidArchive());
        chunks.push(chunk);
      });
      stream.once('error', fail);
      stream.once('end', () => {
        // bytesWritten counts consumed compressed bytes; trailing junk is invalid.
        if (length !== entry.uncompressedSize || stream.bytesWritten !== compressed.length)
          fail(invalidArchive());
        else {
          result = Buffer.concat(chunks, length);
          stream.destroy();
        }
      });
      stream.once('close', () => {
        signal.removeEventListener('abort', onAbort);
        if (failure) reject(failure);
        else if (result) resolve(result);
        else reject(invalidArchive());
      });
      if (signal.aborted) onAbort();
      else stream.end(compressed);
    });
  signal.throwIfAborted();
  if (bytes.length !== entry.uncompressedSize || crc32(bytes) !== entry.crc32)
    throw invalidArchive();
  return bytes;
}

async function inspectFile(path: string, bytes: Buffer, limits: GithubSourceLimits) {
  const name = path.split('/').at(-1) ?? '';
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  const isText =
    textExtensions.has(extension) || /^(readme|license|licence|copying|notice)(\.|$)/i.test(name);
  const image = imageExtensions.has(extension) ? await inspectSchemeImage(bytes) : undefined;
  let text: string | undefined;
  if (isText) {
    if (bytes.length > limits.textFileBytes || bytes.includes(0)) throw invalidArchive();
    text = utf8.decode(bytes);
  }
  const metadata = sourceFileMetadataSchema.parse({
    relativePath: path,
    kind: image ? 'image' : isText ? 'text' : 'other',
    mimeType: image?.mimeType ?? (isText ? 'text/plain' : 'application/octet-stream'),
    sizeBytes: bytes.length,
    contentHash: hash(bytes),
    evidencePath: path,
    textExcerpt: text?.slice(0, 2000) ?? null,
  });
  return { metadata, bytes, ...(text === undefined ? {} : { text }), ...(image ? { image } : {}) };
}

/** Server-only bytes. Nothing is extracted to disk or interpreted as executable code. */
export async function readGithubSourceArchive(
  bytes: Buffer,
  expectedRoot: string,
  limits: GithubSourceLimits,
  signal: AbortSignal,
) {
  const directory = centralDirectory(bytes);
  if (directory.entries < 1 || directory.entries > limits.archiveEntries) throw invalidArchive();
  const zip = await openZip(bytes, signal);
  // Keep an error listener throughout the ZIP lifetime, including cancellation.
  let zipError: Error | undefined;
  zip.on('error', (error: Error) => {
    zipError = error;
  });
  const onAbort = () => zip.close();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const entries = await listEntries(zip, signal, limits.archiveEntries);
    if (
      entries.length !== directory.entries ||
      entries.reduce(
        (sum, entry) =>
          sum + 46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength,
        0,
      ) !== directory.size
    )
      throw invalidArchive();
    const paths = new Map<string, boolean>();
    const ancestors = new Set<string>();
    const ranges: Array<{ start: number; end: number }> = [];
    const selected: Array<{
      entry: yauzl.Entry;
      path: string;
      ignored: boolean;
      dataStart: number;
    }> = [];
    let totalDeclared = 0;
    let regularFiles = 0;
    let ignoredFiles = 0;
    for (const entry of entries) {
      signal.throwIfAborted();
      const name = entry.fileName;
      const directoryEntry = name.endsWith('/');
      const clean = directoryEntry ? name.slice(0, -1) : name;
      const segments = clean.split('/');
      if (
        name.length > 1200 ||
        [...name].some(
          (character) =>
            character.charCodeAt(0) < 32 ||
            character.charCodeAt(0) === 127 ||
            character === '\ufffd',
        ) ||
        name.includes('\\') ||
        segments[0] !== expectedRoot ||
        segments.some((part) => !part || part === '.' || part === '..' || part.includes(':')) ||
        (!directoryEntry && segments.length < 2)
      )
        throw invalidArchive();
      const canonicalPath = clean.normalize('NFC').toLowerCase();
      if (paths.has(canonicalPath) || (!directoryEntry && ancestors.has(canonicalPath)))
        throw invalidArchive();
      for (let index = 1; index < segments.length; index += 1) {
        const ancestor = segments.slice(0, index).join('/').normalize('NFC').toLowerCase();
        if (paths.get(ancestor) === false) throw invalidArchive();
        ancestors.add(ancestor);
      }
      paths.set(canonicalPath, directoryEntry);
      const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        (unixType !== 0 && unixType !== (directoryEntry ? 0o040000 : 0o100000)) ||
        (!directoryEntry && (entry.externalFileAttributes & 0x10) !== 0) ||
        entry.isEncrypted() ||
        (entry.generalPurposeBitFlag & 0x40) !== 0 ||
        ![0, 8].includes(entry.compressionMethod) ||
        entry.extraFields.some((field) => [0x0001, 0x000d, 0x756e].includes(field.id)) ||
        !Number.isSafeInteger(entry.uncompressedSize) ||
        !Number.isSafeInteger(entry.compressedSize) ||
        entry.uncompressedSize < 0 ||
        entry.compressedSize < 0 ||
        entry.uncompressedSize > limits.fileBytes ||
        entry.uncompressedSize > Math.max(1, entry.compressedSize) * limits.compressionRatio ||
        (directoryEntry &&
          (entry.uncompressedSize !== 0 || entry.compressedSize !== 0 || entry.crc32 !== 0))
      )
        throw invalidArchive();
      totalDeclared += entry.uncompressedSize;
      if (totalDeclared > limits.totalBytes) throw invalidArchive();
      const range = validateLocalHeader(bytes, entry, directory.start);
      ranges.push(range);
      if (directoryEntry) continue;
      regularFiles += 1;
      if (regularFiles > limits.files) throw invalidArchive();
      const path = segments.slice(1).join('/');
      if (!relativePathSchema.safeParse(path).success) throw invalidArchive();
      const ignored = segments.some((part) => ignoredSegments.has(part.toLowerCase()));
      if (ignored) ignoredFiles += 1;
      selected.push({ entry, path, ignored, dataStart: range.dataStart });
    }
    ranges.sort((left, right) => left.start - right.start);
    if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end))
      throw invalidArchive();
    const files: Array<Awaited<ReturnType<typeof inspectFile>>> = [];
    let textFiles = 0;
    let textBytes = 0;
    for (const { entry, path, ignored, dataStart } of selected.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )) {
      signal.throwIfAborted();
      const content = await readEntry(
        bytes.subarray(dataStart, dataStart + entry.compressedSize),
        entry,
        signal,
      );
      if (ignored) continue;
      // Sharp has its own bounded decoder timeout. Await its cleanup even on
      // cancellation, retaining this reader's concurrency slot until it finishes.
      const file = await inspectFile(path, content, limits);
      signal.throwIfAborted();
      if (file.metadata.kind === 'text') {
        textFiles += 1;
        textBytes += content.length;
        if (textFiles > limits.textFiles || textBytes > limits.textBytes) throw invalidArchive();
      }
      files.push(file);
    }
    if (zipError || files.length === 0) throw invalidArchive();
    return {
      files,
      ignoredFiles,
      totalBytes: files.reduce((sum, file) => sum + file.bytes.length, 0),
    };
  } catch {
    if (signal.aborted) throw signal.reason;
    throw invalidArchive();
  } finally {
    signal.removeEventListener('abort', onAbort);
    zip.close();
  }
}
