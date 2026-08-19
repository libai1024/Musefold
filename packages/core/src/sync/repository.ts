import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ulid } from "ulid";
import type {
  PromptDocument,
  PromptFolder,
  PromptTag,
  SyncChange,
  SyncEntityType,
  SyncMutation,
  SyncMutationOperation,
  SyncMutationResult,
  SyncSnapshot,
  SyncUsageAction,
  SyncUsageEvent,
  SyncUsageEventResult,
} from "@musefold/contracts";
import { tokenizeForFts } from "../db/fts";

export type DesktopSyncStatus =
  "disabled" | "idle" | "syncing" | "conflict" | "error";

export interface DesktopSyncAccountInput {
  ownerId: string;
  username: string;
  deviceId?: string;
  deviceName: string;
  platform: "macos" | "windows" | "linux";
  clientVersion: string;
}

export interface DesktopSyncAccount {
  ownerId: string;
  username: string;
  deviceId: string;
  deviceName: string;
  platform: "macos" | "windows" | "linux";
  clientVersion: string;
  enabled: boolean;
  cursor: string;
  bootstrapCompletedAt: number | null;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface DesktopSyncSummary {
  account: DesktopSyncAccount | null;
  status: DesktopSyncStatus;
  pendingMutations: number;
  conflicts: number;
}

export interface DesktopSyncConflict {
  id: string;
  ownerId: string;
  entityType: SyncEntityType;
  entityId: string;
  mutationId: string;
  baseVersion: number | null;
  localSnapshot: Record<string, unknown>;
  remoteSnapshot: SyncSnapshot;
  detectedAt: number;
}

interface AccountRow {
  owner_id: string;
  username: string;
  device_id: string;
  device_name: string;
  platform: DesktopSyncAccount["platform"];
  client_version: string;
  enabled: number;
  cursor: string;
  bootstrap_completed_at: number | null;
  last_sync_at: number | null;
  last_error: string | null;
}

interface EntityStateRow {
  cloud_version: number | null;
  last_synced_hash: string | null;
  sync_status: "clean" | "pending" | "conflict" | "error";
}

interface OutboxRow {
  mutation_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncMutationOperation;
  base_version: number | null;
  payload_json: string;
}

interface UsageOutboxRow {
  event_id: string;
  prompt_id: string;
  action: SyncUsageAction;
}

interface ConflictRow {
  id: string;
  owner_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  mutation_id: string;
  base_version: number | null;
  local_snapshot_json: string;
  remote_snapshot_json: string;
  detected_at: number;
}

const SENSITIVE_KEY =
  /(api.?key|token|secret|credential|password|file.?path|image.?path|local.?path)/i;
const ABSOLUTE_PATH =
  /^(?:[a-zA-Z]:[\\/]|\\\\|\/Users\/|\/home\/|\/tmp\/|file:)/;

export class DesktopSyncRepository {
  constructor(private readonly db: Database.Database) {}

  activateAccount(input: DesktopSyncAccountInput): DesktopSyncAccount {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT device_id FROM cloud_sync_accounts WHERE owner_id = ?")
      .get(input.ownerId) as { device_id: string } | undefined;
    const deviceId = existing?.device_id ?? input.deviceId ?? randomUUID();
    this.db.transaction(() => {
      this.db.prepare("UPDATE cloud_sync_accounts SET active = 0").run();
      this.db
        .prepare(
          `INSERT INTO cloud_sync_accounts
            (owner_id, username, device_id, device_name, platform, client_version,
             active, enabled, created_at, updated_at)
           VALUES (@owner_id, @username, @device_id, @device_name, @platform,
             @client_version, 1, 0, @now, @now)
           ON CONFLICT(owner_id) DO UPDATE SET
             username = excluded.username,
             device_name = excluded.device_name,
             platform = excluded.platform,
             client_version = excluded.client_version,
             active = 1,
             updated_at = excluded.updated_at`,
        )
        .run({
          owner_id: input.ownerId,
          username: input.username,
          device_id: deviceId,
          device_name: input.deviceName,
          platform: input.platform,
          client_version: input.clientVersion,
          now,
        });
    })();
    return this.requireAccount(input.ownerId);
  }

  deactivateAccount(ownerId?: string): void {
    if (ownerId)
      this.db
        .prepare(
          "UPDATE cloud_sync_accounts SET active = 0, updated_at = ? WHERE owner_id = ?",
        )
        .run(Date.now(), ownerId);
    else
      this.db
        .prepare(
          "UPDATE cloud_sync_accounts SET active = 0, updated_at = ? WHERE active = 1",
        )
        .run(Date.now());
  }

  setEnabled(ownerId: string, enabled: boolean): DesktopSyncAccount {
    this.db
      .prepare(
        "UPDATE cloud_sync_accounts SET enabled = ?, last_error = NULL, updated_at = ? WHERE owner_id = ?",
      )
      .run(enabled ? 1 : 0, Date.now(), ownerId);
    return this.requireAccount(ownerId);
  }

  getActiveAccount(): DesktopSyncAccount | null {
    const row = this.db
      .prepare("SELECT * FROM cloud_sync_accounts WHERE active = 1 LIMIT 1")
      .get() as AccountRow | undefined;
    return row ? accountFromRow(row) : null;
  }

