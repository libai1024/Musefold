import { Buffer } from 'node:buffer';

export interface DecodedImageData {
  bytes: Buffer;
  extension: string;
  mimeType: string;
}

interface ImageFormat {
  extension: string;
  mimeType: string;
}

const MIME_FORMATS: Record<string, ImageFormat> = {
  'image/avif': { extension: 'avif', mimeType: 'image/avif' },
  'image/bmp': { extension: 'bmp', mimeType: 'image/bmp' },
  'image/gif': { extension: 'gif', mimeType: 'image/gif' },
  'image/jpeg': { extension: 'jpg', mimeType: 'image/jpeg' },
  'image/jpg': { extension: 'jpg', mimeType: 'image/jpeg' },
  'image/png': { extension: 'png', mimeType: 'image/png' },
  'image/webp': { extension: 'webp', mimeType: 'image/webp' },
};

function formatFromMime(contentType: string): ImageFormat | null {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  return MIME_FORMATS[mime] ?? null;
}

function formatFromBytes(bytes: Uint8Array): ImageFormat | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return MIME_FORMATS['image/png'];
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return MIME_FORMATS['image/jpeg'];
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return MIME_FORMATS['image/webp'];
  }
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    return MIME_FORMATS['image/gif'];
  }
  if (bytes.length >= 2 && ascii(bytes, 0, 2) === 'BM') return MIME_FORMATS['image/bmp'];
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') return MIME_FORMATS['image/avif'];
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function decodePercentEncodedData(payload: string): Buffer {
  try {
    return Buffer.from(decodeURIComponent(payload), 'utf8');
  } catch {
    throw new Error('图片数据 URL 编码无效');
  }
}

function decodeBase64Data(payload: string): Buffer {
  // Chromium may expose URL-safe Base64 and may wrap long data URLs.
  let encoded = payload;
  if (encoded.includes('%')) {
    try {
      encoded = decodeURIComponent(encoded);
    } catch {
      throw new Error('图片 Base64 数据 URL 编码无效');
    }
  }
  const normalized = encoded.replace(/[\t\n\r\f ]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('图片 Base64 数据无效');
  }
  if (normalized.replace(/=+$/, '').length % 4 === 1) throw new Error('图片 Base64 数据长度无效');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export function decodeImageDataUrl(dataUrl: string): DecodedImageData {
  if (typeof dataUrl !== 'string' || !dataUrl.toLowerCase().startsWith('data:')) {
    throw new Error('不是图片数据 URL');
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('图片数据 URL 缺少内容');

  const metadata = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const parts = metadata.split(';');
  const declaredMime = (parts.shift() || '').trim().toLowerCase();

  const bytes = parts.some((part) => part.trim().toLowerCase() === 'base64')
    ? decodeBase64Data(payload)
    : decodePercentEncodedData(payload);
  if (bytes.length === 0) throw new Error('图片数据为空');

  const format = formatFromBytes(bytes) ?? formatFromMime(declaredMime);
  if (!declaredMime.startsWith('image/') && !format) throw new Error('数据 URL 不是图片');
  if (!format) throw new Error('图片字节格式无法识别');
  return { bytes, ...format };
}

export function decodeDownloadedImage(
  bytes: Uint8Array,
  contentType = '',
  url = '',
): { bytes: Buffer; extension: string; mimeType: string } {
  const buffer = Buffer.from(bytes);
  const detected = formatFromBytes(buffer) ?? formatFromMime(contentType);
  if (!detected) {
    const extension = /\.(png|jpe?g|webp|avif|gif|bmp)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase();
    if (!extension) throw new Error('下载内容不是可识别的图片');
    const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension;
    return {
      bytes: buffer,
      extension: normalizedExtension,
      mimeType: `image/${normalizedExtension === 'jpg' ? 'jpeg' : normalizedExtension}`,
    };
  }
  return { bytes: buffer, ...detected };
}
