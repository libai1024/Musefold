// src/features/settings/store.ts
// 设置页导航状态 —— 当前分区（可被侧栏/状态栏定向打开）。
// v2 设置整合：分区收敛为 7 个；旧分区 key 作为深链别名在 setSection 内翻译，
// 侧栏/工作台/自动化事件等历史调用点无需逐一改造。

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
  | 'account'
  | 'relay'
  | 'preferences'
  | 'open'
  | 'usage'
  | 'data'
  | 'archived';

/** 中转站分页内部的通道 tab：providers = 生图，ai = Agent。 */
export type RelayTab = 'providers' | 'ai';

/** v1 设置分区的旧 key：外部深链仍在传，统一在 setSection 翻译到新分区。 */
export type LegacySettingsSection =
  | 'access'
  | 'doubao'
  | 'connections'
  | 'providers'
  | 'ai'
  | 'generation'
  | 'appearance'
  | 'automation'
  | 'about';

export type SettingsSectionInput = SettingsSection | LegacySettingsSection;

const LEGACY_SECTION_TARGET: Record<LegacySettingsSection, SettingsSection> = {
  access: 'account',
  doubao: 'account',
  connections: 'open',
  providers: 'relay',
  ai: 'relay',
  generation: 'preferences',
  appearance: 'preferences',
  automation: 'open',
  about: 'data',
};

function resolveSection(input: SettingsSectionInput): SettingsSection {
  return LEGACY_SECTION_TARGET[input as LegacySettingsSection] ?? input;
}

interface SettingsState {
  section: SettingsSection;
  setSection: (s: SettingsSectionInput) => void;
  relayTab: RelayTab;
  setRelayTab: (tab: RelayTab) => void;
  accountImageSource: AccountImageSource;
  setAccountImageSource: (source: AccountImageSource) => void;
  accountSetupRequest: { requestId: string; mode: 'login' | 'register' } | null;
  requestAccountSetup: (requestId: string, mode: 'login' | 'register') => void;
  consumeAccountSetup: (requestId: string) => void;
  doubaoForeground: boolean;
  setDoubaoForeground: (visible: boolean) => void;
}

const initialAccountImageSource = readStoredSettingsPreferences().accountImageSource;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      section: 'account',
      setSection: (input) => set((state) => ({
        section: resolveSection(input),
        relayTab: input === 'providers' || input === 'ai' ? input : state.relayTab,
      })),
      relayTab: 'providers',
      setRelayTab: (relayTab) => set({ relayTab }),
      accountImageSource: initialAccountImageSource,
      setAccountImageSource: (accountImageSource) => set({ accountImageSource }),
      accountSetupRequest: null,
      requestAccountSetup: (requestId, mode) => set({ accountSetupRequest: { requestId, mode } }),
      consumeAccountSetup: (requestId) => set((state) => (
        state.accountSetupRequest?.requestId === requestId ? { accountSetupRequest: null } : state
      )),
      doubaoForeground: false,
      setDoubaoForeground: (visible) => set({ doubaoForeground: visible }),
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
