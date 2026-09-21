import { describe, expect, it } from 'vitest';
import {
  completeLoginCapacitySchema,
  loginCapacityReviewSchema,
  loginSessionPageSchema,
} from '../login-sessions';

describe('login session public contracts', () => {
  const item = {
    sessionRef: 'sid',
    version: 1,
    current: false,
    client: '浏览器',
    platform: 'macOS',
    createdAt: '2026-09-20T00:00:00Z',
    lastInteractiveAt: null,
    lastSeenAt: null,
    expiresAt: '2026-10-20T00:00:00Z',
    maskedIp: '192.168.*.*',
  };
  it('rejects leaked credentials and truncated totals', () => {
    const page = {
      items: [item],
      total: 1,
      limit: 50,
      required: 0,
      requiresReauthentication: false,
    };
    expect(loginSessionPageSchema.parse(page)).toEqual(page);
    expect(loginSessionPageSchema.safeParse({ ...page, total: 2 }).success).toBe(false);
    expect(
      loginSessionPageSchema.safeParse({ ...page, items: [{ ...item, token: 'secret' }] }).success,
    ).toBe(false);
    expect(
      loginCapacityReviewSchema.safeParse({
        flowRef: crypto.randomUUID(),
        expiresAt: item.expiresAt,
        sessions: page,
        flowToken: 'secret',
      }).success,
    ).toBe(false);
  });
  it('requires an explicit stable operation and unique fixed targets', () => {
    const request = {
      flowRef: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      selected: [{ sessionRef: 'sid', version: 1 }],
    };
    expect(completeLoginCapacitySchema.parse(request)).toEqual(request);
    expect(
      completeLoginCapacitySchema.safeParse({
        ...request,
        selected: [...request.selected, ...request.selected],
      }).success,
    ).toBe(false);
    expect(
      completeLoginCapacitySchema.safeParse({
        ...request,
        selected: [{ sessionRef: 'sid', version: 0 }],
      }).success,
    ).toBe(false);
  });
});
