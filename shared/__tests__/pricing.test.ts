import { describe, expect, it } from 'vitest';
import {
  estimateCostFromPricing,
  normalizeProviderPricing,
  parseStoredProviderPricing,
} from '../pricing';

describe('provider pricing validation', () => {
  it('accepts non-negative integer cents', () => {
    expect(normalizeProviderPricing({ mode: 'per-image', unitCents: 32 })).toEqual({
      mode: 'per-image',
      unitCents: 32,
    });
    expect(normalizeProviderPricing({ mode: 'per-1k-token', unitCents: 0 })).toEqual({
      mode: 'per-1k-token',
      unitCents: 0,
    });
  });

  it('rejects invalid mode, non-number, fractional, and negative cents', () => {
    expect(() => normalizeProviderPricing({ mode: 'bad', unitCents: 1 })).toThrow(/计费方式/);
    expect(() => normalizeProviderPricing({ mode: 'per-image', unitCents: Number.NaN })).toThrow(/整数分/);
    expect(() => normalizeProviderPricing({ mode: 'per-image', unitCents: 1.5 })).toThrow(/整数分/);
    expect(() => normalizeProviderPricing({ mode: 'per-image', unitCents: -1 })).toThrow(/负数/);
    expect(parseStoredProviderPricing({ mode: 'per-image', unitCents: -1 })).toBeNull();
  });
});

describe('estimateCostFromPricing', () => {
  it('calculates per-image cost from request count', () => {
    expect(estimateCostFromPricing({ mode: 'per-image', unitCents: 32 }, { n: 1 })).toBe(32);
    expect(estimateCostFromPricing({ mode: 'per-image', unitCents: 32 }, { n: 3 })).toBe(96);
  });

  it('calculates per-token cost only when usage is present', () => {
    expect(estimateCostFromPricing({ mode: 'per-1k-token', unitCents: 20 }, { n: 1 }, 2500)).toBe(50);
    expect(estimateCostFromPricing({ mode: 'per-1k-token', unitCents: 20 }, { n: 1 }, undefined)).toBeNull();
  });

  it('returns null when pricing is not configured', () => {
    expect(estimateCostFromPricing(null, { n: 1 })).toBeNull();
  });
});
