import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/**
 * Permanent scheme-identity fence after authenticated hard-delete. Survives the
 * scheme row so the same opaque id cannot be inserted again for this owner.
 */
export const designSchemePurgeIdentities = pgTable(
  'design_scheme_purge_identities',
  {
    schemeId: varchar('scheme_id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    retiredKeys: integer('retired_keys').notNull().default(0),
    deferredKeys: integer('deferred_keys').notNull().default(0),
    purgedAt: timestamp('purged_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('design_scheme_purge_identities_version_check', sql`${table.version} > 0`),
    check(
      'design_scheme_purge_counts_check',
      sql`${table.retiredKeys} >= 0 AND ${table.deferredKeys} >= 0`,
    ),
  ],
);

/**
 * Permanent revision-identity fence paired with scheme purge. Revision ids are
 * globally unique; the row records the scheme they belonged to.
 */
export const designSchemePurgeRevisionIdentities = pgTable(
  'design_scheme_purge_revision_identities',
  {
    revisionId: varchar('revision_id', { length: 64 }).primaryKey(),
    schemeId: varchar('scheme_id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    purgedAt: timestamp('purged_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
);
