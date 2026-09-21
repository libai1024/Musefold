import { S3Client } from '@aws-sdk/client-s3';
import { createDatabase } from '../../../packages/db/src/index';
import {
  PostgresObjectCleanupStore,
  processObjectCleanupBatch,
} from '../../../apps/worker/src/tasks';

const environment: NodeJS.ProcessEnv = process.env;
const databaseUrl = environment.DATABASE_URL;
const maintenanceAt = environment.PURGE_MAINTENANCE_AT;
if (!databaseUrl || !maintenanceAt) throw new Error('Missing isolated cleanup fixture settings');
const database = createDatabase(databaseUrl);
const client = new S3Client({
  endpoint: environment.PURGE_STORAGE_ENDPOINT,
  region: 'us-east-1',
  forcePathStyle: true,
  maxAttempts: 1,
  credentials: {
    accessKeyId: 'gc-fixture-owner',
    secretAccessKey: 'synthetic-gc-storage-password',
  },
  requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
});
try {
  const result = await processObjectCleanupBatch(
    new PostgresObjectCleanupStore(database.db),
    client,
    'gc-fixture',
    undefined,
    new Date(maintenanceAt),
  );
  process.stdout.write(JSON.stringify({ pid: process.pid, ...result }));
} finally {
  client.destroy();
  await database.pool.end();
}
