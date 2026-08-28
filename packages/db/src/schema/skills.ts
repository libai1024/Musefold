import { jsonb, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * 官方发布的只读视觉 Skills(全局表,云端 MCP list_skills / get_skill 数据源)。
 * 服务端从不执行 skill 内容;(id, version) 定位固定版本,contentHash 供客户端校验。
 */
export const publishedSkills = pgTable(
  'published_skills',
  {
    id: varchar('id', { length: 120 }).notNull(),
    version: varchar('version', { length: 32 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull().default(''),
    content: text('content').notNull(),
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull().default({}),
    contentHash: varchar('content_hash', { length: 128 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('published'),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.id, table.version] })],
);