  getSummary(): DesktopSyncSummary {
    const account = this.getActiveAccount();
    if (!account)
      return {
        account: null,
        status: "disabled",
        pendingMutations: 0,
        conflicts: 0,
      };
    const pendingMutations = Number(
      (
        this.db
          .prepare(
            `SELECT
               (SELECT count(*) FROM cloud_sync_outbox WHERE owner_id = ?) +
               (SELECT count(*) FROM cloud_sync_usage_outbox WHERE owner_id = ?)
               AS value`,
          )
          .get(account.ownerId, account.ownerId) as { value: number }
      ).value,
    );
    const conflicts = Number(
      (
        this.db
          .prepare(
            "SELECT count(*) AS value FROM cloud_sync_conflicts WHERE owner_id = ? AND resolved_at IS NULL",
          )
          .get(account.ownerId) as { value: number }
      ).value,
    );
    return {
      account,
      status: !account.enabled
        ? "disabled"
        : conflicts > 0
          ? "conflict"
          : account.lastError
            ? "error"
            : "idle",
      pendingMutations,
      conflicts,
    };
  }

  setSyncError(ownerId: string, message: string | null): void {
    this.db
      .prepare(
        "UPDATE cloud_sync_accounts SET last_error = ?, updated_at = ? WHERE owner_id = ?",
      )
      .run(message, Date.now(), ownerId);
  }

  markSyncCompleted(ownerId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE cloud_sync_accounts
         SET last_sync_at = ?, last_error = NULL, updated_at = ? WHERE owner_id = ?`,
      )
      .run(now, now, ownerId);
  }

  markBootstrapCompleted(ownerId: string, cursor: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE cloud_sync_accounts
         SET bootstrap_completed_at = ?, cursor = ?, updated_at = ? WHERE owner_id = ?`,
      )
      .run(now, cursor, now, ownerId);
  }

  resetBootstrap(ownerId: string): void {
    this.db
      .prepare(
        `UPDATE cloud_sync_accounts
         SET cursor = '0', bootstrap_completed_at = NULL, last_error = NULL, updated_at = ?
         WHERE owner_id = ?`,
      )
      .run(Date.now(), ownerId);
  }

  setCursor(ownerId: string, cursor: string): void {
    if (!/^\d+$/.test(cursor)) throw new Error("Invalid cloud sync cursor");
    this.db
      .prepare(
        "UPDATE cloud_sync_accounts SET cursor = ?, updated_at = ? WHERE owner_id = ?",
      )
      .run(cursor, Date.now(), ownerId);
  }

  seedUnsyncedEntities(ownerId: string): number {
    let count = 0;
    this.db.transaction(() => {
      const folders = this.db
        .prepare(
          `SELECT id FROM folders
           ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, sort_order, id`,
        )
        .all() as Array<{ id: string }>;
      const tags = this.db
        .prepare("SELECT id FROM tags ORDER BY id")
        .all() as Array<{ id: string }>;
      const prompts = this.db
        .prepare("SELECT id FROM prompts ORDER BY id")
        .all() as Array<{ id: string }>;
      for (const { id } of folders)
        if (this.enqueue(ownerId, "folder", id, "create")) count += 1;
      for (const { id } of tags)
        if (this.enqueue(ownerId, "tag", id, "create")) count += 1;
      for (const { id } of prompts) {
        const row = this.db
          .prepare("SELECT deleted_at FROM prompts WHERE id = ?")
          .get(id) as { deleted_at: number | null };
        if (
          row.deleted_at === null &&
          this.enqueue(ownerId, "prompt", id, "create")
        )
          count += 1;
      }
    })();
    return count;
  }

