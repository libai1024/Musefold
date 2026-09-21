import { describe, expect, it, vi } from 'vitest';
import { assembleUsageSummary, UsageService } from '../service.js';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const DAY_MS = 86_400_000;

describe('assembleUsageSummary(云端口径)', () => {
  it('returns zeros and null rates/costs when there are no rows', () => {
    const summary = assembleUsageSummary('30d', NOW, [], 0);
    expect(summary).toMatchObject({
      range: '30d',
      generationCount: 0,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      imageCount: 0,
      costPoints: null,
      successRate: null,
      byProvider: [],
      byModel: [],
    });
    expect(summary.byDay).toHaveLength(30);
    expect(summary.byDay.every((day) => day.generationCount === 0 && day.costPoints === null)).toBe(
      true,
    );
  });

  it('excludes queued/running from the success-rate denominator', () => {
    const summary = assembleUsageSummary(
      '7d',
      NOW,
      [
        {
          status: 'succeeded',
          costPoints: 2,
          providerModel: 'musefold-image-pro',
          createdAt: NOW,
        },
        {
          status: 'failed',
          costPoints: null,
          providerModel: 'musefold-image-pro',
          createdAt: NOW,
        },
        {
          status: 'cancelled',
          costPoints: null,
          providerModel: 'musefold-image-pro',
          createdAt: NOW,
        },
        {
          status: 'queued',
          costPoints: null,
          providerModel: 'musefold-image-pro',
          createdAt: NOW,
        },
        {
          status: 'running',
          costPoints: null,
          providerModel: 'musefold-image-pro',
          createdAt: NOW,
        },
      ],
      1,
    );
    expect(summary.generationCount).toBe(5);
    expect(summary.succeededCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.successRate).toBe(1 / 3);
    expect(summary.imageCount).toBe(1);
    expect(summary.costPoints).toBe(2);
    expect(summary.byModel).toEqual([
      { model: 'musefold-image-pro', generationCount: 5, costPoints: 2 },
    ]);
    expect(summary.byDay).toHaveLength(7);
    expect(summary.byDay.at(-1)).toMatchObject({
      date: '2026-09-06',
      generationCount: 5,
      successRate: 1 / 3,
      costPoints: 2,
    });
  });

  it('keeps costPoints null when every cost column is null', () => {
    const summary = assembleUsageSummary(
      '90d',
      NOW,
      [
        { status: 'succeeded', costPoints: null, providerModel: null, createdAt: NOW },
        {
          status: 'failed',
          costPoints: null,
          providerModel: 'other',
          createdAt: NOW - DAY_MS,
        },
      ],
      0,
    );
    expect(summary.costPoints).toBeNull();
    expect(summary.byProvider.map((row) => row.costPoints)).toEqual([null, null]);
    expect(summary.byProvider[0]?.providerId).toBeNull();
    expect(summary.byProvider.find((row) => row.label === 'Musefold 云生图')?.generationCount).toBe(
      1,
    );
    expect(summary.byModel.map((row) => row.model).sort()).toEqual(['other', '未知模型']);
    expect(summary.byDay.find((day) => day.date === '2026-09-05')?.costPoints).toBeNull();
  });

  it('zero-fills local days but does not treat padded days as usage', () => {
    const summary = assembleUsageSummary(
      '7d',
      NOW,
      [
        {
          status: 'succeeded',
          costPoints: 4,
          providerModel: 'musefold-image-pro',
          createdAt: NOW,
        },
      ],
      1,
    );
    expect(summary.generationCount).toBe(1);
    expect(summary.byDay.filter((day) => day.generationCount === 0)).toHaveLength(6);
    expect(
      summary.byDay
        .filter((day) => day.generationCount === 0)
        .every((day) => day.costPoints === null),
    ).toBe(true);
  });
});

describe('UsageService.summary', () => {
  it('scopes the query to the owner and assembles the contract shape', async () => {
    const select = vi.fn();
    select
      .mockResolvedValueOnce([
        {
          status: 'succeeded',
          costPoints: 3,
          providerModel: 'musefold-image-pro',
          createdAt: new Date(NOW),
        },
      ])
      .mockResolvedValueOnce([{ imageCount: 2 }]);

    const db = {
      select: () => ({
        from: () => ({
          where: select,
          innerJoin: () => ({
            where: select,
          }),
        }),
      }),
    };
    const service = new UsageService(
      db as never,
      () => NOW,
      () => 'UTC',
    );

    await expect(service.summary('owner-1', '30d')).resolves.toMatchObject({
      range: '30d',
      generationCount: 1,
      succeededCount: 1,
      imageCount: 2,
      costPoints: 3,
      successRate: 1,
      byModel: [{ model: 'musefold-image-pro', generationCount: 1, costPoints: 3 }],
    });
    expect(select).toHaveBeenCalledTimes(2);
  });
});
