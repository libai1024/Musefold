import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/**
 * 桌面 local-first 同步(语义对齐 @musefold/contracts sync.ts)。
 * 「登录 != 同步」:设备注册后才有同步关系;revokedAt 非空即吊销。
 */
export const syncDevices = pgTable(
  'sync_devices',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    platform: varchar('platform', { length: 20 }).notNull(),
    clientVersion: varchar('client_version', { length: 32 }).notNull(),
    lastPullCursor: bigint('last_pull_cursor', { mode: 'number' }).notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.deviceId] })],
);

/**
 * 变更日志(append-only):既是 pull 的变更源,也是 push 幂等记录。
 * - REST 写路径与 push 写路径都追加一行(operation upsert/delete + 完整 snapshot)。
 * - push 携带 mutationId 时按 (userId, mutationId) 判重,重放返回原结果。
 */
export const syncChangeLog = pgTable(
  'sync_change_log',
  {
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    operation: varchar('operation', { length: 10 }).notNull(),
    version: bigint('version', { mode: 'number' }).notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    sourceDeviceId: text('source_device_id'),
    sourceMutationId: varchar('source_mutation_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('sync_change_log_user_seq_idx').on(table.userId, table.seq)],
);

/**
 * push 幂等重放记录:按 (userId, deviceId, mutationId) 存储首次执行的完整结果
 * (含 conflict / rejected),重放原样返回,绝不重复执行。
 */
export const syncMutationResults = pgTable(
  'sync_mutation_results',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    mutationId: varchar('mutation_id', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    resultStatus: varchar('result_status', { length: 20 }).notNull(),
    resultVersion: bigint('result_version', { mode: 'number' }),
    resultSnapshot: jsonb('result_snapshot').$type<Record<string, unknown>>(),
    errorCode: varchar('error_code', { length: 80 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.deviceId, table.mutationId] })],
);

/** 变更日志保留水位(单行):seq 小于水位的游标视为过期(410,需全量重同步)。 */
export const syncRetentionState = pgTable('sync_retention_state', {
  id: text('id').primaryKey().default('singleton'),
  minAvailableCursor: bigint('min_available_cursor', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
