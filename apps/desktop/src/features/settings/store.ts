// src/features/settings/store.ts
// 设置页导航状态 —— 当前分区（可被侧栏/状态栏定向打开）

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountImageSource } from '../../lib/ai-access';
import {
  migrateSettingsPreferences,
  readStoredSettingsPreferences,
  SETTINGS_PREFERENCES_KEY,
  SETTINGS_PREFERENCES_VERSION,
  settingsPreferencesStorage,
} from '../../lib/settings-preferences';

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

const initialAccountImageSource = readStoredSettingsPreferences().accountImageSource;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      section: 'access',
      setSection: (section) => set({ section }),
      accountImageSource: initialAccountImageSource,
      setAccountImageSource: (accountImageSource) => set({ accountImageSource }),
      accountSetupRequest: null,
      requestAccountSetup: (requestId, mode) => set({ accountSetupRequest: { requestId, mode } }),
      consumeAccountSetup: (requestId) => set((state) => (
        state.accountSetupRequest?.requestId === requestId ? { accountSetupRequest: null } : state
      )),
      doubaoDeveloperMode: false,
      setDoubaoDeveloperMode: (enabled) => set({ doubaoDeveloperMode: enabled }),
    }),
    {
      name: SETTINGS_PREFERENCES_KEY,
      version: SETTINGS_PREFERENCES_VERSION,
      storage: settingsPreferencesStorage,
      partialize: (state) => ({ accountImageSource: state.accountImageSource }),
      migrate: migrateSettingsPreferences,
    },
  ),
);
