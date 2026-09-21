import { captureDatabaseAccess, getDb } from '@musefold/core/db/index';
import {
  ManagedExecutionRepository,
  ManagedExecutionError,
} from '@musefold/core/db/repositories/managed-execution';
import { ManagedExecutionGuard } from '@musefold/core/services/managed-execution-guard';
import { createManagedExecutionAnchor } from '../security/managed-execution-anchor';
import { getPaths } from './paths';

/** Process-owned work only. Every future managed POST/poll/download must use this scope. */
export class ManagedExecutionWorkScope {
  private accepting = true;
  private exclusive = false;
  private readonly active = new Map<AbortController, Promise<unknown>>();

  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.accepting)
      return Promise.reject(new ManagedExecutionError('MANAGED_RESTART_REQUIRED'));
    if (this.exclusive) return Promise.reject(new ManagedExecutionError('MANAGED_ENABLEMENT_BUSY'));
    const controller = new AbortController();
    const result = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new ManagedExecutionError('MANAGED_RESTART_REQUIRED');
      return work(controller.signal);
    });
    this.active.set(controller, result);
    const cleanup = () => this.active.delete(controller);
    void result.then(cleanup, cleanup);
    return result;
  }

  /** No budget write or managed operation may enter during explicit lineage enablement. */
  runExclusive<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.exclusive || this.active.size > 0)
      return Promise.reject(new ManagedExecutionError('MANAGED_ENABLEMENT_BUSY'));
    const result = this.run(work);
    this.exclusive = true;
    return result.finally(() => {
      this.exclusive = false;
    });
  }

  async drainForRestore(timeoutMs = 20_000): Promise<void> {
    this.accepting = false;
    for (const controller of this.active.keys()) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.active.values()]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new ManagedExecutionError('MANAGED_DRAIN_TIMEOUT')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

const scopes = new Map<string, ManagedExecutionWorkScope>();
export function managedExecutionWorkScope(): ManagedExecutionWorkScope {
  const scope = getPaths().userData;
  let value = scopes.get(scope);
  if (!value) {
    value = new ManagedExecutionWorkScope();
    scopes.set(scope, value);
  }
  return value;
}

/** Does not enable a lineage. The caller must explicitly request enable/resume through the guard. */
export function withManagedExecution<T>(
  work: (context: {
    signal: AbortSignal;
    assertCurrent(): void;
    guard: ManagedExecutionGuard;
  }) => Promise<T>,
  exclusive = false,
): Promise<T> {
  const assertDb = captureDatabaseAccess();
  const guard = new ManagedExecutionGuard(
    new ManagedExecutionRepository(getDb()),
    createManagedExecutionAnchor(),
  );
  const scope = managedExecutionWorkScope();
  const run = exclusive ? scope.runExclusive.bind(scope) : scope.run.bind(scope);
  return run(async (signal) => {
    const assertCurrent = () => {
      assertDb();
      if (signal.aborted) throw new ManagedExecutionError('MANAGED_OPERATION_ABORTED');
    };
    assertCurrent();
    const result = await work({ signal, assertCurrent, guard });
    assertCurrent();
    return result;
  });
}
