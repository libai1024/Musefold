const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 魔数嗅探图片 MIME；无法识别返回 null（扩展名不可信）。接受 Buffer/Uint8Array。 */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const size = buffer.readUInt32BE(0);
    if (size < 16 || size > buffer.length) return null;
    const brands = [buffer.subarray(8, 12).toString('ascii')];
    for (let offset = 16; offset + 4 <= size; offset += 4)
      brands.push(buffer.subarray(offset, offset + 4).toString('ascii'));
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'image/avif';
  }
  return null;
}
