import { describe, expect, it } from 'vitest';
import { V25_METHODS_BY_DOMAIN } from '../gateway-methods';
import {
  assembleUsageByDay,
  assembleUsageByModel,
  usageCostTotal,
  usageInclusiveLocalDates,
  usageLocalDateKey,
  usageRangeSchema,
  usageSuccessRate,
  usageSummaryQuerySchema,
  usageSummarySchema,
  usageWindow,
} from '../usage';

const FROM = '2026-08-08T12:00:00.000+00:00';
const TO = '2026-09-06T12:00:00.000+00:00';
const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const DAY_MS = 86_400_000;

const READY = {
  range: '30d' as const,
  from: FROM,
  to: TO,
  generationCount: 4,
  succeededCount: 2,
  failedCount: 1,
  cancelledCount: 1,
  imageCount: 3,
  costPoints: 12.5,
  successRate: 0.5,
  byProvider: [
    {
      providerId: 'p1',
      label: '官方中转',
      generationCount: 3,
      costPoints: 12.5,
    },
    {
      providerId: null,
      label: 'Musefold 云生图',
      generationCount: 1,
      costPoints: null,
    },
  ],
  byDay: [
    {
      date: '2026-09-06',
      generationCount: 4,
      succeededCount: 2,
      failedCount: 1,
      cancelledCount: 1,
      costPoints: 12.5,
      successRate: 0.5,
    },
  ],
  byModel: [
    { model: 'musefold-image-pro', generationCount: 3, costPoints: 12.5 },
    { model: '未知模型', generationCount: 1, costPoints: null },
  ],
};

describe('usage contracts(07-05 P2)', () => {
  it('accepts the three range presets and rejects all / custom windows', () => {
    for (const range of ['7d', '30d', '90d'] as const) {
      expect(usageRangeSchema.parse(range)).toBe(range);
      expect(usageSummaryQuerySchema.parse({ range })).toEqual({ range });
    }
    expect(usageRangeSchema.safeParse('all').success).toBe(false);
    expect(usageRangeSchema.safeParse('1d').success).toBe(false);
    expect(usageSummaryQuerySchema.safeParse({}).success).toBe(false);
    expect(usageSummaryQuerySchema.safeParse({ range: '30d', extra: true }).success).toBe(false);
  });

  it('keeps the summary strict and path-free', () => {
    expect(usageSummarySchema.parse(READY)).toEqual(READY);
    expect(
      usageSummarySchema.parse({ ...READY, costPoints: null, successRate: null }),
    ).toMatchObject({
      costPoints: null,
      successRate: null,
    });
    expect(usageSummarySchema.safeParse({ ...READY, from: 1_756_720_500_000 }).success).toBe(false);
    expect(usageSummarySchema.safeParse({ ...READY, from: '2026-09-06' }).success).toBe(false);
    expect(usageSummarySchema.safeParse({ ...READY, successRate: 1.2 }).success).toBe(false);
    expect(usageSummarySchema.safeParse({ ...READY, costPoints: -1 }).success).toBe(false);
    expect(usageSummarySchema.safeParse({ ...READY, byProvider: [{ label: 'x' }] }).success).toBe(
      false,
    );
    expect(usageSummarySchema.safeParse({ ...READY, byDay: [{ date: '09-06' }] }).success).toBe(
      false,
    );
    expect(usageSummarySchema.safeParse({ ...READY, dbPath: '/tmp/musefold.db' }).success).toBe(
      false,
    );
  });

  it('computes an inclusive window from an injected now (avoid CI timezone drift)', () => {
    const now = Date.parse('2026-09-06T12:00:00.000Z');
    expect(usageWindow('30d', now)).toEqual({
      fromMs: now - 29 * 86_400_000,
      toMs: now,
      from: '2026-08-08T12:00:00.000+00:00',
      to: '2026-09-06T12:00:00.000+00:00',
    });
    expect(usageWindow('7d', now).fromMs).toBe(now - 6 * 86_400_000);
    expect(usageWindow('90d', now).fromMs).toBe(now - 89 * 86_400_000);
  });

  it('uses succeeded/(succeeded+failed+cancelled) and null when the denominator is 0', () => {
    expect(usageSuccessRate(2, 1, 1)).toBe(0.5);
    expect(usageSuccessRate(8, 2, 0)).toBe(0.8);
    expect(usageSuccessRate(0, 0, 0)).toBeNull();
    expect(usageSuccessRate(0, 1, 0)).toBe(0);
  });

  it('keeps cost null when every value is missing (do not fabricate 0)', () => {
    expect(usageCostTotal([])).toBeNull();
    expect(usageCostTotal([null, null])).toBeNull();
    expect(usageCostTotal([null, 3, 1.5])).toBe(4.5);
    expect(usageCostTotal([0])).toBe(0);
  });
});

