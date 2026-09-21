import { createDatabase } from '@musefold/db';
import { loadEnv } from './env.js';
import { S3DesignSchemeAssetStorage } from './modules/design-scheme-assets/storage.js';
import { DesignSchemeAssetService } from './modules/design-scheme-assets/service.js';
import { DesignSchemeSourcePreparationService } from './modules/design-schemes/source-preparation.js';
import { DesignSchemeAgentService } from './modules/design-scheme-agent/service.js';
import { startDesignSchemeAgentWorker } from './modules/design-scheme-agent/worker.js';

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL, { max: 6 });
pool.on('error', () => console.error('[scheme-agent] database connection lost'));
const storage = new S3DesignSchemeAssetStorage(env);
const service = new DesignSchemeAgentService(
  db,
  new DesignSchemeSourcePreparationService(db, storage),
  env,
  new DesignSchemeAssetService(db, storage),
);
const runner = await startDesignSchemeAgentWorker(pool, service);
console.log(`[scheme-agent] worker started pid=${process.pid}`);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  try {
    await runner.stop();
    storage.destroy();
    await pool.end();
    process.exit(0);
  } catch {
    console.error('[scheme-agent] shutdown failed');
    process.exit(1);
  }
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
await runner.promise;
