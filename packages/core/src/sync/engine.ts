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
import type { DesktopSyncRepository, DesktopSyncSummary } from './repository';

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

  constructor(
    private readonly repository: DesktopSyncRepository,
    private readonly transport: DesktopSyncTransport,
    private readonly options: DesktopSyncEngineOptions = {},
  ) {}

  run(): Promise<DesktopSyncSummary> {
    this.inflight ??= this.runOnce().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async runOnce(): Promise<DesktopSyncSummary> {
    let account = this.repository.getActiveAccount();
    if (!account?.enabled) return this.repository.getSummary();
    try {
      await this.transport.registerDevice({
        deviceId: account.deviceId,
        name: account.deviceName,
        platform: account.platform,
        clientVersion: account.clientVersion,
      });
      if (!account.bootstrapCompletedAt) {
        const snapshotCursor = await this.bootstrap(account.ownerId);
        this.repository.markBootstrapCompleted(account.ownerId, snapshotCursor);
        this.repository.seedUnsyncedEntities(account.ownerId);
        account = this.repository.getActiveAccount()!;
      }
      await this.pullAll(account.ownerId, account.cursor, true);
      await this.pushAll(account.ownerId, account.deviceId);
      await this.pushUsageAll(account.ownerId, account.deviceId);
      account = this.repository.getActiveAccount()!;
      await this.pullAll(account.ownerId, account.cursor, false);
      this.repository.markSyncCompleted(account.ownerId);
      return this.repository.getSummary();
    } catch (error) {
      if (isCursorExpired(error)) {
        this.repository.resetBootstrap(account.ownerId);
      }
      this.repository.setSyncError(account.ownerId, safeErrorMessage(error));
      throw error;
    }
  }

  private async bootstrap(ownerId: string): Promise<string> {
    let firstSnapshotCursor: string | null = null;
    for (const entity of BOOTSTRAP_ORDER) {
      let after: string | undefined;
      do {
        const page = await this.transport.bootstrap({
          entity,
          after,
          limit: this.options.bootstrapLimit ?? 200,
        });
        firstSnapshotCursor ??= page.snapshotCursor;
        this.repository.applyBootstrapPage(ownerId, entity, page.items);
        after = page.nextPage ?? undefined;
      } while (after);
    }
    return firstSnapshotCursor ?? '0';
  }

  private async pullAll(
    ownerId: string,
    initialCursor: string,
    stopOnConflict: boolean,
  ): Promise<void> {
    let cursor = initialCursor;
    let hasMore = true;
    while (hasMore) {
      const page = await this.transport.pull({
        cursor,
        limit: this.options.pullLimit ?? 200,
        deviceId: this.repository.getActiveAccount()?.deviceId,
      });
      this.repository.applyPullPage(ownerId, page.changes, page.nextCursor);
      cursor = page.nextCursor;
      hasMore = page.hasMore;
      if (stopOnConflict && this.repository.getSummary().conflicts > 0) break;
    }
  }

  private async pushAll(ownerId: string, deviceId: string): Promise<void> {
    const maxBatches = this.options.maxPushBatches ?? 100;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const mutations = this.repository.listReadyMutations(ownerId, 100);
      if (mutations.length === 0) return;
      try {
        const response = await this.transport.push({ deviceId, mutations });
        this.repository.applyPushBatch(ownerId, mutations, response.results);
      } catch (error) {
        const message = safeErrorMessage(error);
        for (const mutation of mutations)
          this.repository.markMutationAttempt(
            ownerId,
            mutation.mutationId,
            message,
          );
        throw error;
      }
    }
    throw new Error('Cloud sync exceeded the per-run push batch limit');
  }

  private async pushUsageAll(ownerId: string, deviceId: string): Promise<void> {
    const maxBatches = this.options.maxPushBatches ?? 100;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const events = this.repository.listReadyUsageEvents(ownerId, 100);
      if (events.length === 0) return;
      try {
        const response = await this.transport.pushUsage({ deviceId, events });
        this.repository.applyUsagePushBatch(ownerId, events, response.results);
      } catch (error) {
        const message = safeErrorMessage(error);
        for (const event of events)
          this.repository.markUsageEventAttempt(ownerId, event.eventId, message);
        throw error;
      }
    }
    throw new Error('Cloud sync exceeded the per-run usage push batch limit');
  }
}

function isCursorExpired(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'SYNC_CURSOR_EXPIRED',
  );
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim())
    return error.message.slice(0, 500);
  return '云同步暂时不可用';
}
