// electron/db/index.ts
// SQLite 连接初始化 + WAL + 迁移

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { APP_DATA_NAMESPACE } from '@musefold/domain/constants';
import { getPaths } from '../runtime';
import { runMigrations } from './run-migrations';

let dbInstance: Database.Database | null = null;

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
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
      tableExists(legacy, 'workbench_sessions')
      && tableExists(legacy, 'generation_runs')
      && tableExists(legacy, 'generated_assets')
    ) {
      const legacySessions = legacy.prepare(
        `SELECT id, title, created_at, updated_at, archived_at, deleted_at
         FROM workbench_sessions`,
      ).all() as Array<Record<string, unknown>>;
      const runs = legacy.prepare(
        `SELECT id, run_kind, workbench_session_id, workbench_turn_id, turn_index, result_index,
                parent_run_id, retry_of_run_id, source_asset_id, provider_id, model, user_prompt,
                base_prompt, refinement_instruction, final_prompt, negative_prompt, params_json,
                prompt_snapshot_json, status, error_code, error_message, request_id, estimated_cost,
                actual_cost, duration_ms, created_at, started_at, finished_at, deleted_at
         FROM generation_runs
         WHERE run_kind IN ('free_generation', 'refinement', 'retry')
         ORDER BY created_at, id`,
      ).all() as Array<Record<string, unknown>>;
      const runIds = new Set(runs.map((run) => String(run.id)));
      const sessionIds = new Set(
        runs.map((run) => run.workbench_session_id).filter(Boolean).map(String),
      );
      const sessions = legacySessions.filter((session) => sessionIds.has(String(session.id)));
      const assets = legacy.prepare(
        `SELECT id, run_id, position, status, media_path, mime_type, width, height,
                file_size, checksum, created_at
         FROM generated_assets`,
      ).all().filter((asset) => runIds.has(String((asset as Record<string, unknown>).run_id))) as Array<Record<string, unknown>>;
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
        for (const session of sessions) insertSession.run(session);
        for (const run of runs) {
          insertRun.run({
            ...run,
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
     WHERE status IN ('queued', 'running')`,
  ).run(now);
}

export function getDb(): Database.Database {
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
  migrateAndRemoveLegacyRecipeDatabase(db, paths.userData);
  recoverInterruptedGenerationRuns(db);

  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
