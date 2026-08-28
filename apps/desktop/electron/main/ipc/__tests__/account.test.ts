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
  const events: string[] = [];
  const status = {
    loggedIn: false,
    userId: null,
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
    register: vi.fn(async () => {
      events.push('account:register');
      return { ...status, loggedIn: true, userId: '7', username: 'user' };
    }),
    login: vi.fn(async () => {
      events.push('account:login');
      return { ...status, loggedIn: true, userId: '7', username: 'user' };
    }),
    logout: vi.fn(async () => {
      events.push('account:logout');
      return status;
    }),
    redeem: vi.fn(async () => ({ quotaAdded: 500000, status })),
    refreshQuota: vi.fn(async () => status),
    setServerUrl: vi.fn(async () => status),
  };
  const cloudSync = {
    prepareForAccountLogin: vi.fn(async () => {
      events.push('sync:prepare-login');
    }),
    completeAccountLogin: vi.fn(async () => {
      events.push('sync:complete-login');
    }),
    cancelAccountTransition: vi.fn(async () => {
      events.push('sync:cancel-transition');
    }),
    prepareForAccountLogout: vi.fn(async () => {
      events.push('sync:prepare-logout');
    }),
    completeAccountLogout: vi.fn(() => {
      events.push('sync:complete-logout');
    }),
  };
  registerAccountHandlers({
    target: {
      handle: ((channel: string, listener: Handler) => {
        handlers.set(channel, listener);
      }) as never,
    },
    service: service as never,
    cloudSync: cloudSync as never,
  });
  return { handlers, service, cloudSync, events, status };
}

describe('account IPC handlers', () => {
  it('registers the full account surface and never returns credentials', async () => {
    const { handlers, service } = harness();
    expect([...handlers.keys()].sort()).toEqual(
      [
        IPC.ACCOUNT_LOGIN,
        IPC.ACCOUNT_LOGOUT,
        IPC.ACCOUNT_REDEEM,
        IPC.ACCOUNT_REFRESH_QUOTA,
        IPC.ACCOUNT_REGISTER,
        IPC.ACCOUNT_SET_SERVER_URL,
        IPC.ACCOUNT_STATUS,
      ].sort(),
    );

    const result = await handlers.get(IPC.ACCOUNT_LOGIN)?.(
      {},
      {
        username: 'user',
        password: 'password-secret',
      },
    );
    expect(service.login).toHaveBeenCalledWith({ username: 'user', password: 'password-secret' });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('"userId":"7"');
    expect(serialized).not.toContain('password-secret');
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('refresh');
  });

  it('validates credentials before touching account or sync state', async () => {
    const { handlers, service, cloudSync } = harness();
    await expect(
      handlers.get(IPC.ACCOUNT_LOGIN)?.({}, { username: 'x', password: 'short' }),
    ).rejects.toThrow(ACCOUNT_ERROR_IPC_PREFIX);
    expect(service.login).not.toHaveBeenCalled();
    expect(cloudSync.prepareForAccountLogin).not.toHaveBeenCalled();
  });

  it('coordinates login and logout around cloud sync lifecycle boundaries', async () => {
    const { handlers, events } = harness();
    await handlers.get(IPC.ACCOUNT_LOGIN)?.(
      {},
      {
        username: 'user',
        password: 'password',
      },
    );
    expect(events).toEqual(['sync:prepare-login', 'account:login', 'sync:complete-login']);

    events.length = 0;
    await handlers.get(IPC.ACCOUNT_LOGOUT)?.({});
    expect(events).toEqual(['sync:prepare-logout', 'account:logout', 'sync:complete-logout']);
  });

  it('cancels the sync transition when authentication fails', async () => {
    const { handlers, service, events } = harness();
    service.login.mockImplementationOnce(async () => {
      events.push('account:login');
      throw new AccountError('ACCOUNT/CREDENTIALS', '用户名或密码错误', 'auth');
    });

    await expect(
      handlers.get(IPC.ACCOUNT_LOGIN)?.(
        {},
        {
          username: 'user',
          password: 'password',
        },
      ),
    ).rejects.toThrow(ACCOUNT_ERROR_IPC_PREFIX);
    expect(events).toEqual(['sync:prepare-login', 'account:login', 'sync:cancel-transition']);
  });

  it('returns the authenticated account when sync finalization fails closed', async () => {
    const { handlers, cloudSync } = harness();
    cloudSync.completeAccountLogin.mockRejectedValueOnce(new Error('sync database unavailable'));

    await expect(
      handlers.get(IPC.ACCOUNT_LOGIN)?.(
        {},
        {
          username: 'user',
          password: 'password',
        },
      ),
    ).resolves.toMatchObject({ loggedIn: true, userId: '7' });
    expect(cloudSync.cancelAccountTransition).toHaveBeenCalledOnce();
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
