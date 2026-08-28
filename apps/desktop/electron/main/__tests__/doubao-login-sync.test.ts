import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners: Array<(status: { loggedIn: boolean }) => void> = [];
const run = vi.fn();
const prepare = vi.fn((_sql: string) => ({ run }));

vi.mock('../../doubao-web/browser-service', () => ({
  subscribeDoubaoWebLogin: (listener: (status: { loggedIn: boolean }) => void) => {
    listeners.push(listener);
    return () => undefined;
  },
}));
vi.mock('@musefold/core/db', () => ({ getDb: () => ({ prepare }) }));

import { startDoubaoLoginSync } from '../doubao-login-sync';

describe('doubao 登录态 → providers 表同步', () => {
  beforeEach(() => {
    listeners.length = 0;
    run.mockClear();
    prepare.mockClear();
  });

  it('登录时置 has_key=1 并写「网页会话」后缀', () => {
    startDoubaoLoginSync();
    expect(listeners).toHaveLength(1);
    listeners[0]({ loggedIn: true });
    expect(prepare.mock.calls[0][0]).toContain("type = 'doubao-web'");
    expect(run).toHaveBeenCalledWith(1, '网页会话', expect.any(Number));
  });

  it('登出时清空 has_key 与后缀', () => {
    startDoubaoLoginSync();
    listeners[0]({ loggedIn: false });
    expect(run).toHaveBeenCalledWith(0, null, expect.any(Number));
  });
});
