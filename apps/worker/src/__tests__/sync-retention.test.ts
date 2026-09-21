import { SYNC_RETENTION_MS, nextSyncMinAvailableCursor } from '@musefold/db';
import { describe, expect, it } from 'vitest';
import { applySyncTrim, collectExpiredSyncRows } from '../sync-retention.js';

const NOW = new Date('2026-09-07T00:00:00.000Z');

describe('sync 90 天裁剪(内存规则)', () => {
  const oldLog = {
    seq: 4,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
  };
  const freshLog = {
    seq: 12,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const oldMutation = {
    mutationId: 'mut-old',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
  };
  const freshMutation = {
    mutationId: 'mut-fresh',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const devices = [{ deviceId: 'device-keep' }];

  it('过期 changelog / mutation 删除,未到期保留,水位抬到仍存活最小 seq-1', () => {
    expect(oldLog.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime() - SYNC_RETENTION_MS);
    expect(freshLog.createdAt.getTime()).toBeGreaterThan(NOW.getTime() - SYNC_RETENTION_MS);

    const first = applySyncTrim([oldLog, freshLog], [oldMutation, freshMutation], 0, NOW);
    expect(first.purged).toBe(2);
    expect(first.changeLogs).toBe(1);
    expect(first.mutationResults).toBe(1);
    expect(first.remainingLogs).toEqual([freshLog]);
    expect(first.remainingMutations).toEqual([freshMutation]);
    expect(first.minAvailableCursor).toBe(nextSyncMinAvailableCursor(freshLog.seq, 0));
    expect(first.minAvailableCursor).toBe(11);
    expect(devices).toEqual([{ deviceId: 'device-keep' }]);
  });

  it('第二次裁剪 purged=0,水位不回退,设备仍在', () => {
    const first = applySyncTrim([oldLog, freshLog], [oldMutation, freshMutation], 0, NOW);
    const second = applySyncTrim(
      first.remainingLogs,
      first.remainingMutations,
      first.minAvailableCursor,
      NOW,
    );
    expect(second.purged).toBe(0);
    expect(second.changeLogs).toBe(0);
    expect(second.mutationResults).toBe(0);
    expect(second.minAvailableCursor).toBe(first.minAvailableCursor);
    expect(collectExpiredSyncRows(second.remainingLogs, NOW)).toEqual([]);
    expect(devices).toHaveLength(1);
  });

  it('没有存活 changelog 时保持现有水位', () => {
    const outcome = applySyncTrim([oldLog], [oldMutation], 7, NOW);
    expect(outcome.purged).toBe(2);
    expect(outcome.remainingLogs).toEqual([]);
    expect(outcome.minAvailableCursor).toBe(7);
  });

  it('删除最后一条日志仍前移水位，重复空裁剪不回退', () => {
    const first = applySyncTrim([oldLog], [], 0, NOW);
    expect(first.minAvailableCursor).toBe(oldLog.seq);
    expect(applySyncTrim([], [], first.minAvailableCursor, NOW)).toMatchObject({
      purged: 0,
      minAvailableCursor: oldLog.seq,
    });
  });

  it('保留的早期序号不能掩盖较晚序号的过期缺口', () => {
    const result = applySyncTrim(
      [
        { ...freshLog, seq: 3 },
        { ...oldLog, seq: 10 },
      ],
      [],
      0,
      NOW,
    );
    expect(result.remainingLogs).toHaveLength(1);
    expect(result.minAvailableCursor).toBe(10);
  });
});
