import { pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
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
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
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
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
