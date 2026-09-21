import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DB_NAME } from '@musefold/core/constants';
import { DESIGN_SCHEME_DB_FILENAME } from '@musefold/core/db/design-scheme/schema';
import { packBundleArchive } from '@musefold/update-protocol';

// C3-C 行②：内容更新只替换渲染内容（content-bundles/bundles/<version> 与其 tmp 目录），
// 不触碰持久库（musefold-data-*.db、design-scheme db）以及 userData 下任何既有文件。

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

import { getBundleDir, getTmpRoot } from './content-bundle-store';
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

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else {
        files.set(
          relative(root, abs),
          createHash('sha256').update(readFileSync(abs)).digest('hex'),
        );
      }
    }
  };
  walk(root);
  return files;
}

let userData: string;

beforeEach(() => {
  storeState.reset(CONTENT_UPDATE_DEFAULTS);
  userData = tempDir('musefold-content-db-boundary-');
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('content update never touches persistent databases', () => {
  it('installs renderer content while leaving every pre-existing userData file byte-identical', async () => {
    // 既有持久面：主库（带真实数据）、设计方案库、以及任意既有文件。
    const primaryDbPath = join(userData, DB_NAME);
    const primary = new Database(primaryDbPath);
    primary.pragma('journal_mode = WAL');
    primary.exec('CREATE TABLE c3c_boundary (id TEXT PRIMARY KEY, points INTEGER NOT NULL)');
    primary.prepare('INSERT INTO c3c_boundary (id, points) VALUES (?, ?)').run('row-1', 42);
    primary.close();
    const designSchemeDbPath = join(userData, DESIGN_SCHEME_DB_FILENAME);
    const designScheme = new Database(designSchemeDbPath);
    designScheme.exec('CREATE TABLE marker (k TEXT PRIMARY KEY)');
    designScheme.prepare('INSERT INTO marker (k) VALUES (?)').run('keep');
    designScheme.close();
    const existingRendererFile = join(userData, 'index.html');
    writeFileSync(existingRendererFile, '<html>old renderer</html>');

    const before = snapshot(userData);
    expect(before.size).toBeGreaterThanOrEqual(3);

    const archive = packBundleArchive(
      (() => {
        const source = tempDir('musefold-content-src-');
        writeFileSync(join(source, 'index.html'), '<html>new renderer</html>');
        writeFileSync(join(source, 'pet.html'), '<html>pet</html>');
        return source;
      })(),
    );

    const result = await installContentBundle(
      {
        schemaVersion: 1,
        channel: 'dev',
        bundleVersion: VERSION,
        gitSha: '0ce9aac',
        createdAt: '2026-08-20T00:00:00Z',
        minShellVersion: '0.5.0-dev',
        maxShellVersion: null,
        surfaces: {
          'electron-renderer': {
            url: 'https://cdn.example.test/renderer.tar.gz',
            sha256: createHash('sha256').update(archive).digest('hex'),
            bytes: archive.length,
          },
        },
        rollout: { percentage: 100 },
        signature: Buffer.alloc(64).toString('base64'),
      },
      { fetch: vi.fn(async () => new Response(archive)), userDataRoot: userData },
    );

    expect(result).toEqual({ status: 'installed', bundleVersion: VERSION });

    // 安装面只允许出现在 content-bundles 根（bundles/<version> 与 tmp）之下。
    const contentRoot = join(userData, 'content-bundles');
    const after = snapshot(userData);
    for (const [relativePath] of after) {
      if (before.has(relativePath)) continue;
      expect(
        relativePath.startsWith('content-bundles/'),
        `content update wrote outside content-bundles: ${relativePath}`,
      ).toBe(true);
      expect(contentRoot).toBeTruthy();
    }

    // 所有既有文件（含两个持久库与旧渲染入口）字节不变。
    for (const [relativePath, sha] of before) {
      expect(after.get(relativePath), `pre-existing file changed: ${relativePath}`).toBe(sha);
    }

    // 设置面只写 contentUpdate.* 键。
    for (const [key] of storeState.calls) {
      expect(key.startsWith('contentUpdate.')).toBe(true);
    }

    // 持久库仍然可读且数据原样。
    const readonlyPrimary = new Database(primaryDbPath, { readonly: true });
    try {
      expect(readonlyPrimary.prepare('SELECT id, points FROM c3c_boundary').all()).toEqual([
        { id: 'row-1', points: 42 },
      ]);
    } finally {
      readonlyPrimary.close();
    }
    const readonlyDesignScheme = new Database(designSchemeDbPath, { readonly: true });
    try {
      expect(readonlyDesignScheme.prepare('SELECT k FROM marker').all()).toEqual([{ k: 'keep' }]);
    } finally {
      readonlyDesignScheme.close();
    }

    // 新渲染内容确实落地在 bundles/<version>，旧入口未被改写。
    expect(readFileSync(join(getBundleDir(VERSION, userData), 'index.html'), 'utf8')).toBe(
      '<html>new renderer</html>',
    );
    expect(readFileSync(existingRendererFile, 'utf8')).toBe('<html>old renderer</html>');
    expect(readdirSync(getTmpRoot(userData))).toEqual([]);
  });
});