  enqueue(
    ownerId: string,
    entityType: SyncEntityType,
    entityId: string,
    requestedOperation: SyncMutationOperation,
  ): boolean {
    const state = this.entityState(ownerId, entityType, entityId);
    if (state?.sync_status === "conflict") return false;
    const existing = this.db
      .prepare(
        `SELECT mutation_id, entity_type, entity_id, operation, base_version, payload_json
         FROM cloud_sync_outbox
         WHERE owner_id = ? AND entity_type = ? AND entity_id = ?
         ORDER BY created_at LIMIT 1`,
      )
      .get(ownerId, entityType, entityId) as OutboxRow | undefined;
    const payload =
      requestedOperation === "delete"
        ? {}
        : localPayload(this.db, entityType, entityId);
    if (!payload && requestedOperation !== "delete") return false;
    const payloadHash = payload ? hashPayload(payload) : null;

    if (
      requestedOperation !== "delete" &&
      state?.cloud_version &&
      state.last_synced_hash === payloadHash
    ) {
      this.clearEntityOutbox(ownerId, entityType, entityId);
      this.markEntityStatus(ownerId, entityType, entityId, "clean");
      return false;
    }

    if (requestedOperation === "delete" && !state?.cloud_version) {
      this.clearEntityOutbox(ownerId, entityType, entityId);
      this.db
        .prepare(
          "DELETE FROM cloud_entity_state WHERE owner_id = ? AND entity_type = ? AND local_id = ?",
        )
        .run(ownerId, entityType, entityId);
      return false;
    }

    let operation = normalizeOperation(
      requestedOperation,
      state?.cloud_version ?? null,
    );
    let baseVersion =
      operation === "create" ? null : (state?.cloud_version ?? null);
    if (existing?.operation === "create" && operation !== "delete") {
      operation = "create";
      baseVersion = null;
    }
    const mutationId = existing?.mutation_id ?? ulid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO cloud_sync_outbox
          (mutation_id, owner_id, entity_type, entity_id, operation, base_version,
           payload_json, created_at, attempt_count, next_attempt_at, last_error)
         VALUES (@mutation_id, @owner_id, @entity_type, @entity_id, @operation,
           @base_version, @payload_json, @created_at, 0, 0, NULL)
         ON CONFLICT(mutation_id) DO UPDATE SET
           operation = excluded.operation,
           base_version = excluded.base_version,
           payload_json = excluded.payload_json,
           attempt_count = 0,
           next_attempt_at = 0,
           last_error = NULL`,
      )
      .run({
        mutation_id: mutationId,
        owner_id: ownerId,
        entity_type: entityType,
        entity_id: entityId,
        operation,
        base_version: baseVersion,
        payload_json: JSON.stringify(payload ?? {}),
        created_at: now,
      });
    this.db
      .prepare(
        `INSERT INTO cloud_entity_state
          (owner_id, entity_type, local_id, cloud_id, cloud_version, sync_status)
         VALUES (?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(owner_id, entity_type, local_id) DO UPDATE SET sync_status = 'pending'`,
      )
      .run(
        ownerId,
        entityType,
        entityId,
        entityId,
        state?.cloud_version ?? null,
      );
    return true;
  }

  listReadyMutations(ownerId: string, limit = 100): SyncMutation[] {
    const rows = this.db
      .prepare(
        `SELECT o.mutation_id, o.entity_type, o.entity_id, o.operation,
           o.base_version, o.payload_json
         FROM cloud_sync_outbox o
         JOIN cloud_entity_state s
           ON s.owner_id = o.owner_id
          AND s.entity_type = o.entity_type
          AND s.local_id = o.entity_id
         WHERE o.owner_id = ? AND o.next_attempt_at <= ? AND s.sync_status = 'pending'
         ORDER BY
           CASE
             WHEN o.entity_type = 'folder' AND json_extract(o.payload_json, '$.parentId') IS NULL THEN 0
             WHEN o.entity_type = 'folder' THEN 1
             WHEN o.entity_type = 'tag' THEN 2
             ELSE 3
           END,
           o.created_at, o.mutation_id
         LIMIT ?`,
      )
      .all(
        ownerId,
        Date.now(),
        Math.max(1, Math.min(limit, 100)),
      ) as OutboxRow[];
    return rows.map((row) => ({
      mutationId: row.mutation_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      baseVersion: row.base_version,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }

  enqueueUsageEvent(
    ownerId: string,
    promptId: string,
    action: SyncUsageAction,
  ): string {
    const eventId = ulid();
    this.db
      .prepare(
        `INSERT INTO cloud_sync_usage_outbox
          (event_id, owner_id, prompt_id, action, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(eventId, ownerId, promptId, action, Date.now());
    return eventId;
  }

  listReadyUsageEvents(ownerId: string, limit = 100): SyncUsageEvent[] {
    const rows = this.db
      .prepare(
        `SELECT event_id, prompt_id, action
         FROM cloud_sync_usage_outbox
         WHERE owner_id = ? AND next_attempt_at <= ?
         ORDER BY created_at, event_id LIMIT ?`,
      )
      .all(ownerId, Date.now(), Math.max(1, Math.min(limit, 100))) as UsageOutboxRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      promptId: row.prompt_id,
      action: row.action,
    }));
  }

  markUsageEventAttempt(ownerId: string, eventId: string, error: string): void {
    const row = this.db
      .prepare(
        "SELECT attempt_count FROM cloud_sync_usage_outbox WHERE owner_id = ? AND event_id = ?",
      )
      .get(ownerId, eventId) as { attempt_count: number } | undefined;
    if (!row) return;
    const attempts = row.attempt_count + 1;
    const delay = Math.min(300_000, 2 ** Math.min(attempts, 8) * 1_000);
    this.db
      .prepare(
        `UPDATE cloud_sync_usage_outbox
         SET attempt_count = ?, next_attempt_at = ?, last_error = ?
         WHERE owner_id = ? AND event_id = ?`,
      )
      .run(attempts, Date.now() + delay, error.slice(0, 500), ownerId, eventId);
  }

  applyUsagePushBatch(
    ownerId: string,
    events: SyncUsageEvent[],
    results: SyncUsageEventResult[],
  ): void {
    const byId = new Map(results.map((result) => [result.eventId, result]));
    this.db.transaction(() => {
      for (const event of events) {
        const result = byId.get(event.eventId);
        if (!result) continue;
        if (result.status === "applied" || result.status === "duplicate") {
          this.db
            .prepare(
              "DELETE FROM cloud_sync_usage_outbox WHERE owner_id = ? AND event_id = ?",
            )
            .run(ownerId, event.eventId);
        } else {
          this.db
            .prepare(
              `UPDATE cloud_sync_usage_outbox
               SET next_attempt_at = 0, last_error = ?
               WHERE owner_id = ? AND event_id = ?`,
            )
            .run(result.errorCode ?? "SYNC_USAGE_REJECTED", ownerId, event.eventId);
        }
      }
    })();
  }

  markMutationAttempt(
    ownerId: string,
    mutationId: string,
    error: string,
  ): void {
    const row = this.db
      .prepare(
        "SELECT attempt_count FROM cloud_sync_outbox WHERE owner_id = ? AND mutation_id = ?",
      )
      .get(ownerId, mutationId) as { attempt_count: number } | undefined;
    if (!row) return;
    const attempts = row.attempt_count + 1;
    const exponential = 2 ** Math.min(attempts, 8) * 1_000;
    const delay = Math.min(
      300_000,
      Math.round(exponential * (0.75 + Math.random() * 0.5)),
    );
    this.db
      .prepare(
        `UPDATE cloud_sync_outbox SET attempt_count = ?, next_attempt_at = ?, last_error = ?
         WHERE owner_id = ? AND mutation_id = ?`,
      )
      .run(
        attempts,
        Date.now() + delay,
        error.slice(0, 500),
        ownerId,
        mutationId,
      );
  }

  applyPushResult(
    ownerId: string,
    mutation: SyncMutation,
    result: SyncMutationResult,
  ): void {
    this.db.transaction(() => {
      if (
        (result.status === "applied" || result.status === "duplicate") &&
        result.snapshot
      ) {
        this.applySnapshot(ownerId, mutation.entityType, result.snapshot);
        this.db
          .prepare(
            "DELETE FROM cloud_sync_outbox WHERE owner_id = ? AND mutation_id = ?",
          )
          .run(ownerId, mutation.mutationId);
        return;
      }
      if (result.status === "conflict" && result.snapshot) {
        this.recordConflict(ownerId, mutation, result.snapshot);
        return;
      }
      this.db
        .prepare(
          `UPDATE cloud_sync_outbox SET last_error = ?, next_attempt_at = 0
           WHERE owner_id = ? AND mutation_id = ?`,
        )
        .run(
          result.errorCode ?? "SYNC_MUTATION_REJECTED",
          ownerId,
          mutation.mutationId,
        );
      this.markEntityStatus(
        ownerId,
        mutation.entityType,
        mutation.entityId,
        "error",
      );
    })();
  }

  applyBootstrapSnapshot(
    ownerId: string,
    entityType: SyncEntityType,
    snapshot: SyncSnapshot,
  ): void {
    this.applyRemoteChange(ownerId, {
      seq: "0",
      entityType,
      entityId: snapshot.id,
      operation: snapshot.deletedAt ? "delete" : "upsert",
      version: snapshot.version,
      snapshot,
    });
  }

  applyBootstrapPage(
    ownerId: string,
    entityType: SyncEntityType,
    snapshots: SyncSnapshot[],
  ): void {
    this.db.transaction(() => {
      for (const snapshot of snapshots)
        this.applyBootstrapSnapshot(ownerId, entityType, snapshot);
    })();
  }

  applyPullPage(
    ownerId: string,
    changes: SyncChange[],
    nextCursor: string,
  ): void {
    this.db.transaction(() => {
      for (const change of changes) this.applyRemoteChange(ownerId, change);
      this.setCursor(ownerId, nextCursor);
    })();
  }

  applyPushBatch(
    ownerId: string,
    mutations: SyncMutation[],
    results: SyncMutationResult[],
  ): void {
    const byMutationId = new Map(
      results.map((result) => [result.mutationId, result]),
    );
    this.db.transaction(() => {
      for (const mutation of mutations) {
        const result = byMutationId.get(mutation.mutationId);
        if (!result)
          throw new Error(`Missing sync result for ${mutation.mutationId}`);
        this.applyPushResult(ownerId, mutation, result);
      }
    })();
  }

  applyRemoteChange(ownerId: string, change: SyncChange): void {
    const state = this.entityState(ownerId, change.entityType, change.entityId);
    if (state?.cloud_version && change.version <= state.cloud_version) return;
    const local = localPayload(this.db, change.entityType, change.entityId);
    if (state?.sync_status === "pending" || state?.sync_status === "conflict") {
      const mutation = this.db
        .prepare(
          `SELECT mutation_id, entity_type, entity_id, operation, base_version, payload_json
           FROM cloud_sync_outbox
           WHERE owner_id = ? AND entity_type = ? AND entity_id = ?
           ORDER BY created_at LIMIT 1`,
        )
        .get(ownerId, change.entityType, change.entityId) as
        OutboxRow | undefined;
      if (mutation) {
        this.recordConflict(
          ownerId,
          {
            mutationId: mutation.mutation_id,
            entityType: mutation.entity_type,
            entityId: mutation.entity_id,
            operation: mutation.operation,
            baseVersion: mutation.base_version,
            payload: JSON.parse(mutation.payload_json) as Record<
              string,
              unknown
            >,
          },
          change.snapshot,
        );
        return;
      }
    }
    if (
      !state &&
      local &&
      hashPayload(local) !== hashSnapshot(change.entityType, change.snapshot)
    ) {
      this.recordConflict(
        ownerId,
        {
          mutationId: ulid(),
          entityType: change.entityType,
          entityId: change.entityId,
          operation: "create",
          baseVersion: null,
          payload: local,
        },
        change.snapshot,
      );
      return;
    }
    this.applySnapshot(ownerId, change.entityType, change.snapshot);
  }

  listConflicts(ownerId: string): DesktopSyncConflict[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM cloud_sync_conflicts
         WHERE owner_id = ? AND resolved_at IS NULL ORDER BY detected_at DESC`,
      )
      .all(ownerId) as ConflictRow[];
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      mutationId: row.mutation_id,
      baseVersion: row.base_version,
      localSnapshot: JSON.parse(row.local_snapshot_json) as Record<
        string,
        unknown
      >,
      remoteSnapshot: JSON.parse(row.remote_snapshot_json) as SyncSnapshot,
      detectedAt: row.detected_at,
    }));
  }

  resolveConflict(
    ownerId: string,
    conflictId: string,
    resolution: "remote" | "local" | "duplicate",
  ): void {
    this.db.transaction(() => {
      const conflict = this.db
        .prepare(
          `SELECT * FROM cloud_sync_conflicts
           WHERE id = ? AND owner_id = ? AND resolved_at IS NULL`,
        )
        .get(conflictId, ownerId) as ConflictRow | undefined;
      if (!conflict) throw new Error("Cloud sync conflict not found");
      const localSnapshot = JSON.parse(conflict.local_snapshot_json) as Record<
        string,
        unknown
      >;
      const remoteSnapshot = JSON.parse(
        conflict.remote_snapshot_json,
      ) as SyncSnapshot;
      this.db
        .prepare(
          `DELETE FROM cloud_sync_outbox
           WHERE owner_id = ? AND entity_type = ? AND entity_id = ?`,
        )
        .run(ownerId, conflict.entity_type, conflict.entity_id);
      this.applySnapshot(ownerId, conflict.entity_type, remoteSnapshot);

      if (resolution === "local") {
        applyLocalPayload(
          this.db,
          conflict.entity_type,
          conflict.entity_id,
          localSnapshot,
        );
        this.enqueue(
          ownerId,
          conflict.entity_type,
          conflict.entity_id,
          remoteSnapshot.deletedAt ? "restore" : "update",
        );
      } else if (resolution === "duplicate") {
        if (conflict.entity_type !== "prompt")
          throw new Error("Only prompt conflicts can be duplicated");
        const duplicateId = ulid();
        applyLocalPayload(this.db, "prompt", duplicateId, {
          ...localSnapshot,
          title: `${String(localSnapshot.title ?? "未命名")}（本地副本）`,
        });
        this.enqueue(ownerId, "prompt", duplicateId, "create");
      }

      this.db
        .prepare(
          `UPDATE cloud_sync_conflicts
           SET resolved_at = ?, resolution = ? WHERE id = ? AND owner_id = ?`,
        )
        .run(Date.now(), resolution, conflictId, ownerId);
      if (resolution === "remote")
        this.markEntityStatus(
          ownerId,
          conflict.entity_type,
          conflict.entity_id,
          "clean",
        );
    })();
  }

  private applySnapshot(
    ownerId: string,
    entityType: SyncEntityType,
    snapshot: SyncSnapshot,
  ): void {
    applyCloudSnapshot(this.db, ownerId, entityType, snapshot);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO cloud_entity_state
          (owner_id, entity_type, local_id, cloud_id, cloud_version,
           last_synced_hash, remote_snapshot_json, sync_status, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'clean', ?)
         ON CONFLICT(owner_id, entity_type, local_id) DO UPDATE SET
           cloud_id = excluded.cloud_id,
           cloud_version = excluded.cloud_version,
           last_synced_hash = excluded.last_synced_hash,
           remote_snapshot_json = excluded.remote_snapshot_json,
           sync_status = 'clean',
           last_synced_at = excluded.last_synced_at`,
      )
      .run(
        ownerId,
        entityType,
        snapshot.id,
        snapshot.id,
        snapshot.version,
        hashSnapshot(entityType, snapshot),
        JSON.stringify(snapshot),
        now,
      );
  }

  private recordConflict(
    ownerId: string,
    mutation: SyncMutation,
    remote: SyncSnapshot,
  ): void {
    this.db
      .prepare(
        `INSERT INTO cloud_sync_conflicts
          (id, owner_id, entity_type, entity_id, mutation_id, base_version,
           local_snapshot_json, remote_snapshot_json, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, entity_type, entity_id) WHERE resolved_at IS NULL
         DO UPDATE SET
           mutation_id = excluded.mutation_id,
           base_version = excluded.base_version,
           local_snapshot_json = excluded.local_snapshot_json,
           remote_snapshot_json = excluded.remote_snapshot_json,
           detected_at = excluded.detected_at`,
      )
      .run(
        ulid(),
        ownerId,
        mutation.entityType,
        mutation.entityId,
        mutation.mutationId,
        mutation.baseVersion,
        JSON.stringify(mutation.payload),
        JSON.stringify(remote),
        Date.now(),
      );
    this.db
      .prepare(
        `INSERT INTO cloud_entity_state
          (owner_id, entity_type, local_id, cloud_id, cloud_version,
           last_synced_hash, remote_snapshot_json, sync_status, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'conflict', ?)
         ON CONFLICT(owner_id, entity_type, local_id) DO UPDATE SET
           cloud_id = excluded.cloud_id,
           cloud_version = excluded.cloud_version,
           last_synced_hash = excluded.last_synced_hash,
           remote_snapshot_json = excluded.remote_snapshot_json,
           sync_status = 'conflict',
           last_synced_at = excluded.last_synced_at`,
      )
      .run(
        ownerId,
        mutation.entityType,
        mutation.entityId,
        remote.id,
        remote.version,
        hashSnapshot(mutation.entityType, remote),
        JSON.stringify(remote),
        Date.now(),
      );
  }

  private entityState(
    ownerId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): EntityStateRow | null {
    return (
      (this.db
        .prepare(
          `SELECT cloud_version, last_synced_hash, sync_status
           FROM cloud_entity_state
           WHERE owner_id = ? AND entity_type = ? AND local_id = ?`,
        )
        .get(ownerId, entityType, entityId) as EntityStateRow | undefined) ??
      null
    );
  }

  private markEntityStatus(
    ownerId: string,
    entityType: SyncEntityType,
    entityId: string,
    status: EntityStateRow["sync_status"],
  ): void {
    this.db
      .prepare(
        `UPDATE cloud_entity_state SET sync_status = ?
         WHERE owner_id = ? AND entity_type = ? AND local_id = ?`,
      )
      .run(status, ownerId, entityType, entityId);
  }

  private clearEntityOutbox(
    ownerId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): void {
    this.db
      .prepare(
        "DELETE FROM cloud_sync_outbox WHERE owner_id = ? AND entity_type = ? AND entity_id = ?",
      )
      .run(ownerId, entityType, entityId);
  }

  private requireAccount(ownerId: string): DesktopSyncAccount {
    const row = this.db
      .prepare("SELECT * FROM cloud_sync_accounts WHERE owner_id = ?")
      .get(ownerId) as AccountRow | undefined;
    if (!row) throw new Error("Cloud sync account not found");
    return accountFromRow(row);
  }
}

