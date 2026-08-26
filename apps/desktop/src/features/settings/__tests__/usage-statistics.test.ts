import { describe, expect, it } from 'vitest';
import {
  buildActivityQuery,
  buildUsageHeatmap,
  buildUsageStatsQuery,
  successRate,
  usageGroupBy,
} from '../usage-statistics';

describe('usage statistics helpers', () => {
  it('uses stable allowlisted groups and ranges', () => {
    expect(usageGroupBy('7d')).toBe('day');
    expect(usageGroupBy('90d')).toBe('week');
    expect(usageGroupBy('all')).toBe('month');
    expect(buildUsageStatsQuery('30d', 100_000)).toEqual({
      from: 100_000 - 29 * 86_400_000,
      to: 100_000,
      groupBy: 'day',
    });
    expect(buildUsageStatsQuery('all', 100_000)).toEqual({ groupBy: 'month' });
    expect(buildActivityQuery(100_000).groupBy).toBe('day');
  });

  it('builds a fixed 53-week heatmap and scales activity levels', () => {
    const now = new Date(2026, 7, 26, 12).getTime();
    const cells = buildUsageHeatmap(
      [
        {
          key: '2026-08-25',
          cost: 0,
          count: 2,
          attemptCount: 2,
          failedCount: 0,
          cancelledCount: 0,
          channels: [],
        },
        {
          key: '2026-08-26',
          cost: 1,
          count: 8,
          attemptCount: 8,
          failedCount: 0,
          cancelledCount: 0,
          channels: [],
        },
      ],
      now,
    );

    expect(cells).toHaveLength(371);
    expect(cells.find((cell) => cell.key === '2026-08-25')?.level).toBe(1);
    expect(cells.find((cell) => cell.key === '2026-08-26')?.level).toBe(4);
  });

  it('keeps success rates finite for empty channels', () => {
    expect(successRate(0, 0)).toBe(0);
    expect(successRate(8, 10)).toBe(80);
  });
});
