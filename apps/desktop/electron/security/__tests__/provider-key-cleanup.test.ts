import { describe, expect, it } from 'vitest';
import { orphanedProviderKeyIds } from '../provider-key-cleanup';

describe('provider key cleanup', () => {
  it('returns only keys without a live provider row', () => {
    expect(
      orphanedProviderKeyIds(
        { live: 'ciphertext-a', retired: 'ciphertext-b' },
        new Set(['live']),
      ),
    ).toEqual(['retired']);
  });

  it('is empty for missing storage and preserves every live key', () => {
    expect(orphanedProviderKeyIds(undefined, new Set())).toEqual([]);
    expect(orphanedProviderKeyIds({ first: 'a', second: 'b' }, new Set(['first', 'second']))).toEqual([]);
  });
});
