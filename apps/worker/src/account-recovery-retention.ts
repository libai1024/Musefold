import {
  type MusefoldDatabase,
  accountRecoveryBackupEvidence,
  accountRecoveryRequests,
} from '@musefold/db';
import { sql } from 'drizzle-orm';

/**
 * Expiry is enforced by the API immediately. Periodic maintenance also removes
 * encrypted candidate/backup material, while retaining non-secret provenance.
 * Lock only in request -> backup order; never wait on an active recovery writer
 * or acquire user/session locks after these rows.
 */
export async function clearExpiredAccountRecoverySecrets(
  db: MusefoldDatabase,
  now = new Date(),
  batchSize = 100,
): Promise<{ candidates: number; backups: number }> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new RangeError('Invalid account recovery retention batch size');
  const timestamp = now.toISOString();
  return db.transaction(async (tx) => {
    const candidates = await tx.execute<{ id: string }>(sql`
      WITH expired AS (
        SELECT r.id FROM ${accountRecoveryRequests} AS r
        WHERE r.candidate_ciphertext <> ''
          AND (r.expires_at <= ${timestamp}::timestamptz OR r.status = 'completed')
        ORDER BY r.expires_at, r.id LIMIT ${batchSize}
        FOR UPDATE OF r SKIP LOCKED
      )
      UPDATE ${accountRecoveryRequests} AS r
      SET candidate_ciphertext = '', revision = r.revision + 1,
          updated_at = ${timestamp}::timestamptz
      FROM expired WHERE r.id = expired.id RETURNING r.id
    `);
    const backups = await tx.execute<{ id: string }>(sql`
      WITH expired AS (
        SELECT b.id FROM ${accountRecoveryBackupEvidence} AS b
        WHERE b.state = 'staged' AND (
          b.expires_at <= ${timestamp}::timestamptz OR EXISTS (
            SELECT 1 FROM ${accountRecoveryRequests} AS r
            WHERE r.id = b.request_id
              AND (r.expires_at <= ${timestamp}::timestamptz OR r.status = 'completed')
          )
        )
        ORDER BY b.expires_at, b.id LIMIT ${batchSize}
        FOR UPDATE OF b SKIP LOCKED
      )
      UPDATE ${accountRecoveryBackupEvidence} AS b
      SET state = 'revoked', ciphertext = '', lease_id = NULL, lease_until = NULL,
          revision = b.revision + 1, updated_at = ${timestamp}::timestamptz
      FROM expired WHERE b.id = expired.id RETURNING b.id
    `);
    return { candidates: candidates.rows.length, backups: backups.rows.length };
  });
}

/** At most 1,000 rows per kind per cleanup execution; a later run drains backlog. */
export async function clearExpiredAccountRecoverySecretBatches(
  db: MusefoldDatabase,
  now = new Date(),
) {
  const total = { candidates: 0, backups: 0 };
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await clearExpiredAccountRecoverySecrets(db, now);
    total.candidates += result.candidates;
    total.backups += result.backups;
    if (result.candidates < 100 && result.backups < 100) break;
  }
  return total;
}
