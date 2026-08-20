// file:// → app://musefold 一次性 localStorage 偏好迁移（v1.2.1 M5）。
//
// 导出：主进程在创建主窗口之前，用 file:// 加载专用页读取旧 origin。
// 导入：仅当有待写入载荷时，经 additionalArguments 布尔标记通知 preload，
// preload 再用一次 sendSync 取回映射并写入；无标记时绝不发同步 IPC。

import { BrowserWindow, ipcMain } from 'electron';
import Store from 'electron-store';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { IPC } from '@shared/types/ipc';
import { STORE_NAME } from '@shared/constants';
import { createLogger } from '../system/logger';
import { getBuiltinRendererRoot } from './renderer-bundle';
import {
  EXPORT_TIMEOUT_MS,
  MAX_EXPORT_ATTEMPTS,
  SKIP_PREFS_MIGRATION_ENV,
  additionalArgumentsForImport,
  beginExportAttempt,
  isOriginMigrationPullHandlerReady,
  coerceMigrationRecord,
  coerceStringMap,
  completeMigration,
  consumePendingPayload,
  decidePrepare,
  DEFAULT_PREFS_ORIGIN_MIGRATION_RECORD,
  planLocalStorageCopy,
  type PrefsOriginMigrationRecord,
  shouldRetryExport,
} from './prefs-origin-migration-logic';

const logger = createLogger('prefs-origin-migration');

export const STORAGE_EXPORT_ENTRY = 'storage-export.html';

const DUMP_LOCAL_STORAGE_SCRIPT = `(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key == null) continue;
    const value = localStorage.getItem(key);
    if (typeof value === 'string') out[key] = value;
  }
  return out;
})()`;

interface PrefsOriginMigrationStoreShape {
  prefsOriginMigration: PrefsOriginMigrationRecord;
}

const store = new Store<PrefsOriginMigrationStoreShape>({
  name: STORE_NAME,
  defaults: {
    prefsOriginMigration: { ...DEFAULT_PREFS_ORIGIN_MIGRATION_RECORD },
  },
});

let pendingPayload: Record<string, string> | null = null;
let windowAllClosedSuppression = 0;

export function acquireWindowAllClosedSuppression(): () => void {
  windowAllClosedSuppression += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    windowAllClosedSuppression = Math.max(0, windowAllClosedSuppression - 1);
  };
}

export function isWindowAllClosedSuppressed(): boolean {
  return windowAllClosedSuppression > 0;
}

export interface PrefsOriginMigrationRuntime {
  rendererUrl: string | undefined;
  skipEnvValue: string | undefined;
  now: () => number;
  exportSnapshot: () => Promise<unknown>;
}

function defaultRuntime(): PrefsOriginMigrationRuntime {
  return {
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
    skipEnvValue: process.env[SKIP_PREFS_MIGRATION_ENV],
    now: () => Date.now(),
    exportSnapshot: exportFileOriginLocalStorage,
  };
}

export function readPrefsOriginMigrationRecord(): PrefsOriginMigrationRecord {
  return coerceMigrationRecord(store.get('prefsOriginMigration', DEFAULT_PREFS_ORIGIN_MIGRATION_RECORD));
}

export function writePrefsOriginMigrationRecord(record: PrefsOriginMigrationRecord): void {
  store.set('prefsOriginMigration', record);
}

export function originMigrationImportArgv(
  listenerCount: (channel: string) => number = (channel) => ipcMain.listenerCount(channel),
): string[] {
  if (!isOriginMigrationPullHandlerReady(listenerCount)) return [];
  return additionalArgumentsForImport(pendingPayload);
}

export function consumePendingOriginMigrationPayload(): Record<string, string> {
  const { delivered, remaining } = consumePendingPayload(pendingPayload);
  pendingPayload = remaining;
  return delivered;
}

export function markOriginMigrationApplied(keyCount: number): void {
  const record = completeMigration(readPrefsOriginMigrationRecord(), keyCount, Date.now());
  writePrefsOriginMigrationRecord(record);
  logger.info(
    'applied',
    `keys=${record.migratedKeyCount ?? 0}`,
    `completedAt=${record.completedAt ?? 0}`,
  );
}

export function resetPrefsOriginMigrationForTests(): void {
  pendingPayload = null;
  windowAllClosedSuppression = 0;
}

