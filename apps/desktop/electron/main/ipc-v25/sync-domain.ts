// v2.5 桌面云同步域桥:core DesktopSyncEngine + 新 API /api/v1/sync/*。
// 登录 ≠ 同步:开关由用户在设置里显式打开(setEnabled),打开即全量跑一轮;
// 之后写路径 scheduleV25CloudSync() 防抖触发 + 60s 兜底轮。
// 旧 CloudSyncService(electron/cloud-sync,绑旧登录体系)不再被 v25 界面触达,M5c 删。

import os from 'node:os';
import type { DesktopSyncStatus, SetSyncEnabled } from '@musefold/contracts';
import {
  syncBootstrapPageSchema,
  syncDeviceSchema,
  syncPullResultSchema,
  syncPushResultSchema,
  syncUsagePushResultSchema,
  setSyncEnabledSchema,
} from '@musefold/contracts';
import {
  DesktopSyncEngine,
  DesktopSyncRepository,
  type DesktopSyncSummary,
  type DesktopSyncTransport,
} from '@musefold/core';
import { getDb } from '@musefold/core/db';
import { app } from 'electron';
import { z } from 'zod';
import { createLogger } from '../../system/logger';
import { apiBase, fetchAccountStatus, onAccountChanged, readSessionToken } from './account-domain';
import { BridgeError, type MethodDef } from './envelope';

const logger = createLogger('ipc-v25:sync');

const SYNC_DEBOUNCE_MS = 2_000;
const SYNC_INTERVAL_MS = 60_000;

// ---------- transport:bearer token → /api/v1/sync/* ----------

async function syncFetch(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const token = await readSessionToken();
  if (!token) throw new BridgeError('AUTH_REQUIRED', '登录状态已失效,云同步已暂停');
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/api/v1${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new BridgeError('ACCOUNT_SERVICE_UNAVAILABLE', '无法连接 Musefold 云服务');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined;
    throw new BridgeError(
      body?.error?.code ?? 'INTERNAL_ERROR',
      body?.error?.message ?? `云同步请求失败(HTTP ${response.status})`,
    );
  }
  return response.json();
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const raw = search.toString();
  return raw ? `?${raw}` : '';
}

const cloudTransport: DesktopSyncTransport = {
  async registerDevice(input) {
    return syncDeviceSchema.parse(
      await syncFetch('/sync/devices', { method: 'POST', body: input }),
    );
  },
  async bootstrap(input) {
    const query = toQuery({ entity: input.entity, after: input.after, limit: input.limit });
    return syncBootstrapPageSchema.parse(
      await syncFetch(`/sync/bootstrap${query}`, { method: 'GET' }),
    );
  },
  async pull(input) {
    const query = toQuery({ cursor: input.cursor, limit: input.limit, deviceId: input.deviceId });
    return syncPullResultSchema.parse(await syncFetch(`/sync/pull${query}`, { method: 'GET' }));
  },
  async push(input) {
    return syncPushResultSchema.parse(
      await syncFetch('/sync/push', { method: 'POST', body: input }),
    );
  },
  async pushUsage(input) {
    return syncUsagePushResultSchema.parse(
      await syncFetch('/sync/usage', { method: 'POST', body: input }),
    );
  },
};

// ---------- 单例引擎 + 调度 ----------

interface SyncRuntime {
  repository: DesktopSyncRepository;
  engine: DesktopSyncEngine;
}

let runtime: SyncRuntime | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

function getRuntime(): SyncRuntime {
  if (!runtime) {
    const repository = new DesktopSyncRepository(getDb());
    runtime = { repository, engine: new DesktopSyncEngine(repository, cloudTransport) };
  }
  return runtime;
}

function runSync(): Promise<DesktopSyncSummary> {
  return getRuntime()
    .engine.run()
    .catch((error) => {
      logger.warn('云同步失败', error instanceof Error ? error.message : String(error));
      return getRuntime().repository.getSummary();
    });
}

function startSchedulers(): void {
  intervalTimer ??= setInterval(() => {
    void runSync();
  }, SYNC_INTERVAL_MS);
}

function stopSchedulers(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  debounceTimer = null;
  intervalTimer = null;
}

/**
 * 写路径防抖触发(prompts 域每次成功写库后调)。
 * 未开启同步时是纯 no-op,不读库不发网。
 */
export function scheduleV25CloudSync(): void {
  const active = getRuntime().repository.getActiveAccount();
  if (!active?.enabled) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync();
  }, SYNC_DEBOUNCE_MS);
}

/** 应用启动时恢复上次的开关状态(enabled 则立即补一轮 + 起兜底轮)。 */
export function resumeV25CloudSyncOnStartup(): void {
  const active = getRuntime().repository.getActiveAccount();
  if (!active?.enabled) return;
  startSchedulers();
  void runSync();
}

/** 应用退出前停调度(closeDb 之后再触发同步会打已关闭的连接)。 */
export function stopV25CloudSync(): void {
  stopSchedulers();
}

// ---------- summary → 契约 ----------

function toContractStatus(summary: DesktopSyncSummary): DesktopSyncStatus {
  const { account } = summary;
  return {
    enabled: account?.enabled ?? false,
    state: summary.status,
    account: account ? { username: account.username, deviceName: account.deviceName } : null,
    lastSyncedAt:
      account?.lastSyncAt != null
        ? new Date(account.lastSyncAt).toISOString().replace(/Z$/, '+00:00')
        : null,
    pendingMutations: summary.pendingMutations,
    conflicts: summary.conflicts,
    error: account?.lastError ?? null,
  };
}

function desktopPlatform(): 'macos' | 'windows' | 'linux' {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

// ---------- 方法表 ----------

export function buildSyncDomainMethods(): Record<string, MethodDef> {
  // 登录/登出/换账号 → 停调度并关开关(登录 ≠ 同步,换身份后须重新显式开启)。
  onAccountChanged(() => {
    stopSchedulers();
    const { repository } = getRuntime();
    const active = repository.getActiveAccount();
    if (active?.enabled) repository.setEnabled(active.ownerId, false);
  });
  resumeV25CloudSyncOnStartup();

  return {
    'sync.getStatus': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => toContractStatus(getRuntime().repository.getSummary()),
    },
    'sync.setEnabled': {
      input: setSyncEnabledSchema,
      handle: async (input) => {
        const { enabled } = input as SetSyncEnabled;
        const { repository } = getRuntime();
        if (!enabled) {
          stopSchedulers();
          const active = repository.getActiveAccount();
          if (active) repository.setEnabled(active.ownerId, false);
          return toContractStatus(repository.getSummary());
        }
        const token = await readSessionToken();
        if (!token) throw new BridgeError('AUTH_REQUIRED', '请先登录账号再开启云同步');
        const status = await fetchAccountStatus(token);
        repository.activateAccount({
          ownerId: status.id,
          username: status.username,
          deviceName: os.hostname() || 'Musefold Desktop',
          platform: desktopPlatform(),
          clientVersion: app.getVersion(),
        });
        repository.setEnabled(status.id, true);
        startSchedulers();
        return toContractStatus(await runSync());
      },
    },
    'sync.syncNow': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        const active = getRuntime().repository.getActiveAccount();
        if (!active?.enabled) {
          throw new BridgeError('VALIDATION_FAILED', '云同步未开启');
        }
        return toContractStatus(await runSync());
      },
    },
  };
}

/** 测试注入:替换 transport/repository(仅单测使用)。 */
export function resetSyncRuntimeForTests(next: SyncRuntime | null): void {
  stopSchedulers();
  runtime = next;
}
