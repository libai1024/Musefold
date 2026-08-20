// src/features/settings/store.ts
// 设置页导航状态 —— 当前分区（可被侧栏/状态栏定向打开）

import { create } from 'zustand';
import { LOCAL_STORAGE_PREFIX } from '@musefold/domain/constants';
import type { AccountImageSource } from '../../lib/ai-access';

export type SettingsSection =
  | 'access'
  | 'doubao'
  | 'account'
  | 'connections'
  | 'providers'
  | 'ai'
  | 'generation'
  | 'appearance'
  | 'data'
  | 'automation'
  | 'archived'
  | 'about';

interface SettingsState {
  section: SettingsSection;
  setSection: (s: SettingsSection) => void;
  accountImageSource: AccountImageSource;
  setAccountImageSource: (source: AccountImageSource) => void;
  accountSetupRequest: { requestId: string; mode: 'login' | 'register' } | null;
  requestAccountSetup: (requestId: string, mode: 'login' | 'register') => void;
  consumeAccountSetup: (requestId: string) => void;
  doubaoDeveloperMode: boolean;
  setDoubaoDeveloperMode: (enabled: boolean) => void;
}

const ACCOUNT_IMAGE_SOURCE_KEY = `${LOCAL_STORAGE_PREFIX}account-image-source`;

function initialAccountImageSource(): AccountImageSource {
  try {
    return localStorage.getItem(ACCOUNT_IMAGE_SOURCE_KEY) === 'official' ? 'official' : 'doubao';
  } catch {
    return 'doubao';
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  section: 'access',
  setSection: (section) => set({ section }),
  accountImageSource: initialAccountImageSource(),
  setAccountImageSource: (accountImageSource) => {
    try {
      localStorage.setItem(ACCOUNT_IMAGE_SOURCE_KEY, accountImageSource);
    } catch {
      /* 偏好持久化失败不阻塞本次切换。 */
    }
    set({ accountImageSource });
  },
  accountSetupRequest: null,
  requestAccountSetup: (requestId, mode) => set({ accountSetupRequest: { requestId, mode } }),
  consumeAccountSetup: (requestId) => set((state) => (
    state.accountSetupRequest?.requestId === requestId ? { accountSetupRequest: null } : state
  )),
  // 开发者窗口是临时诊断能力，每次启动都关闭，避免恢复上次状态后主动弹窗。
  doubaoDeveloperMode: false,
  setDoubaoDeveloperMode: (enabled) => set({ doubaoDeveloperMode: enabled }),
}));
