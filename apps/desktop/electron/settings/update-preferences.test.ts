import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  return {
    data,
    reset() {
      for (const key of Object.keys(data)) delete data[key];
    },
  };
});

function getPath(target: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current == null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, target);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const key of parts.slice(0, -1)) {
    const next = current[key];
    if (next == null || typeof next !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

vi.mock('electron-store', () => ({
  default: class FakeStore {
    get(key: string, defaultValue?: unknown) {
      const value = getPath(storeState.data, key);
      return value === undefined ? defaultValue : value;
    }
    set(key: string, value: unknown) {
      setPath(storeState.data, key, value);
    }
    delete(key: string) {
      setPath(storeState.data, key, undefined);
    }
  },
}));

import {
  DEFAULT_UPDATE_PREFERENCES,
  getUpdatePreferences,
  resetUpdatePreferencesForTests,
  setUpdatePreferences,
} from './update-preferences';

describe('update preferences settings', () => {
  beforeEach(() => {
    storeState.reset();
    resetUpdatePreferencesForTests();
  });

  it('defaults to auto check + auto download (mainstream baseline)', () => {
    expect(getUpdatePreferences()).toEqual({
      autoCheckOnStartup: true,
      autoDownload: true,
    });
  });

  it('persists patches field-by-field and merges with existing values', () => {
    expect(setUpdatePreferences({ autoDownload: false })).toEqual({
      autoCheckOnStartup: true,
      autoDownload: false,
    });
    // 只动 autoCheckOnStartup,不回写另一个开关。
    expect(setUpdatePreferences({ autoCheckOnStartup: false })).toEqual({
      autoCheckOnStartup: false,
      autoDownload: false,
    });
    expect(getUpdatePreferences()).toEqual({
      autoCheckOnStartup: false,
      autoDownload: false,
    });
  });

  it('falls back to defaults for illegal stored values without throwing', () => {
    setPath(storeState.data, 'update.autoDownload', 'yes');
    expect(getUpdatePreferences()).toEqual(DEFAULT_UPDATE_PREFERENCES);
  });

  it('empty patch is a no-op returning current values', () => {
    setUpdatePreferences({ autoDownload: false });
    expect(setUpdatePreferences({})).toEqual({
      autoCheckOnStartup: true,
      autoDownload: false,
    });
  });
});
