import type { ExecutionBinding, GenerationExecutionReceipt } from '@musefold/contracts';
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

/**
 * Non-deleting execution identity. No foreign key to users, sessions, runs or schemes:
 * deleting history/account rows must never make a previously accepted key reusable.
 * This table contains provenance and digests, never credentials or prompt/image content.
 */
export const generationExecutionReceipts = pgTable(
  'generation_execution_receipts',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    principalId: text('principal_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
    operation: text('operation').$type<GenerationExecutionReceipt['operation']>().notNull(),
    originalRunId: varchar('original_run_id', { length: 64 }).notNull(),
    sourceRunId: varchar('source_run_id', { length: 64 }),
    binding: jsonb('binding').$type<ExecutionBinding>(),
    bindingState: text('binding_state')
      .$type<GenerationExecutionReceipt['bindingState']>()
      .notNull(),
    /** Legacy digests stay null when the old representation cannot prove the new canonical input. */
    logicalInputDigest: varchar('logical_input_digest', { length: 64 }),
    finalRequestDigest: varchar('final_request_digest', { length: 64 }),
    /** Better Auth session, deliberately independent of workbench session IDs. */
    authorizingSessionId: text('authorizing_session_id'),
    authRevision: integer('auth_revision'),
    status: text('status').$type<GenerationExecutionReceipt['status']>().notNull(),
    dispatch: text('dispatch')
      .$type<GenerationExecutionReceipt['dispatch']>()
      .notNull()
      .default('not_started'),
    costProvenance: text('cost_provenance')
      .$type<GenerationExecutionReceipt['costProvenance']>()
      .notNull()
      .default('not_sent'),
    /** Nullable is unknown/unavailable, never proof of a zero bill. */
    costPoints: integer('cost_points'),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    terminalAt: timestamp('terminal_at', { withTimezone: true, mode: 'date' }),
    purgedAt: timestamp('purged_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('generation_execution_receipts_principal_key_unique').on(
      table.principalId,
      table.idempotencyKey,
    ),
    unique('generation_execution_receipts_id_principal_unique').on(table.id, table.principalId),
    unique('generation_execution_receipts_original_run_unique').on(table.originalRunId),
    index('generation_execution_receipts_principal_created_idx').on(
      table.principalId,
      table.createdAt,
    ),
    check(
      'generation_execution_receipts_operation_check',
      sql`${table.operation} IN ('ordinary_create','explicit_retry','scheme_run','legacy_unknown') AND (${table.operation} <> 'legacy_unknown' OR ${table.bindingState} = 'legacy_unbound')`,
    ),
    check(
      'generation_execution_receipts_binding_state_check',
      sql`${table.bindingState} IN ('bound','legacy_unbound')`,
    ),
    check(
      'generation_execution_receipts_binding_check',
      sql`(${table.bindingState} = 'legacy_unbound' AND ${table.binding} IS NULL AND ${table.authorizingSessionId} IS NULL AND ${table.authRevision} IS NULL) OR (${table.bindingState} = 'bound' AND ${table.binding} IS NOT NULL AND ${table.binding}->>'principalId' IS NOT NULL AND ${table.binding}->>'principalId' = ${table.principalId} AND ${table.authorizingSessionId} IS NOT NULL AND ${table.authRevision} IS NOT NULL AND ${table.authRevision} > 0 AND ${table.logicalInputDigest} IS NOT NULL AND ${table.finalRequestDigest} IS NOT NULL)`,
    ),
    check(
      'generation_execution_receipts_digest_check',
      sql`(${table.logicalInputDigest} IS NULL OR ${table.logicalInputDigest} ~ '^[a-f0-9]{64}$') AND (${table.finalRequestDigest} IS NULL OR ${table.finalRequestDigest} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'generation_execution_receipts_status_check',
      sql`${table.status} IN ('queued','pending_approval','running','cancelling','succeeded','failed','cancelled','rejected','expired')`,
    ),
    check(
      'generation_execution_receipts_dispatch_check',
      sql`${table.dispatch} IN ('not_started','claimed','confirmed_not_sent')`,
    ),
    check(
      'generation_execution_receipts_cost_provenance_check',
      sql`${table.costProvenance} IN ('not_sent','unknown','provider_reported')`,
    ),
    check(
      'generation_execution_receipts_cost_check',
      sql`(${table.costPoints} IS NULL OR ${table.costPoints} >= 0) AND (${table.costProvenance} <> 'unknown' OR ${table.costPoints} IS NULL) AND (${table.costProvenance} <> 'not_sent' OR ${table.costPoints} IS NULL OR ${table.costPoints} = 0) AND (${table.costProvenance} <> 'provider_reported' OR ${table.costPoints} IS NOT NULL)`,
    ),
    check('generation_execution_receipts_revision_check', sql`${table.revision} > 0`),
  ],
);
