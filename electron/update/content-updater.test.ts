import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateBundleSigningKeyPair,
  packBundleArchive,
  signManifest,
} from '@musefold/update-protocol';

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
    get isPackaged() {
      return false;
    },
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

import { getBundleDir, getPendingVersion } from './content-bundle-store';
import {
  CONTENT_UPDATE_CHECK_INITIAL_DELAY_MS,
  resetContentUpdateScheduleForTests,
  resolveContentUpdateSchedulePlan,
  runContentUpdateCheckOnce,
  scheduleContentUpdateChecks,
} from './content-updater';
import { resolveUpdateFeedUrl } from './updater-service';

const STORE_DEFAULTS = {
  update: { channel: 'stable' },
  contentUpdate: {
    pendingVersion: null,
    knownGoodVersion: null,
    previousGoodVersion: null,
    attemptCount: 0,
    rejectedVersions: [] as string[],
  },
};

const VERSION = '1.2.1-dev.412';
const ARTIFACT_URL = 'https://cdn.example.test/Musefold/bundles/dev/renderer.tar.gz';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function packCompleteBundle(): { archive: Buffer; bytes: number; sha256: string } {
  const source = tempDir('musefold-content-upd-src-');
  writeFileSync(join(source, 'index.html'), '<html>index</html>');
  writeFileSync(join(source, 'pet.html'), '<html>pet</html>');
  const archive = packBundleArchive(source);
  return {
    archive,
    bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex'),
  };
}

function unsignedBody(packed: { sha256: string; bytes: number }): Record<string, unknown> {
  return {
    schemaVersion: 1,
    channel: 'dev',
    bundleVersion: VERSION,
    gitSha: '0ce9aac',
    createdAt: '2026-08-20T00:00:00Z',
    minShellVersion: '0.5.0-dev',
    maxShellVersion: null,
    surfaces: {
      'electron-renderer': {
        url: ARTIFACT_URL,
        sha256: packed.sha256,
        bytes: packed.bytes,
      },
    },
    rollout: { percentage: 100 },
  };
}

let userData: string;

