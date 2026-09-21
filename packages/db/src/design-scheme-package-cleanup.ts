import { sql } from 'drizzle-orm';
import type { MusefoldDatabase } from './client.js';
import { enqueueObjectCleanup } from './object-cleanup.js';
import { runRetentionTransaction } from './retention-transaction.js';

/** Retire abandoned uploads in bounded batches; object deletion remains in the shared worker outbox. */
export async function retireDesignSchemePackageStages(db: MusefoldDatabase, now = new Date()) {
  return runRetentionTransaction(db, async (tx) => {
    const rows = await tx.execute<{ id: string; user_id: string; object_key: string }>(sql`
      UPDATE design_scheme_package_stages p SET status = 'expired', updated_at = ${now}
      WHERE id IN (SELECT id FROM design_scheme_package_stages
        WHERE status IN ('awaiting_upload','uploading','ready','confirmed')
          AND (upload_lease_until IS NULL OR upload_lease_until <= ${now})
          AND (expires_at <= ${now} OR (status = 'uploading' AND upload_lease_until <= ${now}))
        ORDER BY expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED)
      RETURNING p.id, p.user_id, p.object_key
    `);
    for (const row of rows.rows) {
      await tx.execute(
        sql`UPDATE generation_reference_uploads SET status='cleanup_pending', cleanup_queued_at=${now} WHERE id=${row.id} AND user_id=${row.user_id}`,
      );
      await enqueueObjectCleanup(
        tx,
        [
          {
            objectKey: row.object_key,
            ownerId: row.user_id,
            objectType: 'generation_reference',
            reason: 'reference_expired',
          },
        ],
        now,
      );
    }
    return rows.rows.length;
  });
}
