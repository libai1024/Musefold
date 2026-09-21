import { createHash } from 'node:crypto';
import {
  MAX_DESIGN_SCHEME_IMAGE_DIMENSION,
  MAX_DESIGN_SCHEME_IMAGE_PIXELS,
  MAX_DESIGN_SCHEME_UPLOAD_BYTES,
} from '@musefold/contracts/design-scheme-assets';
import sharp from 'sharp';
import { AppError } from '../../lib/errors.js';

/** Parse and fully decode bounded raster bytes before storage or reference promotion. */
export async function inspectSchemeImage(
  input: Uint8Array,
  // Server-only policy override for generation outputs; upload routes always use the default.
  options: { maxBytes?: number } = {},
) {
  const maxBytes = options.maxBytes ?? MAX_DESIGN_SCHEME_UPLOAD_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    input.byteLength === 0 ||
    input.byteLength > maxBytes
  )
    throw invalid();
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const expectedFormat = rasterMagic(bytes);
  if (!expectedFormat) throw invalid();
  try {
    // Never accept filenames/URLs into the decoder. Metadata alone does not validate pixel data.
    const decoder = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: MAX_DESIGN_SCHEME_IMAGE_PIXELS,
      sequentialRead: true,
      pages: 1,
    }).timeout({ seconds: 10 });
    const metadata = await decoder.metadata();
    const mimeType = rasterMime(metadata.format);
    if (
      !mimeType ||
      metadata.format !== expectedFormat ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width > MAX_DESIGN_SCHEME_IMAGE_DIMENSION ||
      metadata.height > MAX_DESIGN_SCHEME_IMAGE_DIMENSION ||
      metadata.width * metadata.height > MAX_DESIGN_SCHEME_IMAGE_PIXELS ||
      (metadata.format === 'png' && hasPngAnimation(bytes))
    )
      throw invalid();
    // raw() forces every pixel to be decoded, catching truncated JPEG/VP8 payloads.
    const { info } = await decoder.raw().toBuffer({ resolveWithObject: true });
    if (info.width !== metadata.width || info.height !== metadata.height) throw invalid();
    return {
      mimeType,
      width: info.width,
      height: info.height,
      byteSize: bytes.length,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch {
    throw invalid();
  }
}

// Do not even invoke optional SVG/GIF/PDF loaders for non-allowlisted bytes.
function rasterMagic(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

function rasterMime(format: string | undefined) {
  if (format === 'png') return 'image/png' as const;
  if (format === 'jpeg') return 'image/jpeg' as const;
  if (format === 'webp') return 'image/webp' as const;
  return null;
}

// libvips can expose APNG as its first PNG frame; reject its animation control chunk explicitly.
function hasPngAnimation(bytes: Buffer) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw invalid();
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += length + 12;
  }
  return false;
}

function invalid() {
  return new AppError(
    'VALIDATION_FAILED',
    '方案参考图无效或尺寸过大，请使用静态 PNG、JPG 或 WebP 图片',
  );
}
