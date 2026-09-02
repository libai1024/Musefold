import type {
  SyncBootstrapPage,
  SyncBootstrapQuery,
  SyncDevice,
  SyncDeviceRegistration,
  SyncEntityType,
  SyncPullQuery,
  SyncPullResult,
  SyncPushRequest,
  SyncPushResult,
  SyncUsagePushRequest,
  SyncUsagePushResult,
} from '@musefold/contracts';
import type { DesktopSyncAccount, DesktopSyncRepository, DesktopSyncSummary } from './repository';

export interface DesktopSyncTransport {
  registerDevice(input: SyncDeviceRegistration): Promise<SyncDevice>;
  bootstrap(input: SyncBootstrapQuery): Promise<SyncBootstrapPage>;
  pull(input: SyncPullQuery): Promise<SyncPullResult>;
  push(input: SyncPushRequest): Promise<SyncPushResult>;
  pushUsage(input: SyncUsagePushRequest): Promise<SyncUsagePushResult>;
}

export interface DesktopSyncEngineOptions {
  pullLimit?: number;
  bootstrapLimit?: number;
  maxPushBatches?: number;
}

const BOOTSTRAP_ORDER: SyncEntityType[] = ['folder', 'tag', 'prompt'];

export class DesktopSyncEngine {
  private inflight: Promise<DesktopSyncSummary> | null = null;
  private currentRunCancelled = false;

  constructor(
    private readonly repository: DesktopSyncRepository,
    private readonly transport?: DesktopSyncTransport,
    private readonly options: DesktopSyncEngineOptions = {},
  ) {}

  isRunning(): boolean {
    return this.inflight !== null;
  }

