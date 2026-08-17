import {
  acquireOwnerLock,
  currentOwner,
  readDiscoveryFile,
  type AcquireResult,
  type OwnerLockInfo,
} from '@musefold/automation-server';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_FORCE_KILL_AFTER_MS = 3_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export interface HeadlessTakeoverOptions {
  timeoutMs?: number;
  forceKillAfterMs?: number;
  pollIntervalMs?: number;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 桌面 App 启动时若发现 musefold serve 正在持有数据目录，先温和终止
 * headless 守护并等待 owner.lock 释放，再由桌面接管。
 */
export async function acquireDesktopOwnerLockWithHeadlessTakeover(
  dataDir: string,
  options: HeadlessTakeoverOptions = {},
): Promise<AcquireResult> {
  const initial = acquireOwnerLock(dataDir, 'desktop-app');
  if (initial.acquired || initial.holder?.owner !== 'headless-daemon') return initial;

  await stopHeadlessDaemonForTakeover(dataDir, initial.holder, options);
  return acquireOwnerLock(dataDir, 'desktop-app');
}

async function stopHeadlessDaemonForTakeover(
  dataDir: string,
  holder: OwnerLockInfo,
  options: HeadlessTakeoverOptions,
): Promise<boolean> {
  if (holder.pid === process.pid) return false;
  if (!headlessDiscoveryMatches(dataDir, holder)) return false;

  const signalProcess = options.signalProcess ?? ((pid, signal) => process.kill(pid, signal));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forceKillAfterMs = options.forceKillAfterMs ?? DEFAULT_FORCE_KILL_AFTER_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  let forceKillSent = false;

  if (!sendSignal(holder.pid, 'SIGTERM', signalProcess)) return false;

  while (Date.now() - startedAt < timeoutMs) {
    const current = currentOwner(dataDir);
    if (!current || current.pid !== holder.pid || current.owner !== holder.owner) return true;

    if (!forceKillSent && Date.now() - startedAt >= forceKillAfterMs) {
      forceKillSent = sendSignal(holder.pid, 'SIGKILL', signalProcess);
    }

    await sleep(pollIntervalMs);
  }

  return false;
}

function headlessDiscoveryMatches(dataDir: string, holder: OwnerLockInfo): boolean {
  const discovery = readDiscoveryFile(dataDir);
  if (!discovery) return true;
  return discovery.owner === 'headless-daemon' && discovery.pid === holder.pid;
}

function sendSignal(
  pid: number,
  signal: NodeJS.Signals,
  signalProcess: (pid: number, signal: NodeJS.Signals) => void,
): boolean {
  try {
    signalProcess(pid, signal);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}
