/** 软删对象超过该天数后可由 maintenance 硬删(D02-b)。 */
export const SOFT_DELETE_RETENTION_DAYS = 30;

export const SOFT_DELETE_RETENTION_MS = SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** 同步变更日志 / 幂等结果超过该天数后可由 maintenance 裁剪(D02-b)。 */
export const SYNC_RETENTION_DAYS = 90;

export const SYNC_RETENTION_MS = SYNC_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Maximum parent rows per retention kind per invocation; later runs drain the backlog. */
export const RETENTION_BATCH_SIZE = 1000;

/** 该时刻(含)之前软删的终态行可以被 purge。 */
export function softDeletePurgeBefore(now = new Date()): Date {
  return new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
}

/** 该时刻(含)之前的 sync changelog / mutation results 可以被裁剪。 */
export function syncRetentionPurgeBefore(now = new Date()): Date {
  return new Date(now.getTime() - SYNC_RETENTION_MS);
}

/**
 * 裁剪后的 pull 水位至少覆盖本次删除的最大 seq，即使日志被全部清空。
 * 时间与 seq 不一定同序；任何已删除的增量缺口都要求旧游标重新 bootstrap。
 */
export function nextSyncMinAvailableCursor(
  survivingMinSeq: number | null,
  currentMinAvailable: number,
  maxPurgedSeq = 0,
): number {
  return Math.max(currentMinAvailable, maxPurgedSeq, Math.max(0, (survivingMinSeq ?? 1) - 1));
}
