// 纯决策：file:// → app://musefold 的一次性 localStorage 偏好迁移。
// 不依赖 Electron，便于单测。体积上限与合并策略都在这里拍板。

import { IPC } from '@shared/types/ipc';

/** 经 webPreferences.additionalArguments 传入 preload 的布尔标记。不含数据本体。 */
export const PREFS_ORIGIN_MIGRATION_ARGV = '--musefold-prefs-origin-migration';

/** 排障 kill switch。仅当值为 `1` 时跳过（与 MUSEFOLD_E2E 一致）。 */
export const SKIP_PREFS_MIGRATION_ENV = 'MUSEFOLD_SKIP_PREFS_MIGRATION';

/** 单条 value 超过 1 MiB 则跳过该 key。 */
export const MAX_SINGLE_KEY_BYTES = 1024 * 1024;
/** 待写入 value 合计超过 5 MiB 则截断（不再追加后续 key，不打包填缝）。 */
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
/** 导出最多 2 次尝试（失败后再即时重试 1 次），之后永久放弃。 */
export const MAX_EXPORT_ATTEMPTS = 2;
/** 隐藏导出窗口的总超时。 */
export const EXPORT_TIMEOUT_MS = 5_000;

export type PrefsOriginMigrationStatus = 'pending' | 'completed' | 'abandoned';

export interface PrefsOriginMigrationRecord {
  status: PrefsOriginMigrationStatus;
  exportAttempts: number;
  completedAt?: number;
  abandonedAt?: number;
  migratedKeyCount?: number;
}

export const DEFAULT_PREFS_ORIGIN_MIGRATION_RECORD: PrefsOriginMigrationRecord = {
  status: 'pending',
  exportAttempts: 0,
};

export interface LocalStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocalStorageCopyPlan {
  toWrite: Record<string, string>;
  skippedExisting: number;
  skippedOversize: number;
  skippedOversizeKeys: string[];
  truncated: boolean;
  copiedBytes: number;
}

export type PrepareDecision =
  | { run: false; reason: 'dev' | 'kill-switch' | 'completed' | 'abandoned' }
  | { run: true };

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function coerceStringMap(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function coerceMigrationRecord(raw: unknown): PrefsOriginMigrationRecord {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PREFS_ORIGIN_MIGRATION_RECORD };
  }
  const rec = raw as Record<string, unknown>;
  const status: PrefsOriginMigrationStatus =
    rec.status === 'completed' || rec.status === 'abandoned' || rec.status === 'pending'
      ? rec.status
      : 'pending';
  const exportAttempts =
    typeof rec.exportAttempts === 'number' && Number.isFinite(rec.exportAttempts) && rec.exportAttempts >= 0
      ? Math.floor(rec.exportAttempts)
      : 0;
  const next: PrefsOriginMigrationRecord = { status, exportAttempts };
  if (typeof rec.completedAt === 'number' && Number.isFinite(rec.completedAt)) {
    next.completedAt = rec.completedAt;
  }
  if (typeof rec.abandonedAt === 'number' && Number.isFinite(rec.abandonedAt)) {
    next.abandonedAt = rec.abandonedAt;
  }
  if (typeof rec.migratedKeyCount === 'number' && Number.isFinite(rec.migratedKeyCount) && rec.migratedKeyCount >= 0) {
    next.migratedKeyCount = Math.floor(rec.migratedKeyCount);
  }
  return next;
}

export function decidePrepare(input: {
  rendererUrl: string | undefined;
  skipEnvValue: string | undefined;
  record: PrefsOriginMigrationRecord;
}): PrepareDecision {
  if (typeof input.rendererUrl === 'string' && input.rendererUrl.length > 0) {
    return { run: false, reason: 'dev' };
  }
  if (input.skipEnvValue === '1') {
    return { run: false, reason: 'kill-switch' };
  }
  const record = coerceMigrationRecord(input.record);
  if (record.status === 'completed') return { run: false, reason: 'completed' };
  if (record.status === 'abandoned') return { run: false, reason: 'abandoned' };
  if (record.exportAttempts >= MAX_EXPORT_ATTEMPTS) return { run: false, reason: 'abandoned' };
  return { run: true };
}

export function beginExportAttempt(
  record: PrefsOriginMigrationRecord,
): PrefsOriginMigrationRecord {
  const current = coerceMigrationRecord(record);
  return {
    ...current,
    status: 'pending',
    exportAttempts: current.exportAttempts + 1,
  };
}

export function abandonMigration(
  record: PrefsOriginMigrationRecord,
  now: number,
): PrefsOriginMigrationRecord {
  const current = coerceMigrationRecord(record);
  return {
    status: 'abandoned',
    exportAttempts: current.exportAttempts,
    abandonedAt: now,
  };
}

