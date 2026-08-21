// electron/security/os-crypt-durability.ts
// Windows 专用：写密文之前，先确认保护它的 safeStorage 主密钥已经落盘。
// 详见 docs/05-image-generation.md §4.3
//
// Chromium 在 Windows 上把 DPAPI 包裹后的 safeStorage 主密钥写进 userData 的
// `Local State`（pref 名 `os_crypt.encrypted_key`）。os_crypt_win.cc 只调用
// PrefService::SetString，不调用 CommitPendingWrite，这次写入要等 JsonPrefStore
// 的提交定时器（10 秒）。定时器到期前强制退出（崩溃、断电、任务管理器结束进程），
// 重启后 Chromium 找不到密钥就会另生成一把，此前写下的密文全部作废。
//
// Chromium 没有暴露强制落盘的接口，所以这里把因果反过来：主密钥在盘上之后才允许
// 写密文。等待是同步的——渲染进程独立于主进程，主进程短暂阻塞不会冻结界面，而
// saveApiKey / AI keychain 的调用方全是同步接口，改异步要穿透 IPC、automation
// LocalAdminOps 与账号编排三条链路。代价只落在「装机后头 10 秒内保存密钥」，
// 一台机器一生至多遇到一次。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

const LOCAL_STATE_FILE = 'Local State';
/** Chromium 的提交定时器是 10s，留一倍余量。 */
const WAIT_BUDGET_MS = 20_000;
const POLL_INTERVAL_MS = 100;

const sleepSlot = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(sleepSlot, 0, 0, ms);
}

/** `Local State` 里是否已有 DPAPI 包裹的主密钥。 */
export function hasPersistedOsCryptKey(localStatePath: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(localStatePath, 'utf8')) as {
      os_crypt?: { encrypted_key?: unknown };
    };
    const key = parsed.os_crypt?.encrypted_key;
    return typeof key === 'string' && key.length > 0;
  } catch {
    // 文件尚未出现，或正处于 ImportantFileWriter 的换名窗口——都按未落盘处理。
    return false;
  }
}

export interface WaitForOsCryptKeyOptions {
  localStatePath: string;
  budgetMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => void;
  now?: () => number;
}

/** 轮询等待主密钥落盘；返回是否等到（超时返回 false，不抛）。 */
export function waitForPersistedOsCryptKey(options: WaitForOsCryptKeyOptions): boolean {
  const budgetMs = options.budgetMs ?? WAIT_BUDGET_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const sleep = options.sleep ?? sleepSync;
  const now = options.now ?? Date.now;
  const deadline = now() + budgetMs;
  for (;;) {
    if (hasPersistedOsCryptKey(options.localStatePath)) return true;
    if (now() >= deadline) return false;
    sleep(pollIntervalMs);
  }
}

let persisted = false;

/**
 * 写入任何 safeStorage 密文之前调用。
 *
 * 非 Windows 直接放行：macOS 的密钥在系统钥匙串、Linux 在 keyring 或明文，
 * 都不依赖 `Local State`。超时也放行——挡住保存比丢一次密钥更糟。
 */
export function ensureOsCryptKeyPersisted(): void {
  if (persisted || process.platform !== 'win32') return;

  let localStatePath: string;
  try {
    localStatePath = join(app.getPath('userData'), LOCAL_STATE_FILE);
  } catch {
    return; // 主进程之外（单测）没有 userData，不阻挡调用方。
  }

  persisted = waitForPersistedOsCryptKey({ localStatePath });
  if (!persisted) {
    console.warn(
      '[security] safeStorage 主密钥仍未写入 Local State，此刻强制退出会让本次保存的密钥失效',
    );
  }
}