  run(transport: DesktopSyncTransport | undefined = this.transport): Promise<DesktopSyncSummary> {
    if (this.inflight) return this.inflight;
    if (!transport) throw new Error('Cloud sync transport is required');
    this.currentRunCancelled = false;
    this.inflight = this.runOnce(transport).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  cancelCurrent(): void {
    if (this.inflight) this.currentRunCancelled = true;
  }

  async awaitIdle(): Promise<void> {
    try {
      await this.inflight;
    } catch {
      // Quiescing waits for settlement; the run caller owns error reporting.
    }
  }

  private async runOnce(transport: DesktopSyncTransport): Promise<DesktopSyncSummary> {
    const account = this.repository.getActiveAccount();
    if (account?.consent !== 'enabled') return this.repository.getSummary();
    const workspaceId = this.repository.getAccountWorkspace(account.ownerId);
    if (!workspaceId) return this.repository.getSummary();
    const identity = { ownerId: account.ownerId, deviceId: account.deviceId };
    const needsBootstrap = account.bootstrapCompletedAt === null;
    try {
      await transport.registerDevice({
        deviceId: account.deviceId,
        name: account.deviceName,
        platform: account.platform,
        clientVersion: account.clientVersion,
      });
      this.requireIdentity(identity);
      let cursor = account.cursor;
      if (needsBootstrap) {
        const snapshotCursor = await this.bootstrap(
          account.ownerId,
          workspaceId,
          identity,
          transport,
        );
        this.requireIdentity(identity);
        this.repository.markBootstrapCompleted(account.ownerId, snapshotCursor);
        cursor = snapshotCursor;
      }
      await this.pullAll(
        account.ownerId,
        workspaceId,
        account.deviceId,
        cursor,
        true,
        identity,
        transport,
      );
      if (needsBootstrap) {
        this.requireIdentity(identity);
        this.repository.seedUnsyncedEntities(account.ownerId, workspaceId);
      }
      await this.pushAll(account.ownerId, workspaceId, account.deviceId, identity, transport);
      await this.pushUsageAll(account.ownerId, workspaceId, account.deviceId, identity, transport);
      const current = this.requireIdentity(identity);
      await this.pullAll(
        account.ownerId,
        workspaceId,
        account.deviceId,
        current.cursor,
        false,
        identity,
        transport,
      );
      this.requireIdentity(identity);
      this.repository.markSyncCompleted(account.ownerId);
      return this.repository.getSummary();
    } catch (error) {
      if (this.currentRunCancelled || error instanceof SyncIdentityChangedError) {
        return this.repository.getSummary();
      }
      try {
        this.requireIdentity(identity);
      } catch {
        return this.repository.getSummary();
      }
      if (isCursorExpired(error)) {
        this.repository.resetBootstrap(account.ownerId);
      }
      this.repository.setSyncError(account.ownerId, safeErrorMessage(error));
      throw error;
    }
  }

  private requireIdentity(identity: { ownerId: string; deviceId: string }): DesktopSyncAccount {
    if (this.currentRunCancelled) throw new SyncIdentityChangedError();
    const active = this.repository.getActiveAccount();
    if (
      active?.consent !== 'enabled' ||
      active.ownerId !== identity.ownerId ||
      active.deviceId !== identity.deviceId
    ) {
      throw new SyncIdentityChangedError();
    }
    return active;
  }

  private async bootstrap(
    ownerId: string,
    workspaceId: string,
    identity: { ownerId: string; deviceId: string },
    transport: DesktopSyncTransport,
  ): Promise<string> {
    let firstSnapshotCursor: string | null = null;
    for (const entity of BOOTSTRAP_ORDER) {
      let after: string | undefined;
      do {
        const page = await transport.bootstrap({
          entity,
          after,
          limit: this.options.bootstrapLimit ?? 200,
        });
        this.requireIdentity(identity);
        firstSnapshotCursor ??= page.snapshotCursor;
        this.repository.applyBootstrapPage(ownerId, workspaceId, entity, page.items);
        after = page.nextPage ?? undefined;
      } while (after);
    }
    return firstSnapshotCursor ?? '0';
  }

  private async pullAll(
    ownerId: string,
    workspaceId: string,
    deviceId: string,
    initialCursor: string,
    stopOnConflict: boolean,
    identity: { ownerId: string; deviceId: string },
    transport: DesktopSyncTransport,
  ): Promise<void> {
    let cursor = initialCursor;
    let hasMore = true;
    while (hasMore) {
      const page = await transport.pull({
        cursor,
        limit: this.options.pullLimit ?? 200,
        deviceId,
      });
      this.requireIdentity(identity);
      this.repository.applyPullPage(ownerId, workspaceId, page.changes, page.nextCursor);
      cursor = page.nextCursor;
      hasMore = page.hasMore;
      if (stopOnConflict && this.repository.getSummary().conflicts > 0) break;
    }
  }

  private async pushAll(
    ownerId: string,
    workspaceId: string,
    deviceId: string,
    identity: { ownerId: string; deviceId: string },
    transport: DesktopSyncTransport,
  ): Promise<void> {
    const maxBatches = this.options.maxPushBatches ?? 100;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      this.requireIdentity(identity);
      const mutations = this.repository.listReadyMutations(ownerId, workspaceId, 100);
      if (mutations.length === 0) return;
      try {
        const response = await transport.push({ deviceId, mutations });
        this.requireIdentity(identity);
        this.repository.applyPushBatch(ownerId, workspaceId, mutations, response.results);
      } catch (error) {
        if (this.currentRunCancelled || error instanceof SyncIdentityChangedError) throw error;
        const message = safeErrorMessage(error);
        for (const mutation of mutations)
          this.repository.markMutationAttempt(ownerId, workspaceId, mutation.mutationId, message);
        throw error;
      }
    }
    throw new Error('Cloud sync exceeded the per-run push batch limit');
  }

  private async pushUsageAll(
    ownerId: string,
    workspaceId: string,
    deviceId: string,
    identity: { ownerId: string; deviceId: string },
    transport: DesktopSyncTransport,
  ): Promise<void> {
    const maxBatches = this.options.maxPushBatches ?? 100;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      this.requireIdentity(identity);
      const events = this.repository.listReadyUsageEvents(ownerId, workspaceId, 100);
      if (events.length === 0) return;
      try {
        const response = await transport.pushUsage({ deviceId, events });
        this.requireIdentity(identity);
        this.repository.applyUsagePushBatch(ownerId, workspaceId, events, response.results);
      } catch (error) {
        if (this.currentRunCancelled || error instanceof SyncIdentityChangedError) throw error;
        const message = safeErrorMessage(error);
        for (const event of events)
          this.repository.markUsageEventAttempt(ownerId, workspaceId, event.eventId, message);
        throw error;
      }
    }
    throw new Error('Cloud sync exceeded the per-run usage push batch limit');
  }
}

class SyncIdentityChangedError extends Error {
  constructor() {
    super('Cloud sync identity changed');
    this.name = 'SyncIdentityChangedError';
  }
}

function isCursorExpired(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'SYNC_CURSOR_EXPIRED',
  );
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return '云同步暂时不可用';
}
