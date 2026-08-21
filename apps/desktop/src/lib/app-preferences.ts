// 桌面全局 UI 偏好：persist 形状、旧 key 迁移、校验。
// store 文件只消费这些函数，不再手写 localStorage。

import type { SchemePriorityMode } from '@musefold/desktop-contracts/design-scheme';
import { createMigratingJSONStorage, persistStateOf } from './zustand-persist';

export const APP_PREFERENCES_KEY = 'musefold:app-preferences';
export const APP_PREFERENCES_VERSION = 1;

export const LEGACY_THEME_KEY = 'musefold:theme';
export const LEGACY_THEME_SOURCE_KEY = 'musefold:theme-source';
export const LEGACY_REDUCED_MOTION_KEY = 'musefold:reduced-motion';
export const LEGACY_DENSITY_KEY = 'musefold:density';
export const LEGACY_DEFAULT_PROVIDER_ID_KEY = 'musefold:default-provider-id';
export const LEGACY_SCHEME_PRIORITY_MODE_KEY = 'musefold:scheme-priority-mode';
export const LEGACY_STUDIO_SETTINGS_KEY = 'musefold:studio-settings';

export type Theme = 'dark' | 'light';
export type ThemeSource = 'system' | 'light' | 'dark';
export type ReducedMotion = 'system' | 'on' | 'off';
export type InterfaceDensity = 'comfortable' | 'compact';

export interface PersistedAppPreferences {
  themeSource: ThemeSource;
  reducedMotion: ReducedMotion;
  density: InterfaceDensity;
  defaultProviderId: string | null;
  schemePriorityMode: SchemePriorityMode;
}

export const DEFAULT_APP_PREFERENCES: PersistedAppPreferences = {
  themeSource: 'system',
  reducedMotion: 'system',
  density: 'comfortable',
  defaultProviderId: null,
  schemePriorityMode: 'scheme_first',
};

export function systemTheme(): Theme {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function resolveTheme(source: ThemeSource): Theme {
  return source === 'system' ? systemTheme() : source;
}

export function sanitizeAppPreferences(raw: unknown): PersistedAppPreferences {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    themeSource: parseThemeSource(value.themeSource),
    reducedMotion: parseReducedMotion(value.reducedMotion),
    density: parseDensity(value.density),
    defaultProviderId:
      typeof value.defaultProviderId === 'string' && value.defaultProviderId
        ? value.defaultProviderId
        : null,
    schemePriorityMode: parseSchemePriorityMode(value.schemePriorityMode),
  };
}

export function readLegacyAppPreferences(): PersistedAppPreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const themeSource = readLegacyThemeSource();
    const reducedMotion = localStorage.getItem(LEGACY_REDUCED_MOTION_KEY);
    const density = localStorage.getItem(LEGACY_DENSITY_KEY);
    const schemePriorityMode = localStorage.getItem(LEGACY_SCHEME_PRIORITY_MODE_KEY);
    const defaultProviderId = readLegacyDefaultProviderId();
    if (
      themeSource == null &&
      reducedMotion == null &&
      density == null &&
      schemePriorityMode == null &&
      defaultProviderId == null
    ) {
      return null;
    }
    return sanitizeAppPreferences({
      themeSource: themeSource ?? DEFAULT_APP_PREFERENCES.themeSource,
      reducedMotion: reducedMotion ?? DEFAULT_APP_PREFERENCES.reducedMotion,
      density: density ?? DEFAULT_APP_PREFERENCES.density,
      defaultProviderId,
      schemePriorityMode: schemePriorityMode ?? DEFAULT_APP_PREFERENCES.schemePriorityMode,
    });
  } catch {
    return null;
  }
}

export function clearLegacyAppPreferences(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of [
    LEGACY_THEME_KEY,
    LEGACY_THEME_SOURCE_KEY,
    LEGACY_REDUCED_MOTION_KEY,
    LEGACY_DENSITY_KEY,
    LEGACY_DEFAULT_PROVIDER_ID_KEY,
    LEGACY_SCHEME_PRIORITY_MODE_KEY,
    LEGACY_STUDIO_SETTINGS_KEY,
  ]) {
    localStorage.removeItem(key);
  }
}

export function migrateAppPreferences(persisted: unknown, version: number): PersistedAppPreferences {
  void version;
  return sanitizeAppPreferences(persisted);
}

export function readStoredAppPreferences(): PersistedAppPreferences {
  if (typeof localStorage === 'undefined') return DEFAULT_APP_PREFERENCES;
  try {
    const stored = persistStateOf<unknown>(localStorage.getItem(APP_PREFERENCES_KEY));
    if (stored) return sanitizeAppPreferences(stored);
  } catch {
    /* 新 key 损坏时回落旧 key / 默认值 */
  }
  return sanitizeAppPreferences(readLegacyAppPreferences() ?? DEFAULT_APP_PREFERENCES);
}

export const appPreferencesStorage = createMigratingJSONStorage<PersistedAppPreferences>({
  readLegacy: readLegacyAppPreferences,
  clearLegacy: clearLegacyAppPreferences,
});

function parseThemeSource(value: unknown): ThemeSource {
  if (value === 'system' || value === 'light' || value === 'dark') return value;
  return DEFAULT_APP_PREFERENCES.themeSource;
}

function parseReducedMotion(value: unknown): ReducedMotion {
  if (value === 'system' || value === 'on' || value === 'off') return value;
  return DEFAULT_APP_PREFERENCES.reducedMotion;
}

function parseDensity(value: unknown): InterfaceDensity {
  if (value === 'comfortable' || value === 'compact') return value;
  return DEFAULT_APP_PREFERENCES.density;
}

function parseSchemePriorityMode(value: unknown): SchemePriorityMode {
  if (value === 'user_first' || value === 'scheme_first' || value === 'agent_mediated') return value;
  return DEFAULT_APP_PREFERENCES.schemePriorityMode;
}

function readLegacyThemeSource(): ThemeSource | null {
  const saved = localStorage.getItem(LEGACY_THEME_SOURCE_KEY);
  if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
  const legacy = localStorage.getItem(LEGACY_THEME_KEY);
  if (legacy === 'light' || legacy === 'dark') return legacy;
  return null;
}

function readLegacyDefaultProviderId(): string | null {
  const saved = localStorage.getItem(LEGACY_DEFAULT_PROVIDER_ID_KEY);
  if (saved) return saved;
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STUDIO_SETTINGS_KEY) ?? '{}') as {
      defaultProviderId?: unknown;
    };
    return typeof legacy.defaultProviderId === 'string' && legacy.defaultProviderId
      ? legacy.defaultProviderId
      : null;
  } catch {
    return null;
  }
}
