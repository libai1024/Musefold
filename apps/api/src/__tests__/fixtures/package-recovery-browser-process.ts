/** Actual package HTTP/PG/S3/ZIP fixture; identity resolution is explicitly synthetic. */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createDatabase } from '@musefold/db';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { DesignSchemePackageService } from '../../modules/design-scheme-packages/service.js';
import { DesignSchemePackageImportService } from '../../modules/design-scheme-packages/import-service.js';
import { DesignSchemePackageExportService } from '../../modules/design-scheme-packages/export-service.js';
import { designSchemePackageExportRoutes } from '../../modules/design-scheme-packages/export-routes.js';
import { designSchemePackageRoutes } from '../../modules/design-scheme-packages/routes.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { designSchemeRoutes } from '../../modules/design-schemes/routes.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import { importFixture } from '../../modules/design-scheme-packages/__tests__/import-fixture.js';
import { seedGenerationAuthority, generationAuthSession } from './generation-authority.js';

if (process.env.PACKAGE_RECOVERY_BROWSER_TEST !== '1' || !process.send)
  throw new Error('Requires isolated browser test process');

const owner = 'package-browser-owner';
const container = await new PostgreSqlContainer('postgres:17-alpine').start();
const database = createDatabase(container.getConnectionUri(), { max: 10 });
await promisify(execFile)('pnpm', ['run', 'db:migrate'], {
  cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
  env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
});
await database.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [
  owner,
  `${owner}@example.test`,
]);
await seedGenerationAuthority(database.db, { principalId: owner, ownerId: owner });
const s3 = await startS3Fixture(256 * 1024 * 1024);
const staging = new DesignSchemePackageService(database.db, s3.storage);
const assets = new DesignSchemeAssetService(database.db, s3.storage);
const importer = new DesignSchemePackageImportService(database.db, s3.storage, assets);
const schemes = new DesignSchemeService(database.db, assets, undefined, undefined, importer);
let exportReads = 0;
const exporter = new DesignSchemePackageExportService(
  database.db,
  {
    read: (key, limit) => {
      exportReads++;
      return s3.storage.read(key, limit);
    },
    put: (key, value, mime) => s3.storage.put(key, value, mime),
  },
  schemes,
  assets,
);
const bytes = await (await importFixture()).encode();
const calls: Array<{ method: string; path: string }> = [];
const app = new OpenAPIHono<AuthedEnv>();
app.use('*', async (c, next) => {
  calls.push({ method: c.req.method, path: c.req.path });
  if (c.req.header('x-package-fixture-owner') !== owner)
    return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', owner);
  c.set('sessionId', generationAuthSession(owner));
  await next();
});
app.onError((error, c) => {
  if (error instanceof AppError)
    return c.json(toErrorBody(error, randomUUID()), error.status as 400);
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Fixture request failed',
        retryable: false,
        requestId: randomUUID(),
      },
    },
    500,
  );
});
app.get('/account/status', (c) =>
  c.json({
    id: owner,
    username: 'fixture',
    displayName: '隔离测试账号',
    quota: 0,
    quotaUnit: '积分',
    canGenerate: false,
  }),
);
app.get('/workbench/sessions', (c) => c.json({ items: [], nextCursor: null }));
app.get('/generations/providers', (c) => c.json([]));
app.route('/', designSchemePackageRoutes(staging));
app.route('/', designSchemePackageExportRoutes(exporter));
app.route('/', designSchemeRoutes(schemes));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No fixture address');
process.send({
  type: 'ready',
  result: { baseUrl: `http://127.0.0.1:${address.port}`, owner, bytes: bytes.toString('base64') },
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  if ('closeAllConnections' in server) server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await s3.close();
  await database.pool.end();
  await container.stop();
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('disconnect', () => void close());
process.on('message', (message: { id: number; action: string }) => {
  void (async () => {
    if (message.action === 'qualify-export') {
      const [row] = (
        await database.pool.query(
          "SELECT result FROM design_scheme_package_imports WHERE status='completed'",
        )
      ).rows;
      if (!row) throw new Error('Import a real package first');
      const result = row.result;
      const detail = await schemes.get(owner, {
        id: result.scheme.id,
        revision: { kind: 'current' },
      });
      // Qualification fixture only: actual import/cover/formalize services, SQL successful trial.
      // This does not stand in for the separate Agent/worker trial-to-formal joint acceptance.
      await database.pool.query(
        "INSERT INTO design_scheme_runs (run_id,user_id,scheme_id,revision_id,mode,status,policy,completed_at) VALUES ($1,$2,$3,$4,'trial','completed','{}',now())",
        [randomUUID(), owner, result.scheme.id, result.revisionId],
      );
      const covered = await schemes.selectCover(owner, {
        schemeId: result.scheme.id,
        assetId: detail.assets[0].id,
        expectedVersion: detail.summary.version,
      });
      await schemes.formalize(owner, {
        schemeId: result.scheme.id,
        revisionId: result.revisionId,
        coverAssetId: detail.assets[0].id,
        expectedVersion: covered.scheme.version,
        confirmed: true,
      });
      return null;
    }
    if (message.action !== 'snapshot') throw new Error('Unknown fixture action');
    return {
      stages: (
        await database.pool.query('SELECT id,request_id,status FROM design_scheme_package_stages')
      ).rows,
      imports: (
        await database.pool.query(
          'SELECT stage_id,status,epoch,result FROM design_scheme_package_imports',
        )
      ).rows,
      schemes: (await database.pool.query('SELECT id,deleted_at FROM design_schemes')).rows,
      assets: (await database.pool.query('SELECT id FROM design_scheme_assets')).rows,
      exports: (
        await database.pool.query(
          'SELECT id,request_id,status,package_hash,size_bytes FROM design_scheme_package_exports',
        )
      ).rows,
      exportReads,
      writes: s3.writes.length,
      calls,
    };
  })().then(
    (result) => process.send?.({ id: message.id, result }),
    () => process.send?.({ id: message.id, error: 'Fixture operation failed' }),
  );
});
