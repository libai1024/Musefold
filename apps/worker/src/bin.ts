import { S3Client } from '@aws-sdk/client-s3';
import { createDatabase } from '@musefold/db';
import { run } from 'graphile-worker';
import { loadEnv } from './env.js';
import { createTaskList } from './tasks.js';

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

const runner = await run({
  pgPool: pool,
  concurrency: env.WORKER_CONCURRENCY,
  taskList: createTaskList({ db, env, s3 }),
  crontab: ['* * * * * generation.reconcile', '17 * * * * maintenance.cleanup'].join('\n'),
});

console.log('[worker] generation worker started');

const shutdown = async () => {
  await runner.stop();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await runner.promise;
