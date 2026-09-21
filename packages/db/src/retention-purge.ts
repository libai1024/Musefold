import { sql, type SQL } from 'drizzle-orm';
import type { MusefoldDatabase, MusefoldTransaction } from './client.js';
import { enqueueObjectCleanup } from './object-cleanup.js';
import { RETENTION_BATCH_SIZE, softDeletePurgeBefore } from './retention.js';
import { runRetentionTransaction } from './retention-transaction.js';
import { lockSyncPublication } from './sync-publication.js';

// Parent rows stay locked through all child batches. A committed marker means
// logically purged; API readers/restores exclude it while later maintenance drains it.
async function markParents(
  tx: MusefoldTransaction,
  kind: 'generation_runs' | 'prompts',
  now: Date,
) {
  const table = sql.identifier(kind);
  const terminal =
    kind === 'generation_runs'
      ? sql`AND status IN ('succeeded','failed','cancelled','rejected','expired')`
      : sql``;
  const selected = await tx.execute<{ id: string }>(sql`
    SELECT id FROM ${table}
    WHERE purge_started_at IS NOT NULL OR (deleted_at <= ${softDeletePurgeBefore(now)} ${terminal})
    ORDER BY id LIMIT ${RETENTION_BATCH_SIZE} FOR UPDATE
  `);
  if (!selected.rows.length) return null;
  const ids = sql.join(
    selected.rows.map((row) => sql`${row.id}`),
    sql`, `,
  );
  await tx.execute(sql`UPDATE ${table} SET purge_started_at = ${now}
    WHERE id IN (${ids}) AND purge_started_at IS NULL`);
  return ids;
}

async function drainChildren(
  tx: MusefoldTransaction,
  tableName:
    | 'generation_assets'
    | 'generation_events'
    | 'generation_reference_links'
    | 'design_scheme_generation_references'
    | 'prompt_usage_events'
    | 'prompt_tag_links',
  parentColumn: 'run_id' | 'generation_run_id' | 'prompt_id',
  keys: readonly string[],
  ids: SQL,
  objectKeys = false,
) {
  const table = sql.identifier(tableName);
  const column = sql.identifier(parentColumn);
  const columns = sql.join(
    keys.map((key) => sql`c.${sql.identifier(key)}`),
    sql`, `,
  );
  const match = sql.join(
    keys.map((key) => sql`c.${sql.identifier(key)} = selected.${sql.identifier(key)}`),
    sql` AND `,
  );
  return tx.execute<{ object_key: string; user_id: string }>(sql`
    WITH selected AS MATERIALIZED (
      SELECT ${columns} FROM ${table} c WHERE c.${column} IN (${ids})
      ORDER BY c.${column}, ${columns} LIMIT ${RETENTION_BATCH_SIZE} FOR UPDATE
    )
    DELETE FROM ${table} c USING selected WHERE ${match}
    RETURNING ${objectKeys ? sql`c.object_key, c.user_id` : sql`NULL::text AS object_key, NULL::text AS user_id`}
  `);
}

/** Each child table has its own 1000-row budget; no cascading parent delete can bypass it. */
export async function purgeGenerationRetentionBatch(db: MusefoldDatabase, now = new Date()) {
  return runRetentionTransaction(db, async (tx) => {
    const ids = await markParents(tx, 'generation_runs', now);
    if (!ids) return { purged: 0, objectKeys: [] as string[] };
    // Preserve the original accepted key and cost facts from the FIRST batch,
    // including when the result's large child collection needs a later process.
    await tx.execute(sql`UPDATE generation_execution_receipts
      SET purged_at=${now}, updated_at=${now}, revision=revision+1
      WHERE original_run_id IN (${ids}) AND purged_at IS NULL`);
    const assets = await drainChildren(tx, 'generation_assets', 'run_id', ['id'], ids, true);
    const references = await drainChildren(
      tx,
      'design_scheme_generation_references',
      'generation_run_id',
      ['generation_run_id', 'asset_id'],
      ids,
      true,
    );
    const objects = [
      ...assets.rows.map((row) => ({
        objectKey: row.object_key,
        ownerId: row.user_id,
        objectType: 'generation_asset' as const,
        reason: 'generation_purge' as const,
      })),
      ...references.rows.map((row) => ({
        objectKey: row.object_key,
        ownerId: row.user_id,
        objectType: 'generation_reference' as const,
        reason: 'generation_purge' as const,
      })),
    ];
    const unique = [...new Map(objects.map((row) => [row.objectKey, row])).values()];
    await enqueueObjectCleanup(tx, unique, now);
    await drainChildren(tx, 'generation_events', 'run_id', ['seq'], ids);
    await drainChildren(
      tx,
      'generation_reference_links',
      'run_id',
      ['run_id', 'reference_id'],
      ids,
    );
    const completed = await tx.execute<{ id: string }>(sql`
      DELETE FROM generation_runs r WHERE id IN (${ids})
        AND NOT EXISTS (SELECT 1 FROM generation_assets a WHERE a.run_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM generation_events e WHERE e.run_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM generation_reference_links l WHERE l.run_id=r.id)
        AND NOT EXISTS (SELECT 1 FROM design_scheme_generation_references s WHERE s.generation_run_id=r.id)
      RETURNING id
    `);
    return { purged: completed.rows.length, objectKeys: unique.map((row) => row.objectKey) };
  });
}

export async function purgePromptRetentionBatch(db: MusefoldDatabase, now = new Date()) {
  return runRetentionTransaction(db, async (tx) => {
    // Keep bootstrap's snapshot protocol in the same order as foreground edits.
    await lockSyncPublication(tx, 'write');
    const ids = await markParents(tx, 'prompts', now);
    if (!ids) return { purged: 0 };
    await drainChildren(tx, 'prompt_usage_events', 'prompt_id', ['user_id', 'event_id'], ids);
    await drainChildren(tx, 'prompt_tag_links', 'prompt_id', ['prompt_id', 'tag_id'], ids);
    const completed = await tx.execute<{ id: string }>(sql`
      DELETE FROM prompts p WHERE id IN (${ids})
        AND NOT EXISTS (SELECT 1 FROM prompt_usage_events u WHERE u.prompt_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM prompt_tag_links l WHERE l.prompt_id=p.id)
      RETURNING id
    `);
    return { purged: completed.rows.length };
  });
}
