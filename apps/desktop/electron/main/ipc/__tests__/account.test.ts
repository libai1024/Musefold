import { describe, expect, it, vi } from 'vitest';
import { IPC } from '@musefold/desktop-contracts/ipc';
import { AccountError, ACCOUNT_ERROR_IPC_PREFIX } from '../../../account/errors';

vi.mock('../../../account', () => ({
  getAccountService: () => {
    throw new Error('测试必须注入 service');
  },
}));

import { registerAccountHandlers } from '../account';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness() {
  const handlers = new Map<string, Handler>();
  const status = {
    loggedIn: false,
    username: null,
    serverUrl: 'https://relay.test',
    isDefaultServer: false,
    quota: null,
    estImagesRemaining: null,
    deviceTokenSuffix: null,
    health: 'unknown' as const,
    notices: [],
  };
  const service = {
    status: vi.fn(() => status),
    register: vi.fn(async () => ({ ...status, loggedIn: true, username: 'user' })),
    login: vi.fn(async () => ({ ...status, loggedIn: true, username: 'user' })),
    logout: vi.fn(async () => status),
    redeem: vi.fn(async () => ({ quotaAdded: 500000, status })),
    refreshQuota: vi.fn(async () => status),
    setServerUrl: vi.fn(async () => status),
  };
  registerAccountHandlers({
    target: {
      handle: ((channel: string, listener: Handler) => {
        handlers.set(channel, listener);
      }) as never,
    },
    service: service as never,
  });
  return { handlers, service, status };
}

describe('account IPC handlers', () => {
  it('registers the full account surface and never returns credentials', async () => {
    const { handlers, service } = harness();
    expect([...handlers.keys()].sort()).toEqual([
      IPC.ACCOUNT_LOGIN,
      IPC.ACCOUNT_LOGOUT,
      IPC.ACCOUNT_REDEEM,
      IPC.ACCOUNT_REFRESH_QUOTA,
      IPC.ACCOUNT_REGISTER,
      IPC.ACCOUNT_SET_SERVER_URL,
      IPC.ACCOUNT_STATUS,
    ].sort());

    const result = await handlers.get(IPC.ACCOUNT_LOGIN)?.({}, {
      username: 'user',
      password: 'password-secret',
    });
    expect(service.login).toHaveBeenCalledWith({ username: 'user', password: 'password-secret' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('password-secret');
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('refresh');
  });

  it('validates credentials before calling service', async () => {
    const { handlers, service } = harness();
    await expect(
      handlers.get(IPC.ACCOUNT_LOGIN)?.({}, { username: 'x', password: 'short' }),
    ).rejects.toThrow(ACCOUNT_ERROR_IPC_PREFIX);
    expect(service.login).not.toHaveBeenCalled();
  });

  it('serializes AccountError code/stage for preload restoration', async () => {
    const { handlers, service } = harness();
    service.login.mockRejectedValueOnce(
      new AccountError('ACCOUNT/CREDENTIALS', '用户名或密码错误', 'auth'),
    );
    const error = await Promise.resolve(
      handlers.get(IPC.ACCOUNT_LOGIN)?.({}, { username: 'user', password: 'password' }),
    ).then(
      () => null,
      (value) => value as Error,
    );
    expect(error?.message).toContain(ACCOUNT_ERROR_IPC_PREFIX);
    expect(error?.message).toContain('"code":"ACCOUNT/CREDENTIALS"');
    expect(error?.message).toContain('"stage":"auth"');
  });
});
