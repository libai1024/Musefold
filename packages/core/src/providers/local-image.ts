import { copyFile, mkdir, open, readFile, stat, writeFile } from 'fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'path';
import { ulid } from 'ulid';
import type {
  LocalImageReference,
  PickLocalImagesResult,
  StageLocalImageInput,
  SupportedImageMimeType,
} from '@musefold/desktop-contracts/providers';
import { getPaths } from '../runtime';

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
  return isInside(join(getPaths().previews, 'uploads'), path);
}

function mimeFromHeader(header: Uint8Array): SupportedImageMimeType | null {
  if (
    header.length >= 8
    && header[0] === 0x89
    && header[1] === 0x50
    && header[2] === 0x4e
    && header[3] === 0x47
    && header[4] === 0x0d
    && header[5] === 0x0a
    && header[6] === 0x1a
    && header[7] === 0x0a
  ) return 'image/png';
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  if (
    header.length >= 12
    && String.fromCharCode(...header.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return null;
}

async function inspectPath(path: string): Promise<{ mimeType: SupportedImageMimeType; sizeBytes: number }> {
  if (!isAbsolute(path)) throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  }
  if (!fileStat.isFile()) throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  if (fileStat.size > MAX_LOCAL_IMAGE_BYTES) {
    throw new LocalImageError('IMAGE_TOO_LARGE', '图片不能超过 20 MiB，请选择较小的文件');
  }
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  }
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const mimeType = mimeFromHeader(header.subarray(0, bytesRead));
    if (!mimeType) throw new LocalImageError('IMAGE_TYPE_UNSUPPORTED', '请选择 PNG、JPG 或 WebP 图片');
    return { mimeType, sizeBytes: fileStat.size };
  } finally {
    await handle.close();
  }
}

export async function stageLocalImage(path: string): Promise<LocalImageReference> {
  const inspected = await inspectPath(path);
  const paths = getPaths();
  const uploadsDir = join(paths.previews, 'uploads');
  await mkdir(uploadsDir, { recursive: true });
  const stagedPath = join(uploadsDir, `${ulid()}${MIME_EXTENSION[inspected.mimeType]}`);
  try {
    await copyFile(path, stagedPath);
  } catch {
    throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  }
  return {
    path: stagedPath,
    source: 'upload',
    name: basename(path),
    ...inspected,
  };
}

export async function stageLocalImageBytes(input: StageLocalImageInput): Promise<LocalImageReference> {
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : Uint8Array.from(input.bytes ?? []);
  if (bytes.byteLength > MAX_LOCAL_IMAGE_BYTES) {
    throw new LocalImageError('IMAGE_TOO_LARGE', '图片不能超过 20 MiB，请选择较小的文件');
  }
  const mimeType = mimeFromHeader(bytes.subarray(0, 12));
  if (!mimeType) throw new LocalImageError('IMAGE_TYPE_UNSUPPORTED', '请选择 PNG、JPG 或 WebP 图片');

  const uploadsDir = join(getPaths().previews, 'uploads');
  await mkdir(uploadsDir, { recursive: true });
  const stagedPath = join(uploadsDir, `${ulid()}${MIME_EXTENSION[mimeType]}`);
  try {
    await writeFile(stagedPath, bytes);
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
  const inspected = await inspectPath(reference.path);
  try {
    const bytes = await readFile(reference.path);
    return {
      bytes,
      image: {
        ...reference,
        mimeType: inspected.mimeType,
        sizeBytes: inspected.sizeBytes,
      },
    };
  } catch {
    throw new LocalImageError('IMAGE_READ_FAILED', '图片读取失败，请重新选择');
  }
}

export function pickImageFailure(error: unknown): PickLocalImagesResult {
  if (error instanceof LocalImageError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return { ok: false, error: { code: 'IMAGE_READ_FAILED', message: '图片读取失败，请重新选择' } };
}
