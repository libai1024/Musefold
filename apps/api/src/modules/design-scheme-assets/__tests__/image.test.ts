import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { inspectSchemeImage } from '../image.js';

function raster() {
  return sharp({ create: { width: 3, height: 2, channels: 4, background: '#aabbcc' } });
}

describe('cloud scheme image decoding', () => {
  it.each(['png', 'jpeg', 'webp'] as const)(
    'fully decodes %s and computes byte metadata',
    async (format) => {
      const bytes = await raster().toFormat(format).toBuffer();
      await expect(inspectSchemeImage(bytes)).resolves.toEqual({
        mimeType: `image/${format}`,
        width: 3,
        height: 2,
        byteSize: bytes.length,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
      });
    },
  );

  it('rejects JPEG that has valid metadata but no complete pixel stream', async () => {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer();
    const sos = bytes.indexOf(Buffer.from([0xff, 0xda]));
    const entropyStart = sos + 2 + bytes.readUInt16BE(sos + 2);
    const truncated = Buffer.concat([bytes.subarray(0, entropyStart), Buffer.from([0xff, 0xd9])]);
    await expect(sharp(truncated).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 64,
      height: 64,
    });
    await expect(inspectSchemeImage(truncated)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects a forged SOF/SOS JPEG and a header-only VP8L payload', async () => {
    const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9', 'hex');
    const webp = Buffer.from('5249464612000000574542505650384c050000002f0000000000', 'hex');
    for (const bytes of [jpeg, webp])
      await expect(inspectSchemeImage(bytes)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects truncated PNG pixel chunks and unsupported active/vector formats', async () => {
    const png = await raster().png().toBuffer();
    for (const bytes of [
      png.subarray(0, png.length - 20),
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
      ),
      await raster().gif().toBuffer(),
      Buffer.from('file:///etc/passwd'),
    ]) {
      await expect(inspectSchemeImage(bytes)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('rejects APNG even when the decoder exposes only its first PNG frame', async () => {
    const png = await raster().png().toBuffer();
    const chunk = Buffer.alloc(20);
    chunk.writeUInt32BE(8, 0);
    chunk.write('acTL', 4);
    chunk.writeUInt32BE(2, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 16)), 16);
    const apng = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    await expect(inspectSchemeImage(apng)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects multi-frame WebP and oversized dimensions before raw decoding', async () => {
    const animated = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), {
      raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    await expect(sharp(animated).metadata()).resolves.toMatchObject({ pages: 2 });
    await expect(inspectSchemeImage(animated)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const wide = await sharp({
      create: { width: 16_385, height: 1, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(inspectSchemeImage(wide)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(inspectSchemeImage(Buffer.alloc(20 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