export function seedPendingOriginMigrationPayloadForTests(payload: Record<string, string> | null): void {
  pendingPayload = payload;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'unknown error';
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runWithWindowAllClosedSuppression<T>(
  work: () => Promise<T>,
  cleanup?: () => void,
): Promise<T> {
  const release = acquireWindowAllClosedSuppression();
  try {
    return await work();
  } finally {
    try {
      cleanup?.();
    } finally {
      release();
    }
  }
}

async function exportFileOriginLocalStorage(): Promise<unknown> {
  const htmlPath = join(getBuiltinRendererRoot(), STORAGE_EXPORT_ENTRY);
  const fileUrl = pathToFileURL(htmlPath).href;
  let win: BrowserWindow | null = null;
  return runWithWindowAllClosedSuppression(
    async () => {
      win = new BrowserWindow({
        show: false,
        width: 320,
        height: 240,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      const page = win;
      return withTimeout(
        (async () => {
          await page.loadURL(fileUrl);
          return page.webContents.executeJavaScript(DUMP_LOCAL_STORAGE_SCRIPT);
        })(),
        EXPORT_TIMEOUT_MS,
        'file-origin localStorage export',
      );
    },
    () => {
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
    },
  );
}

function logKeyNames(label: string, keys: string[]): void {
  if (keys.length === 0) return;
  logger.info(label, `count=${keys.length}`, `names=${keys.join(',')}`);
}

export async function preparePrefsOriginMigration(
  runtime: Partial<PrefsOriginMigrationRuntime> = {},
): Promise<void> {
  const deps: PrefsOriginMigrationRuntime = { ...defaultRuntime(), ...runtime };
  try {
    await runPrepare(deps);
  } catch (error) {
    logger.warn('failed without blocking startup', formatError(error));
  }
}

async function runPrepare(deps: PrefsOriginMigrationRuntime): Promise<void> {
  pendingPayload = null;
  const initial = readPrefsOriginMigrationRecord();
  const decision = decidePrepare({
    rendererUrl: deps.rendererUrl,
    skipEnvValue: deps.skipEnvValue,
    record: initial,
  });
  if (!decision.run) {
    if (decision.reason === 'abandoned' && initial.status !== 'abandoned') {
      writePrefsOriginMigrationRecord(abandonIfNeeded(initial, deps.now()));
    }
    logger.info('skipped', decision.reason);
    return;
  }

  const startedAt = deps.now();
  let snapshot: Record<string, string> | null = null;
  let record = initial;

  for (let attempt = 0; attempt < MAX_EXPORT_ATTEMPTS; attempt += 1) {
    if (!shouldRetryExport(record) && attempt > 0) break;
    record = beginExportAttempt(record);
    writePrefsOriginMigrationRecord(record);
    try {
      snapshot = requireSnapshotObject(await deps.exportSnapshot());
      break;
    } catch (error) {
      logger.warn(
        'export failed',
        `attempt=${record.exportAttempts}`,
        `elapsedMs=${Math.max(0, deps.now() - startedAt)}`,
        formatError(error),
      );
      if (!shouldRetryExport(record)) {
        record = abandonIfNeeded(record, deps.now());
        writePrefsOriginMigrationRecord(record);
        logger.warn('abandoned after retry limit', `attempts=${record.exportAttempts}`);
        return;
      }
    }
  }

  if (snapshot == null) {
    record = abandonIfNeeded(record, deps.now());
    writePrefsOriginMigrationRecord(record);
    logger.warn('abandoned after retry limit', `attempts=${record.exportAttempts}`);
    return;
  }

  const plan = planLocalStorageCopy(snapshot, []);
  const elapsedMs = Math.max(0, deps.now() - startedAt);
  const keyNames = Object.keys(plan.toWrite);
  logger.info(
    'exported',
    `keys=${keyNames.length}`,
    `elapsedMs=${elapsedMs}`,
    `truncated=${plan.truncated}`,
    `skippedOversize=${plan.skippedOversize}`,
  );
  logKeyNames('exported keys', keyNames);
  logKeyNames('skipped oversize keys', plan.skippedOversizeKeys);

  if (keyNames.length === 0) {
    record = completeMigration(record, 0, deps.now());
    writePrefsOriginMigrationRecord(record);
    logger.info('completed', 'keys=0', `elapsedMs=${elapsedMs}`);
    return;
  }

  pendingPayload = plan.toWrite;
  logger.info('import pending', `keys=${keyNames.length}`);
}

function requireSnapshotObject(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('export snapshot was not an object');
  }
  return coerceStringMap(raw);
}

function abandonIfNeeded(record: PrefsOriginMigrationRecord, now: number): PrefsOriginMigrationRecord {
  if (record.status === 'abandoned') return record;
  return {
    status: 'abandoned',
    exportAttempts: record.exportAttempts,
    abandonedAt: now,
  };
}

export function registerPrefsOriginMigrationHandlers(): void {
  ipcMain.on(IPC.PREFS_PULL_ORIGIN_MIGRATION, (event) => {
    try {
      event.returnValue = consumePendingOriginMigrationPayload();
    } catch {
      event.returnValue = {};
    }
  });

  ipcMain.on(IPC.PREFS_ORIGIN_MIGRATION_APPLIED, (event, keyCount: unknown) => {
    try {
      const count = typeof keyCount === 'number' && Number.isFinite(keyCount) ? keyCount : 0;
      markOriginMigrationApplied(count);
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });
}
