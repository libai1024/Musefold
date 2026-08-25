import { describe, expect, it } from 'vitest';
import { formatHistoryCost, formatParamsSummary, formatSourceLabel } from '../format';

describe('formatHistoryCost', () => {
  it('explains missing cost instead of showing a bare dash', () => {
    expect(formatHistoryCost(null)).toBe('未记录成本');
    expect(formatHistoryCost(undefined)).toBe('未记录成本');
    expect(formatHistoryCost(3.2)).toBe('3.2 积分');
  });

  it('displays canonical point records without a second conversion', () => {
    expect(formatHistoryCost(0.4, 'point')).toBe('0.4 积分');
    expect(formatHistoryCost(null, 'point')).toBe('未记录成本');
  });
});

describe('formatParamsSummary', () => {
  it('returns dash for empty', () => {
    expect(formatParamsSummary(null)).toBe('—');
    expect(formatParamsSummary(undefined)).toBe('—');
  });

  it('joins known fields', () => {
    expect(
      formatParamsSummary({
        schemaVersion: 1,
        size: '1024x1024',
        quality: 'high',
        n: 1,
        background: 'auto',
      }),
    ).toBe('1024x1024 · high · n=1 · bg=auto');
  });
});

describe('formatSourceLabel', () => {
  it('prefers prompt title', () => {
    expect(formatSourceLabel({ promptTitle: '电影感人像', promptId: 'p1' })).toBe('库「电影感人像」');
  });

  it('falls back when prompt deleted but id remains', () => {
    expect(formatSourceLabel({ promptId: 'p1' })).toBe('库（原条目已删除）');
  });

  it('empty → dash', () => {
    expect(formatSourceLabel({})).toBe('—');
  });
});