export function enqueueActiveAccountMutation(
  db: Database.Database,
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncMutationOperation,
): boolean {
  const syncTablesReady = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cloud_sync_accounts'",
    )
    .get();
  if (!syncTablesReady) return false;
  const account = db
    .prepare(
      "SELECT owner_id FROM cloud_sync_accounts WHERE active = 1 LIMIT 1",
    )
    .get() as { owner_id: string } | undefined;
  if (!account) return false;
  return new DesktopSyncRepository(db).enqueue(
    account.owner_id,
    entityType,
    entityId,
    operation,
  );
}

export function enqueueActiveAccountUsageEvent(
  db: Database.Database,
  promptId: string,
  action: SyncUsageAction = "apply",
): string | null {
  const syncTablesReady = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cloud_sync_usage_outbox'",
    )
    .get();
  if (!syncTablesReady) return null;
  const account = db
    .prepare(
      "SELECT owner_id FROM cloud_sync_accounts WHERE active = 1 LIMIT 1",
    )
    .get() as { owner_id: string } | undefined;
  if (!account) return null;
  return new DesktopSyncRepository(db).enqueueUsageEvent(
    account.owner_id,
    promptId,
    action,
  );
}

function accountFromRow(row: AccountRow): DesktopSyncAccount {
  return {
    ownerId: row.owner_id,
    username: row.username,
    deviceId: row.device_id,
    deviceName: row.device_name,
    platform: row.platform,
    clientVersion: row.client_version,
    enabled: Boolean(row.enabled),
    cursor: row.cursor,
    bootstrapCompletedAt: row.bootstrap_completed_at,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
  };
}

