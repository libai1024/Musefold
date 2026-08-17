// src/features/settings/store.ts
// 设置页导航状态 —— 当前分区（可被侧栏/状态栏定向打开）

import { create } from 'zustand';
import { LOCAL_STORAGE_PREFIX } from '@shared/constants';
import type { AccountImageSource } from '../../lib/ai-access';

export type SettingsSection =
  | 'access'
  | 'doubao'
  | 'account'
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
const DOUBAO_DEVELOPER_MODE_KEY = `${LOCAL_STORAGE_PREFIX}doubao-developer-mode`;

function initialAccountImageSource(): AccountImageSource {
  try {
    return localStorage.getItem(ACCOUNT_IMAGE_SOURCE_KEY) === 'official' ? 'official' : 'doubao';
  } catch {
    return 'doubao';
  }
}

function initialDoubaoDeveloperMode(): boolean {
  try {
    return localStorage.getItem(DOUBAO_DEVELOPER_MODE_KEY) === '1';
  } catch {
    return false;
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
  doubaoDeveloperMode: initialDoubaoDeveloperMode(),
  setDoubaoDeveloperMode: (enabled) => {
    try {
      localStorage.setItem(DOUBAO_DEVELOPER_MODE_KEY, enabled ? '1' : '0');
    } catch {
      /* 偏好持久化失败不阻塞本次设置。 */
    }
    set({ doubaoDeveloperMode: enabled });
  },
}));
