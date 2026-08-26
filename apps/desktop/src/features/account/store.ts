// src/features/account/store.ts
// 渲染层账号状态（v0.5）。密码只作为 login/register 的瞬时参数，不进入 Zustand。
// 账号全量状态走 DesktopExtras（桌面 AccountStatus），不经 AccountGateway / AccountSummary mapper。

import { create } from 'zustand';
import { DEFAULT_ACCOUNT_SERVER_URL } from '@musefold/domain/constants';
import { musefoldQueryKeys } from '@musefold/product-ui';
import type {
  AccountCredentialsInput,
  AccountErrorCode,
  AccountRedeemResult,
  AccountStatus,
} from '@musefold/desktop-contracts/account';
import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import { desktopGateway } from '../../runtime';
import { desktopQueryClient } from '../../runtime/query-client';
import { reloadAccountManagedStacks as reloadManagedStacks } from '../../runtime/account-side-effects';

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
  userId: null,
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

let desktopExtras: DesktopExtras = desktopGateway;
let subscribed = false;
let unsubscribeAccountChanged: (() => void) | null = null;

/** 测试替换 DesktopExtras；生产保持 desktopGateway 单例。 */
export function setAccountDesktopExtrasForTests(next: DesktopExtras): void {
  unsubscribeAccountChanged?.();
  unsubscribeAccountChanged = null;
  subscribed = false;
  desktopExtras = next;
}

/** 账号设置页与 store 共用 extras 单点；调用时读取当前注入。 */
export function getAccountDesktopExtras(): DesktopExtras {
  return desktopExtras;
}

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
      if (status) desktopQueryClient.setQueryData(musefoldQueryKeys.account.status, status);
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
        unsubscribeAccountChanged = desktopExtras.onAccountChanged((status) => {
          // 登录态翻转意味着主进程刚创建/回收了托管条目——无论由哪个入口
          // 发起（设置页、引导流、主进程自身），渲染层列表都要跟上。
          const loggedInBefore = useAccountStore.getState().status.loggedIn;
          desktopQueryClient.setQueryData(musefoldQueryKeys.account.status, status);
          set({ status, loaded: true, ...(status.username ? { lastUsername: status.username } : {}) });
          if (loggedInBefore !== status.loggedIn) void reloadManagedStacks();
        });
      }
      set({ loading: true, error: null });
      try {
        const status = await desktopExtras.accountStatus();
        desktopQueryClient.setQueryData(musefoldQueryKeys.account.status, status);
        set({ status, loaded: true, loading: false, ...(status.username ? { lastUsername: status.username } : {}) });
      } catch (error) {
        set({ loaded: true, loading: false, error: uiError(error) });
      }
    },

    login: async (input) => {
      const status = await run('login', () => desktopExtras.accountLogin(input), (s) => s);
      set({ lastUsername: input.username });
      await reloadManagedStacks();
      return status;
    },
    register: async (input) => {
      const status = await run('register', () => desktopExtras.accountRegister(input), (s) => s);
      set({ lastUsername: input.username });
      await reloadManagedStacks();
      return status;
    },
    logout: async () => {
      const before = useAccountStore.getState().status.username;
      const status = await run('logout', () => desktopExtras.accountLogout(), (s) => s);
      if (before) set({ lastUsername: before });
      await reloadManagedStacks();
      return status;
    },
    redeem: (code) => run('redeem', () => desktopExtras.accountRedeem(code), (result) => result.status),
    refreshQuota: () => run('refresh', () => desktopExtras.accountRefreshQuota(), (status) => status),
    setServerUrl: async (url) => {
      const status = await run('server', () => desktopExtras.accountSetServerUrl(url), (s) => s);
      // 换服务器可能触发主进程回收托管条目，同样要重载。
      await reloadManagedStacks();
      return status;
    },
    clearError: () => set({ error: null }),
  };
});
