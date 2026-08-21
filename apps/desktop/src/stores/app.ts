// src/stores/app.ts
// 全局 UI 状态 —— 视图路由、主题（persist 持久化）、命令面板开合、侧栏折叠

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SchemePriorityMode } from '@musefold/desktop-contracts/design-scheme';
import type { SharePayload } from '@musefold/desktop-contracts/share';
import {
  APP_PREFERENCES_KEY,
  APP_PREFERENCES_VERSION,
  appPreferencesStorage,
  migrateAppPreferences,
  readStoredAppPreferences,
  resolveTheme,
  sanitizeAppPreferences,
  systemTheme,
  type InterfaceDensity,
  type PersistedAppPreferences,
  type ReducedMotion,
  type Theme,
  type ThemeSource,
} from '../lib/app-preferences';

export type ViewKey = 'generate' | 'library' | 'design-schemes' | 'history' | 'settings';
export type { Theme, ThemeSource, ReducedMotion, InterfaceDensity };

interface AppState extends PersistedAppPreferences {
  currentView: ViewKey;
  activeProviderId: string | null;
  theme: Theme;
  commandOpen: boolean;
  materialLibraryOpen: boolean;
  sidebarCollapsed: boolean;
  pendingHighlightPromptId: string | null;
  pendingShareImport: SharePayload | null;
  pendingSchemeCenterIntent: { detailId?: string; surface?: 'mine' | 'discover' } | null;
  setView: (view: ViewKey) => void;
  setDefaultProviderId: (id: string | null) => void;
  setSchemePriorityMode: (mode: SchemePriorityMode) => void;
  requestHighlightPrompt: (promptId: string) => void;
  consumeHighlightPrompt: () => void;
  requestShareImport: (payload: SharePayload) => void;
  clearShareImport: () => void;
  requestSchemeCenter: (intent: { detailId?: string; surface?: 'mine' | 'discover' }) => void;
  consumeSchemeCenterIntent: () => { detailId?: string; surface?: 'mine' | 'discover' } | null;
  setActiveProvider: (id: string | null) => void;
  setThemeSource: (source: ThemeSource) => void;
  toggleTheme: () => void;
  syncSystemTheme: () => void;
  setReducedMotion: (value: ReducedMotion) => void;
  setDensity: (value: InterfaceDensity) => void;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
  setMaterialLibraryOpen: (open: boolean) => void;
  toggleMaterialLibrary: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  newConversation: () => void;
}

const initialPreferences = readStoredAppPreferences();

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentView: 'generate',
      activeProviderId: null,
      ...initialPreferences,
      theme: resolveTheme(initialPreferences.themeSource),
      commandOpen: false,
      materialLibraryOpen: false,
      sidebarCollapsed: false,
      pendingHighlightPromptId: null,
      pendingShareImport: null,
      pendingSchemeCenterIntent: null,
      setView: (currentView) => set({ currentView }),
      setDefaultProviderId: (defaultProviderId) => set({ defaultProviderId }),
      setSchemePriorityMode: (schemePriorityMode) => set({ schemePriorityMode }),
      requestHighlightPrompt: (promptId) =>
        set({ currentView: 'library', pendingHighlightPromptId: promptId }),
      consumeHighlightPrompt: () => set({ pendingHighlightPromptId: null }),
      requestShareImport: (pendingShareImport) => set({ pendingShareImport }),
      clearShareImport: () => set({ pendingShareImport: null }),
      requestSchemeCenter: (intent) =>
        set({ currentView: 'design-schemes', pendingSchemeCenterIntent: intent }),
      consumeSchemeCenterIntent: () => {
        const intent = get().pendingSchemeCenterIntent;
        if (intent) set({ pendingSchemeCenterIntent: null });
        return intent;
      },
      setActiveProvider: (id) => set({ activeProviderId: id }),
      setThemeSource: (source) => set({ themeSource: source, theme: resolveTheme(source) }),
      toggleTheme: () =>
        set((s) => {
          const source: ThemeSource = s.theme === 'dark' ? 'light' : 'dark';
          return { themeSource: source, theme: source };
        }),
      syncSystemTheme: () => set((s) => (s.themeSource === 'system' ? { theme: systemTheme() } : {})),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setDensity: (density) => set({ density }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
      setMaterialLibraryOpen: (materialLibraryOpen) => set({ materialLibraryOpen }),
      toggleMaterialLibrary: () => set((s) => ({ materialLibraryOpen: !s.materialLibraryOpen })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      newConversation: () => {
        set({ currentView: 'generate' });
        void import('../features/generation/workbench/store').then(({ useGenerationWorkbenchStore }) => {
          useGenerationWorkbenchStore.getState().newSession();
        });
      },
    }),
    {
      name: APP_PREFERENCES_KEY,
      version: APP_PREFERENCES_VERSION,
      storage: appPreferencesStorage,
      partialize: (state) => ({
        themeSource: state.themeSource,
        reducedMotion: state.reducedMotion,
        density: state.density,
        defaultProviderId: state.defaultProviderId,
        schemePriorityMode: state.schemePriorityMode,
      }),
      migrate: migrateAppPreferences,
      merge: (persisted, current) => {
        const preferences = sanitizeAppPreferences(persisted);
        return {
          ...current,
          ...preferences,
          theme: resolveTheme(preferences.themeSource),
        };
      },
    },
  ),
);
