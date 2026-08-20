import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appState = vi.hoisted(() => ({
  isPackaged: false,
  appPath: '/packaged/Musefold.app/Contents/Resources/app.asar',
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
    getAppPath: () => appState.appPath,
  },
}));

import {
  emptyRendererBundleCandidateReader,
  getBuiltinRendererRoot,
  peekRendererRootResolution,
  resetRendererRootCacheForTests,
  resolveRendererRoot,
} from './renderer-bundle';
import { resetAppRootCacheForTests } from './app-paths';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeBundle(files: Record<string, string>): string {
  const root = tempDir('musefold-renderer-bundle-');
  for (const [relative, content] of Object.entries(files)) {
    const abs = join(root, relative);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function completeBundle(): string {
  return writeBundle({
    'index.html': '<html>index</html>',
    'pet.html': '<html>pet</html>',
  });
}

beforeEach(() => {
  appState.isPackaged = false;
  resetRendererRootCacheForTests();
  resetAppRootCacheForTests();
});

afterEach(() => {
  resetRendererRootCacheForTests();
  resetAppRootCacheForTests();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveRendererRoot', () => {
  it('falls back to the builtin out/renderer when there are no candidates', () => {
    const resolved = resolveRendererRoot(emptyRendererBundleCandidateReader);
    expect(resolved).toEqual({
      root: resolve(getBuiltinRendererRoot()),
      source: 'builtin',
    });
    expect(resolved.root).toBe(resolve(join(process.cwd(), 'apps/desktop/out/renderer')));
  });

  it('uses the packaged app path for the builtin root', () => {
    appState.isPackaged = true;
    const resolved = resolveRendererRoot();
    expect(resolved.source).toBe('builtin');
    expect(resolved.root).toBe(resolve(join(appState.appPath, 'apps/desktop/out/renderer')));
  });

  it('skips a candidate that is missing pet.html', () => {
    const incomplete = writeBundle({ 'index.html': '<html>index</html>' });
    const resolved = resolveRendererRoot({ readCandidates: () => [incomplete] });
    expect(resolved.source).toBe('builtin');
    expect(resolved.root).not.toBe(resolve(incomplete));
  });

  it('selects a complete candidate over the builtin root', () => {
    const complete = completeBundle();
    const resolved = resolveRendererRoot({ readCandidates: () => [complete] });
    expect(resolved).toEqual({ root: resolve(complete), source: 'bundle' });
  });

  it('walks candidates in order and uses the first complete bundle', () => {
    const missingPet = writeBundle({ 'index.html': '<html>index</html>' });
    const missingIndex = writeBundle({ 'pet.html': '<html>pet</html>' });
    const missingDir = join(tempDir('musefold-renderer-missing-'), 'gone');
    const firstComplete = completeBundle();
    const secondComplete = completeBundle();

    const resolved = resolveRendererRoot({
      readCandidates: () => [missingPet, missingIndex, missingDir, firstComplete, secondComplete],
    });
    expect(resolved).toEqual({ root: resolve(firstComplete), source: 'bundle' });
  });

  it('caches the first resolution and does not probe the filesystem again', () => {
    const complete = completeBundle();
    const readCandidates = vi.fn(() => [complete]);

    const first = resolveRendererRoot({ readCandidates });
    const second = resolveRendererRoot({
      readCandidates: () => {
        throw new Error('candidate reader must not run after the process-level cache is frozen');
      },
    });

    expect(second).toBe(first);
    expect(readCandidates).toHaveBeenCalledTimes(1);
  });

  it('peeks the frozen result without resolving when nothing is cached', () => {
    expect(peekRendererRootResolution()).toBeUndefined();
    const resolved = resolveRendererRoot(emptyRendererBundleCandidateReader);
    expect(peekRendererRootResolution()).toBe(resolved);
  });
});
