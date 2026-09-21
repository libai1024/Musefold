import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { designSchemeSourceSnapshots } from './design-schemes.js';

/** One frozen GitHub source per execution, with a durable upload fence and confirmation identity. */
export const designSchemeSourcePreparations = pgTable(
  'design_scheme_source_preparations',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    executionId: varchar('execution_id', { length: 64 }).notNull(),
    confirmationId: varchar('confirmation_id', { length: 64 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    request: jsonb('request').$type<Record<string, unknown>>().notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    status: varchar('status', { length: 16 }).notNull(),
    snapshotId: varchar('snapshot_id', { length: 64 }),
    contentHash: varchar('content_hash', { length: 64 }),
    confirmation: jsonb('confirmation').$type<Record<string, unknown>>(),
    uploadLeaseUntil: timestamp('upload_lease_until', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.executionId] }),
    foreignKey({
      columns: [t.snapshotId, t.userId],
      foreignColumns: [designSchemeSourceSnapshots.id, designSchemeSourceSnapshots.userId],
      name: 'scheme_source_preparation_snapshot_owner_fk',
    }),
    index('scheme_source_preparation_expiry_idx').on(t.expiresAt, t.uploadLeaseUntil),
    check(
      'scheme_source_preparation_status_check',
      sql`${t.status} IN ('queued','reading','ready','confirmed','rejected','cancelled','expired','failed')`,
    ),
    check(
      'scheme_source_preparation_ready_check',
      sql`${t.status} NOT IN ('ready','confirmed') OR (${t.snapshotId} IS NOT NULL AND ${t.contentHash} IS NOT NULL AND ${t.confirmation} IS NOT NULL)`,
    ),
  ],
);
