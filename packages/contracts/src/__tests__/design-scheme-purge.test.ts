import { describe, expect, it } from 'vitest';
import {
  purgeDesignSchemeInputSchema,
  purgeDesignSchemeResultSchema,
} from '../design-scheme-purge';

const input = { schemeId: 'scheme_purge_1', expectedVersion: 2 };
const result = {
  schemeId: 'scheme_purge_1',
  purged: true as const,
  retiredKeys: 3,
  deferredKeys: 1,
};

describe('design-scheme purge contracts', () => {
  it('round-trips the authenticated hard-delete request and logical outcome', () => {
    expect(purgeDesignSchemeInputSchema.parse(input)).toEqual(input);
    expect(purgeDesignSchemeResultSchema.parse(result)).toEqual(result);
    expect(
      purgeDesignSchemeResultSchema.parse({ ...result, retiredKeys: 0, deferredKeys: 0 }),
    ).toEqual({
      ...result,
      retiredKeys: 0,
      deferredKeys: 0,
    });
  });

  it('rejects extra fields, missing version, and non-logical delete claims', () => {
    for (const bad of [
      { schemeId: 'scheme_purge_1' },
      { ...input, expectedVersion: 0 },
      { ...input, expectedVersion: 1.5 },
      { ...input, confirmed: true },
      { ...input, userId: 'owner' },
      { schemeId: '../scheme', expectedVersion: 1 },
      { schemeId: '', expectedVersion: 1 },
    ])
      expect(purgeDesignSchemeInputSchema.safeParse(bad).success).toBe(false);

    for (const bad of [
      { ...result, purged: false },
      { ...result, retiredKeys: -1 },
      { ...result, deferredKeys: 1.2 },
      { ...result, bytesDeleted: 12 },
      { schemeId: result.schemeId, purged: true },
      { ...result, objectKeys: ['users/x'] },
    ])
      expect(purgeDesignSchemeResultSchema.safeParse(bad).success).toBe(false);
  });
});
