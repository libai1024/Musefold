import { createDatabase } from '@musefold/db';
import { DesignSchemePackageService } from '../../modules/design-scheme-packages/service.js';
import { S3DesignSchemeAssetStorage } from '../../modules/design-scheme-assets/storage.js';
import { packageFixture } from '../../modules/design-scheme-packages/__tests__/fixture.js';
import { loadEnv } from '../../env.js';
const database = createDatabase(process.env.DATABASE_URL ?? '');
const storage = new S3DesignSchemeAssetStorage(loadEnv(process.env), 256 * 1024 * 1024);
const [mode, owner, sessionId, id] = process.argv.slice(2);
const service = new DesignSchemePackageService(
  database.db,
  mode === 'hold-after-put'
    ? {
        read: (key) => storage.read(key),
        put: async (...args) => {
          await storage.put(...args);
          await new Promise<void>(() => undefined);
        },
      }
    : storage,
);
process.stdout.write(`PACKAGE_PID=${process.pid}\n`);
try {
  if (mode === 'upload') {
    // Plain upload against whatever S3_ENDPOINT points at (a holding proxy in
    // service-boundary tests); the result line marks the committed confirm.
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(await packageFixture());
        controller.close();
      },
    });
    const result = await service.upload(owner, sessionId, id, body);
    process.stdout.write(`PACKAGE_RESULT=${JSON.stringify(result)}\n`);
  } else if (mode === 'hold' || mode === 'hold-after-put') {
    const keepAlive = setInterval(() => undefined, 1000);
    try {
      const body =
        mode === 'hold'
          ? new ReadableStream<Uint8Array>()
          : new ReadableStream<Uint8Array>({
              async start(controller) {
                controller.enqueue(await packageFixture());
                controller.close();
              },
            });
      await service.upload(owner, sessionId, id, body);
    } finally {
      clearInterval(keepAlive);
    }
  } else process.stdout.write(`PACKAGE_RESULT=${JSON.stringify(await service.get(owner, id))}\n`);
} finally {
  storage.destroy();
  await database.pool.end();
}
