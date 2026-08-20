import { describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/types/ipc';
import {
  MAX_EXPORT_ATTEMPTS,
  MAX_SINGLE_KEY_BYTES,
  MAX_TOTAL_BYTES,
  PREFS_ORIGIN_MIGRATION_ARGV,
  additionalArgumentsForImport,
  beginExportAttempt,
  coerceStringMap,
  completeMigration,
  consumePendingPayload,
  decidePrepare,
  isOriginMigrationPullHandlerReady,
  planLocalStorageCopy,
  runPreloadOriginMigration,
  shouldPullOriginMigration,
  shouldRetryExport,
  utf8ByteLength,
} from './prefs-origin-migration-logic';

function memoryStorage(initial: Record<string, string> = {}): {
  storage: {
    length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
  data: Record<string, string>;
} {
  const data = { ...initial };
  const storage = {
    get length() {
      return Object.keys(data).length;
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null;
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
  return { storage, data };
}

describe('decidePrepare', () => {
  const pending = { status: 'pending' as const, exportAttempts: 0 };

  it('skips the Vite renderer URL branch', () => {
    expect(
      decidePrepare({
        rendererUrl: 'http://localhost:5173',
        skipEnvValue: undefined,
        record: pending,
      }),
    ).toEqual({ run: false, reason: 'dev' });
  });

  it('does not treat an empty renderer URL as development', () => {
    expect(
      decidePrepare({
        rendererUrl: '',
        skipEnvValue: undefined,
        record: pending,
      }),
    ).toEqual({ run: true });
    expect(
      decidePrepare({
        rendererUrl: undefined,
        skipEnvValue: undefined,
        record: pending,
      }),
    ).toEqual({ run: true });
  });

  it('skips when the kill switch is exactly 1', () => {
    expect(
      decidePrepare({
        rendererUrl: undefined,
        skipEnvValue: '1',
        record: pending,
      }),
    ).toEqual({ run: false, reason: 'kill-switch' });
    expect(
      decidePrepare({
        rendererUrl: undefined,
        skipEnvValue: 'true',
        record: pending,
      }),
    ).toEqual({ run: true });
  });

  it('skips completed and abandoned records', () => {
    expect(
      decidePrepare({
        rendererUrl: undefined,
        skipEnvValue: undefined,
        record: { status: 'completed', exportAttempts: 1, completedAt: 1, migratedKeyCount: 3 },
      }),
    ).toEqual({ run: false, reason: 'completed' });
    expect(
      decidePrepare({
        rendererUrl: undefined,
        skipEnvValue: undefined,
        record: { status: 'abandoned', exportAttempts: 2, abandonedAt: 1 },
      }),
    ).toEqual({ run: false, reason: 'abandoned' });
  });

  it('abandons without another export after the retry cap', () => {
    expect(
      decidePrepare({
        rendererUrl: undefined,
        skipEnvValue: undefined,
        record: { status: 'pending', exportAttempts: MAX_EXPORT_ATTEMPTS },
      }),
    ).toEqual({ run: false, reason: 'abandoned' });
    expect(shouldRetryExport({ status: 'pending', exportAttempts: 1 })).toBe(true);
    expect(shouldRetryExport({ status: 'pending', exportAttempts: 2 })).toBe(false);
  });
});

describe('export attempt accounting', () => {
  it('increments attempts and permanently abandons after two failures', () => {
    const first = beginExportAttempt({ status: 'pending', exportAttempts: 0 });
    expect(first).toEqual({ status: 'pending', exportAttempts: 1 });
    expect(shouldRetryExport(first)).toBe(true);

    const second = beginExportAttempt(first);
    expect(second).toEqual({ status: 'pending', exportAttempts: 2 });
    expect(shouldRetryExport(second)).toBe(false);
    expect(
      decidePrepare({ rendererUrl: undefined, skipEnvValue: undefined, record: second }),
    ).toEqual({ run: false, reason: 'abandoned' });
  });

  it('records completion with a timestamp and key count, never values', () => {
    const done = completeMigration({ status: 'pending', exportAttempts: 1 }, 4, 1_700_000_000_000);
    expect(done).toEqual({
      status: 'completed',
      exportAttempts: 1,
      completedAt: 1_700_000_000_000,
      migratedKeyCount: 4,
    });
    expect(JSON.stringify(done)).not.toContain('dark');
  });
});

describe('planLocalStorageCopy', () => {
  it('copies unknown keys without a whitelist', () => {
    const plan = planLocalStorageCopy(
      {
        'musefold:theme': 'dark',
        'musefold:onboarded': '1',
        'musefold:future-key': 'ok',
      },
      [],
    );
    expect(plan.toWrite).toEqual({
      'musefold:theme': 'dark',
      'musefold:onboarded': '1',
      'musefold:future-key': 'ok',
    });
    expect(plan.skippedExisting).toBe(0);
    expect(plan.truncated).toBe(false);
  });

  it('never overwrites keys that already exist on the target origin', () => {
    const plan = planLocalStorageCopy(
      { 'musefold:theme': 'dark', 'musefold:density': 'compact' },
      ['musefold:theme'],
    );
    expect(plan.toWrite).toEqual({ 'musefold:density': 'compact' });
    expect(plan.skippedExisting).toBe(1);
  });

  it('skips a single key whose value exceeds 1 MiB', () => {
    const huge = 'x'.repeat(MAX_SINGLE_KEY_BYTES + 1);
    const plan = planLocalStorageCopy(
      { 'musefold:ok': 'yes', 'musefold:huge': huge },
      [],
    );
    expect(plan.toWrite).toEqual({ 'musefold:ok': 'yes' });
    expect(plan.skippedOversize).toBe(1);
    expect(plan.skippedOversizeKeys).toEqual(['musefold:huge']);
    expect(utf8ByteLength(huge)).toBe(MAX_SINGLE_KEY_BYTES + 1);
  });

  it('truncates once the 5 MiB total is exceeded and does not pack later keys', () => {
    const piece = 'y'.repeat(900 * 1024);
    const source: Record<string, string> = {};
    for (let i = 0; i < 8; i += 1) source[`k${i}`] = piece;
    source.tiny = 'tiny';
    const plan = planLocalStorageCopy(source, []);
    expect(plan.truncated).toBe(true);
    expect(Object.keys(plan.toWrite)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    expect(plan.toWrite).not.toHaveProperty('tiny');
    expect(plan.copiedBytes).toBe(utf8ByteLength(piece) * 5);
    expect(plan.copiedBytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('treats an empty snapshot as a copy of nothing', () => {
    const plan = planLocalStorageCopy({}, ['musefold:theme']);
    expect(plan).toMatchObject({
      toWrite: {},
      skippedExisting: 0,
      skippedOversize: 0,
      truncated: false,
      copiedBytes: 0,
    });
  });
});

describe('pending payload and argv flag', () => {
  it('attaches the boolean argv flag only when there is a non-empty payload', () => {
    expect(additionalArgumentsForImport(null)).toEqual([]);
    expect(additionalArgumentsForImport({})).toEqual([]);
    expect(additionalArgumentsForImport({ 'musefold:theme': 'dark' })).toEqual([
      PREFS_ORIGIN_MIGRATION_ARGV,
    ]);
    expect(additionalArgumentsForImport({ 'musefold:theme': 'dark' }).join(' ')).not.toContain(
      'dark',
    );
  });

  it('refuses the import flag unless the pull handler reports as registered', () => {
    const seen: string[] = [];
    expect(
      isOriginMigrationPullHandlerReady((channel) => {
        seen.push(channel);
        return 0;
      }),
    ).toBe(false);
    expect(seen).toEqual([IPC.PREFS_PULL_ORIGIN_MIGRATION]);
    expect(isOriginMigrationPullHandlerReady(() => 1)).toBe(true);
  });

  it('consumes the in-memory payload once and leaves it empty', () => {
    const first = consumePendingPayload({ 'musefold:onboarded': '1' });
    expect(first.delivered).toEqual({ 'musefold:onboarded': '1' });
    expect(first.remaining).toBeNull();
    const second = consumePendingPayload(first.remaining);
    expect(second.delivered).toEqual({});
    expect(second.remaining).toBeNull();
  });

  it('coerces non-string values out of the payload', () => {
    expect(coerceStringMap({ a: '1', b: 2, c: null })).toEqual({ a: '1' });
    expect(coerceStringMap(['nope'])).toEqual({});
    expect(coerceStringMap(null)).toEqual({});
  });
});

describe('preload import gating', () => {
  it('does not sendSync when the argv flag is absent', () => {
    const sendSync = vi.fn();
    const { storage } = memoryStorage();
    const result = runPreloadOriginMigration({
      argv: ['/path/to/electron', '.'],
      sendSync,
      storage,
    });
    expect(result).toEqual({ pulled: false, written: 0 });
    expect(sendSync).not.toHaveBeenCalled();
  });

  it('pulls, writes missing keys, and confirms without throwing', () => {
    const sendSync = vi.fn((channel: string) => {
      if (channel === IPC.PREFS_PULL_ORIGIN_MIGRATION) {
        return {
          'musefold:theme': 'dark',
          'musefold:onboarded': '1',
          'musefold:density': 'compact',
        };
      }
      return true;
    });
    const { storage, data } = memoryStorage({ 'musefold:theme': 'light' });
    const result = runPreloadOriginMigration({
      argv: ['--musefold-prefs-origin-migration'],
      sendSync,
      storage,
    });
    expect(result).toEqual({ pulled: true, written: 2 });
    expect(data['musefold:theme']).toBe('light');
    expect(data['musefold:onboarded']).toBe('1');
    expect(data['musefold:density']).toBe('compact');
    expect(sendSync).toHaveBeenCalledTimes(2);
    expect(sendSync).toHaveBeenNthCalledWith(1, IPC.PREFS_PULL_ORIGIN_MIGRATION);
    expect(sendSync).toHaveBeenNthCalledWith(2, IPC.PREFS_ORIGIN_MIGRATION_APPLIED, 2);
  });

  it('does not throw when sendSync or setItem fail', () => {
    const sendSync = vi.fn(() => {
      throw new Error('ipc down');
    });
    expect(() =>
      runPreloadOriginMigration({
        argv: [PREFS_ORIGIN_MIGRATION_ARGV],
        sendSync,
        storage: memoryStorage().storage,
      }),
    ).not.toThrow();

    const { storage } = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    const pull = vi.fn((channel: string) => {
      if (channel === IPC.PREFS_PULL_ORIGIN_MIGRATION) return { 'musefold:theme': 'dark' };
      throw new Error('applied failed');
    });
    expect(() =>
      runPreloadOriginMigration({
        argv: [PREFS_ORIGIN_MIGRATION_ARGV],
        sendSync: pull,
        storage,
      }),
    ).not.toThrow();
  });

  it('shouldPullOriginMigration is argv-only', () => {
    expect(shouldPullOriginMigration([])).toBe(false);
    expect(shouldPullOriginMigration(['--other'])).toBe(false);
    expect(shouldPullOriginMigration([PREFS_ORIGIN_MIGRATION_ARGV])).toBe(true);
  });
});
