// 内容层启动状态机（V121-HOT-08）：启动尝试计数、信标提升、自动回滚。
// 协议 §5.2：渲染进程完成首帧并建立 IPC 后，才把 pending 标为已知可用。
// 本模块只依赖 store，不 import renderer-bundle / content-updater，避免循环依赖。

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger } from '../system/logger';
import {
  addRejectedVersion,
  cleanupContentBundles,
  getAttemptCount,
  getBundleDir,
  getKnownGoodVersion,
  getPendingVersion,
  getPreviousGoodVersion,
  setAttemptCount,
  setKnownGoodVersion,
  setPendingVersion,
  setPreviousGoodVersion,
} from './content-bundle-store';

const logger = createLogger('content-bundle-runtime');

export type ContentBundleStartupSource = 'bundle' | 'builtin';

/** 与 `resolveRendererRoot()` 冻结结果结构兼容；不从 main 反向 import。 */
export interface ContentBundleStartupResolution {
  readonly root: string;
  readonly source: ContentBundleStartupSource;
}

export type PrepareContentBundleStartupDeps = {
  userDataRoot?: string;
  /**
   * 本次进程是否会真实加载 content bundle。
   * `false`（窗口走 Vite）：只做 cleanup。attemptCount 的语义是「对 pending 的一次
   * 真实加载尝试」，未加载就不能递增，也不能做 attempt>=2 的拒绝判决——把判决
   * 留到下一次真正消费 bundle 的启动，避免三次 dev 重启把从未加载的版本送进拒绝列表。
   */
  willLoadFromBundles: boolean;
};

let lastUserDataRoot: string | undefined;
let beaconConsumed = false;

/**
 * 在解析渲染根目录**之前**调用。会加载 bundle 时 prepare 会改写 pending
 * （两次未达信标则拒绝），解析必须看到判决后的状态。
 * `willLoadFromBundles` 由调用点按加载分支传入，本模块不嗅探环境变量。
 */
export function prepareContentBundleStartup(deps: PrepareContentBundleStartupDeps): void {
  lastUserDataRoot = deps.userDataRoot;
  cleanupContentBundles(deps.userDataRoot);

  if (!deps.willLoadFromBundles) return;

  const pending = getPendingVersion();
  if (!pending) return;

  const attempts = getAttemptCount();
  if (attempts >= 2) {
    // 上一次运行崩在信标之前，本次启动完成判决（协议 §5.2）。
    addRejectedVersion(pending);
    setPendingVersion(null);
    setAttemptCount(0);
    logger.warn(
      'content bundle startup rejected',
      `version=${versionForLog(pending)}`,
      'reason=startup_beacon_missed',
    );
    return;
  }

  // 先记尝试再加载：若本次到不了信标，计数已留痕。
  setAttemptCount(attempts + 1);
}

/**
 * 按优先级返回**存在**的 bundle 目录：pending（prepare 后仍在）→ knownGood → previousGood。
 * 完整性（index.html + pet.html）由解析器负责，这里只保证顺序与存在性。
 */
export const contentBundleCandidateReader = {
  readCandidates(): readonly string[] {
    const versions = [getPendingVersion(), getKnownGoodVersion(), getPreviousGoodVersion()];
    const seen = new Set<string>();
    const dirs: string[] = [];
    for (const version of versions) {
      if (!version || seen.has(version)) continue;
      seen.add(version);
      let dir: string;
      try {
        dir = getBundleDir(version, lastUserDataRoot);
      } catch {
        continue;
      }
      if (existsSync(dir)) dirs.push(dir);
    }
    return dirs;
  },
};

/**
 * 信标到达。必须绑定**实际被服务**的 bundle：pending 目录不完整时解析器会静默回落
 * knownGood（或 builtin），此时到达的信标绝不能把 pending 提升为已知可用。
 *
 * `source` 仅用于日志（主窗口 / 宠物窗口都会发）；判定只看冻结的 resolution。
 */
export function confirmContentBundleStartup(
  resolution: ContentBundleStartupResolution | undefined,
  source?: string,
): void {
  if (beaconConsumed) return;
  beaconConsumed = true;

  // 开发态若从未冻结解析结果，信标空操作：不能在这里顺带 resolve 成 builtin/bundle。
  if (!resolution) {
    logger.info('content bundle startup beacon ignored', 'reason=unfrozen');
    return;
  }
  if (resolution.source === 'builtin') {
    logger.info('content bundle startup beacon ignored', 'reason=builtin');
    return;
  }

  const pending = getPendingVersion();
  if (!pending) return;

  let pendingDir: string;
  try {
    pendingDir = getBundleDir(pending, lastUserDataRoot);
  } catch {
    return;
  }

  if (resolve(resolution.root) !== resolve(pendingDir)) return;

  const previousKnown = getKnownGoodVersion();
  setPreviousGoodVersion(previousKnown);
  setKnownGoodVersion(pending);
  setPendingVersion(null);
  setAttemptCount(0);
  logger.info(
    'content bundle marked known-good',
    `version=${versionForLog(pending)}`,
    ...(source ? [`beacon=${source}`] : []),
  );
}

/** 仅供测试：重置进程内信标幂等标志与 prepare 注入的 userData。 */
export function resetContentBundleRuntimeForTests(): void {
  beaconConsumed = false;
  lastUserDataRoot = undefined;
}

function versionForLog(version: string): string {
  return /^[0-9A-Za-z.+-]{1,64}$/.test(version) ? version : 'invalid';
}
