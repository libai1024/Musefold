import { sql, type Kysely, type Transaction } from 'kysely';
import type { MusefoldDatabase } from './types.js';

export type OwnerTransaction = Transaction<MusefoldDatabase>;

interface OwnerTransactionOptions {
  isolationLevel?: 'read committed' | 'repeatable read' | 'serializable';
}

/** Every owner-scoped query runs inside a transaction-local RLS context. */
export async function withOwnerTransaction<T>(
  db: Kysely<MusefoldDatabase>,
  ownerId: number,
  callback: (trx: OwnerTransaction) => Promise<T>,
  options: OwnerTransactionOptions = {},
): Promise<T> {
  const transaction = options.isolationLevel
    ? db.transaction().setIsolationLevel(options.isolationLevel)
    : db.transaction();
  return transaction.execute(async (trx) => {
    await sql`SELECT set_config('app.owner_id', ${String(ownerId)}, true)`.execute(
      trx,
    );
    return callback(trx);
  });
}
