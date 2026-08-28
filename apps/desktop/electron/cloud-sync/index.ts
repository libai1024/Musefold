import os from 'node:os';
import { app, BrowserWindow, powerMonitor } from 'electron';
import { createMusefoldCloudClient, type MusefoldCloudClient } from '@musefold/cloud-client';
import type { McpConnectionPage, UpdateMcpConnection } from '@musefold/contracts';
import { DesktopSyncEngine, DesktopSyncRepository, type DesktopSyncConflict } from '@musefold/core';
import { getDb } from '@musefold/core/db';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from '@musefold/desktop-contracts/cloud-sync';
import { getAccountService } from '../account';
import { CloudSyncError } from './errors';

const SYNC_DEBOUNCE_MS = 2_000;
const SYNC_INTERVAL_MS = 60_000;

type AccountService = ReturnType<typeof getAccountService>;
type CloudIdentity = NonNullable<ReturnType<AccountService['cloudIdentity']>>;
type CloudClientFactory = typeof createMusefoldCloudClient;

export interface CloudSyncServiceOptions {
  repository?: DesktopSyncRepository;
  accountService?: () => AccountService;
  clientFactory?: CloudClientFactory;
  fetchImpl?: typeof fetch;
}

export class CloudSyncService {
  private readonly repository: DesktopSyncRepository;
  private readonly accountService: () => AccountService;
  private readonly clientFactory: CloudClientFactory;
  private readonly fetchImpl: typeof fetch;
  private client: MusefoldCloudClient | null = null;
  private engine: DesktopSyncEngine | null = null;
  private transportOwnerId: string | null = null;
  private transportAbort: AbortController | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private inflight: Promise<CloudSyncSummary> | null = null;
  private readonly inflightOperations = new Set<Promise<unknown>>();
  private syncing = false;
  private started = false;
  private schedulersStarted = false;
  private accountTransitioning = false;
  private forceDisabledOwnerId: string | null = null;
  private readonly handleResume = () => this.schedule(0);
  private readonly handleWindowFocus = () => this.schedule(0);

  constructor(options: CloudSyncServiceOptions = {}) {
    this.repository = options.repository ?? new DesktopSyncRepository(getDb());
    this.accountService = options.accountService ?? getAccountService;
    this.clientFactory = options.clientFactory ?? createMusefoldCloudClient;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.reconcileAccount().catch(() => undefined);
  }

  stop(): void {
    this.started = false;
    this.stopSchedulers();
    this.resetTransport();
  }

  async reconcileAccount(): Promise<CloudSyncSummary> {
    if (this.accountTransitioning) {
      this.stopSchedulers();
      const active = this.repository.getActiveAccount();
      if (active) this.repository.setEnabled(active.ownerId, false);
      this.repository.deactivateAccount();
      this.resetTransport();
      return this.broadcast();
    }
    const account = this.accountService();
    const identity = account.cloudIdentity();
    if (!identity) {
      this.stopSchedulers();
      this.forceDisabledOwnerId = null;
      this.repository.deactivateAccount();
      this.resetTransport();
      return this.broadcast();
    }
    const active = this.repository.activateAccount({
      ownerId: identity.ownerId,
      username: identity.username,
      deviceName: os.hostname() || 'Musefold Desktop',
      platform: desktopPlatform(),
      clientVersion: app.getVersion(),
    });
    if (this.forceDisabledOwnerId === active.ownerId && active.enabled) {
      this.repository.setEnabled(active.ownerId, false);
      this.forceDisabledOwnerId = null;
    }
    if (this.transportOwnerId && this.transportOwnerId !== active.ownerId) this.resetTransport();
    if (active.enabled) {
      this.startSchedulers();
      this.schedule(0);
    } else {
      this.stopSchedulers();
    }
    return this.broadcast();
  }

  /** Stop the old owner before login/register mutates account credentials. */
  async prepareForAccountLogin(): Promise<CloudSyncSummary> {
    this.accountTransitioning = true;
    await this.quiesceAndDisableActiveAccount();
    return this.broadcast();
  }

