import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { createDatabase } from '@musefold/db';
import { loadEnv } from '../../env.js';
import { S3DesignSchemeAssetStorage } from '../../modules/design-scheme-assets/storage.js';
import { DesignSchemeSourcePreparationService } from '../../modules/design-schemes/source-preparation.js';
import { DesignSchemeAgentService } from '../../modules/design-scheme-agent/service.js';
const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const storage = new S3DesignSchemeAssetStorage(env);
const service = new DesignSchemeAgentService(
  database.db,
  new DesignSchemeSourcePreparationService(database.db, storage),
  env,
  new DesignSchemeAssetService(database.db, storage),
);
process.stdout.write(`TEXT_PID=${process.pid}\n`);
try {
  await service.process('agent-owner', process.argv[2]);
  process.stdout.write(
    `TEXT_RESULT=${JSON.stringify({ pid: process.pid, session: await service.get('agent-owner', process.argv[2]) })}\n`,
  );
} finally {
  storage.destroy();
  await database.pool.end();
}
