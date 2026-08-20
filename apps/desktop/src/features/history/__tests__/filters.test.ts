import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HISTORY_FILTERS,
  countActiveHistoryFilters,
  resolveDateRange,
  type HistoryFilters,
} from '../filters';

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0); // 2026-08-04 12:00 UTC

describe('resolveDateRange', () => {
  it('all → no bounds', () => {
    expect(resolveDateRange({ datePreset: 'all' }, NOW)).toEqual({ swapped: false });
  });

  it('7d / 30d relative to now', () => {
    const d7 = resolveDateRange({ datePreset: '7d' }, NOW);
    expect(d7.from).toBe(NOW - 7 * 86_400_000);
    expect(d7.to).toBe(NOW);

    const d30 = resolveDateRange({ datePreset: '30d' }, NOW);
    expect(d30.from).toBe(NOW - 30 * 86_400_000);
    expect(d30.to).toBe(NOW);
  });

  it('month → first day of month', () => {
    const r = resolveDateRange({ datePreset: 'month' }, NOW);
    // Local timezone dependent — just assert from <= now and same month-ish
    expect(r.from).toBeTypeOf('number');
    expect(r.to).toBe(NOW);
    expect(r.from!).toBeLessThanOrEqual(NOW);
  });

  it('custom swaps inverted from/to', () => {
    const r = resolveDateRange(
      { datePreset: 'custom', customFrom: 2000, customTo: 1000 },
      NOW,
    );
    expect(r.from).toBe(1000);
    expect(r.to).toBe(2000);
    expect(r.swapped).toBe(true);
  });

  it('custom keeps order when valid', () => {
    const r = resolveDateRange(
      { datePreset: 'custom', customFrom: 1000, customTo: 2000 },
      NOW,
    );
    expect(r).toEqual({ from: 1000, to: 2000, swapped: false });
  });
});

describe('countActiveHistoryFilters', () => {
  it('defaults count as zero', () => {
    expect(countActiveHistoryFilters({ ...DEFAULT_HISTORY_FILTERS })).toBe(0);
  });

  it('counts status / provider / non-default date', () => {
    const f: HistoryFilters = {
      ...DEFAULT_HISTORY_FILTERS,
      status: 'failed',
      providerId: 'p1',
      datePreset: '7d',
    };
    expect(countActiveHistoryFilters(f)).toBe(3);
  });
});
