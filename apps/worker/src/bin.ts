import { S3Client } from '@aws-sdk/client-s3';
import { createDatabase } from '@musefold/db';
import { run } from 'graphile-worker';
import { loadEnv } from './env.js';
import { createTaskList } from './tasks.js';
import { ensureStorageBucket } from './storage-bootstrap.js';

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 2 });
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

try {
  if ((await ensureStorageBucket(s3, env)) === 'created') {
    console.log('[worker] created missing S3 bucket');
  }
} catch {
  // Do not consume jobs (or expose upstream diagnostics) when storage bootstrap failed.
  console.error('[worker] S3 bucket unavailable');
  s3.destroy();
  try {
    await pool.end();
  } finally {
    process.exit(1);
  }
}

const runner = await run({
  pgPool: pool,
  concurrency: env.WORKER_CONCURRENCY,
  // This entry owns shutdown, including S3 and the shared PG pool.
  noHandleSignals: true,
  taskList: createTaskList({ db, env, s3 }),
  // graphile-worker crontab 命令名不允许点号(`generation.reconcile` 会启动失败);
  // 斜杠标识与 taskList 里的 dotted 名并存,add_job 仍走 generation.generate。
  crontab: [
    '* * * * * generation/reconcile',
    '17 * * * * maintenance/cleanup',
    '*/5 * * * * maintenance/inventory',
  ].join('\n'),
});

console.log('[worker] generation worker started');

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  try {
    await runner.stop();
    s3.destroy();
    await pool.end();
    process.exit(0);
  } catch (error) {
    // Do not emit upstream/database diagnostics or report a failed stop as clean.
    console.error('[worker] shutdown failed', error instanceof Error ? error.name : 'unknown');
    process.exit(1);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await runner.promise;
