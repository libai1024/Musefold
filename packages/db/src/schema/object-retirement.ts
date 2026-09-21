import { sql } from 'drizzle-orm';
import { check, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Permanent non-reuse fence after the last reference/lease check. Only key hashes
 * survive cleanup and account deletion; no owner, bucket or object path is stored.
 */
export const objectKeyRetirements = pgTable(
  'object_key_retirements',
  {
    keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [check('object_key_retirements_hash_check', sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`)],
);
