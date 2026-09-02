// v2.5 桌面云同步域桥:core DesktopSyncEngine + 新 API /api/v1/sync/*。
// 登录 ≠ 同步:开关由用户在设置里显式打开(setEnabled),打开即全量跑一轮;
// 之后写路径 scheduleV25CloudSync() 防抖触发 + 60s 兜底轮。
// 旧 CloudSyncService(electron/cloud-sync,绑旧登录体系)不再被 v25 界面触达,M5c 删。

import os from 'node:os';
import type {
  DesktopSyncConsent,
  DesktopSyncPhase,
  DesktopSyncStatus,
  SetSyncEnabled,
  SyncConflictResolutionInput,
  SyncConflictSummary,
} from '@musefold/contracts';
import {
  desktopSyncStatusSchema,
  resolveSyncConflictInputSchema,
  setSyncConsentInputSchema,
  setSyncEnabledSchema,
  syncBootstrapPageSchema,
  syncConflictListSchema,
  syncDeviceSchema,
  syncPullResultSchema,
  syncPushResultSchema,
  syncUsagePushResultSchema,
} from '@musefold/contracts';
import {
  DesktopSyncEngine,
  DesktopSyncRepository,
  type DesktopSyncSummary,
  type DesktopSyncTransport,
} from '@musefold/core';
import { getDb } from '@musefold/core/db';
import { resolveAccountWorkspace } from '@musefold/core/db/workspaces';
import { app } from 'electron';
import { z } from 'zod';
import { createLogger } from '../../system/logger';
import {
  apiBase,
  bindSessionOwner,
  fetchAccountStatus,
  onAccountChangeCancelled,
  onAccountChanged,
  onBeforeAccountChange,
  readSessionCredentials,
} from './account-domain';
import { BridgeError, type MethodDef } from './envelope';

const logger = createLogger('ipc-v25:sync');

const SYNC_DEBOUNCE_MS = 2_000;
const SYNC_INTERVAL_MS = 60_000;
const WORKSPACE_BLOCKED_ERROR = '当前账号工作区尚未建立,请先显式接管本地数据';

// ---------- transport:bearer token → /api/v1/sync/* ----------

