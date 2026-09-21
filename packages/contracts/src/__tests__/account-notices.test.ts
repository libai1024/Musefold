import { describe, expect, it } from 'vitest';
import {
  accountNoticeListSchema,
  accountNoticeReadIdsSchema,
  accountNoticesSchema,
  appPreferencesPatchSchema,
} from '../index';

describe('account notice contracts', () => {
  const item = { id: 'n-ab12', content: '<b>literal</b>', publishedAt: null };
  it('accepts plain text and drops unrelated upstream fields', () => {
    expect(accountNoticeListSchema.parse([{ ...item, token: 'must-not-project' }])).toEqual([item]);
    expect(
      accountNoticesSchema.parse({
        apiIssuer: 'https://api.example',
        issuer: 'https://relay.example',
        items: [item],
      }).items,
    ).toEqual([item]);
  });
  it('bounds content, count, timestamp and read marker shapes', () => {
    for (const invalid of [
      { ...item, content: '' },
      { ...item, content: 'x'.repeat(16_385) },
      { ...item, publishedAt: -1 },
      { ...item, id: '../../private' },
      { ...item, legacyReadIds: ['../../private'] },
      { ...item, legacyReadIds: Array(101).fill('n-old') },
    ])
      expect(accountNoticeListSchema.safeParse([invalid]).success).toBe(false);
    expect(accountNoticeListSchema.safeParse(Array(101).fill(item)).success).toBe(false);
    expect(accountNoticeReadIdsSchema.safeParse(Array(2001).fill(item.id)).success).toBe(false);
  });
  it('does not introduce notice defaults into unrelated preference patches', () => {
    expect(appPreferencesPatchSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(appPreferencesPatchSchema.parse({ legacyAccountNoticeReadIds: ['n-abc'] })).toEqual({
      legacyAccountNoticeReadIds: ['n-abc'],
    });
  });
});
