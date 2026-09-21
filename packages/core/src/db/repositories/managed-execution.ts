import { createHash, randomUUID } from 'node:crypto';
import { types } from 'node:util';
import type Database from 'better-sqlite3';
import {
  managedExecutionCheckpointSchema,
  managedExecutionOperationSchema,
  type ManagedExecutionCheckpoint,
  type ManagedExecutionOperation,
} from '@musefold/desktop-contracts/managed-execution';
import { automationInputHash } from './automation-spend';
import { withManagedSpendWrite } from './managed-spend-scope';

export class ManagedExecutionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ManagedExecutionError';
  }
}

/** Shared by enablement and the read-only host diagnostic. The request table alias is r. */
export const MANAGED_ENABLEMENT_BLOCKER_SQL = `r.reservation_state IN ('held', 'unknown') OR (
  r.state <> 'terminal' AND EXISTS (
    SELECT 1 FROM json_each(r.bindings_json) b WHERE json_extract(b.value, '$.policy') = 'managed'
  )
) OR EXISTS (
  SELECT 1 FROM automation_spend_calls c WHERE c.request_id = r.id
  AND c.state IN ('pending', 'started', 'unknown')
  AND json_extract(c.binding_json, '$.policy') = 'managed'
)`;

export function sameManagedCheckpoint(
  left: ManagedExecutionCheckpoint | null,
  right: ManagedExecutionCheckpoint | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.lineageId === right.lineageId &&
        left.namespace === right.namespace &&
        left.revision === right.revision &&
        left.headHash === right.headHash &&
        left.lastOperationId === right.lastOperationId;
}

/** Hashes only an operation's non-secret intent. Request bodies remain in the primary ledger. */
export function planManagedOperation(
  from: ManagedExecutionCheckpoint | null,
  kind: ManagedExecutionOperation['kind'],
  intent: unknown,
): ManagedExecutionOperation {
  const operationId = randomUUID();
  const intentHash = automationInputHash(intent);
  const identity = from ?? { lineageId: randomUUID(), namespace: randomUUID() };
  const headHash = createHash('sha256')
    .update(JSON.stringify(['managed-execution-v1', from, operationId, kind, intentHash]))
    .digest('hex');
  return managedExecutionOperationSchema.parse({
    operationId,
    kind,
    intentHash,
    from,
    to: {
      lineageId: identity.lineageId,
      namespace: identity.namespace,
      revision: from ? from.revision + 1 : 0,
      headHash,
      lastOperationId: operationId,
    },
  });
}

/** No initialization on construction or migration. The host must explicitly enable the lineage. */
export class ManagedExecutionRepository {
  constructor(private readonly db: Database.Database) {}

  checkpoint(): ManagedExecutionCheckpoint | null {
    const row = this.db
      .prepare(`SELECT lineage_id AS lineageId, namespace, revision,
        head_hash AS headHash, last_operation_id AS lastOperationId
        FROM managed_execution_checkpoint WHERE id = 1`)
      .get();
    return row ? managedExecutionCheckpointSchema.parse(row) : null;
  }

  /** A new namespace cannot adopt unresolved legacy spend or replace lost remote identity. */
  assertReadyToEnable(): void {
    if (this.db.prepare('SELECT 1 FROM managed_generation_requests LIMIT 1').get())
      throw new ManagedExecutionError('MANAGED_RECONCILIATION_REQUIRED');
    const unsettled = this.db
      .prepare(
        `SELECT 1 FROM automation_spend_requests r WHERE ${MANAGED_ENABLEMENT_BLOCKER_SQL} LIMIT 1`,
      )
      .get();
    if (unsettled) throw new ManagedExecutionError('MANAGED_LEGACY_SPEND_UNRESOLVED');
  }

  /** Budget compatibility before explicit enablement; never creates a checkpoint or capability. */
  mutateBeforeEnable<T>(change: () => T): T {
    if (this.db.inTransaction) throw new ManagedExecutionError('MANAGED_NESTED_TRANSACTION');
    if (types.isAsyncFunction(change)) throw new ManagedExecutionError('MANAGED_ASYNC_TRANSACTION');
    return this.db
      .transaction(() => {
        if (this.checkpoint()) throw new ManagedExecutionError('MANAGED_ALREADY_INITIALIZED');
        const result = change();
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result
        )
          throw new ManagedExecutionError('MANAGED_ASYNC_TRANSACTION');
        return result;
      })
      .immediate();
  }

  /** Called by the durable anchor coordinator, never as an alternative permission to send. */
  commit<T>(operation: ManagedExecutionOperation, change: () => T): T {
    const plan = managedExecutionOperationSchema.parse(operation);
    if (this.db.inTransaction) throw new ManagedExecutionError('MANAGED_NESTED_TRANSACTION');
    // Callbacks are trusted host code and must perform SQLite work synchronously. Reject an
    // async function before invoking it: detecting its Promise afterward cannot cancel it.
    if (types.isAsyncFunction(change)) throw new ManagedExecutionError('MANAGED_ASYNC_TRANSACTION');
    return this.db
      .transaction(() => {
        if (!sameManagedCheckpoint(this.checkpoint(), plan.from))
          throw new ManagedExecutionError('MANAGED_CHECKPOINT_CONFLICT');
        if (plan.kind === 'enable') this.assertReadyToEnable();
        const result = withManagedSpendWrite(this.db, change);
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result
        )
          throw new ManagedExecutionError('MANAGED_ASYNC_TRANSACTION');
        const next = plan.to;
        if (plan.from) {
          this.db
            .prepare(`UPDATE managed_execution_checkpoint SET
            revision = ?, head_hash = ?, last_operation_id = ? WHERE id = 1`)
            .run(next.revision, next.headHash, next.lastOperationId);
        } else {
          this.db
            .prepare(`INSERT INTO managed_execution_checkpoint
            (id, lineage_id, namespace, revision, head_hash, last_operation_id)
            VALUES (1, ?, ?, ?, ?, ?)`)
            .run(
              next.lineageId,
              next.namespace,
              next.revision,
              next.headHash,
              next.lastOperationId,
            );
        }
        return result;
      })
      .immediate();
  }
}
