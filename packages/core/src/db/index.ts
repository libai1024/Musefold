// electron/db/index.ts
// SQLite 连接初始化 + WAL + 迁移

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { APP_DATA_NAMESPACE } from '@musefold/domain/constants';
import { createLogger, getPaths } from '../runtime';
import { runMigrations } from './run-migrations';
import { repairPromptFtsIndex } from './prompt-fts-upgrade';

let dbInstance: Database.Database | null = null;
// A restore requires a real process restart. closeDb must not clear this barrier: otherwise a
// late callback could lazily open the replacement database and write an old operation into it.
const restoringDatabases = new Set<string>();
let databaseEpoch = 0;

function assertDatabaseAvailable(): void {
  if (restoringDatabases.has(getPaths().db)) {
    const error = new Error('数据库恢复期间不可访问，请重启应用');
    Object.assign(error, { code: 'DATABASE_RESTART_REQUIRED' });
    throw error;
  }
}

/** Capture before asynchronous work; check again before committing a host-owned result. */
export function captureDatabaseAccess(): () => void {
  assertDatabaseAvailable();
  const epoch = databaseEpoch;
  const path = getPaths().db;
  const db = getDb();
  return () => {
    assertDatabaseAvailable();
    if (epoch !== databaseEpoch || path !== getPaths().db || db !== dbInstance || !db.open) {
      const error = new Error('数据库生命周期已变化，请重新读取');
      Object.assign(error, { code: 'STALE_DATABASE_EPOCH' });
      throw error;
    }
  };
}

