import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type {
  DesktopSyncConsent,
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
} from '@musefold/contracts';
import { tokenizeForFts } from '../db/fts';
import { accountWorkspaceId, resolveAccountWorkspace } from '../db/workspaces';

export type DesktopSyncStatus = 'disabled' | 'idle' | 'syncing' | 'conflict' | 'error';

export interface DesktopSyncAccountInput {
  ownerId: string;
  username: string;
  deviceId?: string;
  deviceName: string;
  platform: 'macos' | 'windows' | 'linux';
  clientVersion: string;
}

export interface DesktopSyncAccount {
  ownerId: string;
  username: string;
  deviceId: string;
  deviceName: string;
  platform: 'macos' | 'windows' | 'linux';
  clientVersion: string;
  consent: DesktopSyncConsent;
  consentDecidedAt: number | null;
  consentVersion: number;
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
  workspaceId: string;
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
  platform: DesktopSyncAccount['platform'];
  client_version: string;
  enabled: number;
  consent_state?: string | null;
  consent_decided_at?: number | null;
  consent_version?: number | null;
  cursor: string;
  bootstrap_completed_at: number | null;
  last_sync_at: number | null;
  last_error: string | null;
}

interface EntityStateRow {
  workspace_id: string;
  cloud_version: number | null;
  last_synced_hash: string | null;
  sync_status: 'clean' | 'pending' | 'conflict' | 'error';
}

interface OutboxRow {
  mutation_id: string;
  workspace_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncMutationOperation;
  base_version: number | null;
  payload_json: string;
  last_error?: string | null;
}

interface UsageOutboxRow {
  event_id: string;
  workspace_id: string;
  prompt_id: string;
  action: SyncUsageAction;
}

interface ConflictRow {
  id: string;
  owner_id: string;
  workspace_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  mutation_id: string;
  base_version: number | null;
  local_snapshot_json: string;
  remote_snapshot_json: string;
  detected_at: number;
}

const SENSITIVE_KEYS = new Set([
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'idtoken',
  'bearertoken',
  'secret',
  'credential',
  'password',
  'passwd',
  'filepath',
  'imagepath',
  'localpath',
  'ownerid',
  'workspaceid',
  'authorization',
  'bearer',
  'privatekey',
  'signingkey',
]);
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|file:)/;

/**
 * 服务端在「同一 mutationId 携带不同 payload」时返回的拒绝码。该 id 已被首次
 * 请求占用,任何 payload 都不能再以它确认成功;本地必须保留 outbox 并换新 id 重发。
 * 与 apps/api SyncService 的字面值保持一致(错误码不在 contracts 中建模)。
 */
const SYNC_MUTATION_PAYLOAD_MISMATCH = 'SYNC_MUTATION_PAYLOAD_MISMATCH';

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) return true;
  if (normalized.includes('secret') || normalized.includes('credential')) return true;
  if (normalized.includes('password') || normalized.includes('passwd')) return true;
  if (normalized.includes('token') && !normalized.endsWith('tokens')) return true;
  if (normalized.startsWith('api') && normalized.includes('key')) return true;
  return (
    normalized.endsWith('path') &&
    ['file', 'image', 'local', 'absolute', 'managed', 'asset', 'reference', 'thumbnail'].some(
      (prefix) => normalized.startsWith(prefix),
    )
  );
}
export class DesktopSyncRepository {
  constructor(private readonly db: Database.Database) {}

