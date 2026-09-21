import { describe, expect, it } from 'vitest';
import { assetOriginSchema } from '../design-scheme';
import {
  stagedDesignSchemeAssetSchema,
  uploadDesignSchemeAssetInputSchema,
} from '../design-scheme-assets';

describe('design-scheme staged asset contracts', () => {
  it('keeps existing origins and honestly distinguishes uploaded references', () => {
    for (const origin of ['repository', 'local-run', 'uploaded'])
      expect(assetOriginSchema.parse(origin)).toBe(origin);
  });
  it('accepts bytes with a display name and rejects paths, control characters and invented transport fields', () => {
    expect(
      uploadDesignSchemeAssetInputSchema.parse({
        name: '  参考图.png  ',
        bytes: new Uint8Array([1]),
      }).name,
    ).toBe('参考图.png');
    for (const name of ['', '../a.png', 'C:\\a.png', 'bad\u0000.png', 'bad\n.png', 'a'.repeat(256)])
      expect(
        uploadDesignSchemeAssetInputSchema.safeParse({ name, bytes: new Uint8Array([1]) }).success,
      ).toBe(false);
    expect(
      uploadDesignSchemeAssetInputSchema.safeParse({ name: 'ok.png', bytes: new Uint8Array() })
        .success,
    ).toBe(false);
    expect(
      uploadDesignSchemeAssetInputSchema.safeParse({
        name: 'ok.png',
        bytes: new Uint8Array([1]),
        url: 'http://localhost/secret',
      }).success,
    ).toBe(false);
  });
  it('exposes bounded verified metadata without local paths or storage coordinates', () => {
    const metadata = {
      id: 'upload_1',
      name: 'ref.png',
      mimeType: 'image/png',
      width: 10,
      height: 20,
      byteSize: 30,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-02T00:00:00.000Z',
    };
    expect(stagedDesignSchemeAssetSchema.safeParse(metadata).success).toBe(true);
    for (const patch of [
      { objectKey: 'users/secret/image' },
      { mimeType: 'image/svg+xml' },
      { width: 16384, height: 16384 },
    ])
      expect(stagedDesignSchemeAssetSchema.safeParse({ ...metadata, ...patch }).success).toBe(
        false,
      );
  });
});
