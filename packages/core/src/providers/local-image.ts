import { mkdir, open, lstat, realpath } from 'node:fs/promises';
import { closeSync, constants, fstatSync, lstatSync, read, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DirectoryHandle } from '@musefold/managed-fs';
import { ulid } from 'ulid';
import type {
  LocalImageReference,
  PickLocalImagesResult,
  StageLocalImageInput,
  SupportedImageMimeType,
} from '@musefold/desktop-contracts/providers';
import { getPaths, getCoreRuntime } from '../runtime';
import { writeLocalUploadedImage } from '../services/local-asset-writes';
import type { LocalUploadOwner } from '../services/local-upload-owner';

export const MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024;

export class LocalImageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LocalImageError';
    this.code = code;
  }
}

const MIME_EXTENSION: Record<SupportedImageMimeType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function isInside(root: string, target: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`);
}

export function isManagedUploadPath(path: string): boolean {
  if (!isAbsolute(path)) return false;
  const paths = getPaths();
  if (isInside(join(paths.previews, 'uploads'), path)) return true;
  try {
    // Hashing resolves the selected file first. Normalize only the OS-owned parent
    // alias (e.g. macOS /var -> /private/var), never links at/below our userData root.
    const userData = resolve(paths.userData);
    const previews = relative(userData, resolve(paths.previews));
    if (!previews || previews === '..' || previews.startsWith(`..${sep}`) || isAbsolute(previews))
      return false;
    const canonicalRoot = join(realpathSync(dirname(userData)), basename(userData));
    return isInside(join(canonicalRoot, previews, 'uploads'), path);
  } catch {
    return false;
  }
}

export function mimeFromHeader(header: Uint8Array): SupportedImageMimeType | null {
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  )
    return 'image/png';
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
    return 'image/jpeg';
  if (
    header.length >= 12 &&
    String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Copies only a regular file below a configured managed root, using one bounded descriptor. */
export async function stageLocalImage(
  path: string,
  owner: LocalUploadOwner,
): Promise<LocalImageReference> {
  owner.assertCurrent();
  const filesystem = getCoreRuntime().managedFilesystem?.();
  if (!filesystem || !isAbsolute(path))
    throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  const paths = getPaths();
  let chosen: { root: string; parts: string[] } | undefined;
  const within = (root: string, target: string) => {
    const suffix = relative(root, target);
    return suffix && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
      ? suffix
      : null;
  };
  for (const configured of [paths.userData, paths.pictures, paths.previews]) {
    try {
      const root = join(realpathSync(dirname(configured)), basename(configured));
      const suffix = within(resolve(configured), resolve(path)) ?? within(root, resolve(path));
      if (suffix) {
        chosen = { root, parts: suffix.split(sep) };
        break;
      }
    } catch {
      /* Another configured managed root can still authorize the source. */
    }
  }
  if (!chosen) throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  const handles: DirectoryHandle[] = [];
  let fd: number | undefined;
  let bytes: Buffer;
  try {
    owner.assertCurrent();
    const root = lstatSync(chosen.root, { bigint: true });
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('unsafe source');
    let parent = filesystem.openRoot(chosen.root, `${root.dev}:${root.ino}`);
    handles.push(parent);
    for (const part of chosen.parts.slice(0, -1)) {
      parent = filesystem.openChild(parent, part, false);
      handles.push(parent);
    }
    const name = chosen.parts.at(-1);
    if (!name) throw new Error('missing source');
    const identity = filesystem.fileIdentity(parent, name);
    fd = filesystem.openFile(parent, name, 'read');
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || identity !== `${before.dev}:${before.ino}`)
      throw new Error('changed source');
    if (before.size > BigInt(MAX_LOCAL_IMAGE_BYTES))
      throw new LocalImageError('IMAGE_TOO_LARGE', '图片不能超过 20 MiB，请选择较小的文件');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    const sourceFd = fd;
    while (offset < buffer.length) {
      owner.assertCurrent();
      const count = await new Promise<number>((resolve, reject) =>
        read(
          sourceFd,
          buffer,
          offset,
          Math.min(65536, buffer.length - offset),
          offset,
          (error, count) => (error ? reject(error) : resolve(count)),
        ),
      );
      if (!count) break;
      offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (
      BigInt(offset) !== before.size ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      filesystem.fileIdentity(parent, name) !== identity
    )
      throw new Error('changed source');
    // Reopen the current namespace and compare every held directory before publishing bytes.
    const currentHandles: DirectoryHandle[] = [];
    try {
      let current = filesystem.openRoot(chosen.root, `${root.dev}:${root.ino}`);
      currentHandles.push(current);
      for (const [index, part] of chosen.parts.slice(0, -1).entries()) {
        current = filesystem.openChild(current, part, false);
        currentHandles.push(current);
        const held = handles[index + 1];
        if (!held || filesystem.identity(current) !== filesystem.identity(held))
          throw new Error('changed source ancestor');
      }
      if (filesystem.fileIdentity(current, name) !== identity) throw new Error('changed source');
    } finally {
      for (const handle of currentHandles.reverse()) filesystem.close(handle);
    }
    bytes = buffer.subarray(0, offset);
  } catch (error) {
    if (error instanceof LocalImageError) throw error;
    throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } finally {
      for (const handle of handles.reverse()) filesystem.close(handle);
    }
  }
  return stageLocalImageBytes({ bytes, name: basename(path) }, owner);
}

export async function stageLocalImageBytes(
  input: StageLocalImageInput,
  owner: LocalUploadOwner,
): Promise<LocalImageReference> {
  owner.assertCurrent();
  const bytes =
    input.bytes instanceof Uint8Array ? input.bytes : Uint8Array.from(input.bytes ?? []);
  if (bytes.byteLength > MAX_LOCAL_IMAGE_BYTES) {
    throw new LocalImageError('IMAGE_TOO_LARGE', '图片不能超过 20 MiB，请选择较小的文件');
  }
  const mimeType = mimeFromHeader(bytes.subarray(0, 12));
  if (!mimeType)
    throw new LocalImageError('IMAGE_TYPE_UNSUPPORTED', '请选择 PNG、JPG 或 WebP 图片');

  const uploadsDir = join(getPaths().previews, 'uploads');
  await mkdir(uploadsDir, { recursive: true });
  const stagedPath = join(uploadsDir, `${ulid()}${MIME_EXTENSION[mimeType]}`);
  try {
    await writeLocalUploadedImage(stagedPath, bytes, owner);
  } catch {
    throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  }
  return {
    path: stagedPath,
    source: 'upload',
    name: input.name ? basename(input.name) : `clipboard${MIME_EXTENSION[mimeType]}`,
    mimeType,
    sizeBytes: bytes.byteLength,
  };
}

export async function readLocalImage(reference: LocalImageReference): Promise<{
  bytes: Buffer;
  image: LocalImageReference & { mimeType: SupportedImageMimeType; sizeBytes: number };
}> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const closeHandle = async () => {
    const current = handle;
    handle = undefined;
    await current?.close();
  };
  try {
    if (!isAbsolute(reference.path)) throw new Error('relative image path');
    // System-selected files may live outside the managed tree, including stable aliases.
    // Resolve the selection once and bind validation and payload reading to one descriptor.
    const selected = await realpath(reference.path);
    const expected = await lstat(selected, { bigint: true });
    if (!expected.isFile()) throw new Error('not a regular image');
    handle = await open(selected, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      before.size !== expected.size ||
      before.mtimeNs !== expected.mtimeNs ||
      before.ctimeNs !== expected.ctimeNs
    ) {
      throw new Error('image changed before opening');
    }
    if (before.size > BigInt(MAX_LOCAL_IMAGE_BYTES))
      throw new LocalImageError('IMAGE_TOO_LARGE', '图片不能超过 20 MiB，请选择较小的文件');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        Math.min(65536, buffer.length - offset),
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const currentPath = await realpath(reference.path);
    const current = await lstat(selected, { bigint: true });
    if (
      currentPath !== selected ||
      !current.isFile() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      BigInt(offset) !== before.size ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      current.size !== before.size ||
      current.mtimeNs !== before.mtimeNs ||
      current.ctimeNs !== before.ctimeNs
    ) {
      throw new Error('image changed while reading');
    }
    const bytes = buffer.subarray(0, offset);
    const mimeType = mimeFromHeader(bytes.subarray(0, 12));
    if (!mimeType)
      throw new LocalImageError('IMAGE_TYPE_UNSUPPORTED', '请选择 PNG、JPG 或 WebP 图片');
    await closeHandle();
    return { bytes, image: { ...reference, mimeType, sizeBytes: bytes.length } };
  } catch (error) {
    try {
      await closeHandle();
    } catch {
      // Preserve the original read/validation failure after attempting to close once.
    }
    if (error instanceof LocalImageError) throw error;
    throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  }
}

export function pickImageFailure(error: unknown): PickLocalImagesResult {
  if (error instanceof LocalImageError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return { ok: false, error: { code: 'IMAGE_READ_FAILED', message: '图片读取失败，请重新选择' } };
}
