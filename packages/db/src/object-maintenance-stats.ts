import { sql } from 'drizzle-orm';
import type { MusefoldDatabase } from './client.js';

/**
 * D02.7 read-only safety snapshot for object garbage collection. Aggregates the
 * five safety counters (candidates, protected, deleted, failed, abandoned) from
 * the existing tables only: the deletion outbox, the inventory candidate store
 * and the permanent retirement hash table. Object identities are anonymized with
 * the same SHA-256 convention as object_key_retirements; real storage keys,
 * bucket names and signed URLs never leave the database in the result.
 *
 * This is a pure SELECT aggregation with no side effects. It deliberately stays
 * available while destructive maintenance is paused: a paused executor is
 * exactly when operators watch these counters. There is no "purge everything"
 * counter or action here; per-store fields are diagnostic lenses and may
 * overlap (a failed row is also a live candidate until abandoned).
 */

/** Matches deferObjectCleanup's marker for a key currently held by a live lease/protection. */
export const PROTECTION_DEFERRAL_MARKER = 'active_generation_lease';

/** Cap for the anonymous identifier lists; counts are always exact. */
export const MAINTENANCE_SNAPSHOT_ANONYMOUS_LIMIT = 100;

export interface ObjectMaintenanceSnapshot {
  /** Snapshot clock (ISO). Counts are as of this instant. */
  generatedAt: string;
  /** Legacy deletion outbox (object_cleanup_queue). */
  outbox: {
    /** Due now and not abandoned: the executor may claim these immediately. */
    due: number;
    /** Not yet due and not abandoned: protection deferrals and failure backoff. */
    deferred: number;
    /** Subset of live rows whose last disposition was a protection/lease deferral. */
    protectedDeferrals: number;
    /** Live rows whose last attempt failed (excludes protection deferrals). */
    failed: number;
    /** Automatic retry exhausted; only explicit controlled recovery revisits them. */
    abandoned: number;
  };
  /** Inventory observation store (object_inventory_candidates). */
  inventory: {
    /** Inside the observation grace (or not yet eligible) without a recorded error. */
    observing: number;
    /** Eligible, due, unclaimed and not abandoned: the executor may claim these. */
    eligible: number;
    /** Claim lease currently held by an executor. */
    claimed: number;
    /** Live rows whose last attempt failed. */
    failed: number;
    abandoned: number;
  };
  /** Permanent retirement facts. Each implies an authorized, already-executed deletion. */
  retired: number;
  /**
   * The D02.7 headline counters. Lenses overlap by design: `protected` and
   * `failed` are subsets of `candidates`; `deleted` is the durable retirement count.
   */
  totals: {
    /** Live GC intents/observations: non-abandoned outbox rows + non-abandoned candidates. */
    candidates: number;
    /** Held back right now: lease/protection deferrals + in-grace observations. */
    protected: number;
    /** Authorized deletions on record (retirement hashes). */
    deleted: number;
    failed: number;
    abandoned: number;
  };
  /**
   * SHA-256 of the object key (hex), identical to the retirement hash convention.
   * Lets backstage observation correlate stuck objects with object_key_retirements
   * without exposing real keys. Capped at MAINTENANCE_SNAPSHOT_ANONYMOUS_LIMIT each.
   */
  anonymous: {
    failed: string[];
    abandoned: string[];
  };
}

type CountRow = {
  due: string | number;
  deferred: string | number;
  protected_deferrals: string | number;
  failed: string | number;
  abandoned: string | number;
};

type InventoryCountRow = {
  /** Non-abandoned rows; the precise candidate denominator (facet counts may overlap). */
  live: string | number;
  observing: string | number;
  eligible: string | number;
  claimed: string | number;
  failed: string | number;
  abandoned: string | number;
};

const toCount = (value: string | number | null | undefined): number => Number(value ?? 0);