  /** Login activates the authenticated owner but never enables cloud sync. */
  async completeAccountLogin(): Promise<CloudSyncSummary> {
    try {
      const identity = this.accountService().cloudIdentity();
      if (!identity) {
        this.forceDisabledOwnerId = null;
        this.repository.deactivateAccount();
        this.stopSchedulers();
        this.resetTransport();
        const summary = this.broadcast();
        this.accountTransitioning = false;
        return summary;
      }
      this.repository.activateAccount(
        {
          ownerId: identity.ownerId,
          username: identity.username,
          deviceName: os.hostname() || 'Musefold Desktop',
          platform: desktopPlatform(),
          clientVersion: app.getVersion(),
        },
        true,
      );
      this.forceDisabledOwnerId = identity.ownerId;
      this.stopSchedulers();
      this.resetTransport();
      const summary = this.broadcast();
      this.accountTransitioning = false;
      return summary;
    } catch (error) {
      this.stopSchedulers();
      this.resetTransport();
      throw error;
    }
  }

  /** A failed account operation reconciles the actual session but stays disabled. */
  async cancelAccountTransition(): Promise<CloudSyncSummary> {
    await this.quiesceAndDisableActiveAccount();
    return this.completeAccountLogin();
  }

  /** Logout stops and aborts network work before credentials are removed. */
  async prepareForAccountLogout(): Promise<CloudSyncSummary> {
    this.accountTransitioning = true;
    await this.quiesceAndDisableActiveAccount();
    return this.broadcast();
  }

  /** Credentials are gone; leave every local owner inactive and disabled. */
  completeAccountLogout(): CloudSyncSummary {
    this.stopSchedulers();
    this.forceDisabledOwnerId = null;
    this.repository.deactivateAccount();
    this.resetTransport();
    const summary = this.broadcast();
    this.accountTransitioning = false;
    return summary;
  }

  status(): CloudSyncSummary {
    const account = this.accountService();
    const accountStatus = account.status();
    const identity = account.cloudIdentity();
    const local = this.repository.getSummary();
    const unavailableReason = identity
      ? null
      : accountStatus.loggedIn
        ? 'custom-server'
        : 'signed-out';
    return {
      available: Boolean(identity),
      unavailableReason,
      status: this.syncing ? 'syncing' : local.status,
      account: local.account
        ? {
            ownerId: local.account.ownerId,
            username: local.account.username,
            deviceName: local.account.deviceName,
            enabled: local.account.enabled,
            lastSyncAt: local.account.lastSyncAt,
            lastError: local.account.lastError,
          }
        : null,
      pendingMutations: local.pendingMutations,
      conflicts: local.conflicts,
    };
  }

  async setEnabled(enabled: boolean): Promise<CloudSyncSummary> {
    this.requireStableAccount();
    if (!enabled) {
      await this.quiesce();
      const active = this.repository.getActiveAccount();
      if (active) this.repository.setEnabled(active.ownerId, false);
      return this.broadcast();
    }

    const identity = await this.requireValidIdentity();
    await this.reconcileAccount();
    const active = this.repository.getActiveAccount();
    if (!active || active.ownerId !== identity.ownerId) {
      throw new CloudSyncError('AUTH_REQUIRED', '请重新登录后再开启云同步');
    }
    this.repository.setEnabled(identity.ownerId, true);
    this.forceDisabledOwnerId = null;
    this.startSchedulers();
    return this.syncNow();
  }

