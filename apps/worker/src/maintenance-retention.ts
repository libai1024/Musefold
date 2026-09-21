import { type MusefoldDatabase, RETENTION_BATCH_SIZE, rateLimitBuckets } from '@musefold/db';
import { inArray, lte, sql } from 'drizzle-orm';
import { runRetentionTransaction } from './retention-transaction.js';

/** Retain the existing two-day cutoff while bounding each maintenance transaction. */
export async function purgeExpiredRateLimitBuckets(db: MusefoldDatabase) {
  return runRetentionTransaction(db, async (tx) => {
    const deleted = await tx
      .delete(rateLimitBuckets)
      .where(
        inArray(
          rateLimitBuckets.bucketKey,
          tx
            .select({ key: rateLimitBuckets.bucketKey })
            .from(rateLimitBuckets)
            .where(lte(rateLimitBuckets.updatedAt, sql`now() - interval '2 days'`))
            .orderBy(rateLimitBuckets.bucketKey)
            .limit(RETENTION_BATCH_SIZE)
            .for('update'),
        ),
      )
      .returning({ key: rateLimitBuckets.bucketKey });
    return { purged: deleted.length };
  });
}
