import type { MusefoldDatabase } from './client.js';
import { sql } from 'drizzle-orm';

type RetentionTransaction = Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];

/** Bound each lock wait without changing a pooled connection's later callers. */
export function runRetentionTransaction<T>(
  db: MusefoldDatabase,
  operation: (tx: RetentionTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // A busy foreground writer wins. PostgreSQL aborts this entire batch; a later
    // maintenance attempt can retry instead of holding a worker indefinitely.
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    return operation(tx);
  });
}
