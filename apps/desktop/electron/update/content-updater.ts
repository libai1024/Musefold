// 内容层更新的单次检查编排与后台调度（V121-HOT-08）。
// 启动信标在 content-bundle-runtime.ts，两边都不互相 import。

import { app } from 'electron';
import { usablePublicKeys, type Channel } from '@musefold/update-protocol';
import type { ContentLayerCheckSnapshot } from '@shared/types/updater';
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

/** app ready 后首次检查延迟。E2E 可在未打包时用环境变量缩短。 */
export const CONTENT_UPDATE_CHECK_INITIAL_DELAY_MS = 30_000;
/** 此后周期检查间隔。 */
export const CONTENT_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
  /** 覆盖 manifest 拉取地址。生产调度只在未打包时从测试环境变量注入。 */
  manifestUrl?: string;
};

export type ContentUpdateSchedulePlan = {
  disabled: boolean;
  initialDelayMs: number;
  checkDeps: ContentUpdateCheckDeps;
};

/** 本次进程内最近一次检查的脱敏快照；不落盘，进程退出即丢。 */
let lastContentUpdateCheck: ContentLayerCheckSnapshot | null = null;

export function getLastContentUpdateCheck(): ContentLayerCheckSnapshot | null {
  return lastContentUpdateCheck;
}

/** 仅供测试：丢掉模块内存中的最近检查记录。 */
export function resetLastContentUpdateCheckForTests(): void {
  lastContentUpdateCheck = null;
}

export async function runContentUpdateCheckOnce(
  deps: ContentUpdateCheckDeps = {},
): Promise<ContentUpdateCheckResult> {
  const result = await executeContentUpdateCheckOnce(deps);
  rememberContentUpdateCheck(result);
  return result;
}

async function executeContentUpdateCheckOnce(
  deps: ContentUpdateCheckDeps,
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
  const manifestUrl = deps.manifestUrl ?? resolveContentManifestUrl(channel);

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

function rememberContentUpdateCheck(result: ContentUpdateCheckResult): void {
  // 只留 status/reason/时间戳：message 是可能演进的英文句子，且可能夹带内部细节。
  const at = Date.now();
  lastContentUpdateCheck =
    result.status === 'manifest_invalid'
      ? { status: result.status, reason: result.reason, at }
      : { status: result.status, at };
}

let contentUpdateScheduleStarted = false;

/**
 * 读取调度计划。
 *
 * 安全边界：`MUSEFOLD_CONTENT_TEST_PUBLIC_KEY` / `MUSEFOLD_CONTENT_TEST_FEED_URL` /
 * `MUSEFOLD_CONTENT_CHECK_INITIAL_DELAY_MS` **只在 `!app.isPackaged` 时读取**。
 * 打包构建绝不能把信任锚或 feed URL 交给环境变量，否则等于给已分发二进制开后门。
 * `MUSEFOLD_CONTENT_UPDATE_DISABLED=1` 任意构建形态都尊重（只关不开）。
 */
export function resolveContentUpdateSchedulePlan(
  env: NodeJS.ProcessEnv = process.env,
  isPackaged = app.isPackaged,
): ContentUpdateSchedulePlan {
  const disabled = env['MUSEFOLD_CONTENT_UPDATE_DISABLED'] === '1';
  const checkDeps: ContentUpdateCheckDeps = {};
  let initialDelayMs = CONTENT_UPDATE_CHECK_INITIAL_DELAY_MS;

  if (!isPackaged) {
    const publicKey = env['MUSEFOLD_CONTENT_TEST_PUBLIC_KEY'];
    if (typeof publicKey === 'string' && publicKey.length > 0) {
      checkDeps.publicKeys = [publicKey];
    }
    const feedUrl = env['MUSEFOLD_CONTENT_TEST_FEED_URL'];
    if (typeof feedUrl === 'string' && feedUrl.length > 0) {
      checkDeps.manifestUrl = feedUrl;
    }
    const delayRaw = env['MUSEFOLD_CONTENT_CHECK_INITIAL_DELAY_MS'];
    if (typeof delayRaw === 'string' && delayRaw.length > 0) {
      const parsed = Number.parseInt(delayRaw, 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        initialDelayMs = parsed;
      }
    }
  }

  return { disabled, initialDelayMs, checkDeps };
}

/** app ready 后延迟首查，此后按间隔复查。幂等：重复调用不会叠加定时器。 */
export function scheduleContentUpdateChecks(
  env: NodeJS.ProcessEnv = process.env,
  isPackaged = app.isPackaged,
): void {
  if (contentUpdateScheduleStarted) return;
  contentUpdateScheduleStarted = true;

  const plan = resolveContentUpdateSchedulePlan(env, isPackaged);
  if (plan.disabled) return;

  const run = (): void => {
    void runContentUpdateCheckOnce(plan.checkDeps)
      .then((result) => {
        logCheckResult(result);
      })
      .catch(() => {
        logger.warn('content update check failed', 'reason=unhandled');
      });
  };

  setTimeout(run, plan.initialDelayMs);
  setInterval(run, CONTENT_UPDATE_CHECK_INTERVAL_MS);
}

/** 仅供测试：允许下一例重新调度。 */
export function resetContentUpdateScheduleForTests(): void {
  contentUpdateScheduleStarted = false;
}

function logCheckResult(result: ContentUpdateCheckResult): void {
  // 密钥仪式完成前每次启动都会走到缺锚点；与单次检查一样不打 info/warn。
  if (result.status === 'trust_anchor_missing') return;
  const parts = [`status=${result.status}`];
  if ('reason' in result && result.reason) parts.push(`reason=${result.reason}`);
  if ('bundleVersion' in result && result.bundleVersion) {
    parts.push(`version=${result.bundleVersion}`);
  }
  logger.info('content update check finished', ...parts);
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
