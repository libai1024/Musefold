/** Isolated joint-test server: real Hono/PG/queue/worker; synthetic auth, image provider and S3. */
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { accountModelCatalogSchema } from '@musefold/contracts';
import { createNewApiClient } from '@musefold/new-api-client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from 'graphile-worker';
import sharp from 'sharp';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { AccountService } from '../../modules/account/service.js';
import { GenerationService } from '../../modules/generation/service.js';
import { generationRoutes } from '../../modules/generation/routes.js';
import { S3AssetUrlSigner } from '../../modules/generation/s3-signer.js';
import { loadEnv } from '../../env.js';
import { generationAuthSession, seedGenerationAuthority } from './generation-authority.js';

if (process.env.DESKTOP_CLOUD_JOINT_TEST !== '1' || !process.send)
  throw new Error('Joint fixture requires isolated IPC process');
const KEY = 'synthetic-joint-encryption-key';
const owners = ['joint-owner-a', 'joint-owner-b'];
const pngs = await Promise.all(
  Array.from({ length: 4 }, (_, index) =>
    sharp({
      create: {
        width: 3 + index,
        height: 2,
        channels: 4,
        background: ['#abcdef', '#123456', '#ffeedd', '#102030'][index],
      },
    })
      .png()
      .toBuffer(),
  ),
);
const png = pngs[0];
const objects = new Map<string, Buffer>();
const calls: Array<{
  method: string;
  path: string;
  key?: string | null;
  body?: unknown;
  status?: number;
}> = [];
const providerCalls: Array<{ body: unknown; authorized: boolean }> = [];
const held: Array<() => void> = [];
let holdProvider = false;
let providerStatus = 200;
let breakCreate = false;
let breakRetry = false;
let holdBinding = false;
let modelQuota = 120000;
let catalogAvailable = true;
const heldBindings: Array<() => void> = [];
function releaseBindings() {
  holdBinding = false;
  for (const release of heldBindings.splice(0)) release();
}
let breakAssets = false;
let baseUrl = '';
let worker: ChildProcess | undefined;
let workerClosed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
let workerOutput = '';
let listener: ReturnType<typeof getRequestListener> | undefined;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    listener?.(req, res);
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  if (url.pathname === '/v1/images/generations') {
    const body = JSON.parse(bytes.toString());
    providerCalls.push({
      body,
      authorized: req.headers.authorization === 'Bearer synthetic-joint-provider-key',
    });
    const finish = () => {
      res.writeHead(providerStatus, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          providerStatus === 200
            ? {
                data: Array.from({ length: body.n }, (_, index) => ({
                  b64_json: pngs[index].toString('base64'),
                })),
              }
            : { error: { message: 'synthetic provider failure' } },
        ),
      );
    };
    if (holdProvider) held.push(finish);
    else finish();
    return;
  }
  if (url.pathname === '/v1/images/edits') {
    const form = await new Request(`${baseUrl}${url.pathname}`, {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] ?? '' },
      body: Uint8Array.from(bytes),
    }).formData();
    const references = await Promise.all(
      [...form.values()]
        .filter((value) => typeof value !== 'string')
        .map(async (file) => ({
          hash: createHash('sha256')
            .update(Buffer.from(await file.arrayBuffer()))
            .digest('hex'),
        })),
    );
    providerCalls.push({
      body: {
        edits: true,
        model: form.get('model'),
        imageCount: references.length,
        references,
        byteLength: bytes.length,
      },
      authorized: req.headers.authorization === 'Bearer synthetic-joint-provider-key',
    });
    res.writeHead(providerStatus, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        providerStatus === 200
          ? { data: [{ b64_json: png.toString('base64') }] }
          : { error: { message: 'synthetic provider failure' } },
      ),
    );
    return;
  }
  const key = decodeURIComponent(url.pathname.replace(/^\/test-bucket\//, ''));
  if (req.method === 'PUT') {
    objects.set(key, bytes);
    res.writeHead(200, { ETag: '"fixture"' }).end();
  } else if (req.method === 'GET' && objects.has(key)) {
    const image = objects.get(key);
    if (!image) throw new Error('Missing fixture object');
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': image.length }).end(image);
  } else if (req.method === 'POST' && url.searchParams.has('delete')) {
    for (const match of bytes.toString().matchAll(/<Key>([^<]+)<\/Key>/g)) objects.delete(match[1]);
    res
      .writeHead(200, { 'content-type': 'application/xml' })
      .end('<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></DeleteResult>');
  } else res.writeHead(404).end();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing fixture port');
baseUrl = `http://127.0.0.1:${address.port}`;
const container = await new PostgreSqlContainer('postgres:17-alpine').start();
const database = createDatabase(container.getConnectionUri(), { max: 10 });
const connectionEnds: Promise<void>[] = [];
let poolErrors = 0;
database.pool.on('error', () => {
  poolErrors++;
});
database.pool.on('connect', (client) =>
  connectionEnds.push(new Promise<void>((resolve) => client.once('end', resolve))),
);
await migrateDatabase(database.db);
await runMigrations({ pgPool: database.pool });
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: container.getConnectionUri(),
  PUBLIC_BASE_URL: baseUrl,
  NEW_API_BASE_URL: baseUrl,
  BETTER_AUTH_SECRET: KEY,
  CREDENTIAL_ENCRYPTION_KEY: KEY,
  S3_ENDPOINT: baseUrl,
  S3_BUCKET: 'test-bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'test-access',
  S3_SECRET_ACCESS_KEY: 'test-secret',
});
const account = new AccountService({
  db: database.db,
  newApi: createNewApiClient(baseUrl),
  encryptionKey: KEY,
  apiIssuer: baseUrl,
  upstreamIssuer: baseUrl,
});
// The upstream catalog is controlled like auth/status. Binding, admission, PG, receipts
// and the generation worker remain production implementations in this joint fixture.
async function readModelCatalog(sessionId: string) {
  if (!catalogAvailable) throw new AppError('INTERNAL_ERROR', 'Synthetic catalog unavailable', 503);
  const binding = await account.getExecutionBinding(sessionId);
  if (binding.status !== 'available') throw new Error('Fixture account binding unavailable');
  const { apiIssuer, principalId, payer, credential } = binding;
  return accountModelCatalogSchema.parse({
    identity: { apiIssuer, principalId, payer, credential },
    group: 'fixture',
    checkedAt: new Date().toISOString(),
    models: ['musefold-image-pro', 'gpt-image-2'].map((model, index) => ({
      model,
      imageGeneration: true,
      supportedEndpointTypes: ['image-generation'],
      pricing: {
        kind: 'per_call',
        baseUsd: index ? modelQuota / 1500000 : 0.04,
        groupRatio: 3,
        quotaPerCall: index ? modelQuota : 60000,
      },
    })),
  });
}
const generation = new GenerationService(
  database.db,
  new S3AssetUrlSigner(env),
  {
    apiIssuer: baseUrl,
    upstreamIssuer: baseUrl,
  },
  readModelCatalog,
);
const app = new OpenAPIHono<AuthedEnv>();
app.onError((error, c) => {
  if (error instanceof AppError)
    return c.json(toErrorBody(error, 'joint-fixture'), error.status as 400);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: String(error) } }, 500);
});
app.post('/api/auth/sign-in/new-api', async (c) => {
  const body = await c.req.json();
  const owner = (body.email ?? body.username) === 'joint-b' ? owners[1] : owners[0];
  return c.json({ token: `synthetic-joint-bearer-${owner}` });
});
app.use('/api/v1/*', async (c, next) => {
  const owner = owners.find(
    (id) => c.req.header('authorization') === `Bearer synthetic-joint-bearer-${id}`,
  );
  if (!owner) return c.json({}, 401);
  const sessionId = generationAuthSession(owner);
  await account.assertSessionAuthorization(sessionId, owner);
  c.set('userId', owner);
  c.set('sessionId', sessionId);
  const call = {
    method: c.req.method,
    path: c.req.path,
    // POST 走 idempotency-key 头；receipts/by-key 的 GET 把键放查询参数，两者都要能对账。
    key: c.req.header('idempotency-key') ?? new URL(c.req.url).searchParams.get('key'),
    body:
      c.req.method === 'POST'
        ? await c.req.raw
            .clone()
            .json()
            .catch(() => null)
        : undefined,
    status: 0,
  };
  calls.push(call);
  // Explicit models derive their execution identity from the catalog; legacy requests
  // still use execution-binding. Hold both routes so pending-state tests pause real work.
  if (
    holdBinding &&
    ['/api/v1/account/execution-binding', '/api/v1/account/models'].includes(c.req.path)
  )
    await new Promise<void>((resolve) => heldBindings.push(resolve));
  if (breakAssets && c.req.path.startsWith('/api/v1/assets/')) return c.json({}, 503);
  await next();
  call.status = c.res.status;
  if (
    ((breakCreate && c.req.path === '/api/v1/generations') ||
      (breakRetry && /^\/api\/v1\/generations\/[^/]+\/retry$/.test(c.req.path))) &&
    c.req.method === 'POST' &&
    c.res.status === 201
  )
    c.res = new Response('{', { status: 201, headers: { 'content-type': 'application/json' } });
});
// Auth/status transport is synthetic; execution binding and all generation/asset routes are real.
app.get('/api/v1/account/status', (c) =>
  c.json({
    id: c.get('userId'),
    username: c.get('userId'),
    displayName: null,
    quota: 500000,
    quotaUnit: '点',
    canGenerate: true,
    identity: {
      apiIssuer: baseUrl,
      principalId: c.get('userId'),
      status: 'active',
      identityVersion: 1,
    },
    recovery: null,
  }),
);
app.get('/api/v1/account/execution-binding', async (c) =>
  c.json(await account.getExecutionBinding(c.get('sessionId'))),
);
app.get('/api/v1/account/models', async (c) => c.json(await readModelCatalog(c.get('sessionId'))));
app.route('/api/v1', generationRoutes(generation));
listener = getRequestListener(app.fetch);

