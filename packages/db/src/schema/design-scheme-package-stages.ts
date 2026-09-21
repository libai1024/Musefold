import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import type { DesignSchemePackageStage } from '@musefold/contracts';
import { user } from './auth.js';

/** Upload intent and confirmation survive process loss; object cleanup uses the existing outbox. */
export const designSchemePackageStages = pgTable(
  'design_scheme_package_stages',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    requestId: varchar('request_id', { length: 64 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    packageHash: varchar('package_hash', { length: 64 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    formatVersion: integer('format_version').notNull(),
    parserVersion: integer('parser_version').notNull(),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    uploadLeaseUntil: timestamp('upload_lease_until', { withTimezone: true, mode: 'date' }),
    preview: jsonb('preview').$type<DesignSchemePackageStage['preview']>(),
    confirmationHash: varchar('confirmation_hash', { length: 64 }),
    /** Server-observed identity/authorization revision; no token or credential is persisted here. */
    authorityHash: varchar('authority_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('scheme_package_stage_request_owner_unique').on(t.userId, t.requestId),
    unique('scheme_package_stage_id_owner_unique').on(t.id, t.userId),
    unique('scheme_package_stage_object_unique').on(t.objectKey),
    index('scheme_package_stage_expiry_idx').on(t.expiresAt, t.uploadLeaseUntil),
    check('scheme_package_stage_size_check', sql`${t.byteSize} > 0 AND ${t.byteSize} <= 268435456`),
    check(
      'scheme_package_stage_format_check',
      sql`${t.formatVersion} IN (1,2) AND ${t.parserVersion} > 0`,
    ),
    check(
      'scheme_package_stage_status_check',
      sql`${t.status} IN ('awaiting_upload','uploading','ready','confirmed','imported','rejected','cancelled','expired','failed')`,
    ),
    check(
      'scheme_package_stage_ready_check',
      sql`${t.status} NOT IN ('ready','confirmed','imported') OR (${t.preview} IS NOT NULL AND ${t.confirmationHash} IS NOT NULL)`,
    ),
  ],
);
