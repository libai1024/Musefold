import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { generationRuns } from './workbench.js';

/**
 * Cloud reference uploads are registered before S3 upload. Rows remain discoverable
 * when upload finalization fails, allowing the worker to clean up ambiguous writes.
 */
export const generationReferenceUploads = pgTable(
  'generation_reference_uploads',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 32 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('uploading'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    cleanupQueuedAt: timestamp('cleanup_queued_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('generation_reference_uploads_id_user_unique').on(table.id, table.userId),
    unique('generation_reference_uploads_object_key_unique').on(table.objectKey),
    index('generation_reference_uploads_user_status_expiry_idx').on(
      table.userId,
      table.status,
      table.expiresAt,
    ),
    index('generation_reference_uploads_cleanup_idx').on(table.status, table.expiresAt),
    check('generation_reference_uploads_byte_size_check', sql`${table.byteSize} >= 0`),
    check(
      'generation_reference_uploads_status_check',
      sql`${table.status} IN ('uploading', 'available', 'cleanup_pending')`,
    ),
  ],
);

/** A reference stays live while at least one generation run links to it. */
export const generationReferenceLinks = pgTable(
  'generation_reference_links',
  {
    runId: varchar('run_id', { length: 64 }).notNull(),
    referenceId: varchar('reference_id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.referenceId] }),
    index('generation_reference_links_user_reference_idx').on(table.userId, table.referenceId),
    foreignKey({
      columns: [table.runId, table.userId],
      foreignColumns: [generationRuns.id, generationRuns.userId],
      name: 'generation_reference_links_run_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.referenceId, table.userId],
      foreignColumns: [generationReferenceUploads.id, generationReferenceUploads.userId],
      name: 'generation_reference_links_reference_owner_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Durable S3 deletion outbox. A row is pending until object deletion succeeds and
 * the worker acknowledges it by deleting this row. ownerId intentionally has no
 * user foreign key so cleanup intent survives account-row deletion.
 */
export const objectCleanupQueue = pgTable(
  'object_cleanup_queue',
  {
    objectKey: varchar('object_key', { length: 512 }).primaryKey(),
    ownerId: text('owner_id').notNull(),
    objectType: varchar('object_type', { length: 32 }).notNull(),
    reason: varchar('reason', { length: 40 }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'date' }),
    lastError: varchar('last_error', { length: 160 }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('object_cleanup_queue_due_idx').on(table.nextAttemptAt, table.createdAt),
    index('object_cleanup_queue_owner_idx').on(table.ownerId, table.objectType),
    check('object_cleanup_queue_attempt_count_check', sql`${table.attemptCount} >= 0`),
    check(
      'object_cleanup_queue_type_check',
      sql`${table.objectType} IN ('generation_asset', 'generation_reference')`,
    ),
    check(
      'object_cleanup_queue_reason_check',
      sql`${table.reason} IN ('generation_purge', 'generation_compensation', 'reference_expired', 'reference_upload_failed', 'design_scheme_purge')`,
    ),
  ],
);
