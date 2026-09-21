import { and, inArray, sql } from 'drizzle-orm';
import type { MusefoldDatabase } from './client.js';
import { generationReferenceUploads, objectCleanupQueue } from './schema/object-storage.js';

export type ObjectCleanupType = 'generation_asset' | 'generation_reference';
export type ObjectCleanupReason =
  | 'generation_purge'
  | 'generation_compensation'
  | 'reference_expired'
  | 'reference_upload_failed'
  | 'design_scheme_purge';

export interface ObjectCleanupIntent {
  objectKey: string;
  ownerId: string;
  objectType: ObjectCleanupType;
  reason: ObjectCleanupReason;
}

type CleanupDb = MusefoldDatabase | Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];

const MAX_BACKOFF_ATTEMPT_EXPONENT = 9;
export const MAX_OBJECT_CLEANUP_ATTEMPTS = 12;

/** Idempotently records cleanup intent without resetting prior attempt history. */
export async function enqueueObjectCleanup(
  db: CleanupDb,
  intents: ObjectCleanupIntent[],
  now = new Date(),
  nextAttemptAt = now,
): Promise<void> {
  if (intents.length === 0) return;
  await db
    .insert(objectCleanupQueue)
    .values(
      intents.map((intent) => ({
        ...intent,
        nextAttemptAt,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: objectCleanupQueue.objectKey,
      set: {
        ownerId: sql`excluded.owner_id`,
        objectType: sql`excluded.object_type`,
        reason: sql`excluded.reason`,
        nextAttemptAt: sql`LEAST(${objectCleanupQueue.nextAttemptAt}, ${nextAttemptAt})`,
        updatedAt: now,
      },
    });
}

/** Removes acknowledged queue rows. S3 deletion is idempotent, so a failed ack is retry-safe. */
export async function acknowledgeObjectCleanup(db: CleanupDb, objectKeys: string[]): Promise<void> {
  if (objectKeys.length === 0) return;
  await db.delete(objectCleanupQueue).where(inArray(objectCleanupQueue.objectKey, objectKeys));
}

/**
 * Records a failed deletion and applies exponential backoff (5 minutes to 24 hours).
 * Maintenance claims already increment attemptCount; immediate API/worker attempts do not.
 */
export async function markObjectCleanupAttemptFailed(
  db: CleanupDb,
  objectKeys: string[],
  error: unknown,
  now = new Date(),
  attemptAlreadyRecorded = false,
): Promise<void> {
  if (objectKeys.length === 0) return;
  const increment = attemptAlreadyRecorded ? 0 : 1;
  await db
    .update(objectCleanupQueue)
    .set({
      attemptCount: sql`${objectCleanupQueue.attemptCount} + ${increment}`,
      lastAttemptAt: now,
      lastError: cleanupErrorName(error),
      nextAttemptAt: sql`${now}::timestamptz + make_interval(secs => LEAST(
        86400.0,
        300.0 * power(
          2.0,
          LEAST(
            GREATEST(${objectCleanupQueue.attemptCount} + ${increment}, 1) - 1,
            ${MAX_BACKOFF_ATTEMPT_EXPONENT}
          )
        )
      ))`,
      abandonedAt: sql`CASE
        WHEN ${objectCleanupQueue.attemptCount} + ${increment} >= ${MAX_OBJECT_CLEANUP_ATTEMPTS}
        THEN ${now}::timestamptz
        ELSE ${objectCleanupQueue.abandonedAt}
      END`,
      updatedAt: now,
    })
    .where(inArray(objectCleanupQueue.objectKey, objectKeys));
}

export async function deferObjectCleanup(
  db: CleanupDb,
  objectKeys: string[],
  now = new Date(),
): Promise<void> {
  if (objectKeys.length === 0) return;
  await db
    .update(objectCleanupQueue)
    .set({
      attemptCount: sql`GREATEST(${objectCleanupQueue.attemptCount} - 1, 0)`,
      lastError: 'active_generation_lease',
      nextAttemptAt: new Date(now.getTime() + 24 * 60 * 60_000),
      abandonedAt: null,
      updatedAt: now,
    })
    .where(inArray(objectCleanupQueue.objectKey, objectKeys));
}

/** Deletes reference registry rows only after their S3 objects were removed successfully. */
export async function removeAcknowledgedReferenceUploads(
  db: CleanupDb,
  objectKeys: string[],
): Promise<void> {
  if (objectKeys.length === 0) return;
  await db
    .delete(generationReferenceUploads)
    .where(
      and(
        inArray(generationReferenceUploads.objectKey, objectKeys),
        sql`${generationReferenceUploads.status} = 'cleanup_pending'`,
      ),
    );
}

function cleanupErrorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 160);
  return 'UnknownObjectStorageError';
}
