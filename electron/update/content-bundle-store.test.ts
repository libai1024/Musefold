import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const appState = vi.hoisted(() => ({
  userData: '/tmp/musefold-mock/userData',
}));

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

function mergeMissing(target: Record<string, unknown>, defaults: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(defaults)) {
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      const current = target[key];
      if (current == null || typeof current !== 'object' || Array.isArray(current)) {
        target[key] = structuredClone(value);
      } else {
        mergeMissing(current as Record<string, unknown>, value as Record<string, unknown>);
      }
    } else if (!(key in target)) {
      target[key] = structuredClone(value);
    }
  }
}

vi.mock('electron-store', () => ({
  default: class FakeStore {
    constructor(options: { defaults?: Record<string, unknown> }) {
      if (options.defaults) mergeMissing(storeState.data, options.defaults);
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

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'userData' ? appState.userData : `/tmp/musefold-mock/${name}`,
  },
}));

vi.mock('../system/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

import {
  addRejectedVersion,
  cleanupContentBundles,
  getAttemptCount,
  getBundleDir,
  getBundlesRoot,
  getInstallId,
  getKnownGoodVersion,
  getPendingVersion,
  getPreviousGoodVersion,
  getRejectedVersions,
  getTmpRoot,
  setAttemptCount,
  setKnownGoodVersion,
  setPendingVersion,
  setPreviousGoodVersion,
} from './content-bundle-store';

const CONTENT_UPDATE_DEFAULTS = {
  contentUpdate: {
    pendingVersion: null,
    knownGoodVersion: null,
    previousGoodVersion: null,
    attemptCount: 0,
    rejectedVersions: [] as string[],
  },
};

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  storeState.reset(CONTENT_UPDATE_DEFAULTS);
  appState.userData = tempDir('musefold-content-store-');
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('content bundle store', () => {
  it('generates installId once and then reuses the persisted value', () => {
    const first = getInstallId();
    const second = getInstallId();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(second).toBe(first);
    expect(storeState.calls.filter(([key]) => key === 'contentUpdate.installId')).toHaveLength(1);
  });

  it('caps rejectedVersions at 20 with FIFO eviction and ignores duplicates', () => {
    for (let index = 0; index <= 20; index += 1) {
      addRejectedVersion(`1.0.${index}`);
    }
    expect(getRejectedVersions()).toHaveLength(20);
    expect(getRejectedVersions()[0]).toBe('1.0.1');
    expect(getRejectedVersions().at(-1)).toBe('1.0.20');

    addRejectedVersion('1.0.5');
    expect(getRejectedVersions()).toEqual(
      Array.from({ length: 20 }, (_, index) => `1.0.${index + 1}`),
    );
  });

  it('clears tmp, deletes unreferenced bundle dirs, and keeps the three referenced versions', () => {
    const userData = appState.userData;
    const pending = '1.0.0';
    const knownGood = '1.0.1';
    const previousGood = '1.0.2';
    const orphan = '9.9.9';

    setPendingVersion(pending);
    setKnownGoodVersion(knownGood);
    setPreviousGoodVersion(previousGood);
    setAttemptCount(2);

    for (const version of [pending, knownGood, previousGood, orphan]) {
      const dir = getBundleDir(version, userData);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'marker.txt'), version);
    }
    const tmpFile = join(getTmpRoot(userData), 'scratch', 'download.bin');
    mkdirSync(join(tmpFile, '..'), { recursive: true });
    writeFileSync(tmpFile, 'tmp');

    cleanupContentBundles(userData);

    expect(getPendingVersion()).toBe(pending);
    expect(getKnownGoodVersion()).toBe(knownGood);
    expect(getPreviousGoodVersion()).toBe(previousGood);
    expect(getAttemptCount()).toBe(2);

    expect(readdirSync(getBundlesRoot(userData)).sort()).toEqual(
      [pending, knownGood, previousGood].sort(),
    );
    expect(getTmpRoot(userData)).toBe(join(userData, 'content-bundles', 'tmp'));
    expect(() => readdirSync(getTmpRoot(userData))).toThrow();
  });

  it('rejects unsafe or non-semver versions as directory names', () => {
    const userData = appState.userData;
    expect(getBundlesRoot(userData)).toBe(join(userData, 'content-bundles', 'bundles'));
    expect(getBundleDir('1.2.1-dev.412', userData)).toBe(
      join(userData, 'content-bundles', 'bundles', '1.2.1-dev.412'),
    );

    expect(() => getBundleDir('../etc', userData)).toThrow('invalid bundle version');
    expect(() => getBundleDir('not-a-version', userData)).toThrow('invalid bundle version');
    expect(() => getBundleDir('v1.0.0', userData)).toThrow('invalid bundle version');

    setPendingVersion('../etc');
    setPendingVersion('not-a-version');
    expect(getPendingVersion()).toBeNull();
  });

  it('reads path roots from app.getPath when no override is passed', () => {
    expect(getBundlesRoot()).toBe(join(appState.userData, 'content-bundles', 'bundles'));
    expect(getTmpRoot()).toBe(join(appState.userData, 'content-bundles', 'tmp'));
  });
});
