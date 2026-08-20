import os from "node:os";
import { app, BrowserWindow, powerMonitor } from "electron";
import {
  createMusefoldCloudClient,
  type MusefoldCloudClient,
} from "@musefold/cloud-client";
import type {
  McpConnectionPage,
  UpdateMcpConnection,
} from "@musefold/contracts";
import {
  DesktopSyncEngine,
  DesktopSyncRepository,
  type DesktopSyncConflict,
} from "@musefold/core";
import { getDb } from "@musefold/core/db";
import { IPC } from "@musefold/desktop-contracts/ipc";
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from "@musefold/desktop-contracts/cloud-sync";
import { getAccountService } from "../account";

const SYNC_DEBOUNCE_MS = 2_000;
const SYNC_INTERVAL_MS = 60_000;

type CloudIdentity = NonNullable<
  ReturnType<ReturnType<typeof getAccountService>["cloudIdentity"]>
>;

export class CloudSyncService {
  private readonly repository = new DesktopSyncRepository(getDb());
  private client: MusefoldCloudClient | null = null;
  private engine: DesktopSyncEngine | null = null;
  private transportOwnerId: string | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private inflight: Promise<CloudSyncSummary> | null = null;
  private syncing = false;
  private started = false;
  private readonly handleResume = () => this.schedule(0);
  private readonly handleWindowFocus = () => this.schedule(0);

  start(): void {
    if (this.started) return;
    this.started = true;
    this.intervalTimer = setInterval(() => {
      if (BrowserWindow.getAllWindows().some((window) => window.isVisible()))
        this.schedule(0);
    }, SYNC_INTERVAL_MS);
    powerMonitor.on("resume", this.handleResume);
    app.on("browser-window-focus", this.handleWindowFocus);
    void this.reconcileAccount();
  }

  stop(): void {
    this.started = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.debounceTimer = null;
    this.intervalTimer = null;
    powerMonitor.removeListener("resume", this.handleResume);
    app.removeListener("browser-window-focus", this.handleWindowFocus);
    this.resetTransport();
  }

  async reconcileAccount(): Promise<CloudSyncSummary> {
    const account = getAccountService();
    const identity = account.cloudIdentity();
    if (!identity) {
      this.repository.deactivateAccount();
      this.resetTransport();
      return this.broadcast();
    }
    const active = this.repository.activateAccount({
      ownerId: identity.ownerId,
      username: identity.username,
      deviceName: os.hostname() || "Musefold Desktop",
      platform: desktopPlatform(),
      clientVersion: app.getVersion(),
    });
    if (this.transportOwnerId && this.transportOwnerId !== active.ownerId)
      this.resetTransport();
    const summary = this.broadcast();
    if (active.enabled) this.schedule(0);
    return summary;
  }

  status(): CloudSyncSummary {
    const accountStatus = getAccountService().status();
    const identity = getAccountService().cloudIdentity();
    const local = this.repository.getSummary();
    const unavailableReason = identity
      ? null
      : accountStatus.loggedIn
        ? "custom-server"
        : "signed-out";
    return {
      available: Boolean(identity),
      unavailableReason,
      status: this.syncing ? "syncing" : local.status,
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
    await this.reconcileAccount();
    const identity = this.requireIdentity();
    this.repository.setEnabled(identity.ownerId, enabled);
    if (!enabled) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      return this.broadcast();
    }
    return this.syncNow();
  }