beforeEach(() => {
  storeState.reset(STORE_DEFAULTS);
  userData = tempDir('musefold-content-updater-');
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runContentUpdateCheckOnce', () => {
  it('returns trust_anchor_missing without issuing any fetch', async () => {
    const fetchFn = vi.fn();
    const result = await runContentUpdateCheckOnce({
      fetch: fetchFn,
      userDataRoot: userData,
      channel: 'dev',
    });
    expect(result).toEqual({ status: 'trust_anchor_missing' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns manifest_unreachable when the feed is non-2xx', async () => {
    const { publicKey } = generateBundleSigningKeyPair();
    const fetchFn = vi.fn(async () => new Response('nope', { status: 503 }));
    const result = await runContentUpdateCheckOnce({
      fetch: fetchFn,
      publicKeys: [publicKey],
      channel: 'dev',
      currentShellVersion: '0.5.0-dev',
      userDataRoot: userData,
    });
    expect(result).toEqual({ status: 'manifest_unreachable' });
    expect(fetchFn).toHaveBeenCalledWith(
      `${resolveUpdateFeedUrl('dev')}manifest.json`,
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it('passes through the verify failure reason', async () => {
    const { publicKey } = generateBundleSigningKeyPair();
    const packed = packCompleteBundle();
    const fakeSignature = Buffer.alloc(64).toString('base64');
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ ...unsignedBody(packed), signature: fakeSignature })),
    );
    const result = await runContentUpdateCheckOnce({
      fetch: fetchFn,
      publicKeys: [publicKey],
      channel: 'dev',
      currentShellVersion: '0.5.0-dev',
      userDataRoot: userData,
    });
    expect(result.status).toBe('manifest_invalid');
    if (result.status === 'manifest_invalid') {
      expect(result.reason).toBe('invalid_signature');
      expect(result.message).not.toMatch(/\/|\\/);
    }
  });

  it('installs a signed manifest through the real installer', async () => {
    const { publicKey, privateKey } = generateBundleSigningKeyPair();
    const packed = packCompleteBundle();
    const signed = signManifest(unsignedBody(packed), privateKey);
    const manifestJson = JSON.stringify(signed);
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${resolveUpdateFeedUrl('dev')}manifest.json`) {
        return new Response(manifestJson);
      }
      if (url === ARTIFACT_URL) {
        return new Response(packed.archive);
      }
      return new Response('missing', { status: 404 });
    });

    const result = await runContentUpdateCheckOnce({
      fetch: fetchFn,
      publicKeys: [publicKey],
      channel: 'dev',
      currentShellVersion: '0.5.0-dev',
      userDataRoot: userData,
    });

    expect(result).toEqual({ status: 'installed', bundleVersion: VERSION });
    expect(getPendingVersion()).toBe(VERSION);
    const dest = getBundleDir(VERSION, userData);
    expect(readFileSync(join(dest, 'index.html'), 'utf8')).toBe('<html>index</html>');
    expect(readFileSync(join(dest, 'pet.html'), 'utf8')).toBe('<html>pet</html>');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('uses an injected manifest URL when provided', async () => {
    const { publicKey } = generateBundleSigningKeyPair();
    const customUrl = 'https://example.test/custom/manifest.json';
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    const result = await runContentUpdateCheckOnce({
      fetch: fetchFn,
      publicKeys: [publicKey],
      channel: 'dev',
      currentShellVersion: '0.5.0-dev',
      userDataRoot: userData,
      manifestUrl: customUrl,
    });
    expect(result).toEqual({ status: 'manifest_unreachable' });
    expect(fetchFn).toHaveBeenCalledWith(
      customUrl,
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });
});

describe('content update schedule plan', () => {
  const TEST_ENV = {
    MUSEFOLD_CONTENT_TEST_PUBLIC_KEY: 'injected-test-public-key',
    MUSEFOLD_CONTENT_TEST_FEED_URL: 'https://evil.example/manifest.json',
    MUSEFOLD_CONTENT_CHECK_INITIAL_DELAY_MS: '12',
  };

  it('ignores test trust-anchor injection when the app is packaged', () => {
    const plan = resolveContentUpdateSchedulePlan(TEST_ENV, true);
    expect(plan.disabled).toBe(false);
    expect(plan.checkDeps.publicKeys).toBeUndefined();
    expect(plan.checkDeps.manifestUrl).toBeUndefined();
    expect(plan.initialDelayMs).toBe(CONTENT_UPDATE_CHECK_INITIAL_DELAY_MS);
  });

  it('reads test overrides only when the app is unpackaged', () => {
    const plan = resolveContentUpdateSchedulePlan(TEST_ENV, false);
    expect(plan.checkDeps.publicKeys).toEqual(['injected-test-public-key']);
    expect(plan.checkDeps.manifestUrl).toBe('https://evil.example/manifest.json');
    expect(plan.initialDelayMs).toBe(12);
  });

  it('disables scheduling in any build when MUSEFOLD_CONTENT_UPDATE_DISABLED=1', () => {
    expect(resolveContentUpdateSchedulePlan({ MUSEFOLD_CONTENT_UPDATE_DISABLED: '1' }, true).disabled).toBe(
      true,
    );
    expect(resolveContentUpdateSchedulePlan({ MUSEFOLD_CONTENT_UPDATE_DISABLED: '1' }, false).disabled).toBe(
      true,
    );
  });
});

describe('scheduleContentUpdateChecks', () => {
  beforeEach(() => {
    resetContentUpdateScheduleForTests();
  });

  afterEach(() => {
    resetContentUpdateScheduleForTests();
    vi.useRealTimers();
  });

  it('does not start timers when updates are disabled', () => {
    vi.useFakeTimers();
    scheduleContentUpdateChecks({ MUSEFOLD_CONTENT_UPDATE_DISABLED: '1' }, false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is idempotent and does not stack timers', () => {
    vi.useFakeTimers();
    scheduleContentUpdateChecks({}, false);
    scheduleContentUpdateChecks({}, false);
    expect(vi.getTimerCount()).toBe(2);
  });
});
