// v2.5 桌面云同步域桥:core DesktopSyncEngine + 新 API /api/v1/sync/*。
// 登录 ≠ 同步:开关由用户在设置里显式打开(setEnabled),打开即全量跑一轮;
// 之后写路径 scheduleV25CloudSync() 防抖触发 + 60s 兜底轮。
// 旧 CloudSyncService(electron/cloud-sync,绑旧登录体系)不再被 v25 界面触达,M5c 删。

import os from 'node:os';
import { createHash } from 'node:crypto';
import type {
  AccountSummary,
  DesktopSyncConsent,
  DesktopSyncPhase,
  DesktopSyncStatus,
  SetSyncEnabled,
  SetSyncConsentInput,
  SyncConflictResolutionInput,
  SyncConflictSummary,
  PrepareLocalWorkspaceInput,
  PreviewLocalWorkspaceInput,
} from '@musefold/contracts';
import {
  desktopSyncStatusSchema,
  localWorkspacePreviewSchema,
  localWorkspaceRecoveryStatusSchema,
  prepareLocalWorkspaceInputSchema,
  previewLocalWorkspaceInputSchema,
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
  PermanentTaxonomyConflictError,
  type DesktopSyncSummary,
  type DesktopSyncTransport,
} from '@musefold/core';
import { getDb } from '@musefold/core/db';
import { resolveAccountWorkspace } from '@musefold/core/db/workspaces';
import {
  listLocalWorkspaceRecovery,
  previewLocalWorkspace,
  prepareLocalWorkspace,
  WorkspaceRecoveryError,
} from '@musefold/core/db/workspace-recovery';
import type Database from 'better-sqlite3';
import { app } from 'electron';
import { z } from 'zod';
import { createLogger } from '../../system/logger';
import {
  type SessionCredentials,
  accountWorkspaceOwner,
  apiBase,
  fetchAccountStatus,
  onAccountChangeCancelled,
  onAccountChanged,
  onBeforeAccountChange,
  readSessionCredentials,
} from './account-domain';
import { withAccountTransition } from './account-session-store';
import { BridgeError, type MethodDef } from './envelope';

const logger = createLogger('ipc-v25:sync');

const SYNC_DEBOUNCE_MS = 2_000;
const SYNC_INTERVAL_MS = 60_000;
const WORKSPACE_BLOCKED_ERROR = '当前账号工作区尚未建立,请先显式接管本地数据';

// ---------- transport:bearer token → /api/v1/sync/* ----------

