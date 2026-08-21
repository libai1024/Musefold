import { createMigratingJSONStorage, persistStateOf } from './zustand-persist';

export const ONBOARDING_PREFERENCES_KEY = 'musefold:onboarding';
export const ONBOARDING_PREFERENCES_VERSION = 1;
export const LEGACY_ONBOARDED_KEY = 'musefold:onboarded';

export interface PersistedOnboardingPreferences {
  onboarded: boolean;
}

export function readLegacyOnboardingPreferences(): PersistedOnboardingPreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    if (localStorage.getItem(LEGACY_ONBOARDED_KEY) !== '1') return null;
    return { onboarded: true };
  } catch {
    return null;
  }
}

export function clearOnboardingPreferences(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(ONBOARDING_PREFERENCES_KEY);
  localStorage.removeItem(LEGACY_ONBOARDED_KEY);
}

export function migrateOnboardingPreferences(
  persisted: unknown,
  version: number,
): PersistedOnboardingPreferences {
  void version;
  const value = persisted && typeof persisted === 'object' ? (persisted as { onboarded?: unknown }) : {};
  return { onboarded: value.onboarded === true };
}

export function readStoredOnboardingPreferences(): PersistedOnboardingPreferences {
  if (typeof localStorage === 'undefined') return { onboarded: false };
  try {
    const stored = persistStateOf<{ onboarded?: unknown }>(localStorage.getItem(ONBOARDING_PREFERENCES_KEY));
    if (stored) return { onboarded: stored.onboarded === true };
  } catch {
    /* 新 key 损坏时回落旧哨兵 */
  }
  return readLegacyOnboardingPreferences() ?? { onboarded: false };
}

export const onboardingPreferencesStorage = createMigratingJSONStorage<PersistedOnboardingPreferences>({
  readLegacy: readLegacyOnboardingPreferences,
  clearLegacy: () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LEGACY_ONBOARDED_KEY);
  },
});