function normalizeOperation(
  operation: SyncMutationOperation,
  cloudVersion: number | null,
): SyncMutationOperation {
  if (!cloudVersion) return operation === "delete" ? "delete" : "create";
  if (operation === "create") return "update";
  return operation;
}

function localPayload(
  db: Database.Database,
  entityType: SyncEntityType,
  entityId: string,
): Record<string, unknown> | null {
  if (entityType === "prompt") {
    const row = db
      .prepare("SELECT * FROM prompts WHERE id = ?")
      .get(entityId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const tagIds = (
      db
        .prepare(
          "SELECT tag_id FROM prompt_tags WHERE prompt_id = ? ORDER BY tag_id",
        )
        .all(entityId) as Array<{ tag_id: string }>
    ).map((item) => item.tag_id);
    return {
      title: String(row.title ?? "").trim(),
      description: nullableText(row.description),
      content: String(row.content ?? "").trim(),
      negative: nullableText(row.content_negative),
      folderId: typeof row.folder_id === "string" ? row.folder_id : null,
      tagIds,
      modelId: nullableText(row.model_id),
      params: sanitizeCloudJson(parseJson(row.params)),
      rating: Number(row.rating ?? 0),
      isPinned: Boolean(row.is_pinned),
      pinOrder: typeof row.pin_order === "number" ? row.pin_order : null,
      source: normalizeSource(row.source),
      sourceUrl: normalizeSourceUrl(row.source_url),
    };
  }
  if (entityType === "folder") {
    const row = db
      .prepare("SELECT * FROM folders WHERE id = ?")
      .get(entityId) as Record<string, unknown> | undefined;
    return row
      ? {
          name: String(row.name ?? "").trim(),
          parentId: typeof row.parent_id === "string" ? row.parent_id : null,
          sortOrder: Number(row.sort_order ?? 0),
        }
      : null;
  }
  const row = db.prepare("SELECT * FROM tags WHERE id = ?").get(entityId) as
    Record<string, unknown> | undefined;
  return row
    ? {
        name: String(row.name ?? "").trim(),
        group: nullableText(row.tag_group),
        color: normalizeColor(row.color),
      }
    : null;
}

function cloudPayload(
  entityType: SyncEntityType,
  snapshot: SyncSnapshot,
): Record<string, unknown> {
  if (entityType === "prompt") {
    const prompt = snapshot as PromptDocument;
    return {
      title: prompt.title,
      description: prompt.description,
      content: prompt.content,
      negative: prompt.negative,
      folderId: prompt.folderId,
      tagIds: prompt.tags.map((tag) => tag.id).sort(),
      modelId: prompt.modelId,
      params: sanitizeCloudJson(prompt.params),
      rating: prompt.rating,
      isPinned: prompt.isPinned,
      pinOrder: prompt.pinOrder,
      source: prompt.source,
      sourceUrl: prompt.sourceUrl,
    };
  }
  if (entityType === "folder") {
    const folder = snapshot as PromptFolder;
    return {
      name: folder.name,
      parentId: folder.parentId,
      sortOrder: folder.sortOrder,
    };
  }
  const tag = snapshot as PromptTag;
  return { name: tag.name, group: tag.group, color: tag.color };
}

function applyCloudSnapshot(
  db: Database.Database,
  ownerId: string,
  entityType: SyncEntityType,
  snapshot: SyncSnapshot,
): void {
  if (snapshot.deletedAt) {
    if (entityType === "prompt") {
      db.prepare(
        "UPDATE prompts SET deleted_at = ?, updated_at = ? WHERE id = ?",
      ).run(
        Date.parse(snapshot.deletedAt),
        Date.parse(snapshot.updatedAt),
        snapshot.id,
      );
    } else if (entityType === "folder") {
      db.prepare("UPDATE folders SET parent_id = NULL WHERE parent_id = ?").run(
        snapshot.id,
      );
      db.prepare("DELETE FROM folders WHERE id = ?").run(snapshot.id);
    } else {
      const affectedPromptIds = (
        db
          .prepare("SELECT prompt_id AS id FROM prompt_tags WHERE tag_id = ?")
          .all(snapshot.id) as Array<{ id: string }>
      ).map((row) => row.id);
      db.prepare("DELETE FROM tags WHERE id = ?").run(snapshot.id);
      for (const promptId of affectedPromptIds) syncPromptFts(db, promptId);
    }
    return;
  }
  applyLocalPayload(
    db,
    entityType,
    snapshot.id,
    cloudPayload(entityType, snapshot),
    snapshot,
  );
  restoreCloudRelations(db, ownerId, entityType, snapshot.id);
}

function applyLocalPayload(
  db: Database.Database,
  entityType: SyncEntityType,
  entityId: string,
  payload: Record<string, unknown>,
  snapshot?: SyncSnapshot,
): void {
  const now = Date.now();
  if (entityType === "folder") {
    const requestedParentId =
      typeof payload.parentId === "string" ? payload.parentId : null;
    const parentId =
      requestedParentId &&
      db.prepare("SELECT 1 FROM folders WHERE id = ?").get(requestedParentId)
        ? requestedParentId
        : null;
    db.prepare(
      `INSERT INTO folders(id, name, parent_id, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         parent_id = excluded.parent_id,
         sort_order = excluded.sort_order`,
    ).run(
      entityId,
      String(payload.name ?? ""),
      parentId,
      Number(payload.sortOrder ?? 0),
      snapshot ? Date.parse(snapshot.createdAt) : now,
    );
    return;
  }
  if (entityType === "tag") {
    const affectedPromptIds = (
      db
        .prepare("SELECT prompt_id AS id FROM prompt_tags WHERE tag_id = ?")
        .all(entityId) as Array<{ id: string }>
    ).map((row) => row.id);
    db.prepare(
      `INSERT INTO tags(id, name, tag_group, color, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         tag_group = excluded.tag_group,
         color = excluded.color`,
    ).run(
      entityId,
      String(payload.name ?? ""),
      typeof payload.group === "string" ? payload.group : null,
      normalizeColor(payload.color),
      snapshot ? Date.parse(snapshot.createdAt) : now,
    );
    for (const promptId of affectedPromptIds) syncPromptFts(db, promptId);
    return;
  }
  const promptSnapshot = snapshot as PromptDocument | undefined;
  const source = normalizeSource(payload.source);
  const requestedFolderId =
    typeof payload.folderId === "string" ? payload.folderId : null;
  const folderId =
    requestedFolderId &&
    db.prepare("SELECT 1 FROM folders WHERE id = ?").get(requestedFolderId)
      ? requestedFolderId
      : null;
  db.prepare(
    `INSERT INTO prompts(
      id, title, description, content, content_negative, folder_id, model_id,
      params, rating, is_pinned, pin_order, usage_count, last_used_at,
      source, source_url, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      content = excluded.content,
      content_negative = excluded.content_negative,
      folder_id = excluded.folder_id,
      model_id = excluded.model_id,
      params = excluded.params,
      rating = excluded.rating,
      is_pinned = excluded.is_pinned,
      pin_order = excluded.pin_order,
      usage_count = excluded.usage_count,
      source = excluded.source,
      source_url = excluded.source_url,
      updated_at = excluded.updated_at,
      deleted_at = NULL`,
  ).run(
    entityId,
    String(payload.title ?? ""),
    nullableText(payload.description),
    String(payload.content ?? ""),
    nullableText(payload.negative),
    folderId,
    nullableText(payload.modelId),
    payload.params ? JSON.stringify(sanitizeCloudJson(payload.params)) : null,
    Number(payload.rating ?? 0),
    payload.isPinned ? 1 : 0,
    typeof payload.pinOrder === "number" ? payload.pinOrder : null,
    promptSnapshot?.usageCount ?? 0,
    promptSnapshot?.lastUsedAt ? Date.parse(promptSnapshot.lastUsedAt) : null,
    source === "share" ? "shared" : source,
    normalizeSourceUrl(payload.sourceUrl),
    promptSnapshot ? Date.parse(promptSnapshot.createdAt) : now,
    promptSnapshot ? Date.parse(promptSnapshot.updatedAt) : now,
  );
  const tagIds = Array.isArray(payload.tagIds)
    ? payload.tagIds.filter((id): id is string => typeof id === "string")
    : [];
  db.prepare("DELETE FROM prompt_tags WHERE prompt_id = ?").run(entityId);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO prompt_tags(prompt_id, tag_id) VALUES (?, ?)",
  );
  for (const tagId of tagIds) insert.run(entityId, tagId);
  syncPromptFts(db, entityId);
}

