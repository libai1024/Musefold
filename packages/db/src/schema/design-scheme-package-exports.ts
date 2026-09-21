import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  integer,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/** A bounded immutable export attempt. An interrupted build needs an explicit new request. */
export const designSchemePackageExports = pgTable(
  'design_scheme_package_exports',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    requestId: varchar('request_id', { length: 64 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    authorityHash: varchar('authority_hash', { length: 64 }).notNull(),
    schemeId: varchar('scheme_id', { length: 64 }).notNull(),
    revisionId: varchar('revision_id', { length: 64 }).notNull(),
    expectedVersion: integer('expected_version').notNull(),
    basisHash: varchar('basis_hash', { length: 64 }).notNull(),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    packageHash: varchar('package_hash', { length: 64 }),
    sizeBytes: integer('size_bytes'),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('scheme_package_export_owner_request_unique').on(t.userId, t.requestId),
    unique('scheme_package_export_object_unique').on(t.objectKey),
    index('scheme_package_export_expiry_idx').on(t.status, t.expiresAt),
    check(
      'scheme_package_export_status_check',
      sql`${t.status} IN ('preparing','ready','cancelled','failed','expired')`,
    ),
    check('scheme_package_export_version_check', sql`${t.expectedVersion} > 0`),
    check(
      'scheme_package_export_size_check',
      sql`${t.sizeBytes} IS NULL OR (${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 268435456)`,
    ),
    check(
      'scheme_package_export_ready_check',
      sql`${t.status} <> 'ready' OR (${t.packageHash} IS NOT NULL AND ${t.sizeBytes} IS NOT NULL)`,
    ),
  ],
);
