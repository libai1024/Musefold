import { createHmac } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { MusefoldDatabase } from "../../database/types.js";
import { AppError } from "../../errors.js";

export interface RateLimitPolicy {
  capacity: number;
  refillPerSecond: number;
  cost?: number;
}

export interface RateLimiterPort {
  assertAllowed(
    namespace: string,
    subject: string,
    policy: RateLimitPolicy,
  ): Promise<void>;
}

export const RATE_LIMIT_POLICIES = {
  accountLogin: { capacity: 10, refillPerSecond: 10 / 60 },
  accountRegister: { capacity: 5, refillPerSecond: 5 / 300 },
  desktopSession: { capacity: 20, refillPerSecond: 20 / 60 },
  accountRedeem: { capacity: 5, refillPerSecond: 5 / 3_600 },
  accountReauth: { capacity: 5, refillPerSecond: 5 / 3_600 },
  promptSync: { capacity: 180, refillPerSecond: 3 },
  cloudMcpIp: { capacity: 300, refillPerSecond: 5 },
  cloudMcp: { capacity: 120, refillPerSecond: 2 },
} as const satisfies Record<string, RateLimitPolicy>;

export class PostgresRateLimiter implements RateLimiterPort {
  constructor(
    private readonly db: Kysely<MusefoldDatabase>,
    private readonly keySecret: string,
  ) {}

  async assertAllowed(
    namespace: string,
    subject: string,
    policy: RateLimitPolicy,
  ): Promise<void> {
    if (!namespace || !subject) {
      throw new AppError("INTERNAL_ERROR", "限流键配置无效", 500);
    }
    const cost = policy.cost ?? 1;
    const keyHash = createHmac("sha256", this.keySecret)
      .update(namespace)
      .update("\0")
      .update(subject)
      .digest("hex");
    const result = await sql<{
      allowed: boolean;
      remaining_tokens: number;
      retry_after_seconds: number;
    }>`
      SELECT allowed, remaining_tokens, retry_after_seconds
      FROM ops.consume_rate_limit(
        ${keyHash},
        ${policy.capacity},
        ${policy.refillPerSecond},
        ${cost}
      )
    `.execute(this.db);
    const decision = result.rows[0];
    if (!decision) {
      throw new AppError("INTERNAL_ERROR", "限流服务暂时不可用", 500, true);
    }
    if (!decision.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "请求过于频繁，请稍后重试",
        429,
        true,
        {
          retryAfterSeconds: decision.retry_after_seconds,
          remaining: decision.remaining_tokens,
        },
      );
    }
  }
}
