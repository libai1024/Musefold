import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { session, user } from './auth.js';

/**
 * 用户凭据(服务端唯一敏感面):New API 网关签发的生图 API token,AES-256-GCM 加密存储。
 * 密钥来自环境变量(CREDENTIAL_ENCRYPTION_KEY),keyVersion 支持轮换。
 * 明文只在 api(写入)与 worker(生图时解密)进程内存中出现,不落日志、不出接口。
 */
export const accountCredentials = pgTable(
  'account_credentials',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull().default('new-api'),
    externalTokenId: varchar('external_token_id', { length: 128 }),
    ciphertext: text('ciphertext').notNull(),
    keyVersion: varchar('key_version', { length: 16 }).notNull().default('v1'),
    upstreamIssuer: text('upstream_issuer'),
    upstreamOwnerId: text('upstream_owner_id'),
    credentialRef: text('credential_ref'),
    credentialVersion: integer('credential_version').notNull().default(0),
    status: text('status').notNull().default('unverified'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.provider] }),
    check(
      'account_credential_status_check',
      sql`${table.status} IN ('unverified','active','revoked')`,
    ),
    check('account_credential_version_check', sql`${table.credentialVersion} >= 0`),
    check(
      'account_credential_active_source_check',
      sql`${table.status} <> 'active' OR (${table.upstreamIssuer} IS NOT NULL AND ${table.upstreamOwnerId} IS NOT NULL AND ${table.credentialRef} IS NOT NULL AND ${table.credentialVersion} > 0 AND ${table.verifiedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * New API 中继会话凭据(jwt + refreshToken),按 Better Auth 会话粒度加密存储:
 * 登出/会话过期即随行删除,多设备互不影响。余额/兑换等直连 New API 的操作按需解密并就地刷新。
 */
export const relaySessions = pgTable('relay_sessions', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => session.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  keyVersion: varchar('key_version', { length: 16 }).notNull().default('v1'),
  upstreamIssuer: text('upstream_issuer'),
  upstreamOwnerId: text('upstream_owner_id'),
  revision: integer('revision').notNull().default(0),
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
  refreshLeaseId: text('refresh_lease_id'),
  refreshLeaseUntil: timestamp('refresh_lease_until', { withTimezone: true, mode: 'date' }),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** Stable issuer/owner binding. Legacy user.email/newApiUserId remain untrusted hints. */
export const accountIdentities = pgTable(
  'account_identities',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    apiIssuer: text('api_issuer'),
    upstreamIssuer: text('upstream_issuer'),
    upstreamOwnerId: text('upstream_owner_id'),
    status: text('status').notNull().default('unverified'),
    identityVersion: integer('identity_version').notNull().default(0),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('account_identity_issuer_owner_unique').on(
      table.upstreamIssuer,
      table.upstreamOwnerId,
    ),
    check(
      'account_identity_status_check',
      sql`${table.status} IN ('unverified','active','verification_pending','identity_conflict','recovery_required')`,
    ),
    check('account_identity_version_check', sql`${table.identityVersion} >= 0`),
    check(
      'account_identity_active_source_check',
      sql`${table.status} <> 'active' OR (${table.apiIssuer} IS NOT NULL AND ${table.upstreamIssuer} IS NOT NULL AND ${table.upstreamOwnerId} IS NOT NULL AND ${table.verifiedAt} IS NOT NULL)`,
    ),
  ],
);

/** Missing rows denote legacy sessions: recovery access only, never normal authority. */
export const accountSessionAuthorizations = pgTable(
  'account_session_authorizations',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => session.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('account_session_mode_check', sql`${table.mode} IN ('normal','recovery_only')`),
  ],
);

/** Candidate secrets are isolated from historical relay evidence until successful activation. */
export const accountRecoveryRequests = pgTable(
  'account_recovery_requests',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .unique()
      .references(() => session.id, { onDelete: 'cascade' }),
    targetUserId: text('target_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    upstreamIssuer: text('upstream_issuer').notNull(),
    upstreamOwnerId: text('upstream_owner_id').notNull(),
    candidateCiphertext: text('candidate_ciphertext').notNull(),
    candidateSummary: jsonb('candidate_summary').$type<Record<string, unknown>>().notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    revision: integer('revision').notNull().default(1),
    identityVersion: integer('identity_version').notNull(),
    completedUserId: text('completed_user_id').references(() => user.id),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'account_recovery_reason_check',
      sql`${table.reason} IN ('legacy_issuer_unknown','legacy_evidence_missing','legacy_identity_conflict','verification_pending')`,
    ),
    check('account_recovery_status_check', sql`${table.status} IN ('pending','completed')`),
    index('account_recovery_request_expiry_idx')
      .on(table.expiresAt, table.id)
      .where(sql`${table.candidateCiphertext} <> ''`),
  ],
);