describe('usage byDay / byModel(07-05 P3)', () => {
  it('fills inclusive local-day buckets; empty days have count 0 and cost null', () => {
    const days = assembleUsageByDay(
      '7d',
      NOW,
      [
        { createdAtMs: NOW, status: 'succeeded', costPoints: 2 },
        { createdAtMs: NOW - DAY_MS, status: 'queued', costPoints: null },
      ],
      'UTC',
    );
    expect(days).toHaveLength(7);
    expect(days[0]?.date).toBe('2026-08-31');
    expect(days.at(-1)?.date).toBe('2026-09-06');
    expect(days.at(-1)).toMatchObject({
      date: '2026-09-06',
      generationCount: 1,
      succeededCount: 1,
      failedCount: 0,
      cancelledCount: 0,
      costPoints: 2,
      successRate: 1,
    });
    expect(days[5]).toMatchObject({
      date: '2026-09-05',
      generationCount: 1,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      costPoints: null,
      successRate: null,
    });
    for (const day of days.slice(0, 5)) {
      expect(day.generationCount).toBe(0);
      expect(day.costPoints).toBeNull();
      expect(day.successRate).toBeNull();
    }
  });

  it('keeps per-day successRate null when the denominator is 0', () => {
    const [day] = assembleUsageByDay(
      '7d',
      NOW,
      [{ createdAtMs: NOW, status: 'running', costPoints: 1 }],
      'UTC',
    ).slice(-1);
    expect(day).toMatchObject({
      generationCount: 1,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      costPoints: 1,
      successRate: null,
    });
  });

  it('window bucket count equals the inclusive day count (UTC, injected now)', () => {
    const window30 = usageWindow('30d', NOW);
    expect(usageInclusiveLocalDates(window30.fromMs, window30.toMs, 'UTC')).toHaveLength(30);
    expect(assembleUsageByDay('7d', NOW, [], 'UTC')).toHaveLength(7);
    expect(assembleUsageByDay('30d', NOW, [], 'UTC')).toHaveLength(30);
    expect(assembleUsageByDay('90d', NOW, [], 'UTC')).toHaveLength(90);
  });

  it('buckets by the injected timezone so CI hosts cannot drift the civil date', () => {
    const eveningUtc = Date.parse('2026-09-06T16:30:00.000Z');
    expect(usageLocalDateKey(eveningUtc, 'UTC')).toBe('2026-09-06');
    expect(usageLocalDateKey(eveningUtc, 'Asia/Shanghai')).toBe('2026-09-07');
  });

  it('sorts byModel by generationCount desc and keeps missing cost null', () => {
    expect(
      assembleUsageByModel([
        { model: 'beta', costPoints: null },
        { model: 'alpha', costPoints: 1 },
        { model: 'alpha', costPoints: 2 },
        { model: '  ', costPoints: null },
      ]),
    ).toEqual([
      { model: 'alpha', generationCount: 2, costPoints: 3 },
      { model: 'beta', generationCount: 1, costPoints: null },
      { model: '未知模型', generationCount: 1, costPoints: null },
    ]);
  });
});

describe('usage gateway method table', () => {
  it('registers usage.summary and stays bidirectional with the domain table', () => {
    expect(V25_METHODS_BY_DOMAIN.usage).toEqual(['usage.summary']);
    expect(V25_METHODS_BY_DOMAIN.usage).not.toContain('usage.charts');
    for (const name of V25_METHODS_BY_DOMAIN.usage) {
      expect(name.startsWith('usage.')).toBe(true);
    }
    expect(Object.keys(V25_METHODS_BY_DOMAIN)).toContain('usage');
  });
});
