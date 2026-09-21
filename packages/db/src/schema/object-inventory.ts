import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

/** One durable traversal per storage scope, prefix and mode. No account FK: cascades must be discoverable. */
export const objectInventoryCursors = pgTable(
  'object_inventory_cursors',
  {
    scopeId: varchar('scope_id', { length: 64 }).notNull(),
    prefix: varchar('prefix', { length: 64 }).notNull(),
    mode: varchar('mode', { length: 16 }).notNull(),
    continuationToken: text('continuation_token'),
    leaseToken: varchar('lease_token', { length: 64 }),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeId, t.prefix, t.mode] }),
    check('object_inventory_cursor_mode_check', sql`${t.mode} IN ('record','dry-run')`),
  ],
);

/** Observations are separate from the deletion outbox, including across binary rollback. */
export const objectInventoryCandidates = pgTable(
  'object_inventory_candidates',
  {
    scopeId: varchar('scope_id', { length: 64 }).notNull(),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    prefix: varchar('prefix', { length: 64 }).notNull(),
    etag: varchar('etag', { length: 256 }).notNull(),
    modifiedAt: timestamp('modified_at', { withTimezone: true, mode: 'date' }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    firstObservedAt: timestamp('first_observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    eligibleAt: timestamp('eligible_at', { withTimezone: true, mode: 'date' }).notNull(),
    claimToken: varchar('claim_token', { length: 64 }),
    claimUntil: timestamp('claim_until', { withTimezone: true, mode: 'date' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'date' }),
    lastError: varchar('last_error', { length: 64 }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    primaryKey({ columns: [t.scopeId, t.objectKey] }),
    index('object_inventory_candidates_due_idx').on(t.scopeId, t.eligibleAt),
    check('object_inventory_size_check', sql`${t.byteSize} >= 0`),
    check('object_inventory_attempt_check', sql`${t.attemptCount} >= 0`),
    check(
      'object_inventory_claim_check',
      sql`(${t.claimToken} IS NULL) = (${t.claimUntil} IS NULL)`,
    ),
    index('object_inventory_candidates_ready_idx').on(
      t.scopeId,
      t.abandonedAt,
      t.nextAttemptAt,
      t.eligibleAt,
    ),
  ],
);