  activateAccount(input: DesktopSyncAccountInput, disableOnActivate = false): DesktopSyncAccount {
    // Kept for the old host signature; activation must never mutate durable sync state.
    void disableOnActivate;
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT device_id FROM cloud_sync_accounts WHERE owner_id = ?')
      .get(input.ownerId) as { device_id: string } | undefined;
    const deviceId = existing?.device_id ?? input.deviceId ?? randomUUID();
    this.db.transaction(() => {
      this.db.prepare('UPDATE cloud_sync_accounts SET active = 0').run();
      if (hasConsentColumns(this.db)) {
        this.db
          .prepare(
            `INSERT INTO cloud_sync_accounts
              (owner_id, username, device_id, device_name, platform, client_version,
               active, enabled, consent_state, consent_decided_at, consent_version,
               created_at, updated_at)
             VALUES (@owner_id, @username, @device_id, @device_name, @platform,
               @client_version, 1, 0, 'unset', NULL, 1, @now, @now)
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
      } else {
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
      }
    })();
    return this.requireAccount(input.ownerId);
  }

  deactivateAccount(ownerId?: string): void {
    if (ownerId)
      this.db.prepare('UPDATE cloud_sync_accounts SET active = 0 WHERE owner_id = ?').run(ownerId);
    else this.db.prepare('UPDATE cloud_sync_accounts SET active = 0 WHERE active = 1').run();
  }

  setConsent(ownerId: string, consent: DesktopSyncConsent): DesktopSyncAccount {
    const now = Date.now();
    if (hasConsentColumns(this.db)) {
      this.db
        .prepare(
          `UPDATE cloud_sync_accounts
           SET consent_state = ?, consent_decided_at = ?, consent_version = COALESCE(consent_version, 1),
               enabled = ?, last_error = CASE WHEN ? = 'enabled' THEN NULL ELSE last_error END,
               updated_at = ?
           WHERE owner_id = ?`,
        )
        .run(
          consent,
          consent === 'unset' ? null : now,
          consent === 'enabled' ? 1 : 0,
          consent,
          now,
          ownerId,
        );
    } else {
      this.db
        .prepare(
          `UPDATE cloud_sync_accounts
           SET enabled = ?, last_error = CASE WHEN ? = 1 THEN NULL ELSE last_error END,
               updated_at = ? WHERE owner_id = ?`,
        )
        .run(consent === 'enabled' ? 1 : 0, consent === 'enabled' ? 1 : 0, now, ownerId);
    }
    return this.requireAccount(ownerId);
  }

  setEnabled(ownerId: string, enabled: boolean): DesktopSyncAccount {
    return this.setConsent(ownerId, enabled ? 'enabled' : 'paused');
  }

  getActiveAccount(): DesktopSyncAccount | null {
    const row = this.db
      .prepare('SELECT * FROM cloud_sync_accounts WHERE active = 1 LIMIT 1')
      .get() as AccountRow | undefined;
    return row ? accountFromRow(row) : null;
  }

  getAccountWorkspace(ownerId: string): string | null {
    return resolveAccountWorkspace(this.db, ownerId);
  }

  getSummary(): DesktopSyncSummary {
    const account = this.getActiveAccount();
    if (!account)
      return {
        account: null,
        status: 'disabled',
        pendingMutations: 0,
        conflicts: 0,
      };
    const workspaceId = resolveAccountWorkspace(this.db, account.ownerId);
    if (!workspaceId) {
      return {
        account,
        status: !account.enabled ? 'disabled' : account.lastError ? 'error' : 'idle',
        pendingMutations: 0,
        conflicts: 0,
      };
    }
    const pendingMutations = Number(
      (
        this.db
          .prepare(
            `SELECT
               (SELECT count(*) FROM cloud_sync_outbox WHERE owner_id = ? AND workspace_id = ?) +
               (SELECT count(*) FROM cloud_sync_usage_outbox WHERE owner_id = ? AND workspace_id = ?)
               AS value`,
          )
          .get(account.ownerId, workspaceId, account.ownerId, workspaceId) as { value: number }
      ).value,
    );
    const conflicts = Number(
      (
        this.db
          .prepare(
            'SELECT count(*) AS value FROM cloud_sync_conflicts WHERE owner_id = ? AND workspace_id = ? AND resolved_at IS NULL',
          )
          .get(account.ownerId, workspaceId) as { value: number }
      ).value,
    );
    return {
      account,
      status: !account.enabled
        ? 'disabled'
        : conflicts > 0
          ? 'conflict'
          : account.lastError
            ? 'error'
            : 'idle',
      pendingMutations,
      conflicts,
    };
  }

  setSyncError(ownerId: string, message: string | null): void {
    assertOwnerAccountWorkspace(this.db, ownerId);
    this.db
      .prepare('UPDATE cloud_sync_accounts SET last_error = ?, updated_at = ? WHERE owner_id = ?')
      .run(message, Date.now(), ownerId);
  }

  markSyncCompleted(ownerId: string): void {
    assertOwnerAccountWorkspace(this.db, ownerId);
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE cloud_sync_accounts
         SET last_sync_at = ?, last_error = NULL, updated_at = ? WHERE owner_id = ?`,
      )
      .run(now, now, ownerId);
  }

  markBootstrapCompleted(ownerId: string, cursor: string): void {
    assertOwnerAccountWorkspace(this.db, ownerId);
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE cloud_sync_accounts
         SET bootstrap_completed_at = ?, cursor = ?, updated_at = ? WHERE owner_id = ?`,
      )
      .run(now, cursor, now, ownerId);
  }

  resetBootstrap(ownerId: string): void {
    assertOwnerAccountWorkspace(this.db, ownerId);
    this.db
      .prepare(
        `UPDATE cloud_sync_accounts
         SET cursor = '0', bootstrap_completed_at = NULL, last_error = NULL, updated_at = ?
         WHERE owner_id = ?`,
      )
      .run(Date.now(), ownerId);
  }

  setCursor(ownerId: string, cursor: string): void {
    assertOwnerAccountWorkspace(this.db, ownerId);
    if (!/^\d+$/.test(cursor)) throw new Error('Invalid cloud sync cursor');
    this.db
      .prepare('UPDATE cloud_sync_accounts SET cursor = ?, updated_at = ? WHERE owner_id = ?')
      .run(cursor, Date.now(), ownerId);
  }

  seedUnsyncedEntities(ownerId: string, workspaceId: string): number {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    let count = 0;
    this.db.transaction(() => {
      const folders = this.db
        .prepare(
          `SELECT id FROM folders
           WHERE workspace_id = ?
           ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, sort_order, id`,
        )
        .all(workspaceId) as Array<{ id: string }>;
      const tags = this.db
        .prepare('SELECT id FROM tags WHERE workspace_id = ? ORDER BY id')
        .all(workspaceId) as Array<{ id: string }>;
      const prompts = this.db
        .prepare('SELECT id FROM prompts WHERE workspace_id = ? ORDER BY id')
        .all(workspaceId) as Array<{ id: string }>;
      for (const { id } of folders)
        if (this.enqueue(ownerId, workspaceId, 'folder', id, 'create')) count += 1;
      for (const { id } of tags)
        if (this.enqueue(ownerId, workspaceId, 'tag', id, 'create')) count += 1;
      for (const { id } of prompts) {
        const row = this.db
          .prepare('SELECT deleted_at FROM prompts WHERE workspace_id = ? AND id = ?')
          .get(workspaceId, id) as { deleted_at: number | null };
        if (row.deleted_at === null && this.enqueue(ownerId, workspaceId, 'prompt', id, 'create'))
          count += 1;
      }
    })();
    return count;
  }

  enqueue(
    ownerId: string,
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
    requestedOperation: SyncMutationOperation,
  ): boolean {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const state = this.entityState(ownerId, workspaceId, entityType, entityId);
    if (state?.sync_status === 'conflict') return false;
    const existing = this.db
      .prepare(
        `SELECT mutation_id, workspace_id, entity_type, entity_id, operation, base_version, payload_json, last_error
         FROM cloud_sync_outbox
         WHERE owner_id = ? AND workspace_id = ? AND entity_type = ? AND entity_id = ?
         ORDER BY created_at LIMIT 1`,
      )
      .get(ownerId, workspaceId, entityType, entityId) as OutboxRow | undefined;
    // A payload-mismatch rejection proves the server already bound this mutation
    // id to a different payload; compacting further edits into the burned key
    // would be re-rejected forever. Drop it so the re-issue gets a fresh id.
    const burnedMutationId = existing?.last_error === SYNC_MUTATION_PAYLOAD_MISMATCH;
    if (burnedMutationId) this.clearEntityOutbox(ownerId, workspaceId, entityType, entityId);
    const payload =
      requestedOperation === 'delete'
        ? {}
        : localPayload(this.db, workspaceId, entityType, entityId);
    if (!payload && requestedOperation !== 'delete') return false;
    const payloadHash = payload ? hashPayload(payload) : null;

    if (
      requestedOperation !== 'delete' &&
      state?.cloud_version &&
      state.last_synced_hash === payloadHash
    ) {
      this.clearEntityOutbox(ownerId, workspaceId, entityType, entityId);
      this.markEntityStatus(ownerId, workspaceId, entityType, entityId, 'clean');
      return false;
    }

    if (requestedOperation === 'delete' && !state?.cloud_version) {
      this.clearEntityOutbox(ownerId, workspaceId, entityType, entityId);
      this.db
        .prepare(
          'DELETE FROM cloud_entity_state WHERE owner_id = ? AND workspace_id = ? AND entity_type = ? AND local_id = ?',
        )
        .run(ownerId, workspaceId, entityType, entityId);
      return false;
    }

    let operation = normalizeOperation(requestedOperation, state?.cloud_version ?? null);
    let baseVersion = operation === 'create' ? null : (state?.cloud_version ?? null);
    if (existing?.operation === 'create' && operation !== 'delete') {
      operation = 'create';
      baseVersion = null;
    }
    const mutationId = burnedMutationId || !existing ? ulid() : existing.mutation_id;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO cloud_sync_outbox
          (mutation_id, owner_id, workspace_id, entity_type, entity_id, operation, base_version,
           payload_json, created_at, attempt_count, next_attempt_at, last_error)
         VALUES (@mutation_id, @owner_id, @workspace_id, @entity_type, @entity_id, @operation,
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
        workspace_id: workspaceId,
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
          (owner_id, workspace_id, entity_type, local_id, cloud_id, cloud_version, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(owner_id, workspace_id, entity_type, local_id) DO UPDATE SET sync_status = 'pending'`,
      )
      .run(ownerId, workspaceId, entityType, entityId, entityId, state?.cloud_version ?? null);
    return true;
  }

  listReadyMutations(ownerId: string, workspaceId: string, limit = 100): SyncMutation[] {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const rows = this.db
      .prepare(
        `SELECT o.mutation_id, o.entity_type, o.entity_id, o.operation,
           o.base_version, o.payload_json
         FROM cloud_sync_outbox o
         JOIN cloud_entity_state s
           ON s.owner_id = o.owner_id
          AND s.workspace_id = o.workspace_id
          AND s.entity_type = o.entity_type
          AND s.local_id = o.entity_id
         WHERE o.owner_id = ? AND o.workspace_id = ? AND o.next_attempt_at <= ? AND s.sync_status = 'pending'
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
      .all(ownerId, workspaceId, Date.now(), Math.max(1, Math.min(limit, 100))) as OutboxRow[];
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
    workspaceId: string,
    promptId: string,
    action: SyncUsageAction,
  ): string {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const eventId = ulid();
    this.db
      .prepare(
        `INSERT INTO cloud_sync_usage_outbox
          (event_id, owner_id, workspace_id, prompt_id, action, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(eventId, ownerId, workspaceId, promptId, action, Date.now());
    return eventId;
  }

  listReadyUsageEvents(ownerId: string, workspaceId: string, limit = 100): SyncUsageEvent[] {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const rows = this.db
      .prepare(
        `SELECT event_id, prompt_id, action
         FROM cloud_sync_usage_outbox
         WHERE owner_id = ? AND workspace_id = ? AND next_attempt_at <= ?
         ORDER BY created_at, event_id LIMIT ?`,
      )
      .all(ownerId, workspaceId, Date.now(), Math.max(1, Math.min(limit, 100))) as UsageOutboxRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      promptId: row.prompt_id,
      action: row.action,
    }));
  }

  markUsageEventAttempt(
    ownerId: string,
    workspaceId: string,
    eventId: string,
    error: string,
  ): void {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const row = this.db
      .prepare(
        'SELECT attempt_count FROM cloud_sync_usage_outbox WHERE owner_id = ? AND workspace_id = ? AND event_id = ?',
      )
      .get(ownerId, workspaceId, eventId) as { attempt_count: number } | undefined;
    if (!row) return;
    const attempts = row.attempt_count + 1;
    const delay = Math.min(300_000, 2 ** Math.min(attempts, 8) * 1_000);
    this.db
      .prepare(
        `UPDATE cloud_sync_usage_outbox
         SET attempt_count = ?, next_attempt_at = ?, last_error = ?
         WHERE owner_id = ? AND workspace_id = ? AND event_id = ?`,
      )
      .run(attempts, Date.now() + delay, error.slice(0, 500), ownerId, workspaceId, eventId);
  }

  applyUsagePushBatch(
    ownerId: string,
    workspaceId: string,
    events: SyncUsageEvent[],
    results: SyncUsageEventResult[],
  ): void {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const byId = new Map(results.map((result) => [result.eventId, result]));
    this.db.transaction(() => {
      for (const event of events) {
        const result = byId.get(event.eventId);
        if (!result) continue;
        if (result.status === 'applied' || result.status === 'duplicate') {
          this.db
            .prepare(
              'DELETE FROM cloud_sync_usage_outbox WHERE owner_id = ? AND workspace_id = ? AND event_id = ?',
            )
            .run(ownerId, workspaceId, event.eventId);
        } else {
          this.db
            .prepare(
              `UPDATE cloud_sync_usage_outbox
               SET next_attempt_at = 0, last_error = ?
               WHERE owner_id = ? AND workspace_id = ? AND event_id = ?`,
            )
            .run(result.errorCode ?? 'SYNC_USAGE_REJECTED', ownerId, workspaceId, event.eventId);
        }
      }
    })();
  }

  markMutationAttempt(
    ownerId: string,
    workspaceId: string,
    mutationId: string,
    error: string,
  ): void {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const row = this.db
      .prepare(
        'SELECT attempt_count FROM cloud_sync_outbox WHERE owner_id = ? AND workspace_id = ? AND mutation_id = ?',
      )
      .get(ownerId, workspaceId, mutationId) as { attempt_count: number } | undefined;
    if (!row) return;
    const attempts = row.attempt_count + 1;
    const exponential = 2 ** Math.min(attempts, 8) * 1_000;
    const delay = Math.min(300_000, Math.round(exponential * (0.75 + Math.random() * 0.5)));
    this.db
      .prepare(
        `UPDATE cloud_sync_outbox SET attempt_count = ?, next_attempt_at = ?, last_error = ?
         WHERE owner_id = ? AND workspace_id = ? AND mutation_id = ?`,
      )
      .run(attempts, Date.now() + delay, error.slice(0, 500), ownerId, workspaceId, mutationId);
  }

  applyPushResult(
    ownerId: string,
    workspaceId: string,
    mutation: SyncMutation,
    result: SyncMutationResult,
  ): void {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    this.db.transaction(() => {
      // A payload mismatch means the server already bound this mutation id to a
      // different request: the local payload was NOT applied and must never be
      // acknowledged — neither apply the stale stored snapshot nor clear the
      // outbox row. Guarded by error code (not status) so a legacy server that
      // reports the mismatch as `duplicate` cannot trigger the success path.
      if (
        result.errorCode !== SYNC_MUTATION_PAYLOAD_MISMATCH &&
        (result.status === 'applied' || result.status === 'duplicate') &&
        result.snapshot
      ) {
        this.applySnapshot(ownerId, workspaceId, mutation.entityType, result.snapshot);
        this.db
          .prepare(
            'DELETE FROM cloud_sync_outbox WHERE owner_id = ? AND workspace_id = ? AND mutation_id = ?',
          )
          .run(ownerId, workspaceId, mutation.mutationId);
        return;
      }
      if (result.status === 'conflict' && result.snapshot) {
        this.recordConflict(ownerId, workspaceId, mutation, result.snapshot);
        return;
      }
      this.db
        .prepare(
          `UPDATE cloud_sync_outbox SET last_error = ?, next_attempt_at = 0
           WHERE owner_id = ? AND workspace_id = ? AND mutation_id = ?`,
        )
        .run(
          result.errorCode ?? 'SYNC_MUTATION_REJECTED',
          ownerId,
          workspaceId,
          mutation.mutationId,
        );
      this.markEntityStatus(ownerId, workspaceId, mutation.entityType, mutation.entityId, 'error');
    })();
  }

  applyBootstrapSnapshot(
    ownerId: string,
    workspaceId: string,
    entityType: SyncEntityType,
    snapshot: SyncSnapshot,
  ): void {
    this.applyRemoteChange(ownerId, workspaceId, {
      seq: '0',
      entityType,
      entityId: snapshot.id,
      operation: snapshot.deletedAt ? 'delete' : 'upsert',
      version: snapshot.version,
      snapshot,
    });
  }

  applyBootstrapPage(
    ownerId: string,
    workspaceId: string,
    entityType: SyncEntityType,
    snapshots: SyncSnapshot[],
  ): void {
    this.db.transaction(() => {
      for (const snapshot of snapshots)
        this.applyBootstrapSnapshot(ownerId, workspaceId, entityType, snapshot);
    })();
  }

  applyPullPage(
    ownerId: string,
    workspaceId: string,
    changes: SyncChange[],
    nextCursor: string,
  ): void {
    this.db.transaction(() => {
      for (const change of changes) this.applyRemoteChange(ownerId, workspaceId, change);
      this.setCursor(ownerId, nextCursor);
    })();
  }

  applyPushBatch(
    ownerId: string,
    workspaceId: string,
    mutations: SyncMutation[],
    results: SyncMutationResult[],
  ): void {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const byMutationId = new Map(results.map((result) => [result.mutationId, result]));
    this.db.transaction(() => {
      for (const mutation of mutations) {
        const result = byMutationId.get(mutation.mutationId);
        if (!result) throw new Error(`Missing sync result for ${mutation.mutationId}`);
        this.applyPushResult(ownerId, workspaceId, mutation, result);
      }
    })();
  }

  applyRemoteChange(ownerId: string, workspaceId: string, change: SyncChange): void {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const state = this.entityState(ownerId, workspaceId, change.entityType, change.entityId);
    if (state?.cloud_version && change.version <= state.cloud_version) return;
    const local = localPayload(this.db, workspaceId, change.entityType, change.entityId);
    if (state?.sync_status === 'pending' || state?.sync_status === 'conflict') {
      const mutation = this.db
        .prepare(
          `SELECT mutation_id, workspace_id, entity_type, entity_id, operation, base_version, payload_json
           FROM cloud_sync_outbox
           WHERE owner_id = ? AND workspace_id = ? AND entity_type = ? AND entity_id = ?
           ORDER BY created_at LIMIT 1`,
        )
        .get(ownerId, workspaceId, change.entityType, change.entityId) as OutboxRow | undefined;
      if (mutation) {
        this.recordConflict(
          ownerId,
          workspaceId,
          {
            mutationId: mutation.mutation_id,
            entityType: mutation.entity_type,
            entityId: mutation.entity_id,
            operation: mutation.operation,
            baseVersion: mutation.base_version,
            payload: JSON.parse(mutation.payload_json) as Record<string, unknown>,
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
        workspaceId,
        {
          mutationId: ulid(),
          entityType: change.entityType,
          entityId: change.entityId,
          operation: 'create',
          baseVersion: null,
          payload: local,
        },
        change.snapshot,
      );
      return;
    }
    this.applySnapshot(ownerId, workspaceId, change.entityType, change.snapshot);
  }

  listConflicts(ownerId: string, workspaceId: string): DesktopSyncConflict[] {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    const rows = this.db
      .prepare(
        `SELECT * FROM cloud_sync_conflicts
         WHERE owner_id = ? AND workspace_id = ? AND resolved_at IS NULL ORDER BY detected_at DESC`,
      )
      .all(ownerId, workspaceId) as ConflictRow[];
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      workspaceId: row.workspace_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      mutationId: row.mutation_id,
      baseVersion: row.base_version,
      localSnapshot: JSON.parse(row.local_snapshot_json) as Record<string, unknown>,
      remoteSnapshot: JSON.parse(row.remote_snapshot_json) as SyncSnapshot,
      detectedAt: row.detected_at,
    }));
  }

