import { createDatabase } from '@musefold/db';
import { trimExpiredSyncRecords } from '../../sync-retention.js';
import { purgeExpiredSoftDeletedPrompts } from '../../retention.js';

if (process.env.RUN_SYNC_RETENTION_TEST !== '1' || !process.send || !process.env.DATABASE_URL) {
  throw new Error('Requires an isolated sync-retention test process');
}
const now = new Date(process.env.MAINTENANCE_AT ?? '');
if (!Number.isFinite(now.getTime())) throw new Error('Requires an explicit maintenance clock');
const operation = process.env.MAINTENANCE_OPERATION ?? 'sync';
if (operation !== 'sync' && operation !== 'prompts')
  throw new Error('Unknown maintenance operation');
const { db, pool } = createDatabase(process.env.DATABASE_URL, { max: 2 });
try {
  const stats =
    operation === 'sync'
      ? await trimExpiredSyncRecords(db, now)
      : await purgeExpiredSoftDeletedPrompts(db, now);
  process.send({ pid: process.pid, maintenanceAt: now.toISOString(), stats });
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