/** Side-effect-free aggregation; safe to call while GC is paused. */
export async function collectObjectMaintenanceSnapshot(
  db: Pick<MusefoldDatabase, 'execute'>,
  now = new Date(),
): Promise<ObjectMaintenanceSnapshot> {
  const outboxRows = await db.execute<CountRow>(sql`
    SELECT
      count(*) FILTER (WHERE abandoned_at IS NULL AND next_attempt_at <= ${now}) AS due,
      count(*) FILTER (WHERE abandoned_at IS NULL AND next_attempt_at > ${now}) AS deferred,
      count(*) FILTER (WHERE abandoned_at IS NULL AND last_error = ${PROTECTION_DEFERRAL_MARKER}) AS protected_deferrals,
      count(*) FILTER (WHERE abandoned_at IS NULL AND last_error IS NOT NULL
        AND last_error <> ${PROTECTION_DEFERRAL_MARKER}) AS failed,
      count(*) FILTER (WHERE abandoned_at IS NOT NULL) AS abandoned
    FROM object_cleanup_queue
  `);
  const inventoryRows = await db.execute<InventoryCountRow>(sql`
    SELECT
      count(*) FILTER (WHERE abandoned_at IS NULL) AS live,
      count(*) FILTER (WHERE abandoned_at IS NULL AND eligible_at > ${now}
        AND last_error IS NULL AND claim_until IS NULL) AS observing,
      count(*) FILTER (WHERE abandoned_at IS NULL AND eligible_at <= ${now}
        AND next_attempt_at <= ${now}
        AND (claim_until IS NULL OR claim_until <= ${now})) AS eligible,
      count(*) FILTER (WHERE abandoned_at IS NULL AND claim_until > ${now}) AS claimed,
      count(*) FILTER (WHERE abandoned_at IS NULL AND last_error IS NOT NULL) AS failed,
      count(*) FILTER (WHERE abandoned_at IS NOT NULL) AS abandoned
    FROM object_inventory_candidates
  `);
  const retiredRows = await db.execute<{ retired: string | number }>(sql`
    SELECT count(*) AS retired FROM object_key_retirements
  `);
  // Hashed in SQL so real keys never appear in the aggregation result.
  const anonymousRows = await db.execute<{ kind: 'failed' | 'abandoned'; key_hash: string }>(sql`
    SELECT kind, key_hash FROM (
      SELECT 'failed' AS kind, encode(sha256(convert_to(object_key, 'UTF8')), 'hex') AS key_hash
      FROM object_cleanup_queue
      WHERE abandoned_at IS NULL AND last_error IS NOT NULL
      UNION ALL
      SELECT 'failed', encode(sha256(convert_to(object_key, 'UTF8')), 'hex')
      FROM object_inventory_candidates
      WHERE abandoned_at IS NULL AND last_error IS NOT NULL
      UNION ALL
      SELECT 'abandoned', encode(sha256(convert_to(object_key, 'UTF8')), 'hex')
      FROM object_cleanup_queue
      WHERE abandoned_at IS NOT NULL
      UNION ALL
      SELECT 'abandoned', encode(sha256(convert_to(object_key, 'UTF8')), 'hex')
      FROM object_inventory_candidates
      WHERE abandoned_at IS NOT NULL
    ) identities
    ORDER BY kind, key_hash
  `);
  const outboxRow = outboxRows.rows[0];
  const inventoryRow = inventoryRows.rows[0];
  const outbox = {
    due: toCount(outboxRow?.due),
    deferred: toCount(outboxRow?.deferred),
    protectedDeferrals: toCount(outboxRow?.protected_deferrals),
    failed: toCount(outboxRow?.failed),
    abandoned: toCount(outboxRow?.abandoned),
  };
  const inventory = {
    observing: toCount(inventoryRow?.observing),
    eligible: toCount(inventoryRow?.eligible),
    claimed: toCount(inventoryRow?.claimed),
    failed: toCount(inventoryRow?.failed),
    abandoned: toCount(inventoryRow?.abandoned),
  };
  const failed: string[] = [];
  const abandoned: string[] = [];
  for (const row of anonymousRows.rows) {
    const bucket = row.kind === 'failed' ? failed : abandoned;
    if (bucket.length < MAINTENANCE_SNAPSHOT_ANONYMOUS_LIMIT) bucket.push(row.key_hash);
  }
  return {
    generatedAt: now.toISOString(),
    outbox,
    inventory,
    retired: toCount(retiredRows.rows[0]?.retired),
    totals: {
      candidates: outbox.due + outbox.deferred + toCount(inventoryRow?.live),
      protected: outbox.protectedDeferrals + inventory.observing,
      deleted: toCount(retiredRows.rows[0]?.retired),
      failed: outbox.failed + inventory.failed,
      abandoned: outbox.abandoned + inventory.abandoned,
    },
    anonymous: { failed, abandoned },
  };
}
