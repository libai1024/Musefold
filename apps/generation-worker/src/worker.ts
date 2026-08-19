import { run } from 'graphile-worker';
import { loadWorkerConfig } from './config.js';
import { startHeartbeat } from './heartbeat.js';
import { createTaskList } from './tasks.js';
import { createStorageClient, ensureStorageBucket } from './storage.js';

const config = loadWorkerConfig();
const storage = createStorageClient(config);
await ensureStorageBucket(storage, config);
const heartbeat = await startHeartbeat(
  config.DATABASE_URL,
  config.WORKER_HEARTBEAT_INTERVAL_MS,
);
const runner = await run({
  connectionString: config.DATABASE_URL,
  concurrency: config.WORKER_CONCURRENCY,
  pollInterval: config.WORKER_POLL_INTERVAL_MS,
  noHandleSignals: false,
  taskList: createTaskList(config, storage),
});

try {
  await runner.promise;
} finally {
  await heartbeat.stop();
  storage.destroy();
}
