import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  isPackaged: false,
  appPath: '/packaged/Musefold.app/Contents/Resources/app.asar',
}));

const loggerFns = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
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
    get isPackaged() {
      return appState.isPackaged;
    },
    getAppPath: () => appState.appPath,
  },
}));

vi.mock('../system/logger', () => ({
  createLogger: () => loggerFns,
}));

import { resetAppRootCacheForTests } from '../main/app-paths';
import {
  resetRendererRootCacheForTests,
  resolveRendererRoot,
} from '../main/renderer-bundle';
import {
  getAttemptCount,
  getBundleDir,
  getBundlesRoot,
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
import {
  confirmContentBundleStartup,
  contentBundleCandidateReader,
  prepareContentBundleStartup,
  resetContentBundleRuntimeForTests,
} from './content-bundle-runtime';

const CONTENT_UPDATE_DEFAULTS = {
  contentUpdate: {
    pendingVersion: null,
    knownGoodVersion: null,
    previousGoodVersion: null,
    attemptCount: 0,
    rejectedVersions: [] as string[],
  },
};

const PENDING = '1.0.1';
const KNOWN_GOOD = '1.0.0';
const PREVIOUS_GOOD = '0.9.9';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeCompleteBundle(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'index.html'), '<html>index</html>');
  writeFileSync(join(root, 'pet.html'), '<html>pet</html>');
}

function pendingResolution() {
  return {
    root: resolve(getBundleDir(PENDING, appState.userData)),
    source: 'bundle' as const,
  };
}

function knownGoodResolution() {
  return {
    root: resolve(getBundleDir(KNOWN_GOOD, appState.userData)),
    source: 'bundle' as const,
  };
}

beforeEach(() => {
  storeState.reset(CONTENT_UPDATE_DEFAULTS);
  appState.userData = tempDir('musefold-content-runtime-');
  appState.isPackaged = false;
  resetContentBundleRuntimeForTests();
  resetRendererRootCacheForTests();
  resetAppRootCacheForTests();
  loggerFns.debug.mockClear();
  loggerFns.info.mockClear();
  loggerFns.warn.mockClear();
  loggerFns.error.mockClear();
});

afterEach(() => {
  resetContentBundleRuntimeForTests();
  resetRendererRootCacheForTests();
  resetAppRootCacheForTests();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('prepareContentBundleStartup', () => {
  it('rejects pending after two missed beacons and records it in the reject list', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    writeCompleteBundle(getBundleDir(PENDING, appState.userData));
    writeCompleteBundle(getBundleDir(KNOWN_GOOD, appState.userData));

    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });
    expect(getAttemptCount()).toBe(1);
    expect(getPendingVersion()).toBe(PENDING);

    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });
    expect(getAttemptCount()).toBe(2);
    expect(getPendingVersion()).toBe(PENDING);

    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });
    expect(getPendingVersion()).toBeNull();
    expect(getAttemptCount()).toBe(0);
    expect(getRejectedVersions()).toEqual([PENDING]);
    expect(getKnownGoodVersion()).toBe(KNOWN_GOOD);
    expect(loggerFns.warn).toHaveBeenCalledWith(
      'content bundle startup rejected',
      `version=${PENDING}`,
      'reason=startup_beacon_missed',
    );
  });

  it('only cleans up when the process will not load bundles, leaving attempt state untouched', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    setAttemptCount(2);
    writeCompleteBundle(getBundleDir(PENDING, appState.userData));
    writeCompleteBundle(getBundleDir(KNOWN_GOOD, appState.userData));

    const orphan = '9.9.9';
    writeCompleteBundle(getBundleDir(orphan, appState.userData));
    const tmpFile = join(getTmpRoot(appState.userData), 'scratch', 'download.bin');
    mkdirSync(join(tmpFile, '..'), { recursive: true });
    writeFileSync(tmpFile, 'tmp');

    prepareContentBundleStartup({
      userDataRoot: appState.userData,
      willLoadFromBundles: false,
    });

    expect(getPendingVersion()).toBe(PENDING);
    expect(getKnownGoodVersion()).toBe(KNOWN_GOOD);
    expect(getAttemptCount()).toBe(2);
    expect(getRejectedVersions()).toEqual([]);
    expect(loggerFns.warn).not.toHaveBeenCalledWith(
      'content bundle startup rejected',
      `version=${PENDING}`,
      'reason=startup_beacon_missed',
    );
    expect(readdirSync(getBundlesRoot(appState.userData)).sort()).toEqual(
      [PENDING, KNOWN_GOOD].sort(),
    );
    expect(() => readdirSync(getTmpRoot(appState.userData))).toThrow();
  });
});

