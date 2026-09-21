import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  AnalystReport,
  CompilerOutput,
  DesignSchemeTextAuthorization,
  DesignSchemeAgentRevisionBase,
  designSchemeRolePromptSchema,
  designSchemeTextUsageSchema,
} from '@musefold/contracts';
import { designSchemeAgentSessions } from './design-scheme-agent.js';

/** No session FK: logout must not delete an already-sent request or its unknown-cost evidence. */
export const designSchemeTextExecutions = pgTable(
  'design_scheme_text_executions',
  {
    userId: text('user_id').notNull(),
    executionId: varchar('execution_id', { length: 64 }).notNull(),
    authSessionId: text('auth_session_id').notNull(),
    authRevision: integer('auth_revision').notNull(),
    authorization: jsonb('authorization').$type<DesignSchemeTextAuthorization>().notNull(),
    revisionBase: jsonb('revision_base').$type<DesignSchemeAgentRevisionBase>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.executionId] }),
    foreignKey({
      columns: [t.userId, t.executionId],
      foreignColumns: [designSchemeAgentSessions.userId, designSchemeAgentSessions.executionId],
      name: 'scheme_text_execution_parent_fk',
    }).onDelete('cascade'),
    check('scheme_text_auth_revision_positive', sql`${t.authRevision} > 0`),
  ],
);

/** One claim per fixed role/ordinal; queue retries never clear a sent record. */
export const designSchemeTextCalls = pgTable(
  'design_scheme_text_calls',
  {
    userId: text('user_id').notNull(),
    executionId: varchar('execution_id', { length: 64 }).notNull(),
    ordinal: integer('ordinal').notNull(),
    role: varchar('role', { length: 12 }).notNull().$type<'analyst' | 'compiler' | 'reviser'>(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    prompt: jsonb('prompt').$type<z.infer<typeof designSchemeRolePromptSchema>>().notNull(),
    status: varchar('status', { length: 12 })
      .notNull()
      .$type<'sent' | 'completed' | 'invalid' | 'unknown'>(),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }).notNull(),
    output: jsonb('output').$type<AnalystReport | CompilerOutput>(),
    usage: jsonb('usage').$type<z.infer<typeof designSchemeTextUsageSchema>>(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.executionId, t.ordinal] }),
    foreignKey({
      columns: [t.userId, t.executionId],
      foreignColumns: [designSchemeTextExecutions.userId, designSchemeTextExecutions.executionId],
      name: 'scheme_text_call_execution_fk',
    }).onDelete('cascade'),
    check('scheme_text_call_ordinal', sql`${t.ordinal} >= 0 AND ${t.ordinal} < 17`),
    check('scheme_text_call_role', sql`${t.role} IN ('analyst','compiler','reviser')`),
    check('scheme_text_call_status', sql`${t.status} IN ('sent','completed','invalid','unknown')`),
    check(
      'scheme_text_call_output',
      sql`(${t.status} = 'completed' AND ${t.output} IS NOT NULL AND ${t.completedAt} IS NOT NULL) OR (${t.status} <> 'completed' AND ${t.output} IS NULL)`,
    ),
  ],
);
