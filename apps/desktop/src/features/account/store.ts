// src/features/account/store.ts
// 渲染层账号状态（v0.5）。密码只作为 login/register 的瞬时参数，不进入 Zustand。

import { create } from 'zustand';
import { DEFAULT_ACCOUNT_SERVER_URL } from '@musefold/domain/constants';
import type {
  AccountCredentialsInput,
  AccountErrorCode,
  AccountRedeemResult,
  AccountStatus,
} from '@shared/types/account';
import api from '../../lib/ipc';
import { useGenerationStore } from '../generation/store';
import { useAiConnectionStore } from '../settings/ai-connection-store';

/**
 * 登录/登出/换服务器会在主进程创建或回收托管服务商与 Agent 连接，
 * 渲染层两份列表必须跟着重载，否则侧栏与设置里会出现「登录了却看不到」
 * 或「登出后还能选中幽灵托管条目」。引导流登录另有自己的重载逻辑。
 */
async function reloadManagedStacks(): Promise<void> {
  await Promise.allSettled([
    useGenerationStore.getState().loadProviders(),
    useAiConnectionStore.getState().load(),
  ]);
}

export interface AccountUiError {
  code: AccountErrorCode | 'UNKNOWN';
  message: string;
}

interface AccountState {
  status: AccountStatus;
  loaded: boolean;
  loading: boolean;
  action: 'login' | 'register' | 'logout' | 'redeem' | 'refresh' | 'server' | null;
  error: AccountUiError | null;
  /** 最近一次登录过的用户名：登出/失效后重新登录时预填，少输一遍。 */
  lastUsername: string | null;
  initialize: () => Promise<void>;
  login: (input: AccountCredentialsInput) => Promise<AccountStatus>;
  register: (input: AccountCredentialsInput) => Promise<AccountStatus>;
  logout: () => Promise<AccountStatus>;
  redeem: (code: string) => Promise<AccountRedeemResult>;
  refreshQuota: () => Promise<AccountStatus>;
  setServerUrl: (url: string) => Promise<AccountStatus>;
  clearError: () => void;
}

const EMPTY_STATUS: AccountStatus = {
  loggedIn: false,
  username: null,
  serverUrl: DEFAULT_ACCOUNT_SERVER_URL,
  isDefaultServer: true,
  quota: null,
  estImagesRemaining: null,
  deviceTokenSuffix: null,
  health: 'unknown',
  notices: [],
};

function uiError(error: unknown): AccountUiError {
  const e = error as { code?: AccountErrorCode; message?: string };
  return {
    code: e?.code ?? 'UNKNOWN',
    message: e?.message || '账号操作失败，请重试',
  };
}

let subscribed = false;

export const useAccountStore = create<AccountState>((set) => {
  const run = async <T>(
    action: NonNullable<AccountState['action']>,
    operation: () => Promise<T>,
    statusOf?: (result: T) => AccountStatus,
  ): Promise<T> => {
    set({ action, error: null });
    try {
      const result = await operation();
      const status = statusOf?.(result);
      set({ ...(status ? { status } : {}), action: null, loaded: true });
      return result;
    } catch (error) {
      set({ action: null, error: uiError(error), loaded: true });
      throw error;
    }
  };

  return {
    status: EMPTY_STATUS,
    loaded: false,
    loading: false,
    action: null,
    error: null,
    lastUsername: null,

    initialize: async () => {
      if (!subscribed) {
        subscribed = true;
        api.account.onChanged((status) => {
          // 登录态翻转意味着主进程刚创建/回收了托管条目——无论由哪个入口
          // 发起（设置页、引导流、主进程自身），渲染层列表都要跟上。
          const loggedInBefore = useAccountStore.getState().status.loggedIn;
          set({ status, loaded: true, ...(status.username ? { lastUsername: status.username } : {}) });
          if (loggedInBefore !== status.loggedIn) void reloadManagedStacks();
        });
      }
      set({ loading: true, error: null });
      try {
        const status = await api.account.status();
        set({ status, loaded: true, loading: false, ...(status.username ? { lastUsername: status.username } : {}) });
      } catch (error) {
        set({ loaded: true, loading: false, error: uiError(error) });
      }
    },

    login: async (input) => {
      const status = await run('login', () => api.account.login(input), (s) => s);
      set({ lastUsername: input.username });
      await reloadManagedStacks();
      return status;
    },
    register: async (input) => {
      const status = await run('register', () => api.account.register(input), (s) => s);
      set({ lastUsername: input.username });
      await reloadManagedStacks();
      return status;
    },
    logout: async () => {
      const before = useAccountStore.getState().status.username;
      const status = await run('logout', () => api.account.logout(), (s) => s);
      if (before) set({ lastUsername: before });
      await reloadManagedStacks();
      return status;
    },
    redeem: (code) => run('redeem', () => api.account.redeem(code), (result) => result.status),
    refreshQuota: () => run('refresh', () => api.account.refreshQuota(), (status) => status),
    setServerUrl: async (url) => {
      const status = await run('server', () => api.account.setServerUrl(url), (s) => s);
      // 换服务器可能触发主进程回收托管条目，同样要重载。
      await reloadManagedStacks();
      return status;
    },
    clearError: () => set({ error: null }),
  };
});