/** Only the restore owner retains this old handle for its safety snapshot and final close. */
export function beginDatabaseRestore(): { db: Database.Database; close(): void } {
  const db = getDb();
  restoringDatabases.add(getPaths().db);
  databaseEpoch += 1;
  return { db, close: () => closeDb() };
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

export function migrateAndRemoveLegacyRecipeDatabase(
  mainDb: Database.Database,
  userData = getPaths().userData,
): void {
  const path = join(userData, `musefold-recipe-data-${APP_DATA_NAMESPACE}.db`);
  if (!existsSync(path)) {
    for (const suffix of ['-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
    return;
  }

  const legacy = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (
      tableExists(legacy, 'workbench_sessions') &&
      tableExists(legacy, 'generation_runs') &&
      tableExists(legacy, 'generated_assets')
    ) {
      const legacySessions = legacy
        .prepare(
          `SELECT id, title, created_at, updated_at, archived_at, deleted_at
         FROM workbench_sessions`,
        )
        .all() as Array<Record<string, unknown>>;
      const runs = legacy
        .prepare(
          `SELECT id, run_kind, workbench_session_id, workbench_turn_id, turn_index, result_index,
                parent_run_id, retry_of_run_id, source_asset_id, provider_id, model, user_prompt,
                base_prompt, refinement_instruction, final_prompt, negative_prompt, params_json,
                prompt_snapshot_json, status, error_code, error_message, request_id, estimated_cost,
                actual_cost, duration_ms, created_at, started_at, finished_at, deleted_at
         FROM generation_runs
         WHERE run_kind IN ('free_generation', 'refinement', 'retry')
         ORDER BY created_at, id`,
        )
        .all() as Array<Record<string, unknown>>;
      const runIds = new Set(runs.map((run) => String(run.id)));
      const sessionIds = new Set(
        runs
          .map((run) => run.workbench_session_id)
          .filter(Boolean)
          .map(String),
      );
      const sessions = legacySessions.filter((session) => sessionIds.has(String(session.id)));
      const assets = legacy
        .prepare(
          `SELECT id, run_id, position, status, media_path, mime_type, width, height,
                file_size, checksum, created_at
         FROM generated_assets`,
        )
        .all()
        .filter((asset) => runIds.has(String((asset as Record<string, unknown>).run_id))) as Array<
        Record<string, unknown>
      >;
      const assetIds = new Set(assets.map((asset) => String(asset.id)));

      const insertSession = mainDb.prepare(
        `INSERT OR IGNORE INTO workbench_sessions
          (id, title, created_at, updated_at, archived_at, deleted_at)
         VALUES (@id, @title, @created_at, @updated_at, @archived_at, @deleted_at)`,
      );
      const insertRun = mainDb.prepare(
        `INSERT OR IGNORE INTO generation_runs
          (id, run_kind, workbench_session_id, workbench_turn_id, turn_index, result_index,
           parent_run_id, retry_of_run_id, source_asset_id, provider_id, model, user_prompt,
           base_prompt, refinement_instruction, final_prompt, negative_prompt, params_json,
           prompt_snapshot_json, status, error_code, error_message, request_id, estimated_cost,
           actual_cost, duration_ms, created_at, started_at, finished_at, deleted_at)
         VALUES
          (@id, @run_kind, @workbench_session_id, @workbench_turn_id, @turn_index, @result_index,
           @parent_run_id, @retry_of_run_id, @source_asset_id, @provider_id, @model, @user_prompt,
           @base_prompt, @refinement_instruction, @final_prompt, @negative_prompt, @params_json,
           @prompt_snapshot_json, @status, @error_code, @error_message, @request_id, @estimated_cost,
           @actual_cost, @duration_ms, @created_at, @started_at, @finished_at, @deleted_at)`,
      );
      const insertAsset = mainDb.prepare(
        `INSERT OR IGNORE INTO generated_assets
          (id, run_id, position, status, media_path, mime_type, width, height, file_size, checksum, created_at)
         VALUES
          (@id, @run_id, @position, @status, @media_path, @mime_type, @width, @height,
           @file_size, @checksum, @created_at)`,
      );

      mainDb.transaction(() => {
        // The legacy migration harness can merge before Drizzle takeover; permanent
        // Session identities only exist after managed migration 0011.
        const retired = tableExists(mainDb, 'workbench_session_deletions')
          ? mainDb.prepare('SELECT 1 FROM workbench_session_deletions WHERE id=?')
          : undefined;
        for (const session of sessions) {
          if (!retired?.get(String(session.id))) insertSession.run(session);
        }
        for (const run of runs) {
          insertRun.run({
            ...run,
            workbench_session_id:
              run.workbench_session_id && retired?.get(String(run.workbench_session_id))
                ? null
                : run.workbench_session_id,
            parent_run_id: runIds.has(String(run.parent_run_id)) ? run.parent_run_id : null,
            retry_of_run_id: runIds.has(String(run.retry_of_run_id)) ? run.retry_of_run_id : null,
            source_asset_id: assetIds.has(String(run.source_asset_id)) ? run.source_asset_id : null,
          });
        }
        for (const asset of assets) insertAsset.run(asset);
      })();
    }
  } finally {
    legacy.close();
  }

  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
}

function recoverInterruptedGenerationRuns(db: Database.Database): void {
  const now = Date.now();
  db.prepare(
    `UPDATE generation_runs
     SET status = 'failed', error_code = 'INTERRUPTED',
         error_message = '应用上次退出时生成未完成', finished_at = ?
     WHERE status IN ('queued', 'running') AND NOT EXISTS (
       SELECT 1 FROM automation_spend_requests s
       JOIN managed_generation_requests m ON m.request_id = s.id
       WHERE s.execution_id = generation_runs.id
     )`,
  ).run(now);
}

export function getDb(): Database.Database {
  assertDatabaseAvailable();
  // 正常启动流程里 initDb() 已在 app.whenReady 中调用，dbInstance 非空。
  // 但 dev 下 electron-vite 对主进程做 soft-reload 时，本模块会被重新求值
  // （dbInstance 被重置为 null），而 app.whenReady 不会再次触发，导致
  // 「DB not initialized」。此处惰性兜底：为空则就地初始化。
  // 生产环境正常只初始化一次，无副作用。
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

export function initDb(): Database.Database {
  assertDatabaseAvailable();
  if (dbInstance) return dbInstance;
  const paths = getPaths();
  mkdirSync(dirname(paths.db), { recursive: true });

  // 恢复流程先把当前库改名为 restore-previous，再把已校验快照原子移入。
  // 若进程恰好在两次 rename 之间退出，下次启动优先救回旧库，避免生成空库。
  const interruptedRestore = `${paths.db}.restore-previous`;
  if (!existsSync(paths.db) && existsSync(interruptedRestore)) {
    renameSync(interruptedRestore, paths.db);
  }

  const db = new Database(paths.db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  // legacy 链(冻结在 0020)终态后交给 drizzle 受管迁移收敛到当前 schema。
  // 下沉在 initDb 内做,任何宿主(桌面/CLI 守护/备份恢复重开)都不可能漏掉接管。
  const takeover = takeoverDesktopDatabase(db, { backupDir: paths.backups });
  if (takeover.mode !== 'noop') {
    createLogger('db').info(
      `desktop-db 接管:${takeover.mode}${takeover.backupPath ? `(备份 ${takeover.backupPath})` : ''}`,
    );
  }
  migrateAndRemoveLegacyRecipeDatabase(db, paths.userData);
  try {
    repairPromptFtsIndex(db);
  } catch (error) {
    db.close();
    throw error;
  }
  recoverInterruptedGenerationRuns(db);

  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    databaseEpoch += 1;
  }
}
