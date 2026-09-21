import { sql } from 'drizzle-orm';
import type { MusefoldTransaction } from './client.js';

/**
 * Lock snapshot parents before removing the last binding. FK publication takes
 * a conflicting parent lock, so a concurrent new binding wins or is rejected;
 * it cannot attach a snapshot after its imported files have been discarded.
 */
export async function lockSchemeSourceSnapshots(
  tx: MusefoldTransaction,
  userId: string,
  schemeId: string,
): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(sql`
    SELECT s.id FROM design_scheme_source_snapshots s
    WHERE s.user_id = ${userId} AND EXISTS (
      SELECT 1 FROM design_scheme_source_bindings b
      JOIN design_scheme_revisions r ON r.revision_id = b.revision_id AND r.user_id = b.user_id
      WHERE b.source_snapshot_id = s.id AND b.user_id = s.user_id AND r.scheme_id = ${schemeId}
    ) ORDER BY s.id FOR UPDATE OF s
  `);
  return result.rows.map((row) => row.id);
}

/**
 * Imported sources have no preparation/expiry record. Delete their unbound
 * snapshot atomically with the scheme and return keys for the same outbox.
 * Prepared sources keep their existing confirmation/upload lease lifecycle.
 * Caller holds the snapshot locks from lockSchemeSourceSnapshots.
 */
export async function releaseUnboundImportedSchemeSources(
  tx: MusefoldTransaction,
  userId: string,
  snapshotIds: string[],
): Promise<string[]> {
  if (!snapshotIds.length) return [];
  const ids = sql.join(
    snapshotIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const unbound = await tx.execute<{ id: string; package_id: string }>(sql`
    SELECT s.id, s.package_id FROM design_scheme_source_snapshots s
    WHERE s.user_id = ${userId} AND s.id IN (${ids})
      AND NOT EXISTS (SELECT 1 FROM design_scheme_source_bindings b
        WHERE b.user_id = s.user_id AND b.source_snapshot_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM design_scheme_source_preparations p
        WHERE p.user_id = s.user_id AND p.snapshot_id = s.id)
    ORDER BY s.id FOR UPDATE OF s
  `);
  const keys: string[] = [];
  for (const snapshot of unbound.rows) {
    const files = await tx.execute<{ object_key: string }>(sql`
      SELECT object_key FROM design_scheme_source_files
      WHERE user_id = ${userId} AND snapshot_id = ${snapshot.id} AND object_key IS NOT NULL
    `);
    keys.push(...files.rows.map((file) => file.object_key));
    await tx.execute(sql`DELETE FROM design_scheme_source_snapshots
      WHERE user_id = ${userId} AND id = ${snapshot.id}`);
    // Keep user-level package metadata: another snapshot can still be in flight.
  }
  return keys;
}
