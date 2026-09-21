import { AppError } from '../../lib/errors.js';

/** One API application's shared bound for archive buffers, parsing and slow downloads. */
export class PackageOperationBudget {
  private active = 0;

  acquire(message: string): () => void {
    if (this.active >= 2) throw new AppError('VALIDATION_FAILED', message, 429, true);
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }
}
