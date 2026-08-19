import { createHash } from 'node:crypto';
import type { ParsedCloudGenerationRequest } from '@musefold/contracts';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

export class UpstreamImageError extends Error {
  constructor(
    readonly code: 'quota' | 'rejected' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamImageError';
  }
}

export async function generateImage(
  baseUrl: string,
  apiKey: string,
  request: ParsedCloudGenerationRequest,
): Promise<GeneratedImage[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/v1/images/generations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: 'musefold-image-pro',
          prompt: request.negative
            ? `${request.prompt}\n\nNegative prompt: ${request.negative}`
            : request.prompt,
          size: request.size === 'auto' ? undefined : request.size,
          quality: request.quality === 'auto' ? undefined : request.quality,
          n: request.count,
        }),
        signal: controller.signal,
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string; code?: string };
      message?: string;
    };
    if (!response.ok) {
      const message =
        payload.error?.message ??
        payload.message ??
        `上游生图失败（HTTP ${response.status}）`;
      if (response.status === 402 || /quota|balance|余额|配额/i.test(message))
        throw new UpstreamImageError('quota', message);
      if (response.status >= 400 && response.status < 500)
        throw new UpstreamImageError('rejected', message);
      throw new UpstreamImageError('unknown', message);
    }
    const items = payload.data ?? [];
    if (!items.length)
      throw new UpstreamImageError('unknown', '上游没有返回图像数据');
    const images: GeneratedImage[] = [];
    for (const item of items) {
      const bytes = item.b64_json
        ? decodeBase64Image(item.b64_json)
        : item.url
          ? await downloadImage(item.url)
          : null;
      if (!bytes?.length)
        throw new UpstreamImageError('unknown', '上游图像数据为空');
      const metadata = detectImage(bytes);
      if (!metadata)
        throw new UpstreamImageError('rejected', '上游返回了不支持的图像格式');
      images.push({ bytes, ...metadata });
    }
    return images;
  } catch (error) {
    if (error instanceof UpstreamImageError) throw error;
    throw new UpstreamImageError(
      'unknown',
      error instanceof Error ? error.message : '无法确认上游生图结果',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(url: string): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpstreamImageError('rejected', '上游返回了无效图像 URL');
  }
  if (!['https:', 'http:'].includes(parsed.protocol))
    throw new UpstreamImageError('rejected', '上游图像 URL 协议不安全');
  const response = await fetch(parsed, { redirect: 'error' });
  if (!response.ok) throw new UpstreamImageError('unknown', '下载上游图像失败');
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_IMAGE_BYTES)
    throw new UpstreamImageError('rejected', '图像文件过大');
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new UpstreamImageError('rejected', '图像文件过大');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.length;
      if (total > MAX_IMAGE_BYTES)
        throw new UpstreamImageError('rejected', '图像文件过大');
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function decodeBase64Image(value: string): Buffer {
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096) {
    throw new UpstreamImageError('rejected', '图像文件过大');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new UpstreamImageError('rejected', '图像文件过大');
  return bytes;
}

function detectImage(bytes: Buffer): Omit<GeneratedImage, 'bytes'> | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return {
      mimeType: 'image/png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const width = bytes.length >= 30 ? 1 + bytes.readUIntLE(24, 3) : 1;
    const height = bytes.length >= 30 ? 1 + bytes.readUIntLE(27, 3) : 1;
    return { mimeType: 'image/webp', width, height };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const jpeg = readJpegSize(bytes);
    return jpeg ? { mimeType: 'image/jpeg', ...jpeg } : null;
  }
  return null;
}

function readJpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export function imageChecksum(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
