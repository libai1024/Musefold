import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/**
 * 工作台与生图(字段形状对齐 @musefold/contracts workbench.ts / generation.ts)。
 * promptId 不设外键:提示词删除后历史记录保持原样。
 */
export const workbenchSessions = pgTable(
  'workbench_sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 120 }).notNull(),
    draft: jsonb('draft').$type<Record<string, unknown>>().notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('workbench_sessions_user_updated_idx').on(table.userId, table.updatedAt)],
);

export const generationRuns = pgTable(
  'generation_runs',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: varchar('session_id', { length: 64 }),
    parentRunId: varchar('parent_run_id', { length: 64 }),
    promptId: varchar('prompt_id', { length: 64 }),
    runKind: varchar('run_kind', { length: 20 }).notNull().default('free_generation'),
    actorType: varchar('actor_type', { length: 20 }).notNull().default('web'),
    approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('not_required'),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    request: jsonb('request').$type<Record<string, unknown>>().notNull(),
    /** 生成时的提示词快照(溯源用,契约不外露)。 */
    promptSnapshot: jsonb('prompt_snapshot').$type<Record<string, unknown>>(),
    /** 幂等键按用户隔离(复合唯一,见表级索引):不同用户可以撞同一个键。 */
    idempotencyKey: varchar('idempotency_key', { length: 160 }),
    providerModel: varchar('provider_model', { length: 128 }),
    costPoints: integer('cost_points'),
    errorCode: varchar('error_code', { length: 80 }),
    errorMessage: varchar('error_message', { length: 500 }),
    /**
     * 计费安全三件套:上游请求一旦发出(upstreamRequestSent)就绝不盲目重试;
     * 租约过期且已发出 → 标记 GENERATION_UPSTREAM_UNKNOWN 而非重跑。
     */
    attemptCount: integer('attempt_count').notNull().default(0),
    upstreamRequestSent: boolean('upstream_request_sent').notNull().default(false),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('generation_runs_user_created_idx').on(table.userId, table.createdAt),
    index('generation_runs_user_session_idx').on(table.userId, table.sessionId),
    index('generation_runs_user_status_idx').on(table.userId, table.status),
    unique('generation_runs_id_user_unique').on(table.id, table.userId),
    uniqueIndex('generation_runs_user_idempotency_key_idx').on(table.userId, table.idempotencyKey),
  ],
);

/** 资产只存 S3 objectKey;对外 URL 与过期时间在 API 读取时预签名派生。 */
export const generationAssets = pgTable(
  'generation_assets',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    runId: varchar('run_id', { length: 64 })
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    mimeType: varchar('mime_type', { length: 32 }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull().default(0),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('generation_assets_run_idx').on(table.runId)],
);

/** 运行事件流(排队/进度/完成/失败),worker 追加,API 轮询消费。 */
export const generationEvents = pgTable(
  'generation_events',
  {
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    runId: varchar('run_id', { length: 64 })
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('generation_events_run_idx').on(table.runId, table.seq)],
);
