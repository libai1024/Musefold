import {
  type MusefoldDatabase,
  lockSyncPublication,
  RETENTION_BATCH_SIZE,
  nextSyncMinAvailableCursor,
  syncChangeLog,
  syncMutationResults,
  syncRetentionPurgeBefore,
  syncRetentionState,
} from '@musefold/db';
import { asc, inArray, lt, lte, sql } from 'drizzle-orm';
import { runRetentionTransaction } from './retention-transaction.js';

export function collectExpiredSyncRows<T extends { createdAt: Date }>(
  rows: readonly T[],
  now: Date,
): T[] {
  const cutoff = syncRetentionPurgeBefore(now);
  return rows.filter((row) => row.createdAt.getTime() <= cutoff.getTime());
}

export function applySyncTrim<
  TLog extends { seq: number; createdAt: Date },
  TMutation extends { createdAt: Date },
>(
  changeLogs: readonly TLog[],
  mutationResults: readonly TMutation[],
  currentMinAvailable: number,
  now: Date,
): {
  remainingLogs: TLog[];
  remainingMutations: TMutation[];
  purged: number;
  changeLogs: number;
  mutationResults: number;
  minAvailableCursor: number;
} {
  const cutoffMs = syncRetentionPurgeBefore(now).getTime();
  const remainingLogs = changeLogs.filter((row) => row.createdAt.getTime() > cutoffMs);
  const remainingMutations = mutationResults.filter((row) => row.createdAt.getTime() > cutoffMs);
  const maxPurgedSeq = changeLogs.reduce(
    (max, row) => (row.createdAt.getTime() <= cutoffMs ? Math.max(max, row.seq) : max),
    0,
  );
  const survivingMin =
    remainingLogs.length === 0 ? null : Math.min(...remainingLogs.map((row) => row.seq));
  return {
    remainingLogs,
    remainingMutations,
    purged:
      changeLogs.length - remainingLogs.length + mutationResults.length - remainingMutations.length,
    changeLogs: changeLogs.length - remainingLogs.length,
    mutationResults: mutationResults.length - remainingMutations.length,
    minAvailableCursor: nextSyncMinAvailableCursor(survivingMin, currentMinAvailable, maxPurgedSeq),
  };
}

/**
 * D02-b 第二刀:裁剪超过 90 天的 sync changelog / mutation results,
 * 并按仍存活最小 seq 抬高 minAvailableCursor。不碰 sync_devices。
 */
export async function trimExpiredSyncRecords(
  db: MusefoldDatabase,
  now = new Date(),
): Promise<{
  purged: number;
  changeLogs: number;
  mutationResults: number;
  minAvailableCursor: number;
}> {
  const cutoff = syncRetentionPurgeBefore(now);
  return runRetentionTransaction(db, async (tx) => {
    await lockSyncPublication(tx, 'trim');
    const deletedLogs = await tx
      .delete(syncChangeLog)
      .where(
        inArray(
          syncChangeLog.seq,
          tx
            .select({ seq: syncChangeLog.seq })
            .from(syncChangeLog)
            .where(lte(syncChangeLog.createdAt, cutoff))
            .orderBy(syncChangeLog.seq)
            .limit(RETENTION_BATCH_SIZE)
            .for('update'),
        ),
      )
      .returning({ seq: syncChangeLog.seq });
    const deletedMutations = await tx
      .delete(syncMutationResults)
      .where(
        inArray(
          sql`(${syncMutationResults.userId}, ${syncMutationResults.deviceId}, ${syncMutationResults.mutationId})`,
          tx
            .select({
              userId: syncMutationResults.userId,
              deviceId: syncMutationResults.deviceId,
              mutationId: syncMutationResults.mutationId,
            })
            .from(syncMutationResults)
            .where(lte(syncMutationResults.createdAt, cutoff))
            .orderBy(
              syncMutationResults.userId,
              syncMutationResults.deviceId,
              syncMutationResults.mutationId,
            )
            .limit(RETENTION_BATCH_SIZE)
            .for('update'),
        ),
      )
      .returning({ mutationId: syncMutationResults.mutationId });

    const surviving = await tx
      .select({ seq: syncChangeLog.seq })
      .from(syncChangeLog)
      .orderBy(asc(syncChangeLog.seq))
      .limit(1);
    const currentRows = await tx.select().from(syncRetentionState);
    const current = currentRows[0]?.minAvailableCursor ?? 0;
    const maxPurgedSeq = deletedLogs.reduce((max, row) => Math.max(max, row.seq), 0);
    const nextCursor = nextSyncMinAvailableCursor(surviving[0]?.seq ?? null, current, maxPurgedSeq);
    // Concurrent maintenance must not lower a newer committed watermark. A
    // no-op trim leaves updatedAt unchanged; first insertion is also race-safe.
    const written = await tx
      .insert(syncRetentionState)
      .values({
        id: 'singleton',
        minAvailableCursor: nextCursor,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: syncRetentionState.id,
        set: { minAvailableCursor: nextCursor, updatedAt: now },
        setWhere: lt(syncRetentionState.minAvailableCursor, nextCursor),
      })
      .returning({ cursor: syncRetentionState.minAvailableCursor });
    const persistedCursor =
      written[0]?.cursor ??
      (await tx.select().from(syncRetentionState))[0]?.minAvailableCursor ??
      current;

    return {
      purged: deletedLogs.length + deletedMutations.length,
      changeLogs: deletedLogs.length,
      mutationResults: deletedMutations.length,
      minAvailableCursor: persistedCursor,
    };
  });
}
