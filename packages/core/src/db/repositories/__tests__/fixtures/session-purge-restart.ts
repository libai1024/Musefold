import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { migrateAndRemoveLegacyRecipeDatabase } from '../../../index';
import { createWorkbenchRepositories } from '../../workbench';

const [path, directory, id] = process.argv.slice(2);
if (!path || !directory || !id) throw new Error('Missing owned fixture arguments');
const db = new Database(path);
try {
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  migrateAndRemoveLegacyRecipeDatabase(db, directory);
  let ensureRejected = false;
  try {
    createWorkbenchRepositories(db).sessions.ensure({ id, title: 'Late generation' });
  } catch (error) {
    ensureRejected = String(error).includes('已永久删除');
  }
  process.stdout.write(
    JSON.stringify({
      pid: process.pid,
      ensureRejected,
      sessions: db.prepare('SELECT * FROM workbench_sessions').all(),
      runs: db.prepare('SELECT id,workbench_session_id,actual_cost FROM generation_runs').all(),
      assets: db.prepare('SELECT id,run_id,media_path FROM generated_assets').all(),
      deletions: db.prepare('SELECT id FROM workbench_session_deletions').all(),
      foreignKeys: db.pragma('foreign_key_check'),
    }),
  );
} finally {
  db.close();
}
