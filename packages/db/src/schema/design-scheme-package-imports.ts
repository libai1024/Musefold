import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { ImportDesignSchemeResult } from '@musefold/contracts';
import { designSchemePackageStages } from './design-scheme-package-stages.js';

/** One immutable logical import per confirmed stage. Retries change attempt/epoch, never seed. */
export const designSchemePackageImports = pgTable(
  'design_scheme_package_imports',
  {
    stageId: varchar('stage_id', { length: 64 }).primaryKey(),
    userId: text('user_id').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    authorityHash: varchar('authority_hash', { length: 64 }).notNull(),
    confirmationHash: varchar('confirmation_hash', { length: 64 }).notNull(),
    parserVersion: integer('parser_version').notNull(),
    mappingVersion: integer('mapping_version').notNull(),
    seed: varchar('seed', { length: 36 }).notNull(),
    attemptId: varchar('attempt_id', { length: 36 }).notNull(),
    epoch: integer('epoch').notNull().default(1),
    status: varchar('status', { length: 16 }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }).notNull(),
    planHash: varchar('plan_hash', { length: 64 }),
    result: jsonb('result').$type<ImportDesignSchemeResult>(),
    /** Private package provenance; never public snapshot.scan or an authorization record. */
    provenance: jsonb('provenance').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.stageId, t.userId],
      foreignColumns: [designSchemePackageStages.id, designSchemePackageStages.userId],
      name: 'scheme_package_import_stage_owner_fk',
    }).onDelete('cascade'),
    index('scheme_package_import_lease_idx').on(t.status, t.leaseUntil),
    check(
      'scheme_package_import_version_check',
      sql`${t.parserVersion} > 0 AND ${t.mappingVersion} > 0 AND ${t.epoch} > 0`,
    ),
    check(
      'scheme_package_import_status_check',
      sql`${t.status} IN ('running','retryable','completed')`,
    ),
    check(
      'scheme_package_import_result_check',
      sql`(${t.status} = 'completed') = (${t.result} IS NOT NULL) AND (${t.status} <> 'completed' OR ${t.planHash} IS NOT NULL)`,
    ),
  ],
);
