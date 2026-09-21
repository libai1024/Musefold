/** Isolated process entry for runtime tests; production task/lease/HTTP/S3 paths stay intact. */
import { S3Client } from '@aws-sdk/client-s3';
import { createDatabase } from '@musefold/db';
import { run } from 'graphile-worker';
import { loadEnv } from '../../env.js';
import { generateImage } from '../../image-gateway.js';
import { GenerationLease, createTaskList, uploadImagesForGeneration } from '../../tasks.js';

if (process.env.WORKER_PROCESS_TEST !== '1' || !process.send) {
  throw new Error('This entry requires an isolated test process with IPC');
}

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL, { max: 4 });
pool.on('error', (error) => {
  throw error;
});
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  maxAttempts: 1,
});
let release: (() => void) | undefined;
let lease: GenerationLease | undefined;
const notify = (message: Record<string, unknown>) =>
  process.send?.({ ...message, pid: process.pid });
async function barrier(phase: string) {
  if (process.env.WORKER_PAUSE_AT !== phase) return;
  await new Promise<void>((resolve) => {
    release = resolve;
    notify({ type: 'barrier', phase, epoch: lease?.epoch });
  });
}

const taskList = createTaskList({
  db,
  env,
  s3,
  createLease: (...args) => {
    lease = new GenerationLease(...args);
    return lease;
  },
  generate: async (request, references, options) => {
    await barrier('before-upstream');
    return generateImage(request, references, {
      ...options,
      claimUpstreamRequest: async () => {
        const snapshot = await options.claimUpstreamRequest();
        if (snapshot) await barrier('after-claim');
        return snapshot;
      },
    });
  },
  upload: async (...args) => {
    const uploaded = await uploadImagesForGeneration(...args);
    await barrier('after-upload');
    return uploaded;
  },
});
for (const [name, task] of Object.entries(taskList)) {
  if (!task) continue;
  taskList[name] = async (payload, helpers) => {
    await task(payload, helpers);
    notify({ type: 'task-finished', task: name });
  };
}

process.on('message', (message: { type?: string }) => {
  if (message.type === 'release') release?.();
  if (message.type === 'renew') {
    void lease?.renewNow().then(() => notify({ type: 'renewed', lost: lease?.isLost }));
  }
});
await barrier('before-runner');
const runner = await run({
  pgPool: pool,
  concurrency: 1,
  pollInterval: 50,
  noHandleSignals: true,
  taskList,
});
notify({ type: 'ready' });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  release?.();
  await runner.stop();
  s3.destroy();
  await pool.end();
  notify({ type: 'stopped' });
  process.disconnect();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('disconnect', () => void shutdown());
await runner.promise;
