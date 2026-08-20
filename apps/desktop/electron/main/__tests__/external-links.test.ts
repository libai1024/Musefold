import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from '../external-links';

describe('external link whitelist', () => {
  it('allows only documented provider hosts over HTTPS', () => {
    expect(isAllowedExternalUrl('https://ai.tvt.wiki/login/')).toBe(true);
    expect(isAllowedExternalUrl('https://wkapi.vip/wkapi-docs.html')).toBe(true);
    expect(isAllowedExternalUrl('https://wkapi.club/path?q=1')).toBe(true);
  });

  it('rejects lookalikes, credentials, insecure protocols, and malformed input', () => {
    for (const value of [
      'http://ai.tvt.wiki/login/',
      'https://ai.tvt.wiki.evil.example/login/',
      'https://ai.tvt.wiki@evil.example/login/',
      'https://user:pass@ai.tvt.wiki/login/',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedExternalUrl(value), value).toBe(false);
    }
  });
});

