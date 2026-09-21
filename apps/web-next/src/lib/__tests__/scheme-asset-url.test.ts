import { describe, expect, it } from 'vitest';
import { schemeAssetContentUrl } from '../scheme-asset-url';

describe('scheme asset display address', () => {
  it('uses the cookie-authenticated same-origin content endpoint', () => {
    expect(schemeAssetContentUrl('asset-123_abc')).toBe(
      '/api/v1/design-schemes/assets/asset-123_abc/content',
    );
  });
  it.each([
    '',
    '../asset',
    'https://other.test/a',
    '//other.test/a',
    'a?token=x',
    'a#b',
    'a%2fb',
    ' a',
    'a '.repeat(33),
  ])('rejects paths, URLs, query injection and invalid opaque IDs: %s', (value) =>
    expect(schemeAssetContentUrl(value)).toBeNull(),
  );
});
