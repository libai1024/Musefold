import {
  type PromptDocument,
  type PromptFolder,
  type PromptTag,
  type SyncBootstrapPage,
  type SyncChange,
  type SyncDevice,
  type SyncDeviceRegistration,
  type SyncMutation,
  type SyncMutationResult,
  type SyncPushResult,
  type SyncUsageEvent,
  type SyncUsageEventResult,
  type SyncUsagePushResult,
  newPromptDocumentSchema,
  newPromptFolderSchema,
  newPromptTagSchema,
  syncChangeOperationSchema,
  syncEntityTypeSchema,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  promptFolders,
  promptTags,
  promptUsageEvents,
  prompts,
  syncChangeLog,
  syncDevices,
  syncMutationResults,
  syncRetentionState,
} from '@musefold/db';
import { and, asc, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { PromptService } from '../prompts/service.js';
import type { DbLike } from './change-log.js';

type Tx = DbLike;

/**
 * 桌面 local-first 同步:bootstrap 全量 → pull 增量 → push 变更(幂等 + 冲突显式返回)。
 * 与旧版语义一致:同一 mutationId 重放返回首次结果;版本冲突返回 current 快照由客户端合并。
 */
export class SyncService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly prompts: PromptService,
  ) {}

  async registerDevice(userId: string, input: SyncDeviceRegistration): Promise<SyncDevice> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ revokedAt: syncDevices.revokedAt })
        .from(syncDevices)
        .where(and(eq(syncDevices.userId, userId), eq(syncDevices.deviceId, input.deviceId)));
      if (existing[0]?.revokedAt) {
        throw new AppError('VALIDATION_FAILED', '该设备已撤销，请使用新的设备标识', 409);
      }
      await tx
        .insert(syncDevices)
        .values({
          userId,
          deviceId: input.deviceId,
          name: input.name,
          platform: input.platform,
          clientVersion: input.clientVersion,
        })
        .onConflictDoUpdate({
          target: [syncDevices.userId, syncDevices.deviceId],
          set: {
            name: input.name,
            platform: input.platform,
            clientVersion: input.clientVersion,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        });
      return this.getDeviceTx(tx, userId, input.deviceId);
    });
  }

  async bootstrap(
    userId: string,
    entity: 'prompt' | 'folder' | 'tag',
    after: string | undefined,
    limit: number,
  ): Promise<SyncBootstrapPage> {
    return this.db.transaction(
      async (tx) => {
        const snapshotCursor = await this.maxSeqTx(tx, userId);
        const afterValue = after ?? '';
        const table =
          entity === 'prompt' ? prompts : entity === 'folder' ? promptFolders : promptTags;
        const ids = await tx
          .select({ id: table.id })
          .from(table)
          .where(and(eq(table.userId, userId), gt(table.id, afterValue)))
          .orderBy(asc(table.id))
          .limit(limit + 1);
        const hasMore = ids.length > limit;
        const rows = hasMore ? ids.slice(0, limit) : ids;
        const context = { tx };
        const items: Array<PromptDocument | PromptFolder | PromptTag> = [];
        for (const row of rows) {
          if (entity === 'prompt')
            items.push(await this.prompts.getPrompt(userId, row.id, context));
          else if (entity === 'folder')
            items.push(await this.prompts.getFolder(userId, row.id, context));
          else items.push(await this.prompts.getTag(userId, row.id, context));
        }
        return {
          snapshotCursor,
          items,
          nextPage: hasMore ? (rows.at(-1)?.id ?? null) : null,
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  async pull(
    userId: string,
    cursor: string,
    limit: number,
    deviceId?: string,
  ): Promise<{ changes: SyncChange[]; nextCursor: string; hasMore: boolean }> {
    const numericCursor = parseCursor(cursor);
    return this.db.transaction(async (tx) => {
      const retention = await tx.select().from(syncRetentionState);
      const minAvailable = retention[0]?.minAvailableCursor ?? 0;
      if (deviceId) await this.assertActiveDeviceTx(tx, userId, deviceId);
      if (numericCursor < minAvailable) {
        throw new AppError('SYNC_CURSOR_EXPIRED', '同步游标已过期，请重新执行全量同步');
      }
      const rows = await tx
        .select()
        .from(syncChangeLog)
        .where(and(eq(syncChangeLog.userId, userId), gt(syncChangeLog.seq, numericCursor)))
        .orderBy(asc(syncChangeLog.seq))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const changes: SyncChange[] = page.map((row) => ({
        seq: String(row.seq),
        entityType: syncEntityTypeSchema.parse(row.entityType),
        entityId: row.entityId,
        operation: syncChangeOperationSchema.parse(row.operation),
        version: row.version,
        snapshot: row.snapshot as SyncChange['snapshot'],
      }));
      const nextCursor = changes.at(-1)?.seq ?? (await this.maxSeqTx(tx, userId));
      if (deviceId) {
        await tx
          .update(syncDevices)
          .set({
            lastPullCursor: sql`GREATEST(${syncDevices.lastPullCursor}, ${Number(nextCursor)})`,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(syncDevices.userId, userId),
              eq(syncDevices.deviceId, deviceId),
              isNull(syncDevices.revokedAt),
            ),
          );
      }
      return { changes, nextCursor, hasMore };
    });
  }

  async push(userId: string, deviceId: string, mutations: SyncMutation[]): Promise<SyncPushResult> {
    await this.db.transaction(async (tx) => {
      await this.assertActiveDeviceTx(tx, userId, deviceId);
    });
    const results: SyncMutationResult[] = [];
    for (const mutation of mutations) {
      results.push(await this.applyMutation(userId, deviceId, mutation));
    }
    return { results };
  }

  async pushUsage(
    userId: string,
    deviceId: string,
    events: SyncUsageEvent[],
  ): Promise<SyncUsagePushResult> {
    const results: SyncUsageEventResult[] = [];
    for (const event of events) {
      results.push(
        await this.db.transaction(async (tx) => {
          await this.assertActiveDeviceTx(tx, userId, deviceId);
          const prompt = await tx
            .select({ id: prompts.id })
            .from(prompts)
            .where(and(eq(prompts.userId, userId), eq(prompts.id, event.promptId)));
          if (!prompt[0]) {
            return {
              eventId: event.eventId,
              status: 'rejected',
              errorCode: 'PROMPT_NOT_FOUND',
            } satisfies SyncUsageEventResult;
          }
          const inserted = await tx
            .insert(promptUsageEvents)
            .values({
              userId,
              eventId: event.eventId,
              promptId: event.promptId,
              action: event.action,
              deviceId,
            })
            .onConflictDoNothing()
            .returning({ eventId: promptUsageEvents.eventId });
          if (!inserted[0]) {
            return {
              eventId: event.eventId,
              status: 'duplicate',
              errorCode: null,
            } satisfies SyncUsageEventResult;
          }
          await tx
            .update(prompts)
            .set({
              usageCount: sql`${prompts.usageCount} + 1`,
              lastUsedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(and(eq(prompts.userId, userId), eq(prompts.id, event.promptId)));
          return {
            eventId: event.eventId,
            status: 'applied',
            errorCode: null,
          } satisfies SyncUsageEventResult;
        }),
      );
    }
    return { results };
  }

  async status(
    userId: string,
    deviceId: string,
  ): Promise<{ device: SyncDevice; serverCursor: string; pendingConflicts: number }> {
    return this.db.transaction(async (tx) => {
      const device = await this.getDeviceTx(tx, userId, deviceId);
      const serverCursor = await this.maxSeqTx(tx, userId);
      const conflicts = await tx
        .select({ value: count() })
        .from(syncMutationResults)
        .where(
          and(
            eq(syncMutationResults.userId, userId),
            eq(syncMutationResults.deviceId, deviceId),
            eq(syncMutationResults.resultStatus, 'conflict'),
          ),
        );
      return {
        device,
        serverCursor,
        pendingConflicts: conflicts[0]?.value ?? 0,
      };
    });
  }

  private async applyMutation(
    userId: string,
    deviceId: string,
    mutation: SyncMutation,
  ): Promise<SyncMutationResult> {
    return this.db.transaction(async (tx) => {
      await this.assertActiveDeviceTx(tx, userId, deviceId);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${deviceId}:${mutation.mutationId}`}, 0))`,
      );
      const stored = await tx
        .select()
        .from(syncMutationResults)
        .where(
          and(
            eq(syncMutationResults.userId, userId),
            eq(syncMutationResults.deviceId, deviceId),
            eq(syncMutationResults.mutationId, mutation.mutationId),
          ),
        );
      if (stored[0]) {
        return {
          mutationId: mutation.mutationId,
          status: 'duplicate',
          version: stored[0].resultVersion,
          snapshot: stored[0].resultSnapshot as SyncMutationResult['snapshot'],
          errorCode: stored[0].errorCode,
        };
      }

      let result: SyncMutationResult;
      try {
        result = await this.executeMutation(userId, deviceId, mutation, tx);
      } catch (error) {
        if (error instanceof AppError && error.code === 'PROMPT_VERSION_CONFLICT') {
          const current = error.details.current as SyncMutationResult['snapshot'];
          result = {
            mutationId: mutation.mutationId,
            status: 'conflict',
            version: current && 'version' in current ? current.version : null,
            snapshot: current,
            errorCode: 'SYNC_MUTATION_CONFLICT',
          };
        } else if (error instanceof AppError || error instanceof ZodError) {
          result = {
            mutationId: mutation.mutationId,
            status: 'rejected',
            version: null,
            snapshot: null,
            errorCode: error instanceof AppError ? error.code : 'VALIDATION_FAILED',
          };
        } else {
          throw error;
        }
      }

      await tx.insert(syncMutationResults).values({
        userId,
        deviceId,
        mutationId: mutation.mutationId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        resultStatus: result.status,
        resultVersion: result.version,
        resultSnapshot: result.snapshot as Record<string, unknown> | null,
        errorCode: result.errorCode,
      });
      return result;
    });
  }

  private async executeMutation(
    userId: string,
    deviceId: string,
    mutation: SyncMutation,
    tx: Tx,
  ): Promise<SyncMutationResult> {
    const payload = mutation.payload;
    if (mutation.operation === 'create' && mutation.baseVersion !== null) {
      throw new AppError('VALIDATION_FAILED', '创建 mutation 的 baseVersion 必须为空');
    }
    if (mutation.operation !== 'create' && mutation.baseVersion === null) {
      throw new AppError('VALIDATION_FAILED', '更新或删除 mutation 缺少 baseVersion');
    }
    const context = {
      tx,
      source: { deviceId, mutationId: mutation.mutationId },
    };
    const baseVersion = mutation.baseVersion as number;
    let snapshot: PromptDocument | PromptFolder | PromptTag;
    if (mutation.entityType === 'prompt') {
      if (mutation.operation === 'create') {
        snapshot = await this.prompts.createPrompt(
          userId,
          newPromptDocumentSchema.parse(payload),
          mutation.entityId,
          context,
        );
      } else if (mutation.operation === 'update') {
        snapshot = await this.prompts.updatePrompt(
          userId,
          mutation.entityId,
          { ...payload, expectedVersion: baseVersion } as never,
          context,
        );
      } else if (mutation.operation === 'delete') {
        snapshot = await this.prompts.deletePrompt(userId, mutation.entityId, baseVersion, context);
      } else {
        snapshot = await this.prompts.restorePrompt(
          userId,
          mutation.entityId,
          baseVersion,
          context,
        );
      }
    } else if (mutation.entityType === 'folder') {
      if (mutation.operation === 'create') {
        snapshot = await this.prompts.createFolder(
          userId,
          newPromptFolderSchema.parse(payload),
          mutation.entityId,
          context,
        );
      } else if (mutation.operation === 'update') {
        snapshot = await this.prompts.updateFolder(
          userId,
          mutation.entityId,
          { ...payload, expectedVersion: baseVersion } as never,
          context,
        );
      } else if (mutation.operation === 'delete') {
        snapshot = await this.prompts.deleteFolder(userId, mutation.entityId, baseVersion, context);
      } else {
        snapshot = await this.prompts.restoreFolder(
          userId,
          mutation.entityId,
          baseVersion,
          context,
        );
      }
    } else {
      if (mutation.operation === 'create') {
        snapshot = await this.prompts.createTag(
          userId,
          newPromptTagSchema.parse(payload),
          mutation.entityId,
          context,
        );
      } else if (mutation.operation === 'update') {
        snapshot = await this.prompts.updateTag(
          userId,
          mutation.entityId,
          { ...payload, expectedVersion: baseVersion } as never,
          context,
        );
      } else if (mutation.operation === 'delete') {
        snapshot = await this.prompts.deleteTag(userId, mutation.entityId, baseVersion, context);
      } else {
        snapshot = await this.prompts.restoreTag(userId, mutation.entityId, baseVersion, context);
      }
    }
    return {
      mutationId: mutation.mutationId,
      status: 'applied',
      version: snapshot.version,
      snapshot,
      errorCode: null,
    };
  }

  private async maxSeqTx(tx: Tx, userId: string): Promise<string> {
    const result = await tx
      .select({ cursor: sql<string>`COALESCE(max(${syncChangeLog.seq}), 0)::text` })
      .from(syncChangeLog)
      .where(eq(syncChangeLog.userId, userId));
    return result[0]?.cursor ?? '0';
  }

  private async getDeviceTx(tx: Tx, userId: string, deviceId: string): Promise<SyncDevice> {
    const rows = await tx
      .select()
      .from(syncDevices)
      .where(and(eq(syncDevices.userId, userId), eq(syncDevices.deviceId, deviceId)));
    const row = rows[0];
    if (!row) throw new AppError('VALIDATION_FAILED', '同步设备不存在', 404);
    return {
      deviceId: row.deviceId,
      name: row.name,
      platform: row.platform as SyncDevice['platform'],
      clientVersion: row.clientVersion,
      revoked: row.revokedAt !== null,
      lastPullCursor: String(row.lastPullCursor),
    };
  }

  private async assertActiveDeviceTx(tx: Tx, userId: string, deviceId: string): Promise<void> {
    const rows = await tx.execute(sql`
      SELECT device_id FROM sync_devices
      WHERE user_id = ${userId} AND device_id = ${deviceId} AND revoked_at IS NULL
      FOR UPDATE
    `);
    if (!rows.rows[0]) {
      throw new AppError('VALIDATION_FAILED', '同步设备不存在或已撤销', 409);
    }
  }
}

function parseCursor(cursor: string): number {
  if (!/^\d+$/.test(cursor)) throw new AppError('VALIDATION_FAILED', '同步游标无效');
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) throw new AppError('VALIDATION_FAILED', '同步游标无效');
  return value;
}
