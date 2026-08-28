import { describe, expect, it } from 'vitest';
import { decideLeaseRecovery } from '../tasks.js';

describe('生成租约恢复决策', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');

  it('已发出上游请求且租约过期 → 标记 unknown 而不是重试', () => {
    expect(
      decideLeaseRecovery(
        {
          status: 'running',
          upstreamRequestSent: true,
          leaseExpiresAt: new Date('2026-08-18T23:59:00.000Z'),
        },
        now,
      ),
    ).toBe('mark_unknown');
  });

  it('租约过期但尚未发出上游请求 → 允许继续执行', () => {
    expect(
      decideLeaseRecovery(
        {
          status: 'running',
          upstreamRequestSent: false,
          leaseExpiresAt: new Date('2026-08-18T23:59:00.000Z'),
        },
        now,
      ),
    ).toBe('continue');
  });

  it('租约仍然有效 → 不做任何处理', () => {
    expect(
      decideLeaseRecovery(
        {
          status: 'running',
          upstreamRequestSent: true,
          leaseExpiresAt: new Date('2026-08-19T00:01:00.000Z'),
        },
        now,
      ),
    ).toBe('skip');
  });

  it('没有租约 → 不做任何处理', () => {
    expect(
      decideLeaseRecovery(
        { status: 'running', upstreamRequestSent: true, leaseExpiresAt: null },
        now,
      ),
    ).toBe('skip');
  });
});
