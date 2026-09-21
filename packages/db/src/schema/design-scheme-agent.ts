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
  varchar,
} from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  designSchemeAgentSessionSchema,
  DesignSchemeUpdateContext,
  DesignSchemeAgentMaterials,
  startDesignSchemeAgentInputSchema,
} from '@musefold/contracts';
import { user } from './auth.js';

export const designSchemeAgentSessions = pgTable(
  'design_scheme_agent_sessions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    executionId: varchar('execution_id', { length: 64 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }), // null only for a cancel-before-start tombstone
    request: jsonb('request').$type<z.infer<typeof startDesignSchemeAgentInputSchema>>(),
    sourceExecutionIds: jsonb('source_execution_ids').$type<string[]>().notNull(),
    updateContext: jsonb('update_context').$type<DesignSchemeUpdateContext>(),
    materials: jsonb('materials').$type<DesignSchemeAgentMaterials>(),
    view: jsonb('view').$type<z.infer<typeof designSchemeAgentSessionSchema>>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.executionId] }),
    index('scheme_agent_history_idx').on(t.userId, t.createdAt.desc(), t.executionId.desc()),
    index('scheme_agent_reconcile_idx').on(t.expiresAt, t.updatedAt),
    check(
      'scheme_agent_request_check',
      sql`(${t.requestHash} IS NULL AND ${t.request} IS NULL AND ${t.view}->>'status' = 'cancelled') OR (${t.requestHash} IS NOT NULL AND ${t.request} IS NOT NULL)`,
    ),
  ],
);

export const designSchemeAgentEvents = pgTable(
  'design_scheme_agent_events',
  {
    userId: text('user_id').notNull(),
    executionId: varchar('execution_id', { length: 64 }).notNull(),
    seq: integer('seq').notNull(),
    session: jsonb('session').$type<z.infer<typeof designSchemeAgentSessionSchema>>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.executionId, t.seq] }),
    foreignKey({
      columns: [t.userId, t.executionId],
      foreignColumns: [designSchemeAgentSessions.userId, designSchemeAgentSessions.executionId],
      name: 'scheme_agent_event_owner_fk',
    }).onDelete('cascade'),
    check('scheme_agent_event_positive_seq', sql`${t.seq} > 0`),
  ],
);
