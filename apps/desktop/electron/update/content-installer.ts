// 已验签 manifest → 下载归档 → 校验 → 解压 → 原子落盘（协议 §3.2 第 6–8 步）。
// 任何路径都不向调用方抛异常：下一张卡的调度只消费判别联合。

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractBundleArchive,
  isInstallInRollout,
  type SignedContentManifest,
} from '@musefold/update-protocol';
import { createLogger } from '../system/logger';
import {
  getBundleDir,
  getBundlesRoot,
  getInstallId,
  getKnownGoodVersion,
  getPendingVersion,
  getTmpRoot,
  setAttemptCount,
  setPendingVersion,
} from './content-bundle-store';

const logger = createLogger('content-installer');

export const DEFAULT_CONTENT_DOWNLOAD_TIMEOUT_MS = 120_000;

export type ContentInstallStatus =
  | 'installed'
  | 'surface_missing'
  | 'not_in_rollout'
  | 'already_installed'
  | 'url_not_https'
  | 'invalid_bundle_version'
  | 'download_failed'
  | 'size_mismatch'
  | 'sha256_mismatch'
  | 'extract_failed'
  | 'incomplete_bundle'
  | 'disk_error';

export type ContentInstallResult =
  | { status: 'installed'; bundleVersion: string }
  | { status: 'already_installed'; bundleVersion: string }
  | { status: 'surface_missing' }
  | { status: 'not_in_rollout' }
  | { status: 'url_not_https' }
  | { status: 'invalid_bundle_version' }
  | { status: 'download_failed' }
  | { status: 'size_mismatch' }
  | { status: 'sha256_mismatch' }
  | { status: 'extract_failed' }
  | { status: 'incomplete_bundle' }
  | { status: 'disk_error' };

export type ContentInstallFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type InstallContentBundleDeps = {
  fetch?: ContentInstallFetch;
  userDataRoot?: string;
  timeoutMs?: number;
};

const FAILURE_STATUSES: ReadonlySet<ContentInstallStatus> = new Set([
  'url_not_https',
  'invalid_bundle_version',
  'download_failed',
  'size_mismatch',
  'sha256_mismatch',
  'extract_failed',
  'incomplete_bundle',
  'disk_error',
]);

export async function installContentBundle(
  manifest: SignedContentManifest,
  deps: InstallContentBundleDeps = {},
): Promise<ContentInstallResult> {
  const startedAt = Date.now();
  const version = manifest.bundleVersion;
  const userDataRoot = deps.userDataRoot;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_CONTENT_DOWNLOAD_TIMEOUT_MS;
  let extractDir: string | undefined;
  let bytes = 0;

  try {
    const surface = manifest.surfaces['electron-renderer'];
    if (!surface) {
      return conclude(startedAt, version, { status: 'surface_missing' });
    }

    let dest: string;
    try {
      dest = getBundleDir(version, userDataRoot);
    } catch {
      return conclude(startedAt, version, { status: 'invalid_bundle_version' });
    }

    let inRollout = false;
    try {
      inRollout = isInstallInRollout(getInstallId(), version, manifest.rollout.percentage);
    } catch {
      return conclude(startedAt, version, { status: 'not_in_rollout' });
    }
    if (!inRollout) {
      return conclude(startedAt, version, { status: 'not_in_rollout' });
    }

    if (getPendingVersion() === version || getKnownGoodVersion() === version) {
      return conclude(startedAt, version, { status: 'already_installed', bundleVersion: version });
    }
    if (isCompleteBundle(dest)) {
      return conclude(startedAt, version, { status: 'already_installed', bundleVersion: version });
    }

    if (!isHttpsUrl(surface.url)) {
      return conclude(startedAt, version, { status: 'url_not_https' });
    }

    const downloaded = await downloadArchive(fetchFn, surface.url, surface.bytes, timeoutMs);
    if (!downloaded.ok) {
      return conclude(startedAt, version, { status: downloaded.status }, downloaded.bytes);
    }
    bytes = downloaded.bytes;
    if (downloaded.sha256 !== surface.sha256.toLowerCase()) {
      return conclude(startedAt, version, { status: 'sha256_mismatch' }, bytes);
    }

    // 协议 §9：bundle 是数 MiB 量级；解压器另有 256 MiB 硬限。不落盘中转归档。
    extractDir = join(getTmpRoot(userDataRoot), `extract-${version}-${randomUUID()}`);
    try {
      extractBundleArchive(downloaded.buffer, extractDir);
    } catch {
      return conclude(startedAt, version, { status: 'extract_failed' }, bytes);
    }

    if (!isCompleteBundle(extractDir)) {
      return conclude(startedAt, version, { status: 'incomplete_bundle' }, bytes);
    }

    try {
      mkdirSync(getBundlesRoot(userDataRoot), { recursive: true });
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true });
      }
      renameSync(extractDir, dest);
      extractDir = undefined;
    } catch {
      return conclude(startedAt, version, { status: 'disk_error' }, bytes);
    }

    setPendingVersion(version);
    setAttemptCount(0);
    return conclude(startedAt, version, { status: 'installed', bundleVersion: version }, bytes);
  } catch {
    return conclude(startedAt, version, { status: 'disk_error' }, bytes);
  } finally {
    if (extractDir) {
      try {
        rmSync(extractDir, { recursive: true, force: true });
      } catch {
        logger.warn(
          'content bundle tmp residue cleanup failed',
          `version=${versionForLog(version)}`,
        );
      }
    }
  }
}