  async syncNow(): Promise<CloudSyncSummary> {
    this.requireStableAccount();
    this.inflight ??= this.runSync().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  schedule(delay = SYNC_DEBOUNCE_MS): void {
    if (!this.schedulersStarted || this.accountTransitioning) return;
    const identity = this.accountService().cloudIdentity();
    const active = this.repository.getActiveAccount();
    if (!identity || !active?.enabled || active.ownerId !== identity.ownerId || this.syncing)
      return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow().catch(() => undefined);
    }, delay);
  }

  listConflicts(): CloudSyncConflictSummary[] {
    const identity = this.requireIdentity();
    return this.repository.listConflicts(identity.ownerId).map(toConflictSummary);
  }

  async resolveConflict(
    conflictId: string,
    resolution: CloudSyncConflictResolution,
  ): Promise<CloudSyncSummary> {
    const identity = await this.requireValidIdentity();
    this.repository.resolveConflict(identity.ownerId, conflictId, resolution);
    this.broadcast();
    return this.syncNow();
  }

  captureImportedEntities(): number {
    const identity = this.accountService().cloudIdentity();
    const active = this.repository.getActiveAccount();
    if (!identity || !active || active.ownerId !== identity.ownerId) return 0;
    const captured = this.repository.seedUnsyncedEntities(active.ownerId);
    if (captured > 0) {
      this.broadcast();
      this.schedule();
    }
    return captured;
  }

  listConnections(): Promise<McpConnectionPage> {
    return this.trackOperation(this.withClient((client) => client.listConnections()));
  }

  updateConnection(id: string, input: UpdateMcpConnection): Promise<McpConnectionPage> {
    return this.trackOperation(this.withClient((client) => client.updateConnection(id, input)));
  }

  revokeConnection(id: string): Promise<void> {
    return this.trackOperation(this.withClient((client) => client.revokeConnection(id)));
  }

  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.inflightOperations.add(operation);
    return operation.finally(() => this.inflightOperations.delete(operation));
  }

  private async runSync(): Promise<CloudSyncSummary> {
    this.requireStableAccount();
    let identity: CloudIdentity;
    try {
      identity = await this.requireValidIdentity();
    } catch (error) {
      if (error instanceof CloudSyncError && error.code === 'AUTH_REQUIRED') this.failClosed();
      throw error;
    }
    const active = this.repository.getActiveAccount();
    if (!active?.enabled || active.ownerId !== identity.ownerId)
      throw new CloudSyncError('UNAVAILABLE', '请先开启提示词云同步');
    this.syncing = true;
    this.broadcast();
    try {
      try {
        const engine = await this.ensureEngine(identity);
        this.requireStableAccount();
        const current = this.repository.getActiveAccount();
        if (!current?.enabled || current.ownerId !== identity.ownerId)
          throw new CloudSyncError('UNAVAILABLE', '账号正在切换，请稍后重试');
        await engine.run();
      } catch (error) {
        if (!isExpiredSession(error)) throw error;
        this.resetTransport();
        const engine = await this.ensureEngine(identity);
        this.requireStableAccount();
        const current = this.repository.getActiveAccount();
        if (!current?.enabled || current.ownerId !== identity.ownerId)
          throw new CloudSyncError('UNAVAILABLE', '账号正在切换，请稍后重试');
        await engine.run();
      }
    } finally {
      this.syncing = false;
      this.broadcast();
    }
    return this.status();
  }

  private async ensureEngine(identity: CloudIdentity): Promise<DesktopSyncEngine> {
    if (this.engine && this.transportOwnerId === identity.ownerId) return this.engine;
    const client = await this.ensureClient(identity);
    this.engine = new DesktopSyncEngine(this.repository, client);
    return this.engine;
  }

  private async ensureClient(identity: CloudIdentity): Promise<MusefoldCloudClient> {
    this.requireStableAccount();
    if (this.client && this.transportOwnerId === identity.ownerId) return this.client;
    this.resetTransport();
    const controller = new AbortController();
    const client = this.clientFactory(identity.cloudBaseUrl, {
      fetchImpl: (input, init) => this.fetchImpl(input, { ...init, signal: controller.signal }),
    });
    this.transportAbort = controller;
    this.transportOwnerId = identity.ownerId;
    try {
      const accessToken = await this.accountService().managementAccessToken();
      this.requireStableAccount();
      const current = this.accountService().cloudIdentity();
      if (!current || current.ownerId !== identity.ownerId)
        throw new CloudSyncError('AUTH_REQUIRED', '请重新登录后再开启云同步');
      const session = await client.openDesktopSession(accessToken);
      if (
        controller.signal.aborted ||
        this.transportAbort !== controller ||
        this.accountTransitioning
      )
        throw new CloudSyncError('UNAVAILABLE', '账号正在切换，请稍后重试');
      if (session.account.id !== identity.ownerId)
        throw new CloudSyncError('AUTH_REQUIRED', '云端会话账号与桌面账号不一致，请重新登录');
      this.client = client;
      return client;
    } catch (error) {
      if (this.transportAbort === controller) this.resetTransport();
      throw error;
    }
  }

  private async withClient<T>(operation: (client: MusefoldCloudClient) => Promise<T>): Promise<T> {
    const identity = await this.requireValidIdentity();
    try {
      const client = await this.ensureClient(identity);
      this.requireStableAccount();
      const current = this.accountService().cloudIdentity();
      if (!current || current.ownerId !== identity.ownerId)
        throw new CloudSyncError('AUTH_REQUIRED', '请重新登录后再开启云同步');
      return await operation(client);
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.resetTransport();
      const client = await this.ensureClient(identity);
      this.requireStableAccount();
      const current = this.accountService().cloudIdentity();
      if (!current || current.ownerId !== identity.ownerId)
        throw new CloudSyncError('AUTH_REQUIRED', '请重新登录后再开启云同步');
      return operation(client);
    }
  }

  private requireIdentity(): CloudIdentity {
    this.requireStableAccount();
    const account = this.accountService();
    const identity = account.cloudIdentity();
    if (identity) return identity;
    if (!account.status().loggedIn)
      throw new CloudSyncError('AUTH_REQUIRED', '请先登录 Musefold 账号');
    throw new CloudSyncError('UNAVAILABLE', '自定义账号服务器暂不支持 Musefold Cloud 同步');
  }

  private async requireValidIdentity(): Promise<CloudIdentity> {
    const identity = this.requireIdentity();
    const account = this.accountService();
    if (account.status().health === 'token-invalid')
      throw new CloudSyncError('AUTH_REQUIRED', '登录状态已失效，请重新登录');
    try {
      await account.managementAccessToken();
      const confirmed = account.cloudIdentity();
      this.requireStableAccount();
      if (!confirmed || confirmed.ownerId !== identity.ownerId)
        throw new CloudSyncError('AUTH_REQUIRED', '请重新登录后再开启云同步');
      return confirmed;
    } catch (error) {
      if (isAccountAuthError(error))
        throw new CloudSyncError('AUTH_REQUIRED', '登录状态已失效，请重新登录');
      throw error;
    }
  }

  private requireStableAccount(): void {
    if (this.accountTransitioning)
      throw new CloudSyncError('UNAVAILABLE', '账号正在切换，请稍后重试');
  }

  private startSchedulers(): void {
    if (!this.started || this.schedulersStarted) return;
    this.schedulersStarted = true;
    this.intervalTimer = setInterval(() => {
      if (BrowserWindow.getAllWindows().some((window) => window.isVisible())) this.schedule(0);
    }, SYNC_INTERVAL_MS);
    powerMonitor.on('resume', this.handleResume);
    app.on('browser-window-focus', this.handleWindowFocus);
  }

  private stopSchedulers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.debounceTimer = null;
    this.intervalTimer = null;
    if (this.schedulersStarted) {
      powerMonitor.removeListener('resume', this.handleResume);
      app.removeListener('browser-window-focus', this.handleWindowFocus);
    }
    this.schedulersStarted = false;
  }

  private async quiesce(): Promise<void> {
    this.stopSchedulers();
    const inflight = this.inflight;
    this.resetTransport();
    await Promise.allSettled([...(inflight ? [inflight] : []), ...this.inflightOperations]);
  }

  private async quiesceAndDisableActiveAccount(): Promise<void> {
    const active = this.repository.getActiveAccount();
    await this.quiesce();
    if (active) {
      this.repository.setEnabled(active.ownerId, false);
      this.repository.deactivateAccount(active.ownerId);
    }
  }

  private failClosed(): void {
    this.stopSchedulers();
    const active = this.repository.getActiveAccount();
    if (active) this.repository.setEnabled(active.ownerId, false);
    this.resetTransport();
    this.broadcast();
  }

  private resetTransport(): void {
    this.transportAbort?.abort();
    this.transportAbort = null;
    this.client = null;
    this.engine = null;
    this.transportOwnerId = null;
  }

  private broadcast(): CloudSyncSummary {
    const summary = this.status();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.CLOUD_SYNC_CHANGED, summary);
    }
    return summary;
  }
}

