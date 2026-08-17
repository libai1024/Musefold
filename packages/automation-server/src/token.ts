// Bearer token（V04-SECURITY §6）：32 字节 CSPRNG、base64url、常量时间比较。

import { randomBytes, timingSafeEqual, createHash } from 'crypto';

export const TOKEN_PREFIX = 'mf_at_';

export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * 常量时间比较：先各自 SHA-256 再 timingSafeEqual，
 * 长度差异不泄露（哈希后定长），内容差异不泄露（常量时间）。
 */
export function tokenEquals(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

/** 从 Authorization 头提取 Bearer token；格式不符返回 null。 */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header);
  return match ? match[1] : null;
}
