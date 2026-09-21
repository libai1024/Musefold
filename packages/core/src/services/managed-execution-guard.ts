import { types } from 'node:util';
import {
  managedExecutionAnchorSchema,
  type ManagedExecutionAnchor,
  type ManagedExecutionOperation,
  type ManagedExecutionCheckpoint,
} from '@musefold/desktop-contracts/managed-execution';
import {
  ManagedExecutionError,
  type ManagedExecutionRepository,
  planManagedOperation,
  sameManagedCheckpoint,
} from '../db/repositories/managed-execution';

/** Host owns the data directory exclusively. scope must be identical for adapters of one file. */
export interface ManagedExecutionAnchorPort {
  readonly scope: string;
  read(): Promise<ManagedExecutionAnchor | null>;
  write(anchor: ManagedExecutionAnchor): Promise<void>;
}

const tails = new Map<string, Promise<void>>();

/** A resume commit is authoritative even if its optional file compaction was interrupted. */
function settledResume(
  stored: ManagedExecutionAnchor | null,
  checkpoint: ManagedExecutionCheckpoint | null,
): ManagedExecutionAnchor | null {
  return stored?.pending?.kind === 'resume' && sameManagedCheckpoint(stored.pending.to, checkpoint)
    ? { ...stored, committed: stored.pending.to, pending: null }
    : stored;
}

function matchesResume(
  stored: ManagedExecutionAnchor | null,
  checkpoint: ManagedExecutionCheckpoint | null,
): stored is ManagedExecutionAnchor & { committed: ManagedExecutionCheckpoint } {
  return (
    !!stored?.committed &&
    sameManagedCheckpoint(stored.committed, checkpoint) &&
    (!stored.pending || stored.pending.kind === 'resume')
  );
}
async function exclusive<T>(scope: string, run: () => Promise<T>): Promise<T> {
  const previous = tails.get(scope) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(scope, current);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (tails.get(scope) === current) tails.delete(scope);
  }
}

/**
 * Coordinates file persistence outside the synchronous SQLite transaction. It never sends HTTP,
 * restores a missing ledger, or reenables a restored lineage as a side effect of reading it.
 */
export class ManagedExecutionGuard {
  constructor(
    private readonly repository: ManagedExecutionRepository,
    private readonly anchor: ManagedExecutionAnchorPort,
  ) {}

  async status() {
    return exclusive(this.anchor.scope, async () => {
      try {
        const raw = await this.anchor.read();
        const checkpoint = this.repository.checkpoint();
        const stored = settledResume(raw, checkpoint);
        if (!stored && !checkpoint) return { mode: 'not_enabled' as const };
        if (
          !stored ||
          !checkpoint ||
          stored.mode !== 'active' ||
          stored.pending ||
          !sameManagedCheckpoint(stored.committed, checkpoint)
        )
          return { mode: 'query_only' as const };
        return { mode: 'active' as const, checkpoint };
      } catch {
        return { mode: 'query_only' as const };
      }
    });
  }

  /** Explicit user enablement only; never call during startup or old-backup migration. */
  async enable(change: () => void = () => undefined): Promise<void> {
    return exclusive(this.anchor.scope, async () => {
      if ((await this.anchor.read()) || this.repository.checkpoint())
        throw new ManagedExecutionError('MANAGED_ALREADY_INITIALIZED');
      // Refuse before touching the file. commit checks again after the asynchronous flush,
      // inside its SQLite transaction, so a late legacy request cannot slip into the lineage.
      this.repository.assertReadyToEnable();
      const operation = planManagedOperation(null, 'enable', { version: 1 });
      await this.perform(operation, change);
    });
  }

  async mutate<T>(
    kind: Exclude<ManagedExecutionOperation['kind'], 'enable' | 'resume'>,
    nonSecretIntent: unknown,
    change: () => T,
  ): Promise<T> {
    return this.coordinate(kind, nonSecretIntent, () => ({ change }));
  }

  /** Preflight/no-op decisions run under the same lock, before durable pending is written. */
  async coordinate<T>(
    kind: Exclude<ManagedExecutionOperation['kind'], 'enable' | 'resume'>,
    nonSecretIntent: unknown,
    prepare: () => { change: () => T } | { unchanged: T },
  ): Promise<T> {
    return this.coordinateOperation(kind, nonSecretIntent, prepare, false);
  }

  /** Shared budget writes also work before explicit enablement, under the same lineage lock. */
  async coordinateBudget<T>(
    nonSecretIntent: unknown,
    prepare: () => { change: () => T } | { unchanged: T },
  ): Promise<T> {
    return this.coordinateOperation('budget', nonSecretIntent, prepare, true);
  }

