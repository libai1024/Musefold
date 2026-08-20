// src/stores/app.ts
// 全局 UI 状态 —— 视图路由、主题（持久化）、命令面板开合、侧栏折叠

import { create } from 'zustand';
import type { SchemePriorityMode } from '@shared/types/design-scheme';
import type { SharePayload } from '@shared/share';

export type ViewKey = 'generate' | 'library' | 'design-schemes' | 'history' | 'settings';
export type Theme = 'dark' | 'light';
/** 主题来源：跟随系统 / 显式浅色 / 显式深色 */
export type ThemeSource = 'system' | 'light' | 'dark';
export type ReducedMotion = 'system' | 'on' | 'off';
export type InterfaceDensity = 'comfortable' | 'compact';

const THEME_KEY = 'musefold:theme'; // 兼容旧值（存 resolved theme）
const THEME_SOURCE_KEY = 'musefold:theme-source';
const REDUCED_MOTION_KEY = 'musefold:reduced-motion';
const DENSITY_KEY = 'musefold:density';
const DEFAULT_PROVIDER_ID_KEY = 'musefold:default-provider-id';
const SCHEME_PRIORITY_MODE_KEY = 'musefold:scheme-priority-mode';
const LEGACY_STUDIO_SETTINGS_KEY = 'musefold:studio-settings';

function systemTheme(): Theme {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark'; // Codex 风：默认深色
}

function initialSource(): ThemeSource {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(THEME_SOURCE_KEY);
    if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
    // 迁移旧的显式主题值
    const legacy = localStorage.getItem(THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') return legacy;
  }
  return 'system';
}

function resolveTheme(source: ThemeSource): Theme {
  return source === 'system' ? systemTheme() : source;
}

function initialReducedMotion(): ReducedMotion {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(REDUCED_MOTION_KEY);
    if (saved === 'system' || saved === 'on' || saved === 'off') return saved;
  }
  return 'system';
}

function initialDensity(): InterfaceDensity {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(DENSITY_KEY);
    if (saved === 'comfortable' || saved === 'compact') return saved;
  }
  return 'comfortable';
}

function initialSchemePriorityMode(): SchemePriorityMode {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(SCHEME_PRIORITY_MODE_KEY);
    if (saved === 'user_first' || saved === 'scheme_first' || saved === 'agent_mediated') return saved;
  }
  return 'scheme_first'; // 设计规范 §4.1：默认「方案主导」
}

function initialDefaultProviderId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  const saved = localStorage.getItem(DEFAULT_PROVIDER_ID_KEY);
  if (saved) return saved;
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STUDIO_SETTINGS_KEY) ?? '{}') as {
      defaultProviderId?: unknown;
    };
    return typeof legacy.defaultProviderId === 'string' && legacy.defaultProviderId ? legacy.defaultProviderId : null;
  } catch {
    return null;
  }
}

interface AppState {
  currentView: ViewKey;
  activeProviderId: string | null;
  defaultProviderId: string | null;
  /** 方案运行优先级（设计规范 §4.1），默认「方案主导」；每次运行写入快照。 */
  schemePriorityMode: SchemePriorityMode;
  theme: Theme; // 解析后的实际主题（供渲染）
  themeSource: ThemeSource; // 用户选择（system/light/dark）
  reducedMotion: ReducedMotion;
  density: InterfaceDensity;
  commandOpen: boolean;
  materialLibraryOpen: boolean;
  sidebarCollapsed: boolean;
  /**
   * 跨视图意图：创作流程「另存为 Prompt」后要 Library 选中并高亮的条目。
   * Library 挂载/收到值时消费一次然后清空（一次性信号，不是持久状态）。
   */
  pendingHighlightPromptId: string | null;
  /** 跨入口意图：OS deeplink / 测试钩子触发的分享导入确认。 */
  pendingShareImport: SharePayload | null;
  /** 跨视图意图：进入方案中心时直接打开某方案详情或切到发现面（一次性信号）。 */
  pendingSchemeCenterIntent: { detailId?: string; surface?: 'mine' | 'discover' } | null;
  setView: (view: ViewKey) => void;
  setDefaultProviderId: (id: string | null) => void;
  setSchemePriorityMode: (mode: SchemePriorityMode) => void;
  /** 切到 Library 并请求高亮某条（Composer→Library 提升动作） */
  requestHighlightPrompt: (promptId: string) => void;
  consumeHighlightPrompt: () => void;
  requestShareImport: (payload: SharePayload) => void;
  clearShareImport: () => void;
  /** 切到方案中心并请求打开详情 / 切面；方案中心挂载时消费一次。 */
  requestSchemeCenter: (intent: { detailId?: string; surface?: 'mine' | 'discover' }) => void;
  consumeSchemeCenterIntent: () => { detailId?: string; surface?: 'mine' | 'discover' } | null;
  setActiveProvider: (id: string | null) => void;
  setThemeSource: (source: ThemeSource) => void;
  toggleTheme: () => void;
  /** 系统主题变化时重算（仅 source=system 生效） */
  syncSystemTheme: () => void;
  setReducedMotion: (value: ReducedMotion) => void;
  setDensity: (value: InterfaceDensity) => void;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
  setMaterialLibraryOpen: (open: boolean) => void;
  toggleMaterialLibrary: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  /** 开一条新对话（草稿态）：切到生成、清空当前工作台。首次发送才落库。 */
  newConversation: () => void;
}

