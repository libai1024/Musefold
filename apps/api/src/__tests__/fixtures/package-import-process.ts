import { createDatabase } from '@musefold/db';
import { DesignSchemePackageImportService } from '../../modules/design-scheme-packages/import-service.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { S3DesignSchemeAssetStorage } from '../../modules/design-scheme-assets/storage.js';
import { loadEnv } from '../../env.js';
import { importDesignSchemeInputSchema } from '@musefold/contracts';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const storage = new S3DesignSchemeAssetStorage(loadEnv(process.env), 256 * 1024 * 1024);
const [mode, owner, session, raw] = process.argv.slice(2);
const input = importDesignSchemeInputSchema.parse(JSON.parse(raw));
const timer = setInterval(() => undefined, 1000);
async function pause(point: string) {
  process.stdout.write(`IMPORT_POINT=${point}\n`);
  await new Promise<void>(() => undefined);
}
const importer = new DesignSchemePackageImportService(
  database.db,
  {
    async read(key) {
      const bytes = await storage.read(key);
      if (mode === 'hold-read') await pause('read');
      return bytes;
    },
    async put(...args) {
      await storage.put(...args);
      if (mode === 'hold-put') await pause('put');
    },
  },
  new DesignSchemeAssetService(database.db, storage),
);
process.stdout.write(`IMPORT_PID=${process.pid}\n`);
try {
  const result = await importer.execute(owner, session, input);
  if (mode === 'hold-result') await pause('result');
  process.stdout.write(`IMPORT_RESULT=${JSON.stringify(result)}\n`);
} finally {
  clearInterval(timer);
  storage.destroy();
  await database.pool.end();
}
