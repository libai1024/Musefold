import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/**
 * Folder/Tag 永久删除身份。只保留同步所需的最小事实，不保留名称、层级或完整正文。
 * 不能随 90 天 change log / mutation receipt 裁剪，否则离线 bootstrap 与旧创建重放会复活实体。
 * 身份以 owner + entityType + entityId 为界；删除账号时按 FK 级联删除。
 */
export const syncTaxonomyTombstones = pgTable(
  'sync_taxonomy_tombstones',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    version: integer('version').notNull(),
    entityCreatedAt: timestamp('entity_created_at', { withTimezone: true, mode: 'date' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.entityType, table.entityId] }),
    check(
      'sync_taxonomy_tombstones_entity_type_check',
      sql`${table.entityType} in ('folder', 'tag')`,
    ),
    check('sync_taxonomy_tombstones_version_check', sql`${table.version} > 0`),
  ],
);
