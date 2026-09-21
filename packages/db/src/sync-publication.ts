import { sql } from 'drizzle-orm';
import type { MusefoldTransaction } from './client.js';

/**
 * Identity allocation is not commit ordered. A cursor snapshot must wait for all
 * existing appenders and exclude new appenders until its snapshot is pinned.
 *
 * LOCK is a utility command: acquire it BEFORE the first snapshot-producing
 * statement in a repeatable-read transaction. Taking an advisory lock with
 * SELECT after establishing that snapshot would still expose a stale gap.
 * Writers take their compatible ROW EXCLUSIVE mode before entity/device locks;
 * readers share with other readers, and writers remain concurrent with writers.
 * Readers MUST use REPEATABLE READ. Releasing a savepoint's locks after pinning
 * the transaction snapshot lets writes/trim proceed during the remaining reads.
 * No external I/O belongs inside these short database transactions.
 */
export async function lockSyncPublication(
  tx: Pick<MusefoldTransaction, 'execute'>,
  mode: 'read' | 'write' | 'trim',
): Promise<void> {
  if (mode === 'read') {
    await tx.execute(sql`SAVEPOINT sync_publication_snapshot`);
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await tx.execute(sql`LOCK TABLE sync_change_log IN SHARE MODE`);
    await tx.execute(sql`SELECT 1`);
    // The repeatable-read transaction snapshot survives a savepoint rollback;
    // locks and the local timeout acquired inside the savepoint do not.
    await tx.execute(sql`ROLLBACK TO SAVEPOINT sync_publication_snapshot`);
    await tx.execute(sql`RELEASE SAVEPOINT sync_publication_snapshot`);
    return;
  }
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
  if (mode === 'write') await tx.execute(sql`LOCK TABLE sync_change_log IN ROW EXCLUSIVE MODE`);
  else await tx.execute(sql`LOCK TABLE sync_change_log IN SHARE ROW EXCLUSIVE MODE`);
}
