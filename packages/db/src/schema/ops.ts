import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * 固定窗口限流桶(应用层逻辑,替代旧版 SQL 函数方案)。
 * bucketKey 形如 `login:<ip>`、`mcp:<clientId>`;窗口过期即重置。
 */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  bucketKey: varchar('bucket_key', { length: 256 }).primaryKey(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
  count: integer('count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
