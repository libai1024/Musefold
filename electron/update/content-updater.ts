// 内容层更新的单次检查编排。不含调度、IPC 或启动信标——那些是下一张卡。

import { app } from 'electron';
import { usablePublicKeys, type Channel } from '@musefold/update-protocol';
import { getUpdateChannel } from '../settings/update-channel';
import { createLogger } from '../system/logger';
import {
  BUNDLE_TRUST_PUBLIC_KEYS,
  verifyContentManifest,
  type ContentManifestFailureReason,
} from './bundle-trust';
import {
  getKnownGoodVersion,
  getPendingVersion,
  getRejectedVersions,
} from './content-bundle-store';
import {
  DEFAULT_CONTENT_DOWNLOAD_TIMEOUT_MS,
  installContentBundle,
  type ContentInstallFetch,
  type ContentInstallResult,
  type InstallContentBundleDeps,
} from './content-installer';
import { resolveUpdateFeedUrl } from './updater-service';

const logger = createLogger('content-updater');

const MANIFEST_FILE = 'manifest.json';
const MANIFEST_MAX_BYTES = 1024 * 1024;

export type ContentUpdateCheckResult =
  | { status: 'trust_anchor_missing' }
  | { status: 'manifest_unreachable' }
  | {
      status: 'manifest_invalid';
      reason: ContentManifestFailureReason;
      message: string;
    }
  | ContentInstallResult;

export type ContentUpdateCheckDeps = {
  fetch?: ContentInstallFetch;
  channel?: Channel;
  currentShellVersion?: string;
  publicKeys?: readonly string[];
  userDataRoot?: string;
  timeoutMs?: number;
};

export async function runContentUpdateCheckOnce(
  deps: ContentUpdateCheckDeps = {},
): Promise<ContentUpdateCheckResult> {
  const startedAt = Date.now();
  const publicKeys = usablePublicKeys(deps.publicKeys ?? BUNDLE_TRUST_PUBLIC_KEYS);
  // fail-closed 下拉了也白拉：没锚点就不要发出网络请求，也不打 warn（密钥仪式完成前每次启动都会走到这里）。
  if (publicKeys.length === 0) {
    return { status: 'trust_anchor_missing' };
  }

  const channel = deps.channel ?? getUpdateChannel();
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_CONTENT_DOWNLOAD_TIMEOUT_MS;
  const manifestUrl = resolveContentManifestUrl(channel);

  const rawJson = await fetchManifestText(fetchFn, manifestUrl, timeoutMs);
  if (rawJson === 'unreachable') {
    logger.warn(
      'content update check failed',
      'reason=manifest_unreachable',
      `elapsedMs=${Date.now() - startedAt}`,
    );
    return { status: 'manifest_unreachable' };
  }

  const verified = verifyContentManifest(rawJson, {
    expectedChannel: channel,
    currentShellVersion: deps.currentShellVersion ?? app.getVersion(),
    appliedBundleVersion: getPendingVersion() ?? getKnownGoodVersion(),
    rejectedVersions: getRejectedVersions(),
    publicKeys,
  });
  if (!verified.ok) {
    logger.warn(
      'content update check failed',
      `reason=${verified.reason}`,
      `elapsedMs=${Date.now() - startedAt}`,
    );
    return {
      status: 'manifest_invalid',
      reason: verified.reason,
      message: verified.message,
    };
  }

  return installContentBundle(verified.manifest, installDepsFrom(deps, fetchFn, timeoutMs));
}

function resolveContentManifestUrl(channel: Channel): string {
  // resolveUpdateFeedUrl 返回带尾斜杠的 `updates/<channel>/`。
  return `${resolveUpdateFeedUrl(channel)}${MANIFEST_FILE}`;
}

function installDepsFrom(
  deps: ContentUpdateCheckDeps,
  fetchFn: ContentInstallFetch,
  timeoutMs: number,
): InstallContentBundleDeps {
  return {
    fetch: fetchFn,
    timeoutMs,
    ...(deps.userDataRoot ? { userDataRoot: deps.userDataRoot } : {}),
  };
}

async function fetchManifestText(
  fetchFn: ContentInstallFetch,
  url: string,
  timeoutMs: number,
): Promise<string | 'unreachable'> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return 'unreachable';
  }

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      /* 不可达即可，不必排空 */
    }
    return 'unreachable';
  }

  const bytes = await readBodyWithLimit(response, MANIFEST_MAX_BYTES);
  if (bytes === 'too_large' || bytes === 'failed') return 'unreachable';
  return bytes.toString('utf8');
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer | 'too_large' | 'failed'> {
  if (!response.body) {
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer.byteLength > maxBytes ? 'too_large' : buffer;
    } catch {
      return 'failed';
    }
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* 已判定过大 */
        }
        return 'too_large';
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return 'failed';
  }
  return Buffer.concat(chunks, total);
}
