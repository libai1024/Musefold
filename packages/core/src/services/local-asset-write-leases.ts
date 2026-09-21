import type Database from 'better-sqlite3';

// The host owner lock excludes other processes. Durable cleanup rows survive process
// death; only live operations in this process may protect a not-yet-published output.
const active = new WeakMap<Database.Database, Map<string, number>>();

export function retainLocalAssetWrite(db: Database.Database, path: string): () => void {
  let paths = active.get(db);
  if (!paths) {
    paths = new Map();
    active.set(db, paths);
  }
  paths.set(path, (paths.get(path) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (paths.get(path) ?? 1) - 1;
    if (remaining > 0) paths.set(path, remaining);
    else paths.delete(path);
  };
}

export function isLocalAssetWriteActive(db: Database.Database, path: string): boolean {
  return (active.get(db)?.get(path) ?? 0) > 0;
}
