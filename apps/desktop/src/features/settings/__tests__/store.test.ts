import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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

describe('settings workspace navigation', () => {
  it('uses the shared workspace and keeps real desktop section ids', () => {
    const source = readFileSync(new URL('../components/SettingsView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('SettingsWorkspace');
    // v2 设置整合:7 个分区 key
    for (const section of [
      'account',
      'relay',
      'preferences',
      'open',
      'usage',
      'data',
      'archived',
    ]) {
      expect(source).toContain(`'${section}'`);
    }
    expect(source).toContain('SettingsWorkspace');
    expect(source).toContain('返回工作区');
  });

  it('translates legacy section keys to the consolidated sections (deep-link compatibility)', async () => {
    installLocalStorage();
    const { useSettingsStore } = await import('../store');
    const store = useSettingsStore.getState();
    store.setSection('providers');
    expect(useSettingsStore.getState().section).toBe('relay');
    expect(useSettingsStore.getState().relayTab).toBe('providers');
    store.setSection('ai');
    expect(useSettingsStore.getState().section).toBe('relay');
    expect(useSettingsStore.getState().relayTab).toBe('ai');
    store.setSection('access');
    expect(useSettingsStore.getState().section).toBe('account');
    store.setSection('doubao');
    expect(useSettingsStore.getState().section).toBe('account');
    store.setSection('generation');
    expect(useSettingsStore.getState().section).toBe('preferences');
    store.setSection('appearance');
    expect(useSettingsStore.getState().section).toBe('preferences');
    store.setSection('automation');
    expect(useSettingsStore.getState().section).toBe('open');
    store.setSection('connections');
    expect(useSettingsStore.getState().section).toBe('open');
    store.setSection('about');
    expect(useSettingsStore.getState().section).toBe('data');
    // setSection('relay') 本身不改 tab
    store.setRelayTab('ai');
    store.setSection('relay');
    expect(useSettingsStore.getState().relayTab).toBe('ai');
  });
});
