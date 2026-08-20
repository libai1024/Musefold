import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packBundleArchive, type SignedContentManifest } from '@musefold/update-protocol';

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
    getPath: (name: string) => `/tmp/musefold-mock/${name}`,
    getVersion: () => '0.5.0-dev',
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
  getAttemptCount,
  getBundleDir,
  getPendingVersion,
  getTmpRoot,
} from './content-bundle-store';
import { installContentBundle } from './content-installer';

const CONTENT_UPDATE_DEFAULTS = {
  contentUpdate: {
    pendingVersion: null,
    knownGoodVersion: null,
    previousGoodVersion: null,
    attemptCount: 0,
    rejectedVersions: [] as string[],
  },
};

const VERSION = '1.2.1-dev.412';
const HTTPS_URL = 'https://cdn.example.test/renderer.tar.gz';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function packFiles(files: Record<string, string>): { archive: Buffer; bytes: number; sha256: string } {
  const source = tempDir('musefold-content-src-');
  for (const [relative, content] of Object.entries(files)) {
    const abs = join(source, relative);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  const archive = packBundleArchive(source);
  return {
    archive,
    bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex'),
  };
}

function completePacked(): { archive: Buffer; bytes: number; sha256: string } {
  return packFiles({
    'index.html': '<html>index</html>',
    'pet.html': '<html>pet</html>',
  });
}

function manifestFor(
  packed: { sha256: string; bytes: number },
  overrides: Record<string, unknown> = {},
): SignedContentManifest {
  const surfaceOverrides =
    overrides.surfaces === undefined
      ? {
          'electron-renderer': {
            url: HTTPS_URL,
            sha256: packed.sha256,
            bytes: packed.bytes,
          },
        }
      : undefined;
  return {
    schemaVersion: 1,
    channel: 'dev',
    bundleVersion: VERSION,
    gitSha: '0ce9aac',
    createdAt: '2026-08-20T00:00:00Z',
    minShellVersion: '0.5.0-dev',
    maxShellVersion: null,
    surfaces: surfaceOverrides ?? (overrides.surfaces as SignedContentManifest['surfaces']),
    rollout: { percentage: 100 },
    signature: Buffer.alloc(64).toString('base64'),
    ...overrides,
    ...(surfaceOverrides ? { surfaces: surfaceOverrides } : {}),
  } as SignedContentManifest;
}

function tmpEntries(userData: string): string[] {
  const tmp = getTmpRoot(userData);
  return existsSync(tmp) ? readdirSync(tmp) : [];
}

let userData: string;

beforeEach(() => {
  storeState.reset(CONTENT_UPDATE_DEFAULTS);
  userData = tempDir('musefold-content-install-');
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('installContentBundle', () => {
  it('downloads, extracts, atomically installs, records pending, and clears tmp', async () => {
    const packed = completePacked();
    const fetchFn = vi.fn(async () => new Response(packed.archive));

    const result = await installContentBundle(manifestFor(packed), {
      fetch: fetchFn,
      userDataRoot: userData,
    });

    expect(result).toEqual({ status: 'installed', bundleVersion: VERSION });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const dest = getBundleDir(VERSION, userData);
    expect(readFileSync(join(dest, 'index.html'), 'utf8')).toBe('<html>index</html>');
    expect(readFileSync(join(dest, 'pet.html'), 'utf8')).toBe('<html>pet</html>');
    expect(getPendingVersion()).toBe(VERSION);
    expect(getAttemptCount()).toBe(0);
    expect(tmpEntries(userData)).toEqual([]);
  });

  it('rejects a sha256 mismatch without leaving a bundle dir', async () => {
    const packed = completePacked();
    const result = await installContentBundle(
      manifestFor(packed, {
        surfaces: {
          'electron-renderer': {
            url: HTTPS_URL,
            sha256: 'ab'.repeat(32),
            bytes: packed.bytes,
          },
        },
      }),
      { fetch: async () => new Response(packed.archive), userDataRoot: userData },
    );
    expect(result).toEqual({ status: 'sha256_mismatch' });
    expect(existsSync(getBundleDir(VERSION, userData))).toBe(false);
    expect(getPendingVersion()).toBeNull();
    expect(tmpEntries(userData)).toEqual([]);
  });

  it('aborts when declared bytes are smaller than the stream', async () => {
    const packed = completePacked();
    const result = await installContentBundle(
      manifestFor(packed, {
        surfaces: {
          'electron-renderer': {
            url: HTTPS_URL,
            sha256: packed.sha256,
            bytes: 1,
          },
        },
      }),
      { fetch: async () => new Response(packed.archive), userDataRoot: userData },
    );
    expect(result).toEqual({ status: 'size_mismatch' });
    expect(existsSync(getBundleDir(VERSION, userData))).toBe(false);
    expect(tmpEntries(userData)).toEqual([]);
  });

  it('rejects an extracted tree that is missing pet.html', async () => {
    const packed = packFiles({ 'index.html': '<html>index</html>' });
    const result = await installContentBundle(manifestFor(packed), {
      fetch: async () => new Response(packed.archive),
      userDataRoot: userData,
    });
    expect(result).toEqual({ status: 'incomplete_bundle' });
    expect(existsSync(getBundleDir(VERSION, userData))).toBe(false);
    expect(getPendingVersion()).toBeNull();
    expect(tmpEntries(userData)).toEqual([]);
  });

  it('refuses non-https URLs without calling fetch', async () => {
    const packed = completePacked();
    const fetchFn = vi.fn();
    const result = await installContentBundle(
      manifestFor(packed, {
        surfaces: {
          'electron-renderer': {
            url: 'http://cdn.example.test/renderer.tar.gz',
            sha256: packed.sha256,
            bytes: packed.bytes,
          },
        },
      }),
      { fetch: fetchFn, userDataRoot: userData },
    );
    expect(result).toEqual({ status: 'url_not_https' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a thrown fetch to download_failed', async () => {
    const packed = completePacked();
    const result = await installContentBundle(manifestFor(packed), {
      fetch: async () => {
        throw new Error('network down');
      },
      userDataRoot: userData,
    });
    expect(result).toEqual({ status: 'download_failed' });
    expect(getPendingVersion()).toBeNull();
  });

  it('maps a non-2xx fetch to download_failed', async () => {
    const packed = completePacked();
    const result = await installContentBundle(manifestFor(packed), {
      fetch: async () => new Response('nope', { status: 503 }),
      userDataRoot: userData,
    });
    expect(result).toEqual({ status: 'download_failed' });
  });

  it('returns not_in_rollout when percentage is 0 without downloading', async () => {
    const packed = completePacked();
    const fetchFn = vi.fn();
    const result = await installContentBundle(manifestFor(packed, { rollout: { percentage: 0 } }), {
      fetch: fetchFn,
      userDataRoot: userData,
    });
    expect(result).toEqual({ status: 'not_in_rollout' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns already_installed on a second install of the same version', async () => {
    const packed = completePacked();
    const fetchFn = vi.fn(async () => new Response(packed.archive));
    const first = await installContentBundle(manifestFor(packed), {
      fetch: fetchFn,
      userDataRoot: userData,
    });
    const second = await installContentBundle(manifestFor(packed), {
      fetch: fetchFn,
      userDataRoot: userData,
    });
    expect(first.status).toBe('installed');
    expect(second).toEqual({ status: 'already_installed', bundleVersion: VERSION });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns surface_missing when the desktop surface is absent', async () => {
    const packed = completePacked();
    const fetchFn = vi.fn();
    const result = await installContentBundle(
      manifestFor(packed, {
        surfaces: {
          'capacitor-web': {
            url: HTTPS_URL,
            sha256: packed.sha256,
            bytes: packed.bytes,
          },
        },
      }),
      { fetch: fetchFn, userDataRoot: userData },
    );
    expect(result).toEqual({ status: 'surface_missing' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns surface_missing when the manifest only contains unknown surfaces', async () => {
    const packed = completePacked();
    const fetchFn = vi.fn();
    const result = await installContentBundle(
      manifestFor(packed, {
        surfaces: {
          'android-web': {
            url: HTTPS_URL,
            sha256: packed.sha256,
            bytes: packed.bytes,
          },
        },
      }),
      { fetch: fetchFn, userDataRoot: userData },
    );
    expect(result).toEqual({ status: 'surface_missing' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
