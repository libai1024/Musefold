import { createDatabase } from '@musefold/db';
import { beginDesignSchemePackageExportSchema } from '@musefold/contracts';
import { DesignSchemePackageExportService } from '../../modules/design-scheme-packages/export-service.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { S3DesignSchemeAssetStorage } from '../../modules/design-scheme-assets/storage.js';
import { loadEnv } from '../../env.js';
const database = createDatabase(process.env.DATABASE_URL ?? '');
const storage = new S3DesignSchemeAssetStorage(loadEnv(process.env), 256 * 1024 * 1024);
const [mode, owner, session, raw] = process.argv.slice(2);
const input = beginDesignSchemePackageExportSchema.parse(JSON.parse(raw));
const timer = setInterval(() => undefined, 1000);
async function pause(point: string) {
  process.stdout.write(`EXPORT_POINT=${point}\n`);
  await new Promise<void>(() => undefined);
}
const assets = new DesignSchemeAssetService(database.db, storage);
const service = new DesignSchemePackageExportService(
  database.db,
  {
    async read(key, budget) {
      const bytes = await storage.read(key, budget);
      if (mode === 'hold-read') await pause('read');
      return bytes;
    },
    async put(...args) {
      await storage.put(...args);
      if (mode === 'hold-put') await pause('put');
    },
  },
  new DesignSchemeService(database.db, assets),
  assets,
);
process.stdout.write(`EXPORT_PID=${process.pid}\n`);
try {
  const result = await service.begin(owner, session, input);
  if (mode === 'hold-result') await pause('result');
  process.stdout.write(`EXPORT_RESULT=${JSON.stringify(result)}\n`);
} finally {
  clearInterval(timer);
  storage.destroy();
  await database.pool.end();
}
