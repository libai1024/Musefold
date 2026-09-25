import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { patchModuleResolution } from '../native-module-resolver';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function fakeModule(calls: Array<{ request: string; paths?: string[] }>) {
  return {
    _resolveFilename(
      request: string,
      _parent: unknown,
      _isMain?: boolean,
      options?: { paths?: string[] },
    ) {
      calls.push({ request, paths: options?.paths });
      return `/resolved/${request}`;
    },
  };
}

describe('native-module-resolver', () => {
  it('routes redirected packages through the integration node_modules first', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'native-resolver-'));
    const extra = join(tempDir, 'integration', 'node_modules');
    mkdirSync(extra, { recursive: true });
    const calls: Array<{ request: string; paths?: string[] }> = [];
    const mod = fakeModule(calls);

    const restore = patchModuleResolution(mod, extra);
    expect(restore).not.toBeNull();
    expect(mod._resolveFilename('better-sqlite3')).toBe('/resolved/better-sqlite3');
    expect(calls[0]?.paths?.[0]).toBe(extra);

    mod._resolveFilename('node:path', undefined, false, { paths: ['/a'] });
    expect(calls[1]?.paths).toEqual(['/a']);
  });

  it('skips installation when the integration directory is absent', () => {
    const calls: Array<{ request: string; paths?: string[] }> = [];
    const mod = fakeModule(calls);
    const restore = patchModuleResolution(mod, '/definitely/not/here/node_modules');
    expect(restore).toBeNull();
  });

  it('never patches twice', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'native-resolver-'));
    const calls: Array<{ request: string; paths?: string[] }> = [];
    const mod = fakeModule(calls);

    expect(patchModuleResolution(mod, tempDir)).not.toBeNull();
    const once = mod._resolveFilename;
    expect(patchModuleResolution(mod, tempDir)).toBeNull();
    expect(mod._resolveFilename).toBe(once);
  });
});
