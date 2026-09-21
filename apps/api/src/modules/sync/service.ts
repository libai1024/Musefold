import { createHash } from 'node:crypto';
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
  syncMutationSchema,
  updatePromptDocumentSchema,
  updatePromptFolderSchema,
  updatePromptTagSchema,
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
  syncTaxonomyTombstones,
} from '@musefold/db';
import { and, asc, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { PromptService } from '../prompts/service.js';
import type { DbLike } from './change-log.js';
import { acquireSyncPublication } from './publication.js';

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
        await acquireSyncPublication(tx, 'read');
        const snapshotCursor = await this.maxSeqTx(tx, userId);
        const afterValue = after ?? '';
        const table =
          entity === 'prompt' ? prompts : entity === 'folder' ? promptFolders : promptTags;
        const ids =
          entity === 'prompt'
            ? await tx
                .select({ id: prompts.id })
                .from(prompts)
                .where(
                  and(
                    eq(prompts.userId, userId),
                    gt(prompts.id, afterValue),
                    isNull(prompts.purgeStartedAt),
                  ),
                )
                .orderBy(asc(prompts.id))
                .limit(limit + 1)
            : (
                await tx.execute<{ id: string }>(sql`
              SELECT id FROM (
                SELECT ${table.id} AS id FROM ${table}
                WHERE ${table.userId} = ${userId} AND ${table.id} > ${afterValue}
                UNION
                SELECT ${syncTaxonomyTombstones.entityId} AS id FROM ${syncTaxonomyTombstones}
                WHERE ${syncTaxonomyTombstones.userId} = ${userId}
                  AND ${syncTaxonomyTombstones.entityType} = ${entity}
                  AND ${syncTaxonomyTombstones.entityId} > ${afterValue}
              ) AS bootstrap_ids ORDER BY id LIMIT ${limit + 1}
            `)
              ).rows;
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
    return this.db.transaction(
      async (tx) => {
        await acquireSyncPublication(tx, 'read');
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
      },
      { isolationLevel: 'repeatable read' },
    );
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
            .where(
              and(
                eq(prompts.userId, userId),
                eq(prompts.id, event.promptId),
                isNull(prompts.purgeStartedAt),
              ),
            )
            .for('key share');
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
            .where(
              and(
                eq(prompts.userId, userId),
                eq(prompts.id, event.promptId),
                isNull(prompts.purgeStartedAt),
              ),
            );
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
    return this.db.transaction(
      async (tx) => {
        await acquireSyncPublication(tx, 'read');
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
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  private async applyMutation(
    userId: string,
    deviceId: string,
    mutation: SyncMutation,
  ): Promise<SyncMutationResult> {
    const requestFingerprint = fingerprintSyncMutation(mutation);
    try {
      return await this.db.transaction(async (tx) => {
        // Acquire before the device row or per-mutation advisory lock; read
        // snapshots take the same boundary before updating a device cursor.
        await acquireSyncPublication(tx, 'write');
        await this.assertActiveDeviceTx(tx, userId, deviceId);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${deviceId}:${mutation.mutationId}`}, 0))`,
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
          return replayMutationResult(mutation.mutationId, stored[0], requestFingerprint);
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
          requestFingerprint,
        });
        return result;
      });
    } catch (error) {
      // The advisory lock covers all service writers. This fallback also handles a
      // legacy writer that wins the unique key without taking that lock: the failed
      // transaction is rolled back before the persisted result is inspected.
      if (!isUniqueViolation(error)) throw error;
      const stored = await this.db.transaction(async (tx) =>
        tx
          .select()
          .from(syncMutationResults)
          .where(
            and(
              eq(syncMutationResults.userId, userId),
              eq(syncMutationResults.deviceId, deviceId),
              eq(syncMutationResults.mutationId, mutation.mutationId),
            ),
          ),
      );
      if (stored[0]) {
        return replayMutationResult(mutation.mutationId, stored[0], requestFingerprint);
      }
      throw error;
    }
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
      // After retention, an owner may have no remaining log rows. Bootstrap
      // must still return a cursor accepted by pull instead of looping on 410.
      .select({
        cursor: sql<string>`GREATEST(COALESCE(max(${syncChangeLog.seq}), 0),
        COALESCE((SELECT ${syncRetentionState.minAvailableCursor} FROM ${syncRetentionState}
          WHERE ${syncRetentionState.id} = 'singleton'), 0))::text`,
      })
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

const SYNC_MUTATION_PAYLOAD_MISMATCH = 'SYNC_MUTATION_PAYLOAD_MISMATCH';

/**
 * 计算 push 请求的稳定指纹。只接收 sync contract 已解析的 mutation；业务 payload
 * 再按实际执行所用的 prompt contract 做默认值/字段规范化。
 */
export function fingerprintSyncMutation(mutation: SyncMutation): string {
  const parsed = syncMutationSchema.parse(mutation);
  const request = {
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    operation: parsed.operation,
    baseVersion: parsed.baseVersion,
    payload: normalizeMutationPayload(parsed),
  };
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}

function normalizeMutationPayload(mutation: SyncMutation): Record<string, unknown> {
  try {
    if (mutation.entityType === 'prompt') {
      if (mutation.operation === 'create') {
        const parsed = newPromptDocumentSchema.parse(mutation.payload);
        return {
          ...parsed,
          pinOrder: parsed.pinOrder ?? null,
          tagIds: normalizeTagIds(parsed.tagIds),
        };
      }
      if (mutation.operation === 'update') {
        const parsed = updatePromptDocumentSchema.parse({
          ...mutation.payload,
          expectedVersion: mutation.baseVersion,
        });
        const { expectedVersion: _expectedVersion, ...payload } = parsed;
        return payload.tagIds === undefined
          ? payload
          : { ...payload, tagIds: normalizeTagIds(payload.tagIds) };
      }
    } else if (mutation.entityType === 'folder') {
      if (mutation.operation === 'create') return newPromptFolderSchema.parse(mutation.payload);
      if (mutation.operation === 'update') {
        const parsed = updatePromptFolderSchema.parse({
          ...mutation.payload,
          expectedVersion: mutation.baseVersion,
        });
        const { expectedVersion: _expectedVersion, ...payload } = parsed;
        return payload;
      }
    } else if (mutation.entityType === 'tag') {
      if (mutation.operation === 'create') return newPromptTagSchema.parse(mutation.payload);
      if (mutation.operation === 'update') {
        const parsed = updatePromptTagSchema.parse({
          ...mutation.payload,
          expectedVersion: mutation.baseVersion,
        });
        const { expectedVersion: _expectedVersion, ...payload } = parsed;
        return payload;
      }
    }
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
  }

  // Delete/restore ignore payload, and invalid create/update payloads still need a
  // fingerprint so their first rejected result can be replayed safely.
  return mutation.payload;
}

function normalizeTagIds(tagIds: string[]): string[] {
  return [...new Set(tagIds)].sort();
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) throw new Error('undefined is not a JSON value');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite numbers are not allowed');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') throw new Error('value is not JSON');

  if (seen.has(value)) throw new Error('cyclic value is not allowed');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('value is not JSON');
  const record = value as Record<string, unknown>;
  const result = `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], seen)}`)
    .join(',')}}`;
  seen.delete(value);
  return result;
}

function replayMutationResult(
  mutationId: string,
  stored: typeof syncMutationResults.$inferSelect,
  requestFingerprint: string,
): SyncMutationResult {
  // Same mutation id with a different payload is NOT a replay of the stored
  // result: acknowledging it as `duplicate` invites clients to clear their
  // outbox and silently drop the diverging payload. Reject the request instead
  // so clients retain and re-issue it. Legacy rows without a fingerprint stay
  // on the compatibility duplicate path.
  if (stored.requestFingerprint && stored.requestFingerprint !== requestFingerprint) {
    return {
      mutationId,
      status: 'rejected',
      version: null,
      snapshot: null,
      errorCode: SYNC_MUTATION_PAYLOAD_MISMATCH,
    };
  }
  return {
    mutationId,
    status: 'duplicate',
    version: stored.resultVersion,
    snapshot: stored.resultSnapshot as SyncMutationResult['snapshot'],
    errorCode: stored.errorCode,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