const _initialSource = initialSource();

export const useAppStore = create<AppState>((set, get) => ({
  currentView: 'generate',
  activeProviderId: null,
  defaultProviderId: initialDefaultProviderId(),
  schemePriorityMode: initialSchemePriorityMode(),
  theme: resolveTheme(_initialSource),
  themeSource: _initialSource,
  reducedMotion: initialReducedMotion(),
  density: initialDensity(),
  commandOpen: false,
  materialLibraryOpen: false,
  sidebarCollapsed: false,
  pendingHighlightPromptId: null,
  pendingShareImport: null,
  pendingSchemeCenterIntent: null,
  setView: (currentView) => set({ currentView }),
  setDefaultProviderId: (defaultProviderId) => {
    if (typeof localStorage !== 'undefined') {
      if (defaultProviderId) {
        localStorage.setItem(DEFAULT_PROVIDER_ID_KEY, defaultProviderId);
      } else {
        localStorage.removeItem(DEFAULT_PROVIDER_ID_KEY);
      }
    }
    set({ defaultProviderId });
  },
  setSchemePriorityMode: (schemePriorityMode) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SCHEME_PRIORITY_MODE_KEY, schemePriorityMode);
    }
    set({ schemePriorityMode });
  },
  requestHighlightPrompt: (promptId) =>
    set({ currentView: 'library', pendingHighlightPromptId: promptId }),
  consumeHighlightPrompt: () => set({ pendingHighlightPromptId: null }),
  requestShareImport: (pendingShareImport) => set({ pendingShareImport }),
  clearShareImport: () => set({ pendingShareImport: null }),
  requestSchemeCenter: (intent) => set({ currentView: 'design-schemes', pendingSchemeCenterIntent: intent }),
  consumeSchemeCenterIntent: () => {
    const intent = get().pendingSchemeCenterIntent;
    if (intent) set({ pendingSchemeCenterIntent: null });
    return intent;
  },
  setActiveProvider: (id) => set({ activeProviderId: id }),
  setThemeSource: (source) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_SOURCE_KEY, source);
      localStorage.removeItem(THEME_KEY);
    }
    set({ themeSource: source, theme: resolveTheme(source) });
  },
  toggleTheme: () =>
    set((s) => {
      // 快捷切换：直接在浅/深之间显式翻转
      const source: ThemeSource = s.theme === 'dark' ? 'light' : 'dark';
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(THEME_SOURCE_KEY, source);
        localStorage.removeItem(THEME_KEY);
      }
      return { themeSource: source, theme: source };
    }),
  syncSystemTheme: () =>
    set((s) => (s.themeSource === 'system' ? { theme: systemTheme() } : {})),
  setReducedMotion: (reducedMotion) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(REDUCED_MOTION_KEY, reducedMotion);
    set({ reducedMotion });
  },
  setDensity: (density) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DENSITY_KEY, density);
    set({ density });
  },
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
}));