async function syncFetch(
  session: SessionCredentials,
  signal: AbortSignal,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
) {
  const assertSession = async () => {
    const current = await readSessionCredentials();
    if (
      signal.aborted ||
      !current ||
      current.restricted ||
      current.authEpoch !== session.authEpoch ||
      current.ownerId !== session.ownerId ||
      current.principalId !== session.principalId ||
      current.apiIssuer !== session.apiIssuer ||
      current.token !== session.token ||
      apiBase() !== session.apiIssuer
    ) {
      throw new BridgeError('AUTH_REQUIRED', '账号状态已变化,云同步已暂停');
    }
  };
  await assertSession();
  let response: Response;
  try {
    response = await fetch(`${session.apiIssuer}/api/v1${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${session.token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal,
      redirect: 'error',
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
  const result = await response.json();
  await assertSession();
  return result;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const raw = search.toString();
  return raw ? `?${raw}` : '';
}

function createCloudTransport(
  _token: string,
  signal: AbortSignal,
  session: SessionCredentials,
): DesktopSyncTransport {
  return {
    async registerDevice(input) {
      return syncDeviceSchema.parse(
        await syncFetch(session, signal, '/sync/devices', { method: 'POST', body: input }),
      );
    },
    async bootstrap(input) {
      const query = toQuery({ entity: input.entity, after: input.after, limit: input.limit });
      return syncBootstrapPageSchema.parse(
        await syncFetch(session, signal, `/sync/bootstrap${query}`, { method: 'GET' }),
      );
    },
    async pull(input) {
      const query = toQuery({ cursor: input.cursor, limit: input.limit, deviceId: input.deviceId });
      return syncPullResultSchema.parse(
        await syncFetch(session, signal, `/sync/pull${query}`, { method: 'GET' }),
      );
    },
    async push(input) {
      return syncPushResultSchema.parse(
        await syncFetch(session, signal, '/sync/push', { method: 'POST', body: input }),
      );
    },
    async pushUsage(input) {
      return syncUsagePushResultSchema.parse(
        await syncFetch(session, signal, '/sync/usage', { method: 'POST', body: input }),
      );
    },
  };
}

// ---------- 单例引擎 + 调度 ----------

interface SyncRuntime {
  database?: Database.Database;
  repository: DesktopSyncRepository;
  engine: DesktopSyncEngine;
  transportFactory?: (
    token: string,
    signal: AbortSignal,
    session: SessionCredentials,
  ) => DesktopSyncTransport;
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
      database: getDb(),
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
  if (!credentials || credentials.restricted || !active || credentials.ownerId !== active.ownerId) {
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
  const transport = getRuntime().transportFactory?.(
    credentials.token,
    controller.signal,
    credentials,
  );
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
  if (authBlocked) return 'auth_blocked';
  if (!account) return 'signed_out';
  if (account.consent === 'unset') return 'awaiting_consent';
  if (account.consent === 'paused') return 'paused';
  if (workspaceBlocked) return 'error';
  if (enabling) return 'enabling';
  if (getRuntime().engine.isRunning()) return 'syncing';
  if (summary.conflicts > 0) return 'conflict';
  if (account.lastError) return 'error';
  return 'idle';
}

function reviewReference(session: SessionCredentials | null | undefined): string | null {
  if (!session || session.restricted || !session.ownerId || session.apiIssuer !== apiBase())
    return null;
  return createHash('sha256')
    .update(
      JSON.stringify([
        'sync-account-review-v1',
        session.authEpoch,
        session.apiIssuer,
        session.principalId,
        session.ownerId,
      ]),
    )
    .digest('hex');
}

function toContractStatus(
  summary: DesktopSyncSummary,
  session?: SessionCredentials | null,
): DesktopSyncStatus {
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
    reviewRef: session?.ownerId === account?.ownerId ? reviewReference(session) : null,
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
    error: authBlocked
      ? '请先完成账号验证或恢复,云同步已暂停'
      : workspaceBlocked
        ? WORKSPACE_BLOCKED_ERROR
        : (account?.lastError ?? null),
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
      if (status && !status.recovery && (!status.identity || status.identity.status === 'active')) {
        // Login only selects the owner. It must not adopt legacy rows or create
        // a cloud container; explicit adoption/establishment owns that action.
        const ownerId = accountWorkspaceOwner(status);
        const workspaceId = getWorkspace?.(ownerId);
        workspaceBlocked = !workspaceId;
        repository.activateAccount({
          ownerId,
          username: status.username,
          deviceName: os.hostname() || 'Musefold Desktop',
          platform: desktopPlatform(),
          clientVersion: app.getVersion(),
        });
      } else {
        authBlocked = !!status;
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

  const activate = (status: AccountSummary, ownerId: string) =>
    getRuntime().repository.activateAccount({
      ownerId,
      username: status.username,
      deviceName: os.hostname() || 'Musefold Desktop',
      platform: desktopPlatform(),
      clientVersion: app.getVersion(),
    });

  const assertCurrent = async (captured: SessionCredentials) => {
    const current = await readSessionCredentials();
    if (
      accountChangeInProgress ||
      shuttingDown ||
      !current ||
      current.authEpoch !== captured.authEpoch ||
      current.token !== captured.token ||
      current.apiIssuer !== captured.apiIssuer ||
      apiBase() !== captured.apiIssuer ||
      current.ownerId !== captured.ownerId ||
      current.principalId !== captured.principalId ||
      current.restricted !== captured.restricted
    ) {
      throw new BridgeError('CONFLICT', '账号状态已变化,请刷新后重试');
    }
    return current;
  };
  const verifyIdentity = (
    credentials: SessionCredentials,
    status: AccountSummary,
    requirePrincipal = false,
  ) => {
    if (
      credentials.restricted ||
      status.recovery ||
      (status.identity && status.identity.status !== 'active') ||
      (requirePrincipal && (!status.identity || !credentials.principalId))
    ) {
      throw new BridgeError(
        'ACCOUNT_IDENTITY_UNVERIFIED',
        '请先完成账号验证或恢复,再建立提示词库与开启同步',
      );
    }
    const ownerId = accountWorkspaceOwner(status);
    if (
      credentials.ownerId !== ownerId ||
      (status.identity &&
        (status.identity.apiIssuer !== credentials.apiIssuer ||
          status.identity.principalId !== credentials.principalId))
    ) {
      throw new BridgeError('AUTH_REQUIRED', '本地登录身份与云端账号不一致,请重新登录');
    }
    return ownerId;
  };
  const requireCredentials = async () => {
    if (accountChangeInProgress || shuttingDown)
      throw new BridgeError('CONFLICT', '账号正在切换,请稍后重试');
    const credentials = await readSessionCredentials();
    if (!credentials) throw new BridgeError('AUTH_REQUIRED', '请先登录账号');
    return credentials;
  };
  const readStatus = () =>
    withAccountTransition(async () => {
      const credentials = await readSessionCredentials();
      if (credentials?.restricted) authBlocked = true;
      return toContractStatus(getRuntime().repository.getSummary(), credentials);
    });
  const assertReview = (credentials: SessionCredentials, expected: string | null | undefined) => {
    if (!expected || expected !== reviewReference(credentials)) {
      throw new BridgeError('CONFLICT', '确认的账号已变化,请刷新账号状态并重新确认');
    }
  };
  const handleSetConsent = async (
    consent: DesktopSyncConsent,
    reviewRef?: string | null,
  ): Promise<DesktopSyncStatus> => {
    if (consent === 'unset')
      throw new BridgeError('VALIDATION_FAILED', '已建立的同步同意只能暂停,不能重置');
    const credentials = await requireCredentials();
    const { repository, getWorkspace } = getRuntime();
    if (consent === 'paused') {
      let stopping: Promise<void> | undefined;
      await withAccountTransition(async () => {
        await assertCurrent(credentials);
        if (reviewRef !== undefined && reviewRef !== null) assertReview(credentials, reviewRef);
        const active = repository.getActiveAccount();
        if (!active || credentials.restricted || active.ownerId !== credentials.ownerId)
          throw new BridgeError('AUTH_REQUIRED', '请先登录当前账号');
        repository.setConsent(active.ownerId, 'paused');
        stopping = suspendTransport();
      });
      await stopping;
      return readStatus();
    }
    // Network verification is outside the credential commit lock. A delayed A
    // response cannot activate A or change consent after a B session commits.
    const status = await fetchAccountStatus(credentials.token);
    await withAccountTransition(async () => {
      await assertCurrent(credentials);
      const ownerId = verifyIdentity(credentials, status);
      assertReview(credentials, reviewRef);
      if (!getWorkspace?.(ownerId)) {
        throw new BridgeError(
          'VALIDATION_FAILED',
          '请先查看本机数据,选择复制提示词库或建立空库,再开启云同步',
        );
      }
      activate(status, ownerId);
      repository.setConsent(ownerId, 'enabled');
      workspaceBlocked = false;
      authBlocked = false;
      enabling = true;
      startSchedulers();
    });
    try {
      await runSync();
    } finally {
      enabling = false;
    }
    return readStatus();
  };

  const workspaceDatabase = () => getRuntime().database ?? getDb();
  const recoveryOperation = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof WorkspaceRecoveryError) throw new BridgeError(error.code, error.message);
      throw error;
    }
  };

  return {
    'sync.listLocalWorkspaces': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () =>
        withAccountTransition(async () => {
          const credentials = await readSessionCredentials();
          const active = getRuntime().repository.getActiveAccount();
          const reviewRef =
            credentials?.ownerId === active?.ownerId ? reviewReference(credentials) : null;
          const verified =
            !!reviewRef &&
            !!credentials?.principalId &&
            !credentials.restricted &&
            !accountChangeInProgress &&
            !shuttingDown;
          return localWorkspaceRecoveryStatusSchema.parse({
            ...listLocalWorkspaceRecovery(
              workspaceDatabase(),
              credentials?.ownerId ?? null,
              verified,
            ),
            reviewRef,
            targetAccount: reviewRef && active ? { username: active.username } : null,
          });
        }),
    },
    'sync.previewLocalWorkspace': {
      input: previewLocalWorkspaceInputSchema,
      handle: async (input) =>
        recoveryOperation(() =>
          localWorkspacePreviewSchema.parse(
            previewLocalWorkspace(workspaceDatabase(), input as PreviewLocalWorkspaceInput),
          ),
        ),
    },
    'sync.prepareLocalWorkspace': {
      input: prepareLocalWorkspaceInputSchema,
      handle: async (input) => {
        const credentials = await requireCredentials();
        const status = await fetchAccountStatus(credentials.token);
        return withAccountTransition(async () => {
          await assertCurrent(credentials);
          const ownerId = verifyIdentity(credentials, status, true);
          assertReview(credentials, (input as PrepareLocalWorkspaceInput).reviewRef);
          const db = workspaceDatabase();
          recoveryOperation(() =>
            db.transaction(() => {
              prepareLocalWorkspace(db, ownerId, input as PrepareLocalWorkspaceInput);
              activate(status, ownerId);
              // Historical consent belongs to the old scope. A newly prepared
              // target always needs a fresh explicit decision before upload.
              db.prepare(
                "UPDATE cloud_sync_accounts SET enabled = 0, consent_state = 'unset' WHERE owner_id = ?",
              ).run(ownerId);
            })(),
          );
          workspaceBlocked = false;
          authBlocked = false;
          return toContractStatus(getRuntime().repository.getSummary(), credentials);
        });
      },
    },
    'sync.getStatus': { input: z.undefined().or(z.object({}).strict()), handle: readStatus },
    'sync.setConsent': {
      input: setSyncConsentInputSchema,
      handle: async (input) => {
        const request = input as SetSyncConsentInput;
        return handleSetConsent(request.consent, request.reviewRef);
      },
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
          if (error instanceof PermanentTaxonomyConflictError) {
            throw new BridgeError('VALIDATION_FAILED', error.message);
          }
          if (error instanceof Error && error.message === 'Cloud sync conflict not found') {
            throw new BridgeError('NOT_FOUND', '同步冲突不存在或已处理');
          }
          if (error instanceof Error && error.message.includes('Only prompt conflicts')) {
            throw new BridgeError('VALIDATION_FAILED', '只有提示词冲突可以另存本地副本');
          }
          throw error;
        }
        if (active.consent === 'enabled') scheduleV25CloudSync();
        return readStatus();
      },
    },
    'sync.setEnabled': {
      input: setSyncEnabledSchema,
      handle: async (input) =>
        handleSetConsent(
          (input as SetSyncEnabled).enabled ? 'enabled' : 'paused',
          (input as SetSyncEnabled).reviewRef,
        ),
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
        await runSync();
        return readStatus();
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