function restoreCloudRelations(
  db: Database.Database,
  ownerId: string,
  entityType: SyncEntityType,
  entityId: string,
): void {
  if (entityType === "folder") {
    const childFolders = db
      .prepare(
        `SELECT local_id FROM cloud_entity_state
         WHERE owner_id = ? AND entity_type = 'folder'
           AND json_extract(remote_snapshot_json, '$.parentId') = ?`,
      )
      .all(ownerId, entityId) as Array<{ local_id: string }>;
    const reparent = db.prepare(
      "UPDATE folders SET parent_id = ? WHERE id = ?",
    );
    for (const child of childFolders) reparent.run(entityId, child.local_id);

    const prompts = db
      .prepare(
        `SELECT local_id FROM cloud_entity_state
         WHERE owner_id = ? AND entity_type = 'prompt'
           AND json_extract(remote_snapshot_json, '$.folderId') = ?`,
      )
      .all(ownerId, entityId) as Array<{ local_id: string }>;
    const movePrompt = db.prepare(
      "UPDATE prompts SET folder_id = ? WHERE id = ?",
    );
    for (const prompt of prompts) movePrompt.run(entityId, prompt.local_id);
    return;
  }
  if (entityType !== "tag") return;
  const prompts = db
    .prepare(
      `SELECT DISTINCT state.local_id
       FROM cloud_entity_state state,
         json_each(state.remote_snapshot_json, '$.tags') AS tag
       WHERE state.owner_id = ? AND state.entity_type = 'prompt'
         AND json_extract(tag.value, '$.id') = ?`,
    )
    .all(ownerId, entityId) as Array<{ local_id: string }>;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO prompt_tags(prompt_id, tag_id) VALUES (?, ?)",
  );
  for (const prompt of prompts) {
    insert.run(prompt.local_id, entityId);
    syncPromptFts(db, prompt.local_id);
  }
}

