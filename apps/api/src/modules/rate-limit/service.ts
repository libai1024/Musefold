import { createHmac } from 'node:crypto';
import type { MusefoldDatabase } from '@musefold/db';
import { sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

export interface RateLimitPolicy {
  /** 窗口内允许的最大请求数。 */
  capacity: number;
  /** 固定窗口长度(秒)。 */
  windowSeconds: number;
}

export const RATE_LIMIT_POLICIES = {
  accountLogin: { capacity: 10, windowSeconds: 60 },
  accountRegister: { capacity: 5, windowSeconds: 300 },
  accountRedeem: { capacity: 5, windowSeconds: 3_600 },
  promptSync: { capacity: 180, windowSeconds: 60 },
  cloudMcp: { capacity: 120, windowSeconds: 60 },
  cloudMcpIp: { capacity: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * 固定窗口限流(PG 单条原子 upsert,应用层替代旧版 SQL 函数)。
 * 键经 HMAC 脱敏后落库,不存明文 IP/主体。
 */
export class RateLimiter {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly keySecret: string,
  ) {}

  async assertAllowed(namespace: string, subject: string, policy: RateLimitPolicy): Promise<void> {
    if (!namespace || !subject) {
      throw new AppError('INTERNAL_ERROR', '限流键配置无效');
    }
    const keyHash = createHmac('sha256', this.keySecret)
      .update(namespace)
      .update('\0')
      .update(subject)
      .digest('hex');
    const windowInterval = sql`make_interval(secs => ${policy.windowSeconds})`;
    const result = await this.db.execute(sql`
      INSERT INTO rate_limit_buckets (bucket_key, window_started_at, count, updated_at)
      VALUES (${keyHash}, now(), 1, now())
      ON CONFLICT (bucket_key) DO UPDATE SET
        count = CASE
          WHEN rate_limit_buckets.window_started_at <= now() - ${windowInterval} THEN 1
          ELSE rate_limit_buckets.count + 1
        END,
        window_started_at = CASE
          WHEN rate_limit_buckets.window_started_at <= now() - ${windowInterval} THEN now()
          ELSE rate_limit_buckets.window_started_at
        END,
        updated_at = now()
      RETURNING count, extract(epoch FROM (window_started_at + ${windowInterval} - now())) AS retry_after
    `);
    const row = result.rows[0] as
      | { count: number | string; retry_after: number | string }
      | undefined;
    if (!row) throw new AppError('INTERNAL_ERROR', '限流服务暂时不可用');
    if (Number(row.count) > policy.capacity) {
      throw new AppError('RATE_LIMITED', '请求过于频繁，请稍后重试', 429, true, {
        retryAfterSeconds: Math.max(1, Math.ceil(Number(row.retry_after))),
      });
    }
  }
}
