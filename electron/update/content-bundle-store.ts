// 内容层 bundle 的磁盘布局与持久化状态（V121-HOT-05 / HOT-07）。
// 落在 userData 而非 .app 内：公证后改包内文件会破坏签名（协议 §0 / §7.1）。

import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import { isStrictlyNewerBundleVersion } from '@musefold/update-protocol';
import { STORE_NAME } from '@shared/constants';
import { createLogger } from '../system/logger';

const logger = createLogger('content-bundle-store');

const CONTENT_BUNDLES_ROOT_NAME = 'content-bundles';
const BUNDLES_DIR_NAME = 'bundles';
const TMP_DIR_NAME = 'tmp';

// 列表只防回滚攻击与反复重试；老到淘汰的版本会被 bundleVersion 单调性挡住，无需永久保留。
const MAX_REJECTED_VERSIONS = 20;

interface ContentUpdateState {
  installId?: string;
  pendingVersion: string | null;
  knownGoodVersion: string | null;
  previousGoodVersion: string | null;
  attemptCount: number;
  rejectedVersions: string[];
}

interface ContentUpdateSettingsShape {
  contentUpdate: ContentUpdateState;
}

const DEFAULT_CONTENT_UPDATE: ContentUpdateState = {
  pendingVersion: null,
  knownGoodVersion: null,
  previousGoodVersion: null,
  attemptCount: 0,
  rejectedVersions: [],
};

const store = new Store<ContentUpdateSettingsShape>({
  name: STORE_NAME,
  defaults: {
    contentUpdate: { ...DEFAULT_CONTENT_UPDATE },
  },
});

export function getInstallId(): string {
  const stored = store.get('contentUpdate.installId');
  if (typeof stored === 'string' && stored.length > 0) return stored;
  const installId = randomUUID();
  store.set('contentUpdate.installId', installId);
  return installId;
}

export function getPendingVersion(): string | null {
  return readVersionField('pendingVersion');
}

export function setPendingVersion(version: string | null): void {
  writeVersionField('pendingVersion', version);
}

export function getKnownGoodVersion(): string | null {
  return readVersionField('knownGoodVersion');
}

export function setKnownGoodVersion(version: string | null): void {
  writeVersionField('knownGoodVersion', version);
}

export function getPreviousGoodVersion(): string | null {
  return readVersionField('previousGoodVersion');
}

export function setPreviousGoodVersion(version: string | null): void {
  writeVersionField('previousGoodVersion', version);
}

export function getAttemptCount(): number {
  const value = store.get('contentUpdate.attemptCount', 0);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function setAttemptCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) return;
  store.set('contentUpdate.attemptCount', count);
}

export function getRejectedVersions(): string[] {
  const raw = store.get('contentUpdate.rejectedVersions', []);
  if (!Array.isArray(raw)) return [];
  const versions = raw.filter((item): item is string => typeof item === 'string');
  return versions.slice(-MAX_REJECTED_VERSIONS);
}

export function addRejectedVersion(version: string): void {
  if (!isSafeBundleVersion(version)) return;
  const current = getRejectedVersions();
  if (current.includes(version)) return;
  const next = [...current, version];
  if (next.length > MAX_REJECTED_VERSIONS) {
    next.splice(0, next.length - MAX_REJECTED_VERSIONS);
  }
  store.set('contentUpdate.rejectedVersions', next);
}

export function getBundlesRoot(userDataRoot?: string): string {
  return join(resolveUserDataRoot(userDataRoot), CONTENT_BUNDLES_ROOT_NAME, BUNDLES_DIR_NAME);
}

export function getTmpRoot(userDataRoot?: string): string {
  return join(resolveUserDataRoot(userDataRoot), CONTENT_BUNDLES_ROOT_NAME, TMP_DIR_NAME);
}

export function getBundleDir(version: string, userDataRoot?: string): string {
  if (!isSafeBundleVersion(version)) {
    throw new Error('invalid bundle version');
  }
  return join(getBundlesRoot(userDataRoot), version);
}

/** 启动期维护：清暂存，并丢掉三个指针都不再引用的落盘目录。 */
export function cleanupContentBundles(userDataRoot?: string): void {
  const tmpRoot = getTmpRoot(userDataRoot);
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    logger.warn('content bundle tmp cleanup failed');
  }

  const bundlesRoot = getBundlesRoot(userDataRoot);
  let entries: string[];
  try {
    entries = readdirSync(bundlesRoot);
  } catch {
    return;
  }

  const keep = new Set(
    [getPendingVersion(), getKnownGoodVersion(), getPreviousGoodVersion()].filter(
      (value): value is string => value != null,
    ),
  );

  for (const name of entries) {
    if (keep.has(name)) continue;
    try {
      rmSync(join(bundlesRoot, name), { recursive: true, force: true });
    } catch {
      logger.warn(
        'content bundle cleanup could not remove an unreferenced bundle',
        `entry=${sanitizeEntryName(name)}`,
      );
    }
  }
}

function resolveUserDataRoot(override?: string): string {
  if (typeof override === 'string' && override.length > 0) return override;
  return app.getPath('userData');
}

function readVersionField(
  field: 'pendingVersion' | 'knownGoodVersion' | 'previousGoodVersion',
): string | null {
  // electron-store 把 `string | null` 的 dotted key 推成 string，默认值不能传 null。
  const value: unknown = store.get(`contentUpdate.${field}` as 'contentUpdate.pendingVersion');
  if (typeof value !== 'string' || value.length === 0) return null;
  return isSafeBundleVersion(value) ? value : null;
}

function writeVersionField(
  field: 'pendingVersion' | 'knownGoodVersion' | 'previousGoodVersion',
  version: string | null,
): void {
  const key = `contentUpdate.${field}` as 'contentUpdate.pendingVersion';
  if (version === null) {
    store.set(key, null as unknown as string);
    return;
  }
  if (!isSafeBundleVersion(version)) return;
  store.set(key, version);
}

function isSafeBundleVersion(version: string): boolean {
  // 目录名必须是精确 SemVer，挡住 `../` 一类路径注入。协议包未单独导出
  // isExactSemver；applied 为 null 时 isStrictlyNewerBundleVersion 只校验候选自身。
  if (version.includes('/') || version.includes('\\') || version.includes('\0')) return false;
  return isStrictlyNewerBundleVersion(version, null);
}

function sanitizeEntryName(name: string): string {
  return name.replace(/[/\\]/g, '_').slice(0, 64);
}
