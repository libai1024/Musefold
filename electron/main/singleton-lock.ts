// 强杀/崩溃恢复：清理指向死进程的 Chromium 单实例锁。
//
// 背景：POSIX 上 Chromium 的单实例锁是 userData 下的 SingletonLock 符号链接
// （目标形如 `hostname-pid`）。进程被 SIGKILL/断电带走时锁不会释放；
// Chromium 自己要约一秒才判定陈旧并接管。这个窗口内重开应用，
// requestSingleInstanceLock() 返回 false → app.quit() → 静默退出（rc=0，
// 无任何提示）。用户表现是「强退后立刻双击图标没反应，再点一次就好」。
//
// 修复：启动时（调用 requestSingleInstanceLock 之前）检查锁的持有进程——
// 只有「同主机 + 进程确认已死」才把锁三件套清掉，让本实例立即接管；
// 持有进程仍活着（真实的第二实例场景）或无法确认时，一律不动锁，
// 交给 Chromium 的正常仲裁。Windows 用命名互斥量，进程死亡即释放，无此问题。

import { readlinkSync, rmSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';

const SINGLETON_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'] as const;

/** 解析 SingletonLock 符号链接目标（`hostname-pid`）；无法解析返回 null。 */
export function parseSingletonLockTarget(target: string): { host: string; pid: number } | null {
  const separator = target.lastIndexOf('-');
  if (separator <= 0 || separator === target.length - 1) return null;
  const pid = Number(target.slice(separator + 1));
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { host: target.slice(0, separator), pid };
}

export interface ClearStaleSingletonLockOptions {
  /** 平台（默认当前进程）；Windows 无锁文件直接跳过。 */
  platform?: NodeJS.Platform;
  /** 主机名（测试注入用）。 */
  host?: string;
  /** 进程存活探测（测试注入用）：抛 ESRCH 视为已死。 */
  probeProcess?: (pid: number) => void;
}

/**
 * 清理可验证已死的单实例锁。返回是否执行了清理（可观测性/测试用）。
 * 任何读取失败（锁不存在、非符号链接等）都按正常路径静默返回。
 */
export function clearStaleSingletonLock(
  userDataDir: string,
  options: ClearStaleSingletonLockOptions = {},
): boolean {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return false;

  let target: string;
  try {
    target = readlinkSync(join(userDataDir, 'SingletonLock'));
  } catch {
    return false; // 锁不存在：全新启动或已被正常释放
  }

  const parsed = parseSingletonLockTarget(target);
  if (!parsed) return false;
  // 锁可能来自共享目录上的另一台机器：不是本机的锁绝不动。
  if (parsed.host !== (options.host ?? hostname())) return false;

  const probe = options.probeProcess ?? ((pid: number) => process.kill(pid, 0));
  try {
    probe(parsed.pid);
    return false; // 信号可送达：持锁进程仍在（真实第二实例），交给正常仲裁
  } catch (error) {
    // EPERM = 进程存在但无权限（他人进程复用了该 PID）→ 同样不动锁；
    // 只有 ESRCH（查无此进程）才允许清理。
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
  }

  for (const name of SINGLETON_FILES) {
    try {
      rmSync(join(userDataDir, name), { force: true });
    } catch {
      // 尽力清理：个别文件删不掉时交回 Chromium 的陈旧锁判定
    }
  }
  return true;
}
