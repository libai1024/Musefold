import { describe, expect, it } from 'vitest';
import {
  SOFT_DELETE_RETENTION_DAYS,
  SOFT_DELETE_RETENTION_MS,
  SYNC_RETENTION_DAYS,
  SYNC_RETENTION_MS,
  nextSyncMinAvailableCursor,
  softDeletePurgeBefore,
  syncRetentionPurgeBefore,
} from '../retention.js';

describe('soft-delete retention', () => {
  it('保留期是可执行的 30 天常量,不是文档数字', () => {
    expect(SOFT_DELETE_RETENTION_DAYS).toBe(30);
    expect(SOFT_DELETE_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('purge 水位按 now - 30 天计算', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(softDeletePurgeBefore(now).toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });
});

describe('sync retention', () => {
  it('保留期是可执行的 90 天常量', () => {
    expect(SYNC_RETENTION_DAYS).toBe(90);
    expect(SYNC_RETENTION_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('裁剪水位按 now - 90 天计算', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(syncRetentionPurgeBefore(now).toISOString()).toBe('2026-06-09T00:00:00.000Z');
  });

  it('minAvailableCursor 抬到仍存活最小 seq-1,不回退,空表保持现水位', () => {
    expect(nextSyncMinAvailableCursor(12, 0)).toBe(11);
    expect(nextSyncMinAvailableCursor(12, 20)).toBe(20);
    expect(nextSyncMinAvailableCursor(null, 7)).toBe(7);
    expect(nextSyncMinAvailableCursor(null, 0)).toBe(0);
  });

  it('空表或非时间顺序的日志缺口仍使旧游标过期', () => {
    expect(nextSyncMinAvailableCursor(null, 0, 12)).toBe(12);
    expect(nextSyncMinAvailableCursor(null, 20, 12)).toBe(20);
    expect(nextSyncMinAvailableCursor(3, 0, 12)).toBe(12);
  });
});