function desktopPlatform(): 'macos' | 'windows' | 'linux' {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

function toConflictSummary(conflict: DesktopSyncConflict): CloudSyncConflictSummary {
  return {
    id: conflict.id,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    localSnapshot: conflict.localSnapshot,
    remoteSnapshot: conflict.remoteSnapshot as unknown as Record<string, unknown>,
    detectedAt: conflict.detectedAt,
    canDuplicate: conflict.entityType === 'prompt',
  };
}

function isExpiredSession(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (('code' in error && error.code === 'AUTH_SESSION_EXPIRED') ||
        ('status' in error && error.status === 401)),
  );
}

function isAccountAuthError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'ACCOUNT/AUTH',
  );
}

let singleton: CloudSyncService | null = null;

export function getCloudSyncService(): CloudSyncService {
  singleton ??= new CloudSyncService();
  return singleton;
}

export function startCloudSyncService(): void {
  getCloudSyncService().start();
}

export function stopCloudSyncService(): void {
  singleton?.stop();
  singleton = null;
}

export function reconcileCloudSyncAccount(): void {
  if (!singleton) return;
  void singleton.reconcileAccount().catch(() => undefined);
}

export function scheduleCloudSync(): void {
  singleton?.schedule();
}

export function captureImportedCloudEntities(): number {
  return singleton?.captureImportedEntities() ?? 0;
}