async function stopWorker() {
  for (const release of held.splice(0)) release();
  if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill('SIGTERM');
  const outcome = await workerClosed;
  worker = undefined;
  workerClosed = undefined;
  if (outcome && outcome.code !== 0) throw new Error(`Worker cleanup failed: ${workerOutput}`);
}
async function startWorker() {
  if (worker) return;
  workerOutput = '';
  worker = fork(
    fileURLToPath(
      new URL('../../../../worker/src/__tests__/fixtures/process-worker.ts', import.meta.url),
    ),
    [],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        WORKER_PROCESS_TEST: '1',
        DATABASE_URL: env.DATABASE_URL,
        PUBLIC_BASE_URL: baseUrl,
        NEW_API_BASE_URL: baseUrl,
        CREDENTIAL_ENCRYPTION_KEY: KEY,
        S3_ENDPOINT: baseUrl,
        S3_BUCKET: 'test-bucket',
      },
    },
  );
  const running = worker;
  workerClosed = new Promise((resolve) =>
    running.once('close', (code, signal) => resolve({ code, signal })),
  );
  for (const stream of [worker.stdout, worker.stderr])
    stream?.on('data', (chunk) => {
      workerOutput = (workerOutput + String(chunk)).slice(-4000);
    });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Worker ready timeout: ${workerOutput}`)),
      15000,
    );
    running.once('exit', () => {
      clearTimeout(timer);
      reject(new Error(`Worker exited: ${workerOutput}`));
    });
    running.on('message', (message: { type?: string }) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}
async function reset() {
  await stopWorker();
  await database.pool.query('TRUNCATE "user" CASCADE');
  await database.pool.query('DELETE FROM generation_execution_receipts');
  await database.pool.query('DELETE FROM graphile_worker._private_jobs');
  for (const [index, owner] of owners.entries()) {
    await database.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$1)', [owner]);
    await seedGenerationAuthority(database.db, {
      principalId: owner,
      ownerId: String(index + 41),
      apiIssuer: baseUrl,
      upstreamIssuer: baseUrl,
      encryptionKey: KEY,
      apiKey: 'synthetic-joint-provider-key',
    });
  }
  calls.length = 0;
  providerCalls.length = 0;
  objects.clear();
  holdProvider = false;
  providerStatus = 200;
  breakCreate = false;
  breakRetry = false;
  modelQuota = 120000;
  catalogAvailable = true;
  releaseBindings();
  breakAssets = false;
  return {
    baseUrl,
    owners,
    png: png.toString('base64'),
    pngs: pngs.map((image) => image.toString('base64')),
  };
}
let stopping: Promise<void> | undefined;
function stop() {
  if (!stopping)
    stopping = (async () => {
      releaseBindings();
      await stopWorker();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.pool.end();
      await Promise.all(connectionEnds);
      await container.stop();
      if (poolErrors) throw new Error('Pool cleanup errors');
    })();
  return stopping;
}
process.on(
  'message',
  (message: { id: number; action: string; value?: Record<string, unknown> }) => {
    void (async () => {
      const value = message.value ?? {};
      let result: unknown;
      if (message.action === 'reset') result = await reset();
      else if (message.action === 'startWorker') result = await startWorker();
      else if (message.action === 'stopWorker') result = await stopWorker();
      else if (message.action === 'configure') {
        if (typeof value.modelQuota === 'number') modelQuota = value.modelQuota;
        if (typeof value.catalogAvailable === 'boolean') catalogAvailable = value.catalogAvailable;
        if (typeof value.holdProvider === 'boolean') holdProvider = value.holdProvider;
        if (typeof value.providerStatus === 'number') providerStatus = value.providerStatus;
        if (typeof value.breakCreate === 'boolean') breakCreate = value.breakCreate;
        if (typeof value.breakRetry === 'boolean') breakRetry = value.breakRetry;
        if (value.holdBinding === true) holdBinding = true;
        if (value.holdBinding === false) releaseBindings();
        if (typeof value.breakAssets === 'boolean') breakAssets = value.breakAssets;
      } else if (message.action === 'release') {
        holdProvider = false;
        for (const release of held.splice(0)) release();
      } else if (message.action === 'rotate')
        await database.pool.query(
          'UPDATE account_credentials SET credential_version=credential_version+1 WHERE user_id=$1',
          [value.owner ?? owners[0]],
        );
      else if (message.action === 'purge') {
        await generation.remove(String(value.owner ?? owners[0]), String(value.runId));
        await generation.purge(String(value.owner ?? owners[0]), String(value.runId));
      } else if (message.action === 'snapshot')
        result = {
          calls,
          providerCalls,
          heldBindings: heldBindings.length,
          objects: objects.size,
          runs: (
            await database.pool.query(
              'SELECT id,user_id,request,status,parent_run_id,run_kind,cost_points,upstream_request_sent,attempt_count FROM generation_runs ORDER BY created_at,id',
            )
          ).rows,
          receipts: (
            await database.pool.query(
              'SELECT principal_id,idempotency_key,original_run_id,operation,source_run_id,status,dispatch,cost_provenance,cost_points,binding,purged_at FROM generation_execution_receipts ORDER BY created_at,id',
            )
          ).rows,
          assets: (await database.pool.query('SELECT * FROM generation_assets ORDER BY run_id,id'))
            .rows,
        };
      else if (message.action === 'stop') await stop();
      else throw new Error('Unknown test action');
      process.send?.({ id: message.id, result });
      if (message.action === 'stop') process.disconnect();
    })().catch((error) => process.send?.({ id: message.id, error: String(error) }));
  },
);
process.on('disconnect', () => {
  void stop();
});
process.send({ type: 'ready', result: await reset() });
