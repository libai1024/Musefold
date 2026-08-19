import { runMigrations } from 'graphile-worker';
import { loadWorkerConfig } from './config.js';

const config = loadWorkerConfig();
await runMigrations({ connectionString: config.DATABASE_URL });