function conclude(
  startedAt: number,
  version: string,
  result: ContentInstallResult,
  bytes?: number,
): ContentInstallResult {
  const elapsedMs = Date.now() - startedAt;
  const versionLabel = versionForLog(version);
  if (result.status === 'installed') {
    logger.info(
      'content bundle installed',
      `version=${versionLabel}`,
      `bytes=${bytes ?? 0}`,
      `elapsedMs=${elapsedMs}`,
    );
  } else if (FAILURE_STATUSES.has(result.status)) {
    const parts = [
      `version=${versionLabel}`,
      `reason=${result.status}`,
      `elapsedMs=${elapsedMs}`,
    ];
    if (typeof bytes === 'number' && bytes > 0) parts.splice(2, 0, `bytes=${bytes}`);
    logger.warn('content bundle install failed', ...parts);
  }
  return result;
}

function isCompleteBundle(root: string): boolean {
  try {
    return statSync(join(root, 'index.html')).isFile() && statSync(join(root, 'pet.html')).isFile();
  } catch {
    return false;
  }
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function versionForLog(version: string): string {
  return /^[0-9A-Za-z.+-]{1,64}$/.test(version) ? version : 'invalid';
}

type DownloadResult =
  | { ok: true; buffer: Buffer; sha256: string; bytes: number }
  | { ok: false; status: 'download_failed' | 'size_mismatch'; bytes?: number };

async function downloadArchive(
  fetchFn: ContentInstallFetch,
  url: string,
  declaredBytes: number,
  timeoutMs: number,
): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, status: 'download_failed' };
  }

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      /* 失败路径不需要排空响应体 */
    }
    return { ok: false, status: 'download_failed' };
  }
  if (!response.body) {
    return { ok: false, status: 'download_failed' };
  }

  const hash = createHash('sha256');
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > declaredBytes) {
        try {
          await reader.cancel();
        } catch {
          /* 已决定失败，取消读流失败可忽略 */
        }
        return { ok: false, status: 'size_mismatch', bytes: total };
      }
      hash.update(value);
      chunks.push(Buffer.from(value));
    }
  } catch {
    return { ok: false, status: 'download_failed', bytes: total };
  }

  if (total !== declaredBytes) {
    return { ok: false, status: 'size_mismatch', bytes: total };
  }

  return {
    ok: true,
    buffer: Buffer.concat(chunks, total),
    sha256: hash.digest('hex'),
    bytes: total,
  };
}
