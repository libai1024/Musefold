import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { user } from './auth.js';

/**
 * 提示词库(字段形状对齐 @musefold/contracts prompt.ts)。
 * 实体 id 由客户端生成(entityIdSchema,<=64 字符);乐观锁 version;软删 deletedAt。
 * 所有权隔离在应用层:每条查询必须带 userId 条件(v2.5 弃用 RLS)。
 */
export const promptFolders = pgTable(
  'prompt_folders',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    parentId: varchar('parent_id', { length: 64 }),
    sortOrder: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('prompt_folders_user_idx').on(table.userId),
    uniqueIndex('prompt_folders_user_name_live_uq')
      .on(table.userId, sql`lower(btrim(${table.name}))`)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const promptTags = pgTable(
  'prompt_tags',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 40 }).notNull(),
    group: varchar('group_name', { length: 40 }),
    color: varchar('color', { length: 7 }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('prompt_tags_user_idx').on(table.userId),
    uniqueIndex('prompt_tags_user_name_live_uq')
      .on(table.userId, sql`lower(btrim(${table.name}))`)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const prompts = pgTable(
  'prompts',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 80 }).notNull(),
    description: varchar('description', { length: 500 }),
    content: text('content').notNull(),
    negative: text('negative'),
    folderId: varchar('folder_id', { length: 64 }),
    modelId: varchar('model_id', { length: 128 }),
    params: jsonb('params').$type<Record<string, unknown>>(),
    rating: integer('rating').notNull().default(0),
    isPinned: boolean('is_pinned').notNull().default(false),
    pinOrder: integer('pin_order'),
    usageCount: integer('usage_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    source: varchar('source', { length: 20 }).notNull().default('manual'),
    sourceUrl: varchar('source_url', { length: 2048 }),
    /**
     * 封面展示地址(契约 promptDocumentSchema.coverImageUrl,path-free):
     * 云端存对象存储公开/签名 URL;NULL = 无封面。绝不存本地路径。
     */
    coverImageUrl: varchar('cover_image_url', { length: 4096 }),
    /** Internal irreversible-retention marker; never a restorable partially cleaned document. */
    purgeStartedAt: timestamp('purge_started_at', { withTimezone: true, mode: 'date' }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('prompts_user_updated_idx').on(table.userId, table.updatedAt),
    check(
      'prompts_purge_state_check',
      sql`${table.purgeStartedAt} IS NULL OR ${table.deletedAt} IS NOT NULL`,
    ),
    index('prompts_user_folder_idx').on(table.userId, table.folderId),
  ],
);

export const promptTagLinks = pgTable(
  'prompt_tag_links',
  {
    promptId: varchar('prompt_id', { length: 64 })
      .notNull()
      .references(() => prompts.id, { onDelete: 'cascade' }),
    tagId: varchar('tag_id', { length: 64 })
      .notNull()
      .references(() => promptTags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.promptId, table.tagId] }),
    index('prompt_tag_links_tag_idx').on(table.tagId),
  ],
);

/** 使用事件按 (userId, eventId) 幂等去重;usageCount/lastUsedAt 由服务端聚合回写 prompts。 */
export const promptUsageEvents = pgTable(
  'prompt_usage_events',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    eventId: varchar('event_id', { length: 64 }).notNull(),
    promptId: varchar('prompt_id', { length: 64 }).notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    deviceId: text('device_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.eventId] }),
    index('prompt_usage_events_prompt_idx').on(table.userId, table.promptId),
    index('prompt_usage_events_retention_idx').on(table.promptId, table.userId, table.eventId),
  ],
);
