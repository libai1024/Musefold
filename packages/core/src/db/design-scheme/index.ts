import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { getPaths } from '../../runtime';
import {
  DESIGN_SCHEME_DB_FILENAME,
  DESIGN_SCHEME_DB_NAMESPACE,
  DESIGN_SCHEME_DB_SCHEMA_VERSION,
} from './schema';
import {
  designSchemeDbMigrations,
  runDesignSchemeDbMigrations,
  type DesignSchemeDbMigration,
} from './migrations';

let dbInstance: Database.Database | null = null;
let dbPathInUse: string | null = null;

export interface InitDesignSchemeDbOptions {
  dbPath?: string;
  migrations?: ReadonlyArray<DesignSchemeDbMigration>;
}

export class DesignSchemeDbInitError extends Error {
  readonly code = 'DESIGN_SCHEME_DB_INIT_FAILED';
  readonly cause: unknown;
  readonly dbPath: string;

  constructor(dbPath: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to initialize design scheme database at ${dbPath}: ${message}`);
    this.name = 'DesignSchemeDbInitError';
    this.cause = cause;
    this.dbPath = dbPath;
  }
}

function removeSqliteFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function configureDb(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

function metaValue(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM design_scheme_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function verifyDb(db: Database.Database): void {
  const namespace = metaValue(db, 'namespace');
  if (namespace !== DESIGN_SCHEME_DB_NAMESPACE) {
    throw new Error(`Design scheme database namespace mismatch: ${namespace ?? 'missing'}`);
  }
  const schemaVersion = Number(metaValue(db, 'schema_version'));
  if (schemaVersion !== DESIGN_SCHEME_DB_SCHEMA_VERSION) {
    throw new Error(`Design scheme database schema version mismatch: ${schemaVersion}`);
  }
  const foreignKeys = Number(db.pragma('foreign_keys', { simple: true }));
  if (foreignKeys !== 1) {
    throw new Error('Design scheme database foreign_keys pragma is not enabled');
  }
}

/** 启动恢复：进程退出时仍未终态的方案运行统一落为 failed（不可能继续存在）。 */
function recoverInterruptedRuns(db: Database.Database): void {
  db.prepare(
    `UPDATE design_scheme_runs
        SET status = 'failed', completed_at = ?
      WHERE status IN ('planning', 'executing', 'evaluating')`,
  ).run(Date.now());
}

export function initDesignSchemeDb(options: InitDesignSchemeDbOptions = {}): Database.Database {
  const dbPath = options.dbPath ?? getDefaultDesignSchemeDbPath();
  if (dbInstance && dbPathInUse === dbPath) {
    return dbInstance;
  }
  const existedBeforeOpen = existsSync(dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath);
    configureDb(db);
    runDesignSchemeDbMigrations(db, options.migrations ?? designSchemeDbMigrations);
    verifyDb(db);
    recoverInterruptedRuns(db);
    dbInstance = db;
    dbPathInUse = dbPath;
    return db;
  } catch (error) {
    try {
      db?.close();
    } catch {
      // Keep the original initialization error.
    }
    if (!existedBeforeOpen) {
      removeSqliteFiles(dbPath);
    }
    if (dbInstance === db) {
      dbInstance = null;
      dbPathInUse = null;
    }
    throw new DesignSchemeDbInitError(dbPath, error);
  }
}

export function getDefaultDesignSchemeDbPath(userData = getPaths().userData): string {
  return join(userData, DESIGN_SCHEME_DB_FILENAME);
}

export function getDesignSchemeDb(): Database.Database {
  if (!dbInstance) return initDesignSchemeDb();
  return dbInstance;
}

export function closeDesignSchemeDb(): void {
  if (!dbInstance) return;
  dbInstance.close();
  dbInstance = null;
  dbPathInUse = null;
}
