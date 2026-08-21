import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_PREFERENCES_KEY,
  LEGACY_DENSITY_KEY,
  LEGACY_REDUCED_MOTION_KEY,
  LEGACY_STUDIO_SETTINGS_KEY,
  LEGACY_THEME_KEY,
  LEGACY_THEME_SOURCE_KEY,
} from '../../lib/app-preferences';
import { persistStateOf } from '../../lib/zustand-persist';
import type { PersistedAppPreferences } from '../../lib/app-preferences';

function installLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  return values;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('appearance preferences', () => {
  it('falls back when persisted values are invalid', async () => {
    installLocalStorage({ [LEGACY_REDUCED_MOTION_KEY]: 'broken', [LEGACY_DENSITY_KEY]: 'tiny' });
    const { useAppStore } = await import('../app');

    expect(useAppStore.getState().reducedMotion).toBe('system');
    expect(useAppStore.getState().density).toBe('comfortable');
  });

  it('hydrates valid legacy keys and persists updates to the versioned key', async () => {
    const values = installLocalStorage({
      [LEGACY_REDUCED_MOTION_KEY]: 'on',
      [LEGACY_DENSITY_KEY]: 'compact',
    });
    const { useAppStore } = await import('../app');

    expect(useAppStore.getState().reducedMotion).toBe('on');
    expect(useAppStore.getState().density).toBe('compact');

    useAppStore.getState().setReducedMotion('off');
    useAppStore.getState().setDensity('comfortable');
    const persisted = persistStateOf<PersistedAppPreferences>(values.get(APP_PREFERENCES_KEY) ?? null);
    expect(persisted?.reducedMotion).toBe('off');
    expect(persisted?.density).toBe('comfortable');
    expect(values.has(LEGACY_REDUCED_MOTION_KEY)).toBe(false);
    expect(values.has(LEGACY_DENSITY_KEY)).toBe(false);
  });

  it('migrates explicit theme and studio default provider from legacy keys', async () => {
    installLocalStorage({
      [LEGACY_THEME_KEY]: 'light',
      [LEGACY_STUDIO_SETTINGS_KEY]: JSON.stringify({ defaultProviderId: 'prov-1' }),
    });
    const { useAppStore } = await import('../app');

    expect(useAppStore.getState().themeSource).toBe('light');
    expect(useAppStore.getState().theme).toBe('light');
    expect(useAppStore.getState().defaultProviderId).toBe('prov-1');
  });

  it('prefers theme-source over resolved theme when both exist', async () => {
    installLocalStorage({
      [LEGACY_THEME_KEY]: 'light',
      [LEGACY_THEME_SOURCE_KEY]: 'system',
    });
    const { useAppStore } = await import('../app');

    expect(useAppStore.getState().themeSource).toBe('system');
    expect(useAppStore.getState().theme).toBe('dark');
  });

  it('rehydrates from the versioned persist key without legacy keys', async () => {
    installLocalStorage({
      [APP_PREFERENCES_KEY]: JSON.stringify({
        state: {
          themeSource: 'light',
          reducedMotion: 'on',
          density: 'compact',
          defaultProviderId: null,
          schemePriorityMode: 'scheme_first',
        },
        version: 1,
      }),
    });
    const { useAppStore } = await import('../app');
    expect(useAppStore.getState().themeSource).toBe('light');
    expect(useAppStore.getState().theme).toBe('light');
    expect(useAppStore.getState().density).toBe('compact');
    expect(useAppStore.getState().reducedMotion).toBe('on');
  });
});

describe('shell preferences', () => {
  it('tracks sidebar collapse state for narrow shells', async () => {
    installLocalStorage();
    const { useAppStore } = await import('../app');

    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    useAppStore.getState().setSidebarCollapsed(false);
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });
});
