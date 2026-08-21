import { LOCAL_STORAGE_PREFIX } from '@musefold/domain/constants';
import type { AccountImageSource } from './ai-access';
import { createMigratingJSONStorage, persistStateOf } from './zustand-persist';

export const SETTINGS_PREFERENCES_KEY = 'musefold:settings-preferences';
export const SETTINGS_PREFERENCES_VERSION = 1;
export const LEGACY_ACCOUNT_IMAGE_SOURCE_KEY = `${LOCAL_STORAGE_PREFIX}account-image-source`;

export interface PersistedSettingsPreferences {
  accountImageSource: AccountImageSource;
}

export const DEFAULT_SETTINGS_PREFERENCES: PersistedSettingsPreferences = {
  accountImageSource: 'doubao',
};

export function sanitizeSettingsPreferences(raw: unknown): PersistedSettingsPreferences {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    accountImageSource: value.accountImageSource === 'official' ? 'official' : 'doubao',
  };
}

export function readLegacySettingsPreferences(): PersistedSettingsPreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const saved = localStorage.getItem(LEGACY_ACCOUNT_IMAGE_SOURCE_KEY);
    if (saved == null) return null;
    return { accountImageSource: saved === 'official' ? 'official' : 'doubao' };
  } catch {
    return null;
  }
}

export function clearLegacySettingsPreferences(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LEGACY_ACCOUNT_IMAGE_SOURCE_KEY);
}

export function migrateSettingsPreferences(
  persisted: unknown,
  version: number,
): PersistedSettingsPreferences {
  void version;
  return sanitizeSettingsPreferences(persisted);
}

export function readStoredSettingsPreferences(): PersistedSettingsPreferences {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS_PREFERENCES;
  try {
    const stored = persistStateOf<unknown>(localStorage.getItem(SETTINGS_PREFERENCES_KEY));
    if (stored) return sanitizeSettingsPreferences(stored);
  } catch {
    /* 新 key 损坏时回落旧 key */
  }
  return readLegacySettingsPreferences() ?? DEFAULT_SETTINGS_PREFERENCES;
}

export const settingsPreferencesStorage = createMigratingJSONStorage<PersistedSettingsPreferences>({
  readLegacy: readLegacySettingsPreferences,
  clearLegacy: clearLegacySettingsPreferences,
});

