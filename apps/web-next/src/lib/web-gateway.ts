import {
  type AppPreferences,
  appPreferencesSchema,
  defaultAppPreferences,
} from '@musefold/contracts';
import { createCloudDataGateway } from '@musefold/api-client';
import type { MusefoldGateway, SettingsGateway } from '@musefold/platform';
import { createWebSchemePackageExport } from './scheme-package-export';

const PREFERENCES_STORAGE_KEY = 'musefold.preferences.v1';

/** Web 宿主的设置域:偏好只存本机 localStorage,不进云。 */
function createWebSettingsGateway(): SettingsGateway {
  function read(): AppPreferences {
    if (typeof window === 'undefined') return defaultAppPreferences;
    try {
      const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (!raw) return defaultAppPreferences;
      return appPreferencesSchema.parse(JSON.parse(raw));
    } catch {
      return defaultAppPreferences;
    }
  }

  return {
    async getPreferences() {
      return read();
    },
    async updatePreferences(patch) {
      const next = { ...read(), ...patch };
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
      return next;
    },
  };
}

export function createWebGateway(apiBaseUrl: string): MusefoldGateway {
  const cloud = createCloudDataGateway({ baseUrl: apiBaseUrl });
  return {
    settings: createWebSettingsGateway(),
    ...cloud,
    designSchemes: cloud.designSchemes && {
      ...cloud.designSchemes,
      packageExport: createWebSchemePackageExport(apiBaseUrl),
    },
  };
}

export { PREFERENCES_STORAGE_KEY };
