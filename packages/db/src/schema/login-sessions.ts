import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Short-lived login flow. Secret grant and any completion are encrypted; the
 * renderer receives only id. A separate HttpOnly/main-process binding is required. */
export const loginCapacityFlows = pgTable(
  'login_capacity_flows',
  {
    id: text('id').primaryKey(),
    bindingHash: text('binding_hash').notNull(),
    upstreamIssuer: text('upstream_issuer').notNull(),
    ciphertext: text('ciphertext').notNull(),
    state: text('state').notNull().default('pending'),
    operationId: text('operation_id'),
    selectionDigest: text('selection_digest'),
    leaseId: text('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    sessionId: text('session_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('login_capacity_flows_expiry_idx').on(table.expiresAt)],
);

/** Does NOT cascade with Better Auth: deletion must leave release responsibility
 * intact. Only encrypted revoke-only proof is persisted for managed sessions. */
export const loginSessionReleases = pgTable(
  'login_session_releases',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id'),
    upstreamIssuer: text('upstream_issuer').notNull(),
    upstreamSid: text('upstream_sid').notNull(),
    ciphertext: text('ciphertext').notNull(),
    state: text('state').notNull().default('candidate'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }).notNull(),
    leaseId: text('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('login_release_issuer_sid_unique').on(table.upstreamIssuer, table.upstreamSid),
    index('login_release_session_idx').on(table.sessionId),
    index('login_release_due_idx').on(table.state, table.nextAttemptAt),
  ],
);
