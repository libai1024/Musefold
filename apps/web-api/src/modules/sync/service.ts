import { sql, type Kysely } from "kysely";
import { ZodError } from "zod";
import {
  newPromptDocumentSchema,
  newPromptFolderSchema,
  newPromptTagSchema,
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
} from "@musefold/contracts";
import type { MusefoldDatabase } from "../../database/types.js";
import {
  withOwnerTransaction,
  type OwnerTransaction,
} from "../../database/owner-context.js";
import { AppError } from "../../errors.js";
import type { PromptServicePort } from "../prompts/service.js";

export interface SyncServicePort {
  registerDevice(
    ownerId: number,
    input: SyncDeviceRegistration,
  ): Promise<SyncDevice>;
  bootstrap(
    ownerId: number,
    entity: "prompt" | "folder" | "tag",
    after: string | undefined,
    limit: number,
  ): Promise<SyncBootstrapPage>;
  pull(
    ownerId: number,
    cursor: string,
    limit: number,
    deviceId?: string,
  ): Promise<{ changes: SyncChange[]; nextCursor: string; hasMore: boolean }>;
  push(
    ownerId: number,
    deviceId: string,
    mutations: SyncMutation[],
  ): Promise<SyncPushResult>;
  pushUsage(
    ownerId: number,
    deviceId: string,
    events: SyncUsageEvent[],
  ): Promise<SyncUsagePushResult>;
  status(
    ownerId: number,
    deviceId: string,
  ): Promise<{
    device: SyncDevice;
    serverCursor: string;
    pendingConflicts: number;
  }>;
}

type DeviceRow = {
  id: string;
  name: string;
  platform: SyncDevice["platform"];
  client_version: string;
  last_pull_seq: string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
};

type StoredMutationRow = {
  result_status: SyncMutationResult["status"];
  result_version: number | null;
  result_snapshot: SyncMutationResult["snapshot"];
  error_code: string | null;
};

export class SyncService implements SyncServicePort {
  constructor(
    private readonly db: Kysely<MusefoldDatabase>,
    private readonly prompts: PromptServicePort,
  ) {}

