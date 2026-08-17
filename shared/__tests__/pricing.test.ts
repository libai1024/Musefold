import { describe, expect, it } from 'vitest';
import {
  estimateCostFromPricing,
  normalizeProviderPricing,
  parseStoredProviderPricing,
} from '../pricing';

describe('provider pricing validation', () => {
  it('accepts non-negative point values', () => {
    expect(normalizeProviderPricing({ mode: 'per-image', unitPoints: 3.2 })).toEqual({
      mode: 'per-image',
      unitPoints: 3.2,
    });
    expect(normalizeProviderPricing({ mode: 'per-1k-token', unitPoints: 0 })).toEqual({
      mode: 'per-1k-token',
      unitPoints: 0,
    });
  });

  it('rejects invalid mode, non-number, and negative points', () => {
    expect(() => normalizeProviderPricing({ mode: 'bad', unitPoints: 1 })).toThrow(/计费方式/);
    expect(() => normalizeProviderPricing({ mode: 'per-image', unitPoints: Number.NaN })).toThrow(/有效积分/);
    expect(() => normalizeProviderPricing({ mode: 'per-image', unitPoints: -1 })).toThrow(/负数/);
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

  it('calculates per-token cost only when usage is present', () => {
    expect(estimateCostFromPricing({ mode: 'per-1k-token', unitPoints: 2 }, { n: 1 }, 2500)).toBe(5);
    expect(estimateCostFromPricing({ mode: 'per-1k-token', unitPoints: 2 }, { n: 1 }, undefined)).toBeNull();
  });

  it('returns null when pricing is not configured', () => {
    expect(estimateCostFromPricing(null, { n: 1 })).toBeNull();
  });
});
