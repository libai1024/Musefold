import { describe, expect, it } from 'vitest';
import { decodeDownloadedImage, decodeImageDataUrl } from '../image-data';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('Doubao image data decoding', () => {
  it('accepts data URLs with extra parameters and wrapped base64', () => {
    const encoded = Buffer.from(PNG).toString('base64');
    const dataUrl = `data:image/png;charset=utf-8;base64,${encoded.slice(0, 4)}\n${encoded.slice(4)}`;
    expect(decodeImageDataUrl(dataUrl)).toMatchObject({ extension: 'png', mimeType: 'image/png' });
  });

  it('accepts URL-safe base64 without padding', () => {
    const encoded = Buffer.from(PNG).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodeImageDataUrl(`data:image/png;base64,${encoded}`).bytes).toEqual(Buffer.from(PNG));
  });

  it('uses image signatures instead of trusting an incorrect response content type', () => {
    expect(decodeDownloadedImage(PNG, 'application/octet-stream', 'https://example.invalid/result').extension).toBe('png');
    const encoded = Buffer.from(PNG).toString('base64');
    expect(decodeImageDataUrl(`data:application/octet-stream;base64,${encoded}`).extension).toBe('png');
  });

  it('rejects non-image data URLs', () => {
    expect(() => decodeImageDataUrl('data:text/plain;base64,SGVsbG8=')).toThrow('不是图片');
  });
});