describe('confirmContentBundleStartup', () => {
  it('promotes pending when a beacon arrives at attempt=1 and resets the counter', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    setPreviousGoodVersion(PREVIOUS_GOOD);
    writeCompleteBundle(getBundleDir(PENDING, appState.userData));

    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });
    expect(getAttemptCount()).toBe(1);

    confirmContentBundleStartup(pendingResolution(), 'main');
    expect(getKnownGoodVersion()).toBe(PENDING);
    expect(getPreviousGoodVersion()).toBe(KNOWN_GOOD);
    expect(getPendingVersion()).toBeNull();
    expect(getAttemptCount()).toBe(0);
    expect(loggerFns.info).toHaveBeenCalledWith(
      'content bundle marked known-good',
      `version=${PENDING}`,
      'beacon=main',
    );
  });

  it('does not promote pending when the parser fell back to knownGood', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    writeCompleteBundle(getBundleDir(KNOWN_GOOD, appState.userData));

    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });
    const resolution = resolveRendererRoot(contentBundleCandidateReader);

    expect(resolution).toEqual(knownGoodResolution());
    confirmContentBundleStartup(resolution);

    expect(getPendingVersion()).toBe(PENDING);
    expect(getKnownGoodVersion()).toBe(KNOWN_GOOD);
    expect(getAttemptCount()).toBe(1);
    expect(loggerFns.info).not.toHaveBeenCalled();
  });

  it('does not promote pending when the pending directory exists but is incomplete', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    mkdirSync(getBundleDir(PENDING, appState.userData), { recursive: true });
    writeFileSync(join(getBundleDir(PENDING, appState.userData), 'index.html'), '<html>index</html>');
    writeCompleteBundle(getBundleDir(KNOWN_GOOD, appState.userData));

    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });
    const resolution = resolveRendererRoot(contentBundleCandidateReader);

    expect(resolution).toEqual(knownGoodResolution());
    confirmContentBundleStartup(resolution);
    expect(getPendingVersion()).toBe(PENDING);
    expect(getKnownGoodVersion()).toBe(KNOWN_GOOD);
  });

  it('leaves store untouched when the served root is builtin', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    setAttemptCount(1);

    confirmContentBundleStartup({
      root: '/tmp/Musefold.app/Contents/Resources/app.asar/apps/desktop/out/renderer',
      source: 'builtin',
    });

    expect(getPendingVersion()).toBe(PENDING);
    expect(getKnownGoodVersion()).toBe(KNOWN_GOOD);
    expect(getAttemptCount()).toBe(1);
    expect(loggerFns.info).toHaveBeenCalledWith(
      'content bundle startup beacon ignored',
      'reason=builtin',
    );
  });

  it('is a no-op when no resolution has been frozen yet', () => {
    setPendingVersion(PENDING);
    setAttemptCount(1);
    confirmContentBundleStartup(undefined);
    expect(getPendingVersion()).toBe(PENDING);
    expect(getAttemptCount()).toBe(1);
    expect(loggerFns.info).toHaveBeenCalledWith(
      'content bundle startup beacon ignored',
      'reason=unfrozen',
    );
  });

  it('ignores subsequent beacons in the same process', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    writeCompleteBundle(getBundleDir(PENDING, appState.userData));
    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });

    confirmContentBundleStartup({
      root: resolve(getBundleDir(KNOWN_GOOD, appState.userData)),
      source: 'bundle',
    });
    confirmContentBundleStartup(pendingResolution(), 'pet');

    expect(getPendingVersion()).toBe(PENDING);
    expect(getKnownGoodVersion()).toBe(KNOWN_GOOD);
    expect(loggerFns.info).not.toHaveBeenCalled();
  });
});

describe('contentBundleCandidateReader', () => {
  it('returns existing dirs in pending → knownGood → previousGood order', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    setPreviousGoodVersion(PREVIOUS_GOOD);
    writeCompleteBundle(getBundleDir(PENDING, appState.userData));
    writeCompleteBundle(getBundleDir(KNOWN_GOOD, appState.userData));
    writeCompleteBundle(getBundleDir(PREVIOUS_GOOD, appState.userData));

    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });
    expect(contentBundleCandidateReader.readCandidates()).toEqual([
      getBundleDir(PENDING, appState.userData),
      getBundleDir(KNOWN_GOOD, appState.userData),
      getBundleDir(PREVIOUS_GOOD, appState.userData),
    ]);
  });

  it('skips missing directories and omits rejected pending after prepare', () => {
    setPendingVersion(PENDING);
    setKnownGoodVersion(KNOWN_GOOD);
    setPreviousGoodVersion(PREVIOUS_GOOD);
    setAttemptCount(2);
    writeCompleteBundle(getBundleDir(KNOWN_GOOD, appState.userData));
    writeCompleteBundle(getBundleDir(PREVIOUS_GOOD, appState.userData));

    prepareContentBundleStartup({ userDataRoot: appState.userData, willLoadFromBundles: true });
    expect(getPendingVersion()).toBeNull();
    expect(contentBundleCandidateReader.readCandidates()).toEqual([
      getBundleDir(KNOWN_GOOD, appState.userData),
      getBundleDir(PREVIOUS_GOOD, appState.userData),
    ]);
  });
});
