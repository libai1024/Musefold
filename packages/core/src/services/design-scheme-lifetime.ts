import type Database from 'better-sqlite3';

// The app/CLI owner lock excludes a second host. These holds cover asynchronous work
// before and after persisted run status changes, including cancellation still draining IO.
const held = new WeakMap<Database.Database, Map<string, number>>();

export function retainDesignSchemeOperation(db: Database.Database, schemeId: string): () => void {
  let schemes = held.get(db);
  if (!schemes) {
    schemes = new Map();
    held.set(db, schemes);
  }
  schemes.set(schemeId, (schemes.get(schemeId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (schemes.get(schemeId) ?? 1) - 1;
    if (remaining > 0) schemes.set(schemeId, remaining);
    else schemes.delete(schemeId);
  };
}

export function isDesignSchemeOperationActive(db: Database.Database, schemeId: string): boolean {
  return (held.get(db)?.get(schemeId) ?? 0) > 0;
}