function syncPromptFts(db: Database.Database, id: string): void {
  const row = db
    .prepare(
      "SELECT rowid, title, description, content FROM prompts WHERE id = ?",
    )
    .get(id) as
    | {
        rowid: number;
        title: string;
        description: string | null;
        content: string;
      }
    | undefined;
  if (!row) return;
  const tags = (
    db
      .prepare(
        `SELECT t.name FROM tags t JOIN prompt_tags pt ON pt.tag_id = t.id
         WHERE pt.prompt_id = ?`,
      )
      .all(id) as Array<{ name: string }>
  ).map((item) => item.name);
  db.prepare("DELETE FROM prompts_fts WHERE rowid = ?").run(row.rowid);
  db.prepare(
    `INSERT INTO prompts_fts(rowid, title, description, content, tags_index)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    row.rowid,
    row.title,
    row.description ?? "",
    row.content,
    tokenizeForFts(row.title, row.description, row.content, tags),
  );
}

function hashSnapshot(
  entityType: SyncEntityType,
  snapshot: SyncSnapshot,
): string {
  return hashPayload(cloudPayload(entityType, snapshot));
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sanitizeCloudJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string")
    return ABSOLUTE_PATH.test(value) ? null : value;
  if (Array.isArray(value))
    return value.map((item) => sanitizeCloudJson(item, depth + 1));
  if (!value || typeof value !== "object") return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = sanitizeCloudJson(item, depth + 1);
  }
  return result;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSource(value: unknown): PromptDocument["source"] {
  if (value === "shared" || value === "share") return "share";
  if (value === "import" || value === "slip" || value === "generation")
    return value;
  return "manual";
}

function normalizeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : null;
}
