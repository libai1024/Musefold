import { describe, expect, it } from 'vitest';
import {
  doubaoAccountStatusSchema,
  doubaoLoginStateSchema,
  doubaoUsageStatusSchema,
  V25_METHOD_NAMES,
  V25_METHODS_BY_DOMAIN,
} from '../index';

const USAGE = { date: '2026-09-01', limit: 100, used: 3, remaining: 97 };

describe('doubao contracts(桌面专属可选域)', () => {
  it('registers the canonical doubao domain method set', () => {
    expect([...V25_METHODS_BY_DOMAIN.doubao].sort()).toEqual([
      'doubao.getStatus',
      'doubao.logout',
      'doubao.refreshLogin',
      'doubao.startLogin',
    ]);
    for (const name of V25_METHODS_BY_DOMAIN.doubao) {
      expect(V25_METHOD_NAMES).toContain(name);
    }
  });

  it('accepts the frozen login state machine and rejects unknown states', () => {
    for (const state of [
      'logged-out',
      'loading',
      'qr-ready',
      'scanned',
      'logged-in',
      'verification-required',
      'error',
    ]) {
      expect(doubaoLoginStateSchema.safeParse(state).success).toBe(true);
    }
    expect(doubaoLoginStateSchema.safeParse('logged_in').success).toBe(false);
    expect(doubaoLoginStateSchema.safeParse('').success).toBe(false);
  });

  it('normalizes optional frozen login-flow fields to required nulls', () => {
    // 冻结面最小快照:loginState/qr* 缺省;canonical 出参归一为必填 + null。
    const parsed = doubaoAccountStatusSchema.parse({
      loggedIn: false,
      accountName: null,
      avatarDataUrl: null,
      verificationRequired: false,
      usage: USAGE,
    });
    expect(parsed).toEqual({
      loggedIn: false,
      accountName: null,
      avatarDataUrl: null,
      verificationRequired: false,
      usage: USAGE,
      loginState: 'logged-out',
      qrCodeDataUrl: null,
      qrExpiresAt: null,
      errorMessage: null,
    });
  });

  it('round-trips a qr-ready snapshot with data URL and expiry', () => {
    const snapshot = {
      loggedIn: false,
      accountName: null,
      avatarDataUrl: null,
      verificationRequired: false,
      usage: USAGE,
      loginState: 'qr-ready' as const,
      qrCodeDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      qrExpiresAt: 1_800_000_000_000,
      errorMessage: null,
    };
    expect(doubaoAccountStatusSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('rejects malformed usage and path/credential-shaped payloads', () => {
    expect(
      doubaoUsageStatusSchema.safeParse({ date: '09/01/2026', limit: 100, used: 3, remaining: 97 })
        .success,
    ).toBe(false);
    expect(doubaoUsageStatusSchema.safeParse({ ...USAGE, used: -1 }).success).toBe(false);
    // 严格对象:会话 cookie / 分区名 / 本地路径等字段一律不允许混入。
    expect(
      doubaoAccountStatusSchema.safeParse({
        loggedIn: true,
        accountName: 'creator',
        avatarDataUrl: null,
        verificationRequired: false,
        usage: USAGE,
        sessionPartition: 'persist:musefold-doubao-web-v1',
      }).success,
    ).toBe(false);
    expect(
      doubaoAccountStatusSchema.safeParse({
        loggedIn: true,
        accountName: 'creator',
        avatarDataUrl: null,
        verificationRequired: false,
        usage: USAGE,
        qrExpiresAt: -5,
      }).success,
    ).toBe(false);
  });
});
