import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { accountRecoveryRequests } from './credentials.js';

/** Quarantined proof only. Never a login session, a payer binding, or a spend approval. */
export const accountRecoveryBackupEvidence = pgTable(
  'account_recovery_backup_evidence',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .unique()
      .references(() => accountRecoveryRequests.id, { onDelete: 'cascade' }),
    targetUserId: text('target_user_id').notNull(),
    upstreamIssuer: text('upstream_issuer').notNull(),
    sourceProfileId: text('source_profile_id').notNull(),
    sourceDigest: text('source_digest').notNull(),
    provenance: jsonb('provenance').$type<Record<string, unknown>>().notNull(),
    ciphertext: text('ciphertext').notNull(),
    revision: integer('revision').notNull().default(1),
    leaseId: text('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    state: text('state').notNull().default('staged'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('account_recovery_backup_expiry_idx')
      .on(table.expiresAt, table.id)
      .where(sql`${table.state} = 'staged'`),
    check(
      'account_recovery_backup_state_check',
      sql`${table.state} IN ('staged','consumed','revoked')`,
    ),
    check('account_recovery_backup_revision_check', sql`${table.revision} > 0`),
    check('account_recovery_backup_digest_check', sql`${table.sourceDigest} ~ '^[a-f0-9]{64}$'`),
    check(
      'account_recovery_backup_secret_check',
      sql`${table.state} = 'staged' OR ${table.ciphertext} = ''`,
    ),
  ],
);