  syncNow(): Promise<CloudSyncSummary> {
    this.inflight ??= this.runSync().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  schedule(delay = SYNC_DEBOUNCE_MS): void {
    const active = this.repository.getActiveAccount();
    if (!active?.enabled || this.syncing) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow().catch(() => undefined);
    }, delay);
  }

  listConflicts(): CloudSyncConflictSummary[] {
    const identity = this.requireIdentity();
    return this.repository
      .listConflicts(identity.ownerId)
      .map(toConflictSummary);
  }

  async resolveConflict(
    conflictId: string,
    resolution: CloudSyncConflictResolution,
  ): Promise<CloudSyncSummary> {
    const identity = this.requireIdentity();
    this.repository.resolveConflict(identity.ownerId, conflictId, resolution);
    this.broadcast();
    return this.syncNow();
  }

  captureImportedEntities(): number {
    const active = this.repository.getActiveAccount();
    if (!active) return 0;
    const captured = this.repository.seedUnsyncedEntities(active.ownerId);
    if (captured > 0) {
      this.broadcast();
      this.schedule();
    }
    return captured;
  }

  listConnections(): Promise<McpConnectionPage> {
    return this.withClient((client) => client.listConnections());
  }

  updateConnection(
    id: string,
    input: UpdateMcpConnection,
  ): Promise<McpConnectionPage> {
    return this.withClient((client) => client.updateConnection(id, input));
  }

  async revokeConnection(id: string): Promise<void> {
    await this.withClient((client) => client.revokeConnection(id));
  }

  private async runSync(): Promise<CloudSyncSummary> {
    const identity = this.requireIdentity();
    const active = this.repository.getActiveAccount();
    if (!active?.enabled) throw new Error("请先开启提示词云同步");
    this.syncing = true;
    this.broadcast();
    try {
      try {
        const engine = await this.ensureEngine(identity);
        await engine.run();
      } catch (error) {
        if (!isExpiredSession(error)) throw error;
        this.resetTransport();
        const engine = await this.ensureEngine(identity);
        await engine.run();
      }
    } finally {
      this.syncing = false;
      this.broadcast();
    }
    return this.status();
  }

  private async ensureEngine(
    identity: CloudIdentity,
  ): Promise<DesktopSyncEngine> {
    if (this.engine && this.transportOwnerId === identity.ownerId)
      return this.engine;
    const client = await this.ensureClient(identity);
    this.engine = new DesktopSyncEngine(this.repository, client);
    return this.engine;
  }

  private async ensureClient(identity: CloudIdentity): Promise<MusefoldCloudClient> {
    if (this.client && this.transportOwnerId === identity.ownerId)
      return this.client;
    const accessToken = await getAccountService().managementAccessToken();
    const client = createMusefoldCloudClient(identity.cloudBaseUrl);
    const session = await client.openDesktopSession(accessToken);
    if (session.account.id !== identity.ownerId)
      throw new Error("云端会话账号与桌面账号不一致");
    this.client = client;
    this.transportOwnerId = identity.ownerId;
    return client;
  }

  private async withClient<T>(
    operation: (client: MusefoldCloudClient) => Promise<T>,
  ): Promise<T> {
    const identity = this.requireIdentity();
    try {
      return await operation(await this.ensureClient(identity));
    } catch (error) {
      if (!isExpiredSession(error)) throw error;
      this.resetTransport();
      return operation(await this.ensureClient(identity));
    }
  }

  private requireIdentity(): CloudIdentity {
    const identity = getAccountService().cloudIdentity();
    if (!identity) {
      const message = getAccountService().status().loggedIn
        ? "自定义账号服务器暂不支持 Musefold Cloud 同步"
        : "请先登录 Musefold 账号";
      throw new Error(message);
    }
    return identity;
  }

  private resetTransport(): void {
    this.client = null;
    this.engine = null;
    this.transportOwnerId = null;
  }

  private broadcast(): CloudSyncSummary {
    const summary = this.status();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send(IPC.CLOUD_SYNC_CHANGED, summary);
    }
    return summary;
  }
}

function desktopPlatform(): "macos" | "windows" | "linux" {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function toConflictSummary(
  conflict: DesktopSyncConflict,
): CloudSyncConflictSummary {
  return {
    id: conflict.id,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    localSnapshot: conflict.localSnapshot,
    remoteSnapshot: conflict.remoteSnapshot as unknown as Record<
      string,
      unknown
    >,
    detectedAt: conflict.detectedAt,
    canDuplicate: conflict.entityType === "prompt",
  };
}

function isExpiredSession(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (("code" in error && error.code === "AUTH_SESSION_EXPIRED") ||
      ("status" in error && error.status === 401)),
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

export function scheduleCloudSync(): void {
  singleton?.schedule();
}

export function captureImportedCloudEntities(): number {
  return singleton?.captureImportedEntities() ?? 0;
}

export function reconcileCloudSyncAccount(): void {
  if (!singleton) return;
  void singleton.reconcileAccount().catch(() => undefined);
}
