import { describe, expect, it } from 'vitest';
import { parseExpectedSize, readImagePixelSize } from '../image-dimensions';

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('image dimensions helpers', () => {
  it('parses expected OpenAI size strings', () => {
    expect(parseExpectedSize('1536x1024')).toEqual({ width: 1536, height: 1024 });
    expect(parseExpectedSize('auto')).toBeNull();
    expect(parseExpectedSize('16:9')).toBeNull();
  });

  it('reads PNG dimensions without decoding pixels', () => {
    expect(readImagePixelSize(pngHeader(1536, 1024))).toEqual({ width: 1536, height: 1024 });
    expect(readImagePixelSize(Buffer.from([1, 2, 3]))).toBeNull();
  });
});