async function syncFetch(
  token: string,
  signal: AbortSignal,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
) {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/api/v1${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
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

function createCloudTransport(token: string, signal: AbortSignal): DesktopSyncTransport {
  return {
    async registerDevice(input) {
      return syncDeviceSchema.parse(
        await syncFetch(token, signal, '/sync/devices', { method: 'POST', body: input }),
      );
    },
    async bootstrap(input) {
      const query = toQuery({ entity: input.entity, after: input.after, limit: input.limit });
      return syncBootstrapPageSchema.parse(
        await syncFetch(token, signal, `/sync/bootstrap${query}`, { method: 'GET' }),
      );
    },
    async pull(input) {
      const query = toQuery({ cursor: input.cursor, limit: input.limit, deviceId: input.deviceId });
      return syncPullResultSchema.parse(
        await syncFetch(token, signal, `/sync/pull${query}`, { method: 'GET' }),
      );
    },
    async push(input) {
      return syncPushResultSchema.parse(
        await syncFetch(token, signal, '/sync/push', { method: 'POST', body: input }),
      );
    },
    async pushUsage(input) {
      return syncUsagePushResultSchema.parse(
        await syncFetch(token, signal, '/sync/usage', { method: 'POST', body: input }),
      );
    },
  };
}

// ---------- 单例引擎 + 调度 ----------

interface SyncRuntime {
  repository: DesktopSyncRepository;
  engine: DesktopSyncEngine;
  transportFactory?: (token: string, signal: AbortSignal) => DesktopSyncTransport;
  getWorkspace?: (ownerId: string) => string | null;
}

let runtime: SyncRuntime | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let currentRunController: AbortController | null = null;
let syncEpoch = 0;
let accountChangeInProgress = false;
let shuttingDown = false;
let enabling = false;
let authBlocked = false;
let workspaceBlocked = false;

function getRuntime(): SyncRuntime {
  if (!runtime) {
    const repository = new DesktopSyncRepository(getDb());
    runtime = {
      repository,
      engine: new DesktopSyncEngine(repository),
      transportFactory: createCloudTransport,
      getWorkspace: (ownerId) => resolveAccountWorkspace(getDb(), ownerId),
    };
  }
  return runtime;
}

async function runSync(): Promise<DesktopSyncSummary> {
  const { engine, repository } = getRuntime();
  if (accountChangeInProgress || shuttingDown) return repository.getSummary();
  if (engine.isRunning()) return engine.run().catch(() => repository.getSummary());
  const epoch = syncEpoch;
  const credentials = await readSessionCredentials();
  if (epoch !== syncEpoch || accountChangeInProgress || shuttingDown)
    return repository.getSummary();
  const active = repository.getActiveAccount();
  if (!credentials || !active || credentials.ownerId !== active.ownerId) {
    authBlocked = active?.consent === 'enabled';
    return repository.getSummary();
  }
  if (active.consent !== 'enabled') return repository.getSummary();
  // A signed-in owner without an explicitly adopted account workspace remains
  // local-only. Do not even construct a transport for that owner.
  const workspaceId = getRuntime().getWorkspace?.(active.ownerId);
  if (!workspaceId) {
    workspaceBlocked = true;
    return repository.getSummary();
  }
  workspaceBlocked = false;
  const controller = new AbortController();
  currentRunController = controller;
  const transport = getRuntime().transportFactory?.(credentials.token, controller.signal);
  return engine
    .run(transport)
    .then((summary) => {
      authBlocked = false;
      return summary;
    })
    .catch((error) => {
      if (error instanceof BridgeError && error.code === 'AUTH_REQUIRED') authBlocked = true;
      logger.warn('云同步失败', error instanceof Error ? error.message : String(error));
      return repository.getSummary();
    })
    .finally(() => {
      if (currentRunController === controller) currentRunController = null;
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
  if (accountChangeInProgress || shuttingDown) return;
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
  if (accountChangeInProgress || shuttingDown) return;
  const active = getRuntime().repository.getActiveAccount();
  if (!active?.enabled) return;
  if (!getRuntime().getWorkspace?.(active.ownerId)) {
    workspaceBlocked = true;
    return;
  }
  workspaceBlocked = false;
  startSchedulers();
  void runSync();
}

async function suspendTransport(): Promise<void> {
  syncEpoch += 1;
  stopSchedulers();
  if (!runtime) return;
  runtime.engine.cancelCurrent();
  currentRunController?.abort();
  await runtime.engine.awaitIdle();
  currentRunController = null;
}

/** 应用退出或账号切换前中止网络并等待当前 run 收敛。 */
export async function quiesceV25CloudSync(): Promise<void> {
  accountChangeInProgress = true;
  await suspendTransport();
}

/** 应用退出前停调度并等待,防止 closeDb 后旧 run 恢复写库。 */
export async function stopV25CloudSync(): Promise<void> {
  shuttingDown = true;
  await quiesceV25CloudSync();
}

// ---------- summary → 契约 ----------

function derivePhase(summary: DesktopSyncSummary): DesktopSyncPhase {
  const { account } = summary;
  if (!account) return 'signed_out';
  if (account.consent === 'unset') return 'awaiting_consent';
  if (account.consent === 'paused') return 'paused';
  if (authBlocked) return 'auth_blocked';
  if (workspaceBlocked) return 'error';
  if (enabling) return 'enabling';
  if (getRuntime().engine.isRunning()) return 'syncing';
  if (summary.conflicts > 0) return 'conflict';
  if (account.lastError) return 'error';
  return 'idle';
}

function toContractStatus(summary: DesktopSyncSummary): DesktopSyncStatus {
  const { account } = summary;
  const consent: DesktopSyncConsent = account?.consent ?? 'unset';
  const phase = derivePhase(summary);
  const state: DesktopSyncStatus['state'] =
    phase === 'syncing' || phase === 'enabling'
      ? 'syncing'
      : phase === 'conflict'
        ? 'conflict'
        : phase === 'error' || phase === 'auth_blocked'
          ? 'error'
          : consent === 'enabled'
            ? 'idle'
            : 'disabled';
  return desktopSyncStatusSchema.parse({
    consent,
    phase,
    enabled: consent === 'enabled',
    state,
    account: account ? { username: account.username, deviceName: account.deviceName } : null,
    lastSyncedAt:
      account?.lastSyncAt != null
        ? new Date(account.lastSyncAt).toISOString().replace(/Z$/, '+00:00')
        : null,
    pendingMutations: summary.pendingMutations,
    conflicts: summary.conflicts,
    error: workspaceBlocked ? WORKSPACE_BLOCKED_ERROR : (account?.lastError ?? null),
  });
}

function toContractConflicts(repository: DesktopSyncRepository): SyncConflictSummary[] {
  const active = repository.getActiveAccount();
  if (!active) throw new BridgeError('AUTH_REQUIRED', '请先登录账号');
  const workspaceId = repository.getAccountWorkspace(active.ownerId);
  if (!workspaceId) throw new BridgeError('VALIDATION_FAILED', '当前账号工作区尚未建立');
  const conflicts = repository.listConflicts(active.ownerId, workspaceId).map((conflict) => ({
    id: conflict.id,
    entityId: conflict.entityId,
    entityType: conflict.entityType,
    localSnapshot: conflict.localSnapshot,
    remoteSnapshot: conflict.remoteSnapshot,
    createdAt: new Date(conflict.detectedAt).toISOString().replace(/Z$/, '+00:00'),
    canDuplicate: conflict.entityType === 'prompt',
  }));
  return syncConflictListSchema.parse(conflicts);
}

function desktopPlatform(): 'macos' | 'windows' | 'linux' {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

// ---------- 方法表 ----------

export function buildSyncDomainMethods(): Record<string, MethodDef> {
  onBeforeAccountChange(quiesceV25CloudSync);
  onAccountChangeCancelled(() => {
    accountChangeInProgress = false;
    resumeV25CloudSyncOnStartup();
  });
  onAccountChanged((status) => {
    const { repository, getWorkspace } = getRuntime();
    authBlocked = false;
    let activated = false;
    try {
      if (status) {
        // Login only selects the owner. It must not adopt legacy rows or create
        // a cloud container; explicit adoption/establishment owns that action.
        const workspaceId = getWorkspace?.(status.id);
        workspaceBlocked = !workspaceId;
        repository.activateAccount({
          ownerId: status.id,
          username: status.username,
          deviceName: os.hostname() || 'Musefold Desktop',
          platform: desktopPlatform(),
          clientVersion: app.getVersion(),
        });
      } else {
        workspaceBlocked = false;
        repository.deactivateAccount();
      }
      activated = true;
    } finally {
      accountChangeInProgress = false;
    }
    if (activated) resumeV25CloudSyncOnStartup();
  });
  resumeV25CloudSyncOnStartup();

  const handleSetConsent = async (consent: DesktopSyncConsent): Promise<DesktopSyncStatus> => {
    if (accountChangeInProgress || shuttingDown) {
      throw new BridgeError('CONFLICT', '账号正在切换,请稍后重试');
    }
    if (consent === 'unset') {
      throw new BridgeError('VALIDATION_FAILED', '已建立的同步同意只能暂停,不能重置');
    }
    const { repository, getWorkspace } = getRuntime();
    if (consent === 'paused') {
      const active = repository.getActiveAccount();
      if (!active) throw new BridgeError('AUTH_REQUIRED', '请先登录账号');
      await suspendTransport();
      repository.setConsent(active.ownerId, 'paused');
      return toContractStatus(repository.getSummary());
    }

    const credentials = await readSessionCredentials();
    if (!credentials) throw new BridgeError('AUTH_REQUIRED', '请先登录账号再开启云同步');
    const status = await fetchAccountStatus(credentials.token);
    if (credentials.ownerId && credentials.ownerId !== status.id) {
      authBlocked = true;
      throw new BridgeError('AUTH_REQUIRED', '本地登录身份与云端账号不一致,请重新登录');
    }
    await bindSessionOwner(credentials.token, status.id);
    const workspaceId = getWorkspace?.(status.id);
    if (!workspaceId) {
      workspaceBlocked = true;
      repository.activateAccount({
        ownerId: status.id,
        username: status.username,
        deviceName: os.hostname() || 'Musefold Desktop',
        platform: desktopPlatform(),
        clientVersion: app.getVersion(),
      });
      repository.setConsent(status.id, 'enabled');
      throw new BridgeError(
        'VALIDATION_FAILED',
        '当前账号工作区尚未建立,已保留同步设置;请先显式接管本地数据',
      );
    }
    workspaceBlocked = false;
    repository.activateAccount({
      ownerId: status.id,
      username: status.username,
      deviceName: os.hostname() || 'Musefold Desktop',
      platform: desktopPlatform(),
      clientVersion: app.getVersion(),
    });
    repository.setConsent(status.id, 'enabled');
    authBlocked = false;
    enabling = true;
    startSchedulers();
    let summary: DesktopSyncSummary;
    try {
      summary = await runSync();
    } finally {
      enabling = false;
    }
    return toContractStatus(summary);
  };

  return {
    'sync.getStatus': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => toContractStatus(getRuntime().repository.getSummary()),
    },
    'sync.setConsent': {
      input: setSyncConsentInputSchema,
      handle: async (input) => handleSetConsent((input as { consent: DesktopSyncConsent }).consent),
    },
    'sync.listConflicts': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        if (accountChangeInProgress || shuttingDown) {
          throw new BridgeError('CONFLICT', '账号正在切换,请稍后重试');
        }
        return toContractConflicts(getRuntime().repository);
      },
    },
    'sync.resolveConflict': {
      input: resolveSyncConflictInputSchema,
      handle: async (input) => {
        if (accountChangeInProgress || shuttingDown) {
          throw new BridgeError('CONFLICT', '账号正在切换,请稍后重试');
        }
        const { conflictId, resolution } = input as SyncConflictResolutionInput;
        const { repository } = getRuntime();
        const active = repository.getActiveAccount();
        if (!active) throw new BridgeError('AUTH_REQUIRED', '请先登录账号');
        const workspaceId = repository.getAccountWorkspace(active.ownerId);
        if (!workspaceId) throw new BridgeError('VALIDATION_FAILED', '当前账号工作区尚未建立');
        try {
          repository.resolveConflict(active.ownerId, workspaceId, conflictId, resolution);
        } catch (error) {
          if (error instanceof Error && error.message === 'Cloud sync conflict not found') {
            throw new BridgeError('NOT_FOUND', '同步冲突不存在或已处理');
          }
          if (error instanceof Error && error.message.includes('Only prompt conflicts')) {
            throw new BridgeError('VALIDATION_FAILED', '只有提示词冲突可以另存本地副本');
          }
          throw error;
        }
        if (active.consent === 'enabled') scheduleV25CloudSync();
        return toContractStatus(repository.getSummary());
      },
    },
    'sync.setEnabled': {
      input: setSyncEnabledSchema,
      handle: async (input) =>
        handleSetConsent((input as SetSyncEnabled).enabled ? 'enabled' : 'paused'),
    },
    'sync.syncNow': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        if (accountChangeInProgress || shuttingDown) {
          throw new BridgeError('CONFLICT', '账号正在切换,请稍后重试');
        }
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
  currentRunController = null;
  syncEpoch = 0;
  accountChangeInProgress = false;
  shuttingDown = false;
  enabling = false;
  authBlocked = false;
  workspaceBlocked = false;
}