  private async coordinateOperation<T>(
    kind: Exclude<ManagedExecutionOperation['kind'], 'enable' | 'resume'>,
    nonSecretIntent: unknown,
    prepare: () => { change: () => T } | { unchanged: T },
    allowNotEnabled: boolean,
  ): Promise<T> {
    if (types.isAsyncFunction(prepare))
      throw new ManagedExecutionError('MANAGED_ASYNC_TRANSACTION');
    return exclusive(this.anchor.scope, async () => {
      const raw = await this.anchor.read();
      const checkpoint = this.repository.checkpoint();
      const stored = settledResume(raw, checkpoint);
      if (allowNotEnabled && !stored && !checkpoint) {
        const decision = prepare();
        if ('then' in decision) throw new ManagedExecutionError('MANAGED_ASYNC_TRANSACTION');
        if ('unchanged' in decision) return decision.unchanged;
        // No await between observing no lineage and the synchronous legacy write. Enablement
        // uses this same lock, so it cannot capture a budget before a late legacy mutation.
        return this.repository.mutateBeforeEnable(decision.change);
      }
      if (
        !stored ||
        !checkpoint ||
        stored.mode !== 'active' ||
        stored.pending ||
        !sameManagedCheckpoint(stored.committed, checkpoint)
      )
        throw new ManagedExecutionError('MANAGED_RECONCILIATION_REQUIRED');
      const decision = prepare();
      if ('then' in decision) throw new ManagedExecutionError('MANAGED_ASYNC_TRANSACTION');
      if ('unchanged' in decision) return decision.unchanged;
      return this.perform(planManagedOperation(checkpoint, kind, nonSecretIntent), decision.change);
    });
  }

  private async perform<T>(operation: ManagedExecutionOperation, change: () => T): Promise<T> {
    const pending = managedExecutionAnchorSchema.parse({
      version: 1,
      committed: operation.from,
      pending: operation,
      mode: 'active',
      reason: null,
    });
    await this.anchor.write(pending);
    // Failure deliberately leaves pending intact: an old DB is indistinguishable from rollback.
    const result = this.repository.commit(operation, change);
    const observed = await this.anchor.read();
    if (
      observed?.mode !== 'active' ||
      observed.pending?.operationId !== operation.operationId ||
      !sameManagedCheckpoint(observed.pending.to, operation.to) ||
      !sameManagedCheckpoint(this.repository.checkpoint(), operation.to)
    )
      throw new ManagedExecutionError('MANAGED_CHECKPOINT_CONFLICT');
    await this.anchor.write({ ...pending, committed: operation.to, pending: null });
    return result;
  }

  /** Repairs only a fully committed DB operation. Callers must still query the original key. */
  async recoverCommittedOperation(): Promise<boolean> {
    return exclusive(this.anchor.scope, async () => {
      const stored = await this.anchor.read();
      if (
        stored?.mode !== 'active' ||
        !stored.pending ||
        !sameManagedCheckpoint(stored.pending.to, this.repository.checkpoint())
      )
        return false;
      await this.anchor.write({ ...stored, committed: stored.pending.to, pending: null });
      return true;
    });
  }

  /** Must be durable before a host replaces its business DB. No resume happens implicitly. */
  async suspendForRestore(): Promise<void> {
    return exclusive(this.anchor.scope, async () => {
      const stored = settledResume(await this.anchor.read(), this.repository.checkpoint());
      if (!stored) {
        if (this.repository.checkpoint()) throw new ManagedExecutionError('MANAGED_ANCHOR_MISSING');
        return;
      }
      await this.anchor.write({ ...stored, mode: 'query_only', reason: 'restore_pending' });
    });
  }

  async canResumeMatchingCheckpoint(): Promise<boolean> {
    return exclusive(this.anchor.scope, async () => {
      const raw = await this.anchor.read();
      const checkpoint = this.repository.checkpoint();
      return matchesResume(settledResume(raw, checkpoint), checkpoint);
    });
  }

  /**
   * Explicit resume has one activation point: the synchronous SQLite CAS, after a durable
   * prepared anchor and the final live-review check. Pending alone never permits spending.
   */
  async resumeMatchingCheckpoint(assertCurrent: () => void = () => undefined): Promise<void> {
    return exclusive(this.anchor.scope, async () => {
      assertCurrent();
      const raw = await this.anchor.read();
      assertCurrent();
      const checkpoint = this.repository.checkpoint();
      const stored = settledResume(raw, checkpoint);
      if (!matchesResume(stored, checkpoint))
        throw new ManagedExecutionError('MANAGED_RECONCILIATION_REQUIRED');
      if (stored.mode === 'active' && !stored.pending) return;
      const operation =
        stored.pending ?? planManagedOperation(checkpoint, 'resume', { version: 1 });
      const pending: ManagedExecutionAnchor = {
        ...stored,
        pending: operation,
        mode: 'active',
        reason: null,
      };
      await this.anchor.write(pending);
      assertCurrent();
      const observed = await this.anchor.read();
      assertCurrent();
      if (
        observed?.mode !== 'active' ||
        observed.pending?.operationId !== operation.operationId ||
        !sameManagedCheckpoint(observed.pending.to, operation.to)
      )
        throw new ManagedExecutionError('MANAGED_CHECKPOINT_CONFLICT');
      // No await from this live review check through the transaction commit.
      this.repository.commit(operation, assertCurrent);
      // This is compaction of an already committed authorization, not another activation.
      // Readers recognize exactly pending.resume.to == SQLite; a failed cleanup cannot undo
      // a valid commit or grant one when the database is still at operation.from.
      await this.anchor
        .write({ ...pending, committed: operation.to, pending: null })
        .catch(() => undefined);
    });
  }
}
