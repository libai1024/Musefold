import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/types/ipc';

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

const ipcHandlers = vi.hoisted(() => ({
  on: vi.fn(),
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

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (name: string) => `/tmp/musefold-mock/${name}`,
  },
  BrowserWindow: class {
    destroy() {}
    isDestroyed() {
      return true;
    }
  },
  ipcMain: {
    on: (...args: unknown[]) => ipcHandlers.on(...args),
    listenerCount: () => 0,
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
  acquireWindowAllClosedSuppression,
  consumePendingOriginMigrationPayload,
  isWindowAllClosedSuppressed,
  markOriginMigrationApplied,
  originMigrationImportArgv,
  preparePrefsOriginMigration,
  readPrefsOriginMigrationRecord,
  registerPrefsOriginMigrationHandlers,
  resetPrefsOriginMigrationForTests,
  runWithWindowAllClosedSuppression,
  seedPendingOriginMigrationPayloadForTests,
} from './prefs-origin-migration';
import { PREFS_ORIGIN_MIGRATION_ARGV, shouldRetryExport } from './prefs-origin-migration-logic';

describe('prefs origin migration orchestration', () => {
  beforeEach(() => {
    resetPrefsOriginMigrationForTests();
    storeState.reset({
      prefsOriginMigration: { status: 'pending', exportAttempts: 0 },
    });
    vi.unstubAllEnvs();
    ipcHandlers.on.mockClear();
  });

  afterEach(() => {
    resetPrefsOriginMigrationForTests();
    vi.unstubAllEnvs();
  });

  it('skips export for the Vite renderer URL and for the kill switch', async () => {
    const exportSnapshot = vi.fn(async () => ({ 'musefold:theme': 'dark' }));

    await preparePrefsOriginMigration({
      rendererUrl: 'http://localhost:5173',
      skipEnvValue: undefined,
      exportSnapshot,
    });
    expect(exportSnapshot).not.toHaveBeenCalled();
    expect(originMigrationImportArgv()).toEqual([]);

    await preparePrefsOriginMigration({
      rendererUrl: undefined,
      skipEnvValue: '1',
      exportSnapshot,
    });
    expect(exportSnapshot).not.toHaveBeenCalled();
    expect(readPrefsOriginMigrationRecord().status).toBe('pending');
  });

  it('marks an empty snapshot complete without attaching an import flag', async () => {
    const exportSnapshot = vi.fn(async () => ({}));
    await preparePrefsOriginMigration({
      rendererUrl: undefined,
      skipEnvValue: undefined,
      now: () => 42,
      exportSnapshot,
    });
    expect(exportSnapshot).toHaveBeenCalledTimes(1);
    expect(originMigrationImportArgv()).toEqual([]);
    expect(readPrefsOriginMigrationRecord()).toMatchObject({
      status: 'completed',
      migratedKeyCount: 0,
      completedAt: 42,
    });
  });

  it('keeps a non-empty payload until consume, then the second consume is empty', async () => {
    await preparePrefsOriginMigration({
      rendererUrl: undefined,
      skipEnvValue: undefined,
      exportSnapshot: async () => ({
        'musefold:theme': 'dark',
        'musefold:onboarded': '1',
      }),
    });
    expect(originMigrationImportArgv(() => 1)).toEqual([PREFS_ORIGIN_MIGRATION_ARGV]);
    expect(readPrefsOriginMigrationRecord().status).toBe('pending');

    const first = consumePendingOriginMigrationPayload();
    expect(first).toEqual({
      'musefold:theme': 'dark',
      'musefold:onboarded': '1',
    });
    expect(consumePendingOriginMigrationPayload()).toEqual({});
    expect(originMigrationImportArgv(() => 1)).toEqual([]);

    markOriginMigrationApplied(2);
    expect(readPrefsOriginMigrationRecord()).toMatchObject({
      status: 'completed',
      migratedKeyCount: 2,
    });
  });

  it('retries export once then permanently abandons', async () => {
    const exportSnapshot = vi.fn(async () => {
      throw new Error('hidden window failed');
    });
    await preparePrefsOriginMigration({
      rendererUrl: undefined,
      skipEnvValue: undefined,
      now: () => 99,
      exportSnapshot,
    });
    expect(exportSnapshot).toHaveBeenCalledTimes(2);
    expect(originMigrationImportArgv()).toEqual([]);
    expect(readPrefsOriginMigrationRecord()).toMatchObject({
      status: 'abandoned',
      exportAttempts: 2,
      abandonedAt: 99,
    });

    exportSnapshot.mockClear();
    await preparePrefsOriginMigration({
      rendererUrl: undefined,
      skipEnvValue: undefined,
      exportSnapshot,
    });
    expect(exportSnapshot).not.toHaveBeenCalled();
  });

  it('does not open another hidden window after a completed marker', async () => {
    storeState.reset({
      prefsOriginMigration: {
        status: 'completed',
        exportAttempts: 1,
        completedAt: 1,
        migratedKeyCount: 3,
      },
    });
    const exportSnapshot = vi.fn(async () => ({ 'musefold:theme': 'dark' }));
    await preparePrefsOriginMigration({ rendererUrl: undefined, exportSnapshot });
    expect(exportSnapshot).not.toHaveBeenCalled();
  });

  it('treats a non-object snapshot as an export failure rather than an empty success', async () => {
    const exportSnapshot = vi.fn(async () => null);
    await preparePrefsOriginMigration({
      rendererUrl: undefined,
      skipEnvValue: undefined,
      now: () => 7,
      exportSnapshot,
    });
    expect(exportSnapshot).toHaveBeenCalledTimes(2);
    expect(readPrefsOriginMigrationRecord().status).toBe('abandoned');
  });

  it('wires export before window creation and keeps the export page free of app code', async () => {
    const { readFileSync } = await import('node:fs');
    const application = readFileSync('apps/desktop/electron/main/application.ts', 'utf8');
    const windowSource = readFileSync('apps/desktop/electron/main/window.ts', 'utf8');
    const exportPage = readFileSync('apps/desktop/src/storage-export.html', 'utf8');
    expect(application.indexOf('await preparePrefsOriginMigration()')).toBeGreaterThan(-1);
    expect(application.indexOf('await preparePrefsOriginMigration()')).toBeLessThan(
      application.indexOf('createMainWindow()'),
    );
    expect(windowSource).toContain('originMigrationImportArgv');
    expect(windowSource).toContain('additionalArguments');
    expect(application).toContain('isWindowAllClosedSuppressed');
    expect(exportPage).not.toMatch(/<script/i);
    expect(exportPage).not.toContain('main.tsx');
  });

  it('omits the import flag when the pull handler is unregistered and keeps migration retryable', async () => {
    await preparePrefsOriginMigration({
      rendererUrl: undefined,
      skipEnvValue: undefined,
      exportSnapshot: async () => ({
        'musefold:theme': 'dark',
        'musefold:onboarded': '1',
      }),
    });

    const seen: string[] = [];
    expect(
      originMigrationImportArgv((channel) => {
        seen.push(channel);
        return 0;
      }),
    ).toEqual([]);
    expect(seen).toEqual([IPC.PREFS_PULL_ORIGIN_MIGRATION]);
    expect(readPrefsOriginMigrationRecord().status).toBe('pending');
    expect(shouldRetryExport(readPrefsOriginMigrationRecord())).toBe(true);

    expect(
      originMigrationImportArgv((channel) => (channel === IPC.PREFS_PULL_ORIGIN_MIGRATION ? 1 : 0)),
    ).toEqual([PREFS_ORIGIN_MIGRATION_ARGV]);
    expect(readPrefsOriginMigrationRecord().status).toBe('pending');
  });

  it('releases window-all-closed suppression when work, cleanup, or both throw', async () => {
    expect(isWindowAllClosedSuppressed()).toBe(false);

    await expect(
      runWithWindowAllClosedSuppression(async () => {
        expect(isWindowAllClosedSuppressed()).toBe(true);
        throw new Error('load failed');
      }),
    ).rejects.toThrow('load failed');
    expect(isWindowAllClosedSuppressed()).toBe(false);

    await expect(
      runWithWindowAllClosedSuppression(async () => {
        throw new Error('executeJavaScript failed');
      }),
    ).rejects.toThrow('executeJavaScript failed');
    expect(isWindowAllClosedSuppressed()).toBe(false);

    await expect(
      runWithWindowAllClosedSuppression(async () => {
        throw new Error('file-origin localStorage export timed out after 5000ms');
      }),
    ).rejects.toThrow('timed out');
    expect(isWindowAllClosedSuppressed()).toBe(false);

    await expect(
      runWithWindowAllClosedSuppression(
        async () => 'ok',
        () => {
          throw new Error('destroy failed');
        },
      ),
    ).rejects.toThrow('destroy failed');
    expect(isWindowAllClosedSuppressed()).toBe(false);

    await expect(
      runWithWindowAllClosedSuppression(
        async () => {
          throw new Error('executeJavaScript failed');
        },
        () => {
          throw new Error('destroy failed');
        },
      ),
    ).rejects.toThrow('destroy failed');
    expect(isWindowAllClosedSuppressed()).toBe(false);

    await expect(runWithWindowAllClosedSuppression(async () => 'ok')).resolves.toBe('ok');
    expect(isWindowAllClosedSuppressed()).toBe(false);
  });

  it('suppresses window-all-closed while a hidden export window can be destroyed', () => {
    expect(isWindowAllClosedSuppressed()).toBe(false);
    const release = acquireWindowAllClosedSuppression();
    expect(isWindowAllClosedSuppressed()).toBe(true);
    release();
    expect(isWindowAllClosedSuppressed()).toBe(false);
    release();
    expect(isWindowAllClosedSuppressed()).toBe(false);
  });

  it('registers a one-shot pull handler that clears memory', () => {
    const handlers = new Map<string, (event: { returnValue?: unknown }, ...args: unknown[]) => void>();
    ipcHandlers.on.mockImplementation((channel: string, handler: (event: { returnValue?: unknown }, ...args: unknown[]) => void) => {
      handlers.set(channel, handler);
    });
    registerPrefsOriginMigrationHandlers();
    seedPendingOriginMigrationPayloadForTests({ 'musefold:theme': 'dark' });

    const pull = handlers.get(IPC.PREFS_PULL_ORIGIN_MIGRATION);
    expect(pull).toBeTypeOf('function');
    const event = { returnValue: undefined as unknown };
    pull!(event);
    expect(event.returnValue).toEqual({ 'musefold:theme': 'dark' });
    pull!(event);
    expect(event.returnValue).toEqual({});
  });
});
