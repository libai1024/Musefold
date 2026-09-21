import { sql } from 'drizzle-orm';
import type { MusefoldDatabase } from './client.js';
import { enqueueObjectCleanup } from './object-cleanup.js';
import { RETENTION_BATCH_SIZE } from './retention.js';
import { runRetentionTransaction } from './retention-transaction.js';

/** Bounded retirement; the upload lease prevents GC racing a currently executing PUT. */
export async function retireDesignSchemeSourcePreparations(db: MusefoldDatabase, now = new Date()) {
  return runRetentionTransaction(db, async (tx) => {
    const selected = await tx.execute<{
      user_id: string;
      execution_id: string;
      snapshot_id: string | null;
    }>(sql`
      SELECT user_id, execution_id, snapshot_id FROM design_scheme_source_preparations p
      WHERE (retired_at IS NULL OR EXISTS (
          SELECT 1 FROM design_scheme_source_files f
          WHERE f.user_id = p.user_id AND f.snapshot_id = p.snapshot_id
            AND f.object_key IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM design_scheme_source_bindings b
              WHERE b.user_id = f.user_id AND b.source_snapshot_id = f.snapshot_id)
        )) AND (upload_lease_until IS NULL OR upload_lease_until <= ${now})
        AND ((status IN ('queued','reading','ready','confirmed') AND
          (expires_at <= ${now} OR (status = 'reading' AND upload_lease_until <= ${now})))
          OR status IN ('rejected','cancelled','failed','expired'))
      ORDER BY expires_at, user_id, execution_id LIMIT 100 FOR UPDATE SKIP LOCKED
    `);
    // One preparation may contain many files. Share the child budget across all
    // selected parents; the EXISTS candidate above resumes any unbound leftovers.
    let remainingFiles = RETENTION_BATCH_SIZE;
    for (const row of selected.rows) {
      if (row.snapshot_id && remainingFiles > 0) {
        const files = await tx.execute<{ object_key: string }>(sql`
          WITH obsolete AS MATERIALIZED (
          SELECT f.snapshot_id, f.relative_path, f.object_key FROM design_scheme_source_files f
          WHERE f.user_id = ${row.user_id} AND f.snapshot_id = ${row.snapshot_id}
            AND f.object_key IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM design_scheme_source_bindings b
              WHERE b.user_id = f.user_id AND b.source_snapshot_id = f.snapshot_id)
          ORDER BY f.relative_path LIMIT ${remainingFiles} FOR UPDATE)
          UPDATE design_scheme_source_files f SET object_key = NULL FROM obsolete
          WHERE f.snapshot_id = obsolete.snapshot_id AND f.relative_path = obsolete.relative_path
          RETURNING obsolete.object_key
        `);
        remainingFiles -= files.rows.length;
        await enqueueObjectCleanup(
          tx,
          files.rows.map((file) => ({
            objectKey: file.object_key,
            ownerId: row.user_id,
            objectType: 'generation_reference',
            reason: 'reference_expired',
          })),
          now,
        );
      }
      await tx.execute(sql`UPDATE design_scheme_source_preparations
        SET status = CASE WHEN status IN ('queued','reading','ready','confirmed') THEN 'expired' ELSE status END,
          upload_lease_until = NULL, updated_at = ${now}, retired_at = ${now}
        WHERE user_id = ${row.user_id} AND execution_id = ${row.execution_id}`);
    }
    return selected.rows.length;
  });
}