  resolveConflict(
    ownerId: string,
    workspaceId: string,
    conflictId: string,
    resolution: 'remote' | 'local' | 'duplicate',
  ): void {
    assertAccountWorkspace(this.db, ownerId, workspaceId);
    this.db.transaction(() => {
      const conflict = this.db
        .prepare(
          `SELECT * FROM cloud_sync_conflicts
           WHERE id = ? AND owner_id = ? AND workspace_id = ? AND resolved_at IS NULL`,
        )
        .get(conflictId, ownerId, workspaceId) as ConflictRow | undefined;
      if (!conflict) throw new Error('Cloud sync conflict not found');
      const localSnapshot = JSON.parse(conflict.local_snapshot_json) as Record<string, unknown>;
      const remoteSnapshot = JSON.parse(conflict.remote_snapshot_json) as SyncSnapshot;
      this.db
        .prepare(
          `DELETE FROM cloud_sync_outbox
           WHERE owner_id = ? AND workspace_id = ? AND entity_type = ? AND entity_id = ?`,
        )
        .run(ownerId, workspaceId, conflict.entity_type, conflict.entity_id);
      this.applySnapshot(ownerId, workspaceId, conflict.entity_type, remoteSnapshot);

      if (resolution === 'local') {
        applyLocalPayload(
          this.db,
          workspaceId,
          conflict.entity_type,
          conflict.entity_id,
          localSnapshot,
        );
        this.enqueue(
          ownerId,
          workspaceId,
          conflict.entity_type,
          conflict.entity_id,
          remoteSnapshot.deletedAt ? 'restore' : 'update',
        );
      } else if (resolution === 'duplicate') {
        if (conflict.entity_type !== 'prompt')
          throw new Error('Only prompt conflicts can be duplicated');
        const duplicateId = ulid();
        applyLocalPayload(this.db, workspaceId, 'prompt', duplicateId, {
          ...localSnapshot,
          title: `${String(localSnapshot.title ?? '未命名')}（本地副本）`,
        });
        this.enqueue(ownerId, workspaceId, 'prompt', duplicateId, 'create');
      }

      this.db
        .prepare(
          `UPDATE cloud_sync_conflicts
           SET resolved_at = ?, resolution = ?
           WHERE id = ? AND owner_id = ? AND workspace_id = ?`,
        )
        .run(Date.now(), resolution, conflictId, ownerId, workspaceId);
      if (resolution === 'remote')
        this.markEntityStatus(
          ownerId,
          workspaceId,
          conflict.entity_type,
          conflict.entity_id,
          'clean',
        );
    })();
  }

