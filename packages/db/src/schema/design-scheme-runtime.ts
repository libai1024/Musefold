import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { designSchemeRuns } from './design-schemes.js';
import { generationRuns } from './workbench.js';

/** Durable prepare identity and cancellation tombstone, including cancel-before-prepare races. */
export const designSchemeRunExecutions = pgTable(
  'design_scheme_run_executions',
  {
    executionId: varchar('execution_id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    requestHash: varchar('request_hash', { length: 64 }),
    preparedInput: jsonb('prepared_input').$type<Record<string, unknown>>(),
    runId: varchar('run_id', { length: 64 }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.executionId] }),
    unique('design_scheme_run_executions_run_owner_unique').on(table.runId, table.userId),
    foreignKey({
      columns: [table.runId, table.userId],
      foreignColumns: [designSchemeRuns.runId, designSchemeRuns.userId],
      name: 'design_scheme_run_executions_run_owner_fk',
    }),
    index('design_scheme_run_executions_expiry_idx').on(table.expiresAt),
    check(
      'design_scheme_run_executions_preparation_check',
      sql`(${table.requestHash} IS NULL) = (${table.preparedInput} IS NULL)`,
    ),
    check(
      'design_scheme_run_executions_identity_check',
      sql`${table.preparedInput} IS NULL OR (${table.preparedInput}->>'executionId') = ${table.executionId}`,
    ),
  ],
);

/** Server-only object coordinates frozen for a scheme-backed generation. Never a client URL. */
export const designSchemeGenerationReferences = pgTable(
  'design_scheme_generation_references',
  {
    generationRunId: varchar('generation_run_id', { length: 64 }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assetId: varchar('asset_id', { length: 64 }).notNull(),
    position: integer('position').notNull(),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    mimeType: varchar('mime_type', { length: 32 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.generationRunId, table.assetId] }),
    unique('design_scheme_generation_references_position_unique').on(
      table.generationRunId,
      table.position,
    ),
    index('design_scheme_generation_references_object_idx').on(table.objectKey),
    foreignKey({
      columns: [table.generationRunId, table.userId],
      foreignColumns: [generationRuns.id, generationRuns.userId],
      name: 'design_scheme_generation_references_run_owner_fk',
    }).onDelete('cascade'),
    check(
      'design_scheme_generation_references_position_check',
      sql`${table.position} >= 0 AND ${table.position} < 16`,
    ),
    check(
      'design_scheme_generation_references_size_check',
      sql`${table.byteSize} > 0 AND ${table.byteSize} <= 20971520`,
    ),
  ],
);
