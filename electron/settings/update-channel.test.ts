import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  const calls: Array<[string, unknown]> = [];
  return {
    data,
    calls,
    reset(initial?: Record<string, unknown>) {
      for (const key of Object.keys(data)) delete data[key];
      if (initial) Object.assign(data, structuredClone(initial));
      calls.length = 0;
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
    constructor(options: { defaults?: Record<string, unknown> }) {
      storeState.reset(options.defaults ?? {});
    }
    get(key: string, defaultValue?: unknown) {
      const value = getPath(storeState.data, key);
      return value === undefined ? defaultValue : value;
    }
    set(key: string, value: unknown) {
      storeState.calls.push([key, value]);
      setPath(storeState.data, key, value);
    }
  },
}));

import {
  DEFAULT_UPDATE_CHANNEL,
  getUpdateChannel,
  isUpdateChannelLockedByEnv,
  setUpdateChannel,
} from './update-channel';

describe('update channel settings', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env['MUSEFOLD_UPDATE_CHANNEL'];
    storeState.reset({ update: { channel: DEFAULT_UPDATE_CHANNEL } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env['MUSEFOLD_UPDATE_CHANNEL'];
  });

  it('resolves env over persisted settings over the stable default', () => {
    expect(getUpdateChannel()).toBe('stable');

    setUpdateChannel('dev');
    expect(getUpdateChannel()).toBe('dev');

    vi.stubEnv('MUSEFOLD_UPDATE_CHANNEL', 'beta');
    expect(getUpdateChannel()).toBe('beta');
    expect(isUpdateChannelLockedByEnv()).toBe(true);
  });

  it('falls back to stable for illegal env or stored values without throwing', () => {
    setUpdateChannel('beta');
    vi.stubEnv('MUSEFOLD_UPDATE_CHANNEL', 'nightly');
    expect(getUpdateChannel()).toBe('stable');
    expect(isUpdateChannelLockedByEnv()).toBe(true);

    vi.unstubAllEnvs();
    delete process.env['MUSEFOLD_UPDATE_CHANNEL'];
    storeState.reset({ update: { channel: 'canary' } });
    expect(getUpdateChannel()).toBe('stable');
    expect(storeState.calls).toContainEqual(['update.channel', 'stable']);
  });

  it('ignores illegal setUpdateChannel input instead of throwing', () => {
    setUpdateChannel('beta');
    expect(setUpdateChannel('nightly' as 'stable')).toBe('beta');
    expect(getUpdateChannel()).toBe('beta');
  });
});