  async registerDevice(
    ownerId: number,
    input: SyncDeviceRegistration,
  ): Promise<SyncDevice> {
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const existing =
        await sql<DeviceRow>`SELECT id, name, platform, client_version, last_pull_seq, last_seen_at, revoked_at FROM app.sync_devices WHERE owner_id = ${ownerId} AND id = ${input.deviceId}`.execute(
          trx,
        );
      if (existing.rows[0]?.revoked_at)
        throw new AppError(
          "VALIDATION_FAILED",
          "该设备已撤销，请使用新的设备标识",
          409,
        );
      await sql`
        INSERT INTO app.sync_devices(owner_id, id, name, platform, client_version)
        VALUES (${ownerId}, ${input.deviceId}, ${input.name}, ${input.platform}, ${input.clientVersion})
        ON CONFLICT (owner_id, id) DO UPDATE SET
          name = EXCLUDED.name,
          platform = EXCLUDED.platform,
          client_version = EXCLUDED.client_version,
          last_seen_at = now()
      `.execute(trx);
      return this.getDeviceTx(trx, input.deviceId);
    });
  }

  async bootstrap(
    ownerId: number,
    entity: "prompt" | "folder" | "tag",
    after: string | undefined,
    limit: number,
  ): Promise<SyncBootstrapPage> {
    return withOwnerTransaction(
      this.db,
      ownerId,
      async (trx) => {
        const cursorResult = await sql<{
          cursor: string;
        }>`SELECT COALESCE(max(seq), 0)::text AS cursor FROM app.sync_changes`.execute(
          trx,
        );
        const snapshotCursor = cursorResult.rows[0]?.cursor ?? "0";
        const afterValue = after ?? "";
        const ids =
          entity === "prompt"
            ? await sql<{
                id: string;
              }>`SELECT id FROM app.prompts WHERE id > ${afterValue} ORDER BY id LIMIT ${limit + 1}`.execute(
                trx,
              )
            : entity === "folder"
              ? await sql<{
                  id: string;
                }>`SELECT id FROM app.prompt_folders WHERE id > ${afterValue} ORDER BY id LIMIT ${limit + 1}`.execute(
                  trx,
                )
              : await sql<{
                  id: string;
                }>`SELECT id FROM app.prompt_tags WHERE id > ${afterValue} ORDER BY id LIMIT ${limit + 1}`.execute(
                  trx,
                );
        const hasMore = ids.rows.length > limit;
        const rows = hasMore ? ids.rows.slice(0, limit) : ids.rows;
        const context = { transaction: trx };
        const items =
          entity === "prompt"
            ? await Promise.all(
                rows.map((row) =>
                  this.prompts.getPrompt(ownerId, row.id, context),
                ),
              )
            : entity === "folder"
              ? await Promise.all(
                  rows.map((row) =>
                    this.prompts.getFolder(ownerId, row.id, context),
                  ),
                )
              : await Promise.all(
                  rows.map((row) =>
                    this.prompts.getTag(ownerId, row.id, context),
                  ),
                );
        return {
          snapshotCursor,
          items,
          nextPage: hasMore && rows.at(-1) ? rows.at(-1)!.id : null,
        };
      },
      { isolationLevel: "repeatable read" },
    );
  }

  async pull(
    ownerId: number,
    cursor: string,
    limit: number,
    deviceId?: string,
  ): Promise<{ changes: SyncChange[]; nextCursor: string; hasMore: boolean }> {
    const numericCursor = parseCursor(cursor);
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const boundary = await sql<{
        min_available_cursor: string;
        max_seq: string | null;
      }>`
        SELECT
          COALESCE((SELECT min_available_cursor FROM app.sync_retention_state LIMIT 1), 0)::text AS min_available_cursor,
          (SELECT max(seq)::text FROM app.sync_changes) AS max_seq
      `.execute(trx);
      const minAvailableCursor = BigInt(
        boundary.rows[0]?.min_available_cursor ?? "0",
      );
      const maxSeq = boundary.rows[0]?.max_seq
        ? BigInt(boundary.rows[0].max_seq)
        : numericCursor;
      if (deviceId) await this.assertActiveDeviceTx(trx, ownerId, deviceId);
      if (numericCursor < minAvailableCursor)
        throw new AppError(
          "SYNC_CURSOR_EXPIRED",
          "同步游标已过期，请重新执行全量同步",
          410,
        );
      const result = await sql<{
        seq: string;
        entity_type: SyncChange["entityType"];
        entity_id: string;
        operation: SyncChange["operation"];
        entity_version: number;
        snapshot: SyncChange["snapshot"];
      }>`
        SELECT seq::text, entity_type, entity_id, operation, entity_version, snapshot
        FROM app.sync_changes WHERE seq > ${numericCursor.toString()} ORDER BY seq LIMIT ${limit + 1}
      `.execute(trx);
      const hasMore = result.rows.length > limit;
      const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
      const changes = rows.map((row) => ({
        seq: row.seq,
        entityType: row.entity_type,
        entityId: row.entity_id,
        operation: row.operation,
        version: row.entity_version,
        snapshot: row.snapshot,
      }));
      const nextCursor = changes.at(-1)?.seq ?? maxSeq.toString();
      if (deviceId) {
        await sql`
          UPDATE app.sync_devices
          SET last_pull_seq = GREATEST(last_pull_seq, ${BigInt(nextCursor).toString()}::bigint),
              last_seen_at = now()
          WHERE owner_id = ${ownerId} AND id = ${deviceId} AND revoked_at IS NULL
        `.execute(trx);
      }
      return { changes, nextCursor, hasMore };
    });
  }

  async push(
    ownerId: number,
    deviceId: string,
    mutations: SyncMutation[],
  ): Promise<SyncPushResult> {
    await withOwnerTransaction(this.db, ownerId, async (trx) => {
      await this.assertActiveDeviceTx(trx, ownerId, deviceId);
    });
    const results: SyncMutationResult[] = [];
    for (const mutation of mutations)
      results.push(await this.applyMutation(ownerId, deviceId, mutation));
    return { results };
  }

  async pushUsage(
    ownerId: number,
    deviceId: string,
    events: SyncUsageEvent[],
  ): Promise<SyncUsagePushResult> {
    const results: SyncUsageEventResult[] = [];
    for (const event of events) {
      results.push(
        await withOwnerTransaction(this.db, ownerId, async (trx) => {
          await this.assertActiveDeviceTx(trx, ownerId, deviceId);
          const prompt = await sql<{ id: string }>`
            SELECT id FROM app.prompts
            WHERE owner_id = ${ownerId} AND id = ${event.promptId}
          `.execute(trx);
          if (!prompt.rows[0]) {
            return {
              eventId: event.eventId,
              status: "rejected",
              errorCode: "PROMPT_NOT_FOUND",
            } satisfies SyncUsageEventResult;
          }
          const inserted = await sql<{ id: string }>`
            INSERT INTO app.prompt_usage_events(owner_id, prompt_id, action, idempotency_key)
            VALUES (${ownerId}, ${event.promptId}, ${event.action}, ${event.eventId})
            ON CONFLICT DO NOTHING
            RETURNING id::text
          `.execute(trx);
          if (!inserted.rows[0]) {
            return {
              eventId: event.eventId,
              status: "duplicate",
              errorCode: null,
            } satisfies SyncUsageEventResult;
          }
          await sql`
            UPDATE app.prompts
            SET usage_count = usage_count + 1, last_used_at = now(), updated_at = now()
            WHERE owner_id = ${ownerId} AND id = ${event.promptId}
          `.execute(trx);
          return {
            eventId: event.eventId,
            status: "applied",
            errorCode: null,
          } satisfies SyncUsageEventResult;
        }),
      );
    }
    return { results };
  }

  async status(
    ownerId: number,
    deviceId: string,
  ): Promise<{
    device: SyncDevice;
    serverCursor: string;
    pendingConflicts: number;
  }> {
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const device = await this.getDeviceTx(trx, deviceId);
      const server = await sql<{
        cursor: string;
      }>`SELECT COALESCE(max(seq), 0)::text AS cursor FROM app.sync_changes`.execute(
        trx,
      );
      const conflicts = await sql<{
        count: string;
      }>`SELECT count(*)::text AS count FROM app.sync_mutations WHERE device_id = ${deviceId} AND result_status = 'conflict'`.execute(
        trx,
      );
      return {
        device,
        serverCursor: server.rows[0]?.cursor ?? "0",
        pendingConflicts: Number(conflicts.rows[0]?.count ?? 0),
      };
    });
  }

  private async applyMutation(
    ownerId: number,
    deviceId: string,
    mutation: SyncMutation,
  ): Promise<SyncMutationResult> {
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      await this.assertActiveDeviceTx(trx, ownerId, deviceId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${deviceId}:${mutation.mutationId}`}, 0))`.execute(
        trx,
      );
      const result = await sql<StoredMutationRow>`
        SELECT result_status, result_version, result_snapshot, error_code
        FROM app.sync_mutations WHERE device_id = ${deviceId} AND mutation_id = ${mutation.mutationId}
      `.execute(trx);
      const duplicate = result.rows[0];
      if (duplicate) {
        return {
          mutationId: mutation.mutationId,
          status: "duplicate",
          version: duplicate.result_version,
          snapshot: duplicate.result_snapshot,
          errorCode: duplicate.error_code,
        };
      }

      let mutationResult: SyncMutationResult;
      try {
        mutationResult = await this.executeMutation(ownerId, mutation, trx);
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "PROMPT_VERSION_CONFLICT"
        ) {
          const current = error.details
            .current as SyncMutationResult["snapshot"];
          mutationResult = {
            mutationId: mutation.mutationId,
            status: "conflict",
            version: current && "version" in current ? current.version : null,
            snapshot: current,
            errorCode: "SYNC_MUTATION_CONFLICT",
          };
        } else if (error instanceof AppError || error instanceof ZodError) {
          mutationResult = {
            mutationId: mutation.mutationId,
            status: "rejected",
            version: null,
            snapshot: null,
            errorCode:
              error instanceof AppError ? error.code : "VALIDATION_FAILED",
          };
        } else {
          throw error;
        }
      }

      await sql`
        INSERT INTO app.sync_mutations(owner_id, device_id, mutation_id, entity_type, entity_id, result_status, result_version, result_snapshot, error_code)
        VALUES (${ownerId}, ${deviceId}, ${mutation.mutationId}, ${mutation.entityType}, ${mutation.entityId}, ${mutationResult.status}, ${mutationResult.version}, ${mutationResult.snapshot ? JSON.stringify(mutationResult.snapshot) : null}, ${mutationResult.errorCode})
      `.execute(trx);
      return mutationResult;
    });
  }

  private async executeMutation(
    ownerId: number,
    mutation: SyncMutation,
    trx: OwnerTransaction,
  ): Promise<SyncMutationResult> {
    const payload = mutation.payload;
    if (mutation.operation === "create" && mutation.baseVersion !== null)
      throw new AppError(
        "VALIDATION_FAILED",
        "创建 mutation 的 baseVersion 必须为空",
        400,
      );
    if (mutation.operation !== "create" && mutation.baseVersion === null)
      throw new AppError(
        "VALIDATION_FAILED",
        "更新或删除 mutation 缺少 baseVersion",
        400,
      );
    const context = { transaction: trx };
    let snapshot: PromptDocument | PromptFolder | PromptTag;
    if (mutation.entityType === "prompt") {
      if (mutation.operation === "create")
        snapshot = await this.prompts.createPrompt(
          ownerId,
          newPromptDocumentSchema.parse(payload),
          mutation.entityId,
          context,
        );
      else if (mutation.operation === "update")
        snapshot = await this.prompts.updatePrompt(
          ownerId,
          mutation.entityId,
          { ...payload, expectedVersion: mutation.baseVersion! } as never,
          context,
        );
      else if (mutation.operation === "delete")
        snapshot = await this.prompts.deletePrompt(
          ownerId,
          mutation.entityId,
          mutation.baseVersion!,
          context,
        );
      else
        snapshot = await this.prompts.restorePrompt(
          ownerId,
          mutation.entityId,
          mutation.baseVersion!,
          context,
        );
    } else if (mutation.entityType === "folder") {
      if (mutation.operation === "create")
        snapshot = await this.prompts.createFolder(
          ownerId,
          newPromptFolderSchema.parse(payload),
          mutation.entityId,
          context,
        );
      else if (mutation.operation === "update")
        snapshot = await this.prompts.updateFolder(
          ownerId,
          mutation.entityId,
          { ...payload, expectedVersion: mutation.baseVersion! } as never,
          context,
        );
      else if (mutation.operation === "delete")
        snapshot = await this.prompts.deleteFolder(
          ownerId,
          mutation.entityId,
          mutation.baseVersion!,
          context,
        );
      else
        snapshot = await this.prompts.restoreFolder(
          ownerId,
          mutation.entityId,
          mutation.baseVersion!,
          context,
        );
    } else {
      if (mutation.operation === "create")
        snapshot = await this.prompts.createTag(
          ownerId,
          newPromptTagSchema.parse(payload),
          mutation.entityId,
          context,
        );
      else if (mutation.operation === "update")
        snapshot = await this.prompts.updateTag(
          ownerId,
          mutation.entityId,
          { ...payload, expectedVersion: mutation.baseVersion! } as never,
          context,
        );
      else if (mutation.operation === "delete")
        snapshot = await this.prompts.deleteTag(
          ownerId,
          mutation.entityId,
          mutation.baseVersion!,
          context,
        );
      else
        snapshot = await this.prompts.restoreTag(
          ownerId,
          mutation.entityId,
          mutation.baseVersion!,
          context,
        );
    }
    return {
      mutationId: mutation.mutationId,
      status: "applied",
      version: snapshot.version,
      snapshot,
      errorCode: null,
    };
  }

  private async getDeviceTx(
    trx: OwnerTransaction,
    deviceId: string,
  ): Promise<SyncDevice> {
    const result =
      await sql<DeviceRow>`SELECT id, name, platform, client_version, last_pull_seq, last_seen_at, revoked_at FROM app.sync_devices WHERE id = ${deviceId}`.execute(
        trx,
      );
    const row = result.rows[0];
    if (!row) throw new AppError("VALIDATION_FAILED", "同步设备不存在", 404);
    return {
      deviceId: row.id,
      name: row.name,
      platform: row.platform,
      clientVersion: row.client_version,
      revoked: row.revoked_at !== null,
      lastPullCursor: row.last_pull_seq,
    };
  }

  private async assertActiveDeviceTx(
    trx: OwnerTransaction,
    ownerId: number,
    deviceId: string,
  ): Promise<void> {
    const result = await sql<{ id: string }>`
      SELECT id
      FROM app.sync_devices
      WHERE owner_id = ${ownerId} AND id = ${deviceId} AND revoked_at IS NULL
      FOR UPDATE
    `.execute(trx);
    if (!result.rows[0])
      throw new AppError("VALIDATION_FAILED", "同步设备不存在或已撤销", 409);
  }
}

function parseCursor(cursor: string): bigint {
  if (!/^\d+$/.test(cursor))
    throw new AppError("VALIDATION_FAILED", "同步游标无效", 400);
  return BigInt(cursor);
}
