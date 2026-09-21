import type Database from 'better-sqlite3';

const writers = new WeakSet<Database.Database>();

/** Only the anchor coordinator's synchronous SQLite callback may enter this scope. */
export function withManagedSpendWrite<T>(db: Database.Database, change: () => T): T {
  if (!db.inTransaction || writers.has(db)) throw new Error('MANAGED_SPEND_TRANSACTION_REQUIRED');
  writers.add(db);
  try {
    return change();
  } finally {
    writers.delete(db);
  }
}

export function isManagedSpend(db: Database.Database, requestId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM managed_generation_requests WHERE request_id = ?').get(requestId),
  );
}

export function hasManagedSpendCheckpoint(db: Database.Database): boolean {
  // Legacy 0007 fixtures/data are allowed to seed their budget before the checkpoint migration.
  // Host writes still inspect the independent anchor, so an old restored DB is not auto-enabled.
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'managed_execution_checkpoint'",
      )
      .get()
  )
    return false;
  return Boolean(db.prepare('SELECT 1 FROM managed_execution_checkpoint WHERE id = 1').get());
}

/** Policy and opening usage affect every managed request, including an empty new lineage. */
export function assertSharedBudgetWrite(db: Database.Database): void {
  if (hasManagedSpendCheckpoint(db) && !writers.has(db)) coordinatorRequired();
}

function coordinatorRequired(): never {
  throw Object.assign(new Error('MANAGED_SPEND_COORDINATOR_REQUIRED'), {
    code: 'MANAGED_SPEND_COORDINATOR_REQUIRED',
  });
}

export function needsManagedSpendCoordinator(db: Database.Database, requestId: string): boolean {
  if (writers.has(db)) return false;
  if (isManagedSpend(db, requestId)) return true;
  if (!hasManagedSpendCheckpoint(db)) return false;
  // Older managed requests may predate remote associations. Their holds, calls and unknown
  // evidence still contribute to the same budget; a missing association is not a bypass.
  const affected = db
    .prepare(`SELECT 1 FROM automation_spend_requests r
    WHERE r.id = ? AND (r.reservation_state IN ('held', 'unknown') OR EXISTS (
      SELECT 1 FROM json_each(r.bindings_json) b
      WHERE json_extract(b.value, '$.policy') = 'managed'
    ))`)
    .get(requestId);
  return Boolean(affected);
}

export function assertManagedSpendWrite(db: Database.Database, requestId: string): void {
  if (needsManagedSpendCoordinator(db, requestId)) coordinatorRequired();
}