export function completeMigration(
  record: PrefsOriginMigrationRecord,
  keyCount: number,
  now: number,
): PrefsOriginMigrationRecord {
  const current = coerceMigrationRecord(record);
  const migratedKeyCount = Number.isFinite(keyCount) && keyCount > 0 ? Math.floor(keyCount) : 0;
  return {
    status: 'completed',
    exportAttempts: current.exportAttempts,
    completedAt: now,
    migratedKeyCount,
  };
}

export function shouldRetryExport(record: PrefsOriginMigrationRecord): boolean {
  const current = coerceMigrationRecord(record);
  return current.status === 'pending' && current.exportAttempts < MAX_EXPORT_ATTEMPTS;
}

/** 通用拷贝：不白名单。已存在的 key 不覆盖；超限 key 跳过；总量截断。 */
export function planLocalStorageCopy(
  source: Record<string, string>,
  existingKeys: Iterable<string>,
  limits: { maxSingleKeyBytes?: number; maxTotalBytes?: number } = {},
): LocalStorageCopyPlan {
  const maxSingle = limits.maxSingleKeyBytes ?? MAX_SINGLE_KEY_BYTES;
  const maxTotal = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const existing = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  const toWrite: Record<string, string> = {};
  const skippedOversizeKeys: string[] = [];
  let skippedExisting = 0;
  let skippedOversize = 0;
  let copiedBytes = 0;
  let truncated = false;

  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value !== 'string') continue;
    if (existing.has(key)) {
      skippedExisting += 1;
      continue;
    }
    const size = utf8ByteLength(value);
    if (size > maxSingle) {
      skippedOversize += 1;
      skippedOversizeKeys.push(key);
      continue;
    }
    if (truncated) continue;
    if (copiedBytes + size > maxTotal) {
      truncated = true;
      continue;
    }
    toWrite[key] = value;
    copiedBytes += size;
  }

  return {
    toWrite,
    skippedExisting,
    skippedOversize,
    skippedOversizeKeys,
    truncated,
    copiedBytes,
  };
}

export function additionalArgumentsForImport(pending: Record<string, string> | null): string[] {
  if (!pending || Object.keys(pending).length === 0) return [];
  return [PREFS_ORIGIN_MIGRATION_ARGV];
}

/**
 * 是否允许给主窗口附加导入标记。
 *
 * 不加标记、而不是「加标记 + preload 兜底」：`ipcRenderer.sendSync` 无法设超时，
 * handler 未注册时渲染进程会永久白屏。生产侧不发标记，preload 就不会 sendSync；
 * store 保持 pending，符合既有重试语义。
 */
export function isOriginMigrationPullHandlerReady(
  listenerCount: (channel: string) => number,
): boolean {
  return listenerCount(IPC.PREFS_PULL_ORIGIN_MIGRATION) > 0;
}

export function consumePendingPayload(
  pending: Record<string, string> | null,
): { delivered: Record<string, string>; remaining: null } {
  return { delivered: pending ? { ...pending } : {}, remaining: null };
}

export function shouldPullOriginMigration(argv: readonly string[]): boolean {
  return argv.includes(PREFS_ORIGIN_MIGRATION_ARGV);
}

export function readExistingKeys(storage: LocalStorageLike): Set<string> {
  const keys = new Set<string>();
  const length = storage.length;
  for (let i = 0; i < length; i++) {
    const key = storage.key(i);
    if (key != null) keys.add(key);
  }
  return keys;
}

export function runPreloadOriginMigration(deps: {
  argv: readonly string[];
  sendSync: (channel: string, ...args: unknown[]) => unknown;
  storage: LocalStorageLike | null | undefined;
}): { pulled: boolean; written: number } {
  if (!shouldPullOriginMigration(deps.argv)) {
    return { pulled: false, written: 0 };
  }

  let incoming: Record<string, string>;
  try {
    incoming = coerceStringMap(deps.sendSync(IPC.PREFS_PULL_ORIGIN_MIGRATION));
  } catch {
    return { pulled: true, written: 0 };
  }

  if (!deps.storage) {
    return { pulled: true, written: 0 };
  }

  const plan = planLocalStorageCopy(incoming, readExistingKeys(deps.storage));
  let written = 0;
  for (const [key, value] of Object.entries(plan.toWrite)) {
    try {
      deps.storage.setItem(key, value);
      written += 1;
    } catch {
      // 单 key 写入失败不阻断其余 key，也不让 preload 抛异常。
    }
  }

  try {
    deps.sendSync(IPC.PREFS_ORIGIN_MIGRATION_APPLIED, written);
  } catch {
    // 标记置位失败时保持 pending，下次启动可再导出（旧 file:// 数据未删）。
  }

  return { pulled: true, written };
}
