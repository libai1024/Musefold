import { ManagedExecutionError } from '@musefold/core/db/repositories/managed-execution';

/** Admission for the old in-memory managed budget. Unknown reservations remain held. */
export class LegacyManagedSpendBarrier {
  private held = 0;
  private paused = false;
  private retired = false;

  reserve(): () => void {
    if (this.paused || this.retired)
      throw new ManagedExecutionError('MANAGED_LEGACY_ADMISSION_CLOSED');
    this.held += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held -= 1;
    };
  }

  retire(): void {
    this.retired = true;
  }

  async whileIdle<T>(work: () => Promise<T>): Promise<T> {
    if (this.paused) throw new ManagedExecutionError('MANAGED_ENABLEMENT_BUSY');
    if (this.held > 0) throw new ManagedExecutionError('MANAGED_LEGACY_SPEND_UNRESOLVED');
    this.paused = true;
    try {
      return await work();
    } finally {
      this.paused = false;
    }
  }
}

export const legacyManagedSpendBarrier = new LegacyManagedSpendBarrier();