  private applySnapshot(
    ownerId: string,
    workspaceId: string,
    entityType: SyncEntityType,
    snapshot: SyncSnapshot,
  ): void {
    applyCloudSnapshot(this.db, ownerId, workspaceId, entityType, snapshot);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO cloud_entity_state
          (owner_id, workspace_id, entity_type, local_id, cloud_id, cloud_version,
           last_synced_hash, remote_snapshot_json, sync_status, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'clean', ?)
         ON CONFLICT(owner_id, workspace_id, entity_type, local_id) DO UPDATE SET
           cloud_id = excluded.cloud_id,
           cloud_version = excluded.cloud_version,
           last_synced_hash = excluded.last_synced_hash,
           remote_snapshot_json = excluded.remote_snapshot_json,
           sync_status = 'clean',
           last_synced_at = excluded.last_synced_at`,
      )
      .run(
        ownerId,
        workspaceId,
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
    workspaceId: string,
    mutation: SyncMutation,
    remote: SyncSnapshot,
  ): void {
    this.db
      .prepare(
        `INSERT INTO cloud_sync_conflicts
          (id, owner_id, workspace_id, entity_type, entity_id, mutation_id, base_version,
           local_snapshot_json, remote_snapshot_json, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, workspace_id, entity_type, entity_id) WHERE resolved_at IS NULL
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
        workspaceId,
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
          (owner_id, workspace_id, entity_type, local_id, cloud_id, cloud_version,
           last_synced_hash, remote_snapshot_json, sync_status, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'conflict', ?)
         ON CONFLICT(owner_id, workspace_id, entity_type, local_id) DO UPDATE SET
           cloud_id = excluded.cloud_id,
           cloud_version = excluded.cloud_version,
           last_synced_hash = excluded.last_synced_hash,
           remote_snapshot_json = excluded.remote_snapshot_json,
           sync_status = 'conflict',
           last_synced_at = excluded.last_synced_at`,
      )
      .run(
        ownerId,
        workspaceId,
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
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): EntityStateRow | null {
    return (
      (this.db
        .prepare(
          `SELECT workspace_id, cloud_version, last_synced_hash, sync_status
           FROM cloud_entity_state
           WHERE owner_id = ? AND workspace_id = ? AND entity_type = ? AND local_id = ?`,
        )
        .get(ownerId, workspaceId, entityType, entityId) as EntityStateRow | undefined) ?? null
    );
  }

  private markEntityStatus(
    ownerId: string,
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
    status: EntityStateRow['sync_status'],
  ): void {
    this.db
      .prepare(
        `UPDATE cloud_entity_state SET sync_status = ?
         WHERE owner_id = ? AND workspace_id = ? AND entity_type = ? AND local_id = ?`,
      )
      .run(status, ownerId, workspaceId, entityType, entityId);
  }

  private clearEntityOutbox(
    ownerId: string,
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): void {
    this.db
      .prepare(
        'DELETE FROM cloud_sync_outbox WHERE owner_id = ? AND workspace_id = ? AND entity_type = ? AND entity_id = ?',
      )
      .run(ownerId, workspaceId, entityType, entityId);
  }

  private requireAccount(ownerId: string): DesktopSyncAccount {
    const row = this.db
      .prepare('SELECT * FROM cloud_sync_accounts WHERE owner_id = ?')
      .get(ownerId) as AccountRow | undefined;
    if (!row) throw new Error('Cloud sync account not found');
    return accountFromRow(row);
  }
}

export function enqueueActiveAccountMutation(
  db: Database.Database,
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncMutationOperation,
  workspaceId?: string,
): boolean {
  const syncTablesReady = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cloud_sync_accounts'")
    .get();
  if (!syncTablesReady) return false;
  const columns = hasConsentColumns(db);
  const account = db
    .prepare(
      columns
        ? `SELECT owner_id, consent_state, enabled FROM cloud_sync_accounts
           WHERE active = 1 AND consent_state IN ('enabled', 'paused') LIMIT 1`
        : 'SELECT owner_id, enabled FROM cloud_sync_accounts WHERE active = 1 AND enabled = 1 LIMIT 1',
    )
    .get() as { owner_id: string; consent_state?: string; enabled: number } | undefined;
  if (!account) return false;
  const scope = workspaceId ?? resolveAccountWorkspace(db, account.owner_id);
  if (!scope) return false;
  assertAccountWorkspace(db, account.owner_id, scope);
  return new DesktopSyncRepository(db).enqueue(
    account.owner_id,
    scope,
    entityType,
    entityId,
    operation,
  );
}

export function enqueueActiveAccountUsageEvent(
  db: Database.Database,
  promptId: string,
  action: SyncUsageAction = 'apply',
  workspaceId?: string,
): string | null {
  const syncTablesReady = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cloud_sync_usage_outbox'",
    )
    .get();
  if (!syncTablesReady) return null;
  const columns = hasConsentColumns(db);
  const account = db
    .prepare(
      columns
        ? `SELECT owner_id, consent_state, enabled FROM cloud_sync_accounts
           WHERE active = 1 AND consent_state IN ('enabled', 'paused') LIMIT 1`
        : 'SELECT owner_id, enabled FROM cloud_sync_accounts WHERE active = 1 AND enabled = 1 LIMIT 1',
    )
    .get() as { owner_id: string; consent_state?: string; enabled: number } | undefined;
  if (!account) return null;
  const scope = workspaceId ?? resolveAccountWorkspace(db, account.owner_id);
  if (!scope) return null;
  assertAccountWorkspace(db, account.owner_id, scope);
  return new DesktopSyncRepository(db).enqueueUsageEvent(account.owner_id, scope, promptId, action);
}

function assertAccountWorkspace(db: Database.Database, ownerId: string, workspaceId: string): void {
  const expected = accountWorkspaceId(ownerId);
  if (workspaceId !== expected) {
    throw new Error(`sync workspace ${workspaceId} is not owned by account ${ownerId}`);
  }
  const workspace = db
    .prepare('SELECT owner_id, kind FROM local_workspaces WHERE id = ?')
    .get(workspaceId) as { owner_id: string | null; kind: string } | undefined;
  if (workspace?.kind !== 'account' || workspace.owner_id !== ownerId) {
    throw new Error(`account ${ownerId} has no explicit workspace`);
  }
}

function hasConsentColumns(db: Database.Database): boolean {
  const columns = db.prepare('PRAGMA table_info(cloud_sync_accounts)').all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));
  return (
    names.has('consent_state') && names.has('consent_decided_at') && names.has('consent_version')
  );
}

function assertOwnerAccountWorkspace(db: Database.Database, ownerId: string): string {
  const workspaceId = resolveAccountWorkspace(db, ownerId);
  if (!workspaceId) throw new Error(`account ${ownerId} has no explicit workspace`);
  assertAccountWorkspace(db, ownerId, workspaceId);
  return workspaceId;
}

function accountFromRow(row: AccountRow): DesktopSyncAccount {
  const consent = parseConsent(row.consent_state, row.enabled);
  return {
    ownerId: row.owner_id,
    username: row.username,
    deviceId: row.device_id,
    deviceName: row.device_name,
    platform: row.platform,
    clientVersion: row.client_version,
    consent,
    consentDecidedAt: row.consent_decided_at ?? null,
    consentVersion: row.consent_version ?? 1,
    enabled: consent === 'enabled',
    cursor: row.cursor,
    bootstrapCompletedAt: row.bootstrap_completed_at,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
  };
}

function parseConsent(value: string | null | undefined, enabled: number): DesktopSyncConsent {
  if (value === 'enabled' || value === 'paused' || value === 'unset') return value;
  return enabled ? 'enabled' : 'unset';
}

function normalizeOperation(
  operation: SyncMutationOperation,
  cloudVersion: number | null,
): SyncMutationOperation {
  if (!cloudVersion) return operation === 'delete' ? 'delete' : 'create';
  if (operation === 'create') return 'update';
  return operation;
}

function localPayload(
  db: Database.Database,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
): Record<string, unknown> | null {
  if (entityType === 'prompt') {
    const row = db
      .prepare('SELECT * FROM prompts WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, entityId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const tagIds = (
      db
        .prepare(
          'SELECT tag_id FROM prompt_tags WHERE workspace_id = ? AND prompt_id = ? ORDER BY tag_id',
        )
        .all(workspaceId, entityId) as Array<{ tag_id: string }>
    ).map((item) => item.tag_id);
    return {
      title: String(row.title ?? '').trim(),
      description: nullableText(row.description),
      content: String(row.content ?? '').trim(),
      negative: nullableText(row.content_negative),
      folderId: typeof row.folder_id === 'string' ? row.folder_id : null,
      tagIds,
      modelId: nullableText(row.model_id),
      params: sanitizeCloudJson(parseJson(row.params)),
      rating: Number(row.rating ?? 0),
      isPinned: Boolean(row.is_pinned),
      pinOrder: typeof row.pin_order === 'number' ? row.pin_order : null,
      source: normalizeSource(row.source),
      sourceUrl: normalizeSourceUrl(row.source_url),
    };
  }
  if (entityType === 'folder') {
    const row = db
      .prepare('SELECT * FROM folders WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, entityId) as Record<string, unknown> | undefined;
    return row
      ? {
          name: String(row.name ?? '').trim(),
          parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
          sortOrder: Number(row.sort_order ?? 0),
        }
      : null;
  }
  const row = db
    .prepare('SELECT * FROM tags WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, entityId) as Record<string, unknown> | undefined;
  return row
    ? {
        name: String(row.name ?? '').trim(),
        group: nullableText(row.tag_group),
        color: normalizeColor(row.color),
      }
    : null;
}

function cloudPayload(entityType: SyncEntityType, snapshot: SyncSnapshot): Record<string, unknown> {
  if (entityType === 'prompt') {
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
  if (entityType === 'folder') {
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
  workspaceId: string,
  entityType: SyncEntityType,
  snapshot: SyncSnapshot,
): void {
  if (snapshot.deletedAt) {
    if (entityType === 'prompt') {
      db.prepare(
        'UPDATE prompts SET deleted_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?',
      ).run(
        Date.parse(snapshot.deletedAt),
        Date.parse(snapshot.updatedAt),
        workspaceId,
        snapshot.id,
      );
    } else if (entityType === 'folder') {
      db.prepare(
        'UPDATE folders SET parent_id = NULL WHERE workspace_id = ? AND parent_id = ?',
      ).run(workspaceId, snapshot.id);
      db.prepare(
        'UPDATE prompts SET folder_id = NULL WHERE workspace_id = ? AND folder_id = ?',
      ).run(workspaceId, snapshot.id);
      db.prepare('DELETE FROM folders WHERE workspace_id = ? AND id = ?').run(
        workspaceId,
        snapshot.id,
      );
    } else {
      const affectedPromptIds = (
        db
          .prepare('SELECT prompt_id AS id FROM prompt_tags WHERE workspace_id = ? AND tag_id = ?')
          .all(workspaceId, snapshot.id) as Array<{ id: string }>
      ).map((row) => row.id);
      db.prepare('DELETE FROM tags WHERE workspace_id = ? AND id = ?').run(
        workspaceId,
        snapshot.id,
      );
      for (const promptId of affectedPromptIds) syncPromptFts(db, workspaceId, promptId);
    }
    return;
  }
  applyLocalPayload(
    db,
    workspaceId,
    entityType,
    snapshot.id,
    cloudPayload(entityType, snapshot),
    snapshot,
  );
  restoreCloudRelations(db, ownerId, workspaceId, entityType, snapshot.id);
}

function applyLocalPayload(
  db: Database.Database,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
  payload: Record<string, unknown>,
  snapshot?: SyncSnapshot,
): void {
  const now = Date.now();
  if (entityType === 'folder') {
    const requestedParentId = typeof payload.parentId === 'string' ? payload.parentId : null;
    const parentId =
      requestedParentId &&
      db
        .prepare('SELECT 1 FROM folders WHERE workspace_id = ? AND id = ?')
        .get(workspaceId, requestedParentId)
        ? requestedParentId
        : null;
    db.prepare(
      `INSERT INTO folders(workspace_id, id, name, parent_id, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, id) DO UPDATE SET
         name = excluded.name,
         parent_id = excluded.parent_id,
         sort_order = excluded.sort_order`,
    ).run(
      workspaceId,
      entityId,
      String(payload.name ?? ''),
      parentId,
      Number(payload.sortOrder ?? 0),
      snapshot ? Date.parse(snapshot.createdAt) : now,
    );
    return;
  }
  if (entityType === 'tag') {
    const affectedPromptIds = (
      db
        .prepare('SELECT prompt_id AS id FROM prompt_tags WHERE workspace_id = ? AND tag_id = ?')
        .all(workspaceId, entityId) as Array<{ id: string }>
    ).map((row) => row.id);
    db.prepare(
      `INSERT INTO tags(workspace_id, id, name, tag_group, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, id) DO UPDATE SET
         name = excluded.name,
         tag_group = excluded.tag_group,
         color = excluded.color`,
    ).run(
      workspaceId,
      entityId,
      String(payload.name ?? ''),
      typeof payload.group === 'string' ? payload.group : null,
      normalizeColor(payload.color),
      snapshot ? Date.parse(snapshot.createdAt) : now,
    );
    for (const promptId of affectedPromptIds) syncPromptFts(db, workspaceId, promptId);
    return;
  }
  const promptSnapshot = snapshot as PromptDocument | undefined;
  const source = normalizeSource(payload.source);
  const requestedFolderId = typeof payload.folderId === 'string' ? payload.folderId : null;
  const folderId =
    requestedFolderId &&
    db
      .prepare('SELECT 1 FROM folders WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, requestedFolderId)
      ? requestedFolderId
      : null;
  db.prepare(
    `INSERT INTO prompts(
      workspace_id, id, title, description, content, content_negative, folder_id, model_id,
      params, rating, is_pinned, pin_order, usage_count, last_used_at,
      source, source_url, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(workspace_id, id) DO UPDATE SET
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
      deleted_at = excluded.deleted_at`,
  ).run(
    workspaceId,
    entityId,
    String(payload.title ?? ''),
    nullableText(payload.description),
    String(payload.content ?? ''),
    nullableText(payload.negative),
    folderId,
    nullableText(payload.modelId),
    payload.params ? JSON.stringify(sanitizeCloudJson(payload.params)) : null,
    Number(payload.rating ?? 0),
    payload.isPinned ? 1 : 0,
    typeof payload.pinOrder === 'number' ? payload.pinOrder : null,
    promptSnapshot?.usageCount ?? 0,
    promptSnapshot?.lastUsedAt ? Date.parse(promptSnapshot.lastUsedAt) : null,
    source === 'share' ? 'shared' : source,
    normalizeSourceUrl(payload.sourceUrl),
    promptSnapshot ? Date.parse(promptSnapshot.createdAt) : now,
    promptSnapshot ? Date.parse(promptSnapshot.updatedAt) : now,
  );
  const tagIds = Array.isArray(payload.tagIds)
    ? payload.tagIds.filter((id): id is string => typeof id === 'string')
    : [];
  db.prepare('DELETE FROM prompt_tags WHERE workspace_id = ? AND prompt_id = ?').run(
    workspaceId,
    entityId,
  );
  const insert = db.prepare(
    `INSERT OR IGNORE INTO prompt_tags(workspace_id, prompt_id, tag_id)
     SELECT ?, ?, id FROM tags WHERE workspace_id = ? AND id = ?`,
  );
  for (const tagId of tagIds) insert.run(workspaceId, entityId, workspaceId, tagId);
  syncPromptFts(db, workspaceId, entityId);
}

function restoreCloudRelations(
  db: Database.Database,
  ownerId: string,
  workspaceId: string,
  entityType: SyncEntityType,
  entityId: string,
): void {
  if (entityType === 'folder') {
    const childFolders = db
      .prepare(
        `SELECT local_id FROM cloud_entity_state
         WHERE owner_id = ? AND workspace_id = ? AND entity_type = 'folder'
           AND json_extract(remote_snapshot_json, '$.parentId') = ?`,
      )
      .all(ownerId, workspaceId, entityId) as Array<{ local_id: string }>;
    const reparent = db.prepare(
      'UPDATE folders SET parent_id = ? WHERE workspace_id = ? AND id = ?',
    );
    for (const child of childFolders) reparent.run(entityId, workspaceId, child.local_id);

    const prompts = db
      .prepare(
        `SELECT local_id FROM cloud_entity_state
         WHERE owner_id = ? AND workspace_id = ? AND entity_type = 'prompt'
           AND json_extract(remote_snapshot_json, '$.folderId') = ?`,
      )
      .all(ownerId, workspaceId, entityId) as Array<{ local_id: string }>;
    const movePrompt = db.prepare(
      'UPDATE prompts SET folder_id = ? WHERE workspace_id = ? AND id = ?',
    );
    for (const prompt of prompts) movePrompt.run(entityId, workspaceId, prompt.local_id);
    return;
  }
  if (entityType !== 'tag') return;
  const prompts = db
    .prepare(
      `SELECT DISTINCT state.local_id
       FROM cloud_entity_state state,
         json_each(state.remote_snapshot_json, '$.tags') AS tag
       WHERE state.owner_id = ? AND state.workspace_id = ? AND state.entity_type = 'prompt'
         AND json_extract(tag.value, '$.id') = ?`,
    )
    .all(ownerId, workspaceId, entityId) as Array<{ local_id: string }>;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO prompt_tags(workspace_id, prompt_id, tag_id)
     SELECT ?, ?, id FROM tags WHERE workspace_id = ? AND id = ?`,
  );
  for (const prompt of prompts) {
    insert.run(workspaceId, prompt.local_id, workspaceId, entityId);
    syncPromptFts(db, workspaceId, prompt.local_id);
  }
}

function syncPromptFts(db: Database.Database, workspaceId: string, id: string): void {
  const row = db
    .prepare(
      'SELECT rowid, title, description, content FROM prompts WHERE workspace_id = ? AND id = ?',
    )
    .get(workspaceId, id) as
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
        `SELECT t.name FROM tags t
         JOIN prompt_tags pt ON pt.workspace_id = t.workspace_id AND pt.tag_id = t.id
         WHERE pt.workspace_id = ? AND pt.prompt_id = ?`,
      )
      .all(workspaceId, id) as Array<{ name: string }>
  ).map((item) => item.name);
  db.prepare('DELETE FROM prompts_fts WHERE rowid = ?').run(row.rowid);
  db.prepare(
    `INSERT INTO prompts_fts(rowid, title, description, content, tags_index)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    row.rowid,
    row.title,
    row.description ?? '',
    row.content,
    tokenizeForFts(row.title, row.description, row.content, tags),
  );
}

function hashSnapshot(entityType: SyncEntityType, snapshot: SyncSnapshot): string {
  return hashPayload(cloudPayload(entityType, snapshot));
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sanitizeCloudJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return ABSOLUTE_PATH.test(value) ? null : value;
  if (Array.isArray(value)) return value.map((item) => sanitizeCloudJson(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) continue;
    result[key] = sanitizeCloudJson(item, depth + 1);
  }
  return result;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSource(value: unknown): PromptDocument['source'] {
  if (value === 'shared' || value === 'share') return 'share';
  if (value === 'import' || value === 'slip' || value === 'generation') return value;
  return 'manual';
}

function normalizeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}
