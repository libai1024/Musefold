import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_ACCOUNT_IMAGE_SOURCE_KEY,
  SETTINGS_PREFERENCES_KEY,
} from '../../../lib/settings-preferences';
import { persistStateOf } from '../../../lib/zustand-persist';

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
  return values;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('settings preferences persist', () => {
  it('hydrates the legacy plain-string account image source', async () => {
    installLocalStorage({ [LEGACY_ACCOUNT_IMAGE_SOURCE_KEY]: 'official' });
    const { useSettingsStore } = await import('../store');
    expect(useSettingsStore.getState().accountImageSource).toBe('official');
  });

  it('writes the versioned persist key and drops the legacy string', async () => {
    const values = installLocalStorage({ [LEGACY_ACCOUNT_IMAGE_SOURCE_KEY]: 'doubao' });
    const { useSettingsStore } = await import('../store');
    useSettingsStore.getState().setAccountImageSource('official');
    expect(persistStateOf<{ accountImageSource?: string }>(values.get(SETTINGS_PREFERENCES_KEY) ?? null)?.accountImageSource).toBe('official');
    expect(values.has(LEGACY_ACCOUNT_IMAGE_SOURCE_KEY)).toBe(false);
  });
});
