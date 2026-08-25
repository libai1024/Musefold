import { describe, expect, it } from 'vitest';
import {
  estimateCostFromPricing,
  parseStoredProviderPricing,
} from '../pricing';

describe('managed provider pricing storage parsing', () => {
  it('rejects invalid or retired modes and negative points', () => {
    expect(parseStoredProviderPricing({ mode: 'bad', unitPoints: 1 })).toBeNull();
    expect(parseStoredProviderPricing({ mode: 'per-1k-token', unitPoints: 2 })).toBeNull();
    expect(parseStoredProviderPricing({ mode: 'per-image', unitPoints: Number.NaN })).toBeNull();
    expect(parseStoredProviderPricing({ mode: 'per-image', unitPoints: -1 })).toBeNull();
    expect(parseStoredProviderPricing({ mode: 'per-image', unitCents: -1 })).toBeNull();
  });

  it('migrates legacy cents to points', () => {
    expect(parseStoredProviderPricing({ mode: 'per-image', unitCents: 32 })).toEqual({
      mode: 'per-image',
      unitPoints: 3.2,
    });
  });
});

describe('estimateCostFromPricing', () => {
  it('calculates per-image cost from request count', () => {
    expect(estimateCostFromPricing({ mode: 'per-image', unitPoints: 3.2 }, { n: 1 })).toBe(3.2);
    expect(estimateCostFromPricing({ mode: 'per-image', unitPoints: 3.2 }, { n: 3 })).toBe(9.6);
  });

  it('uses one image when request count is invalid', () => {
    expect(estimateCostFromPricing({ mode: 'per-image', unitPoints: 2 }, { n: 0 })).toBe(2);
    expect(estimateCostFromPricing({ mode: 'per-image', unitPoints: 2 }, {})).toBe(2);
  });

  it('returns null when pricing is not configured', () => {
    expect(estimateCostFromPricing(null, { n: 1 })).toBeNull();
  });
});
