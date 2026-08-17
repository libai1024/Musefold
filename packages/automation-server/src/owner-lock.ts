// 单写者所有权锁（V04-ARCHITECTURE §3.3）：桌面 App 与 headless 守护互斥。
// O_EXCL 原子创建 owner.lock（内容 = pid + owner)；持锁进程死亡视为陈旧可接管
// （与 singleton-lock 同一套判活逻辑）。

import { readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

export const OWNER_LOCK_FILE = 'owner.lock';

export interface OwnerLockInfo {
  pid: number;
  owner: 'desktop-app' | 'headless-daemon';
  acquiredAt: string;
}

export interface AcquireResult {
  acquired: boolean;
  /** 未获取时：当前持有者（若可读） */
  holder?: OwnerLockInfo | null;
  release?: () => void;
}

function lockPath(dataDir: string): string {
  return join(dataDir, OWNER_LOCK_FILE);
}

function readLock(dataDir: string): OwnerLockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath(dataDir), 'utf8')) as Partial<OwnerLockInfo>;
    if (typeof parsed.pid !== 'number' || (parsed.owner !== 'desktop-app' && parsed.owner !== 'headless-daemon')) {
      return null;
    }
    return parsed as OwnerLockInfo;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM：进程存在但无权限 → 视为存活
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function acquireOwnerLock(
  dataDir: string,
  owner: OwnerLockInfo['owner'],
): AcquireResult {
  const path = lockPath(dataDir);
  const info: OwnerLockInfo = { pid: process.pid, owner, acquiredAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, JSON.stringify(info), { flag: 'wx', mode: 0o600 });
      return { acquired: true, release: () => releaseIfOwned(dataDir) };
    } catch {
      const holder = readLock(dataDir);
      // 锁内容非法或持有者已死 → 清掉陈旧锁再试一次
      if (!holder || !processAlive(holder.pid)) {
        rmSync(path, { force: true });
        continue;
      }
      return { acquired: false, holder };
    }
  }
  return { acquired: false, holder: readLock(dataDir) };
}

export function currentOwner(dataDir: string): OwnerLockInfo | null {
  const holder = readLock(dataDir);
  if (!holder) return null;
  return processAlive(holder.pid) ? holder : null;
}

function releaseIfOwned(dataDir: string): void {
  const holder = readLock(dataDir);
  if (holder?.pid === process.pid) rmSync(lockPath(dataDir), { force: true });
}
