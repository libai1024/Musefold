import { ownedInventoryPage } from './fixtures/owned-inventory-page.js';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { cloudGenerationRequestSchema } from '@musefold/contracts';
import {
  createDatabase,
  generationAssets,
  generationExecutionReceipts,
  generationRuns,
  migrateDatabase,
  user,
  type MusefoldDatabase,
} from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { runMigrations } from 'graphile-worker';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  attachExecutionReceipt,
  seedExecutionAuthority,
  type FixtureExecutionAuthority,
} from './fixtures/execution-authority.js';
import { waitUntil } from './fixtures/process-runtime.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const API_ISSUER = 'https://production-bin.example.test';
const ENCRYPTION_KEY = 'synthetic-production-bin-encryption-key';
const PROVIDER_KEY = 'synthetic-production-bin-provider-key';
const S3_SECRET = 'synthetic-production-bin-s3-secret';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4aQAAAAASUVORK5CYII=',
  'base64',
);

/** Runs the actual entry without an alternate runner, IPC controls, or task/lease hooks. */
class ProductionWorker {
  readonly child: ChildProcess;
  readonly applicationName = `worker_bin_${randomUUID()}`;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private closed = false;
  private output = '';
  secretObserved = false;

  constructor(
    databaseUrl: string,
    httpUrl: string,
    apiIssuer = API_ISSUER,
    cleanupPaused = false,
    autoCreateBucket = true,
  ) {
    const url = new URL(databaseUrl);
    url.searchParams.set('application_name', this.applicationName);
    this.child = fork(fileURLToPath(new URL('../bin.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        DATABASE_URL: url.toString(),
        PUBLIC_BASE_URL: apiIssuer,
        NEW_API_BASE_URL: httpUrl,
        CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
        S3_ENDPOINT: httpUrl,
        S3_BUCKET: 'test-bucket',
        S3_REGION: 'us-east-1',
        S3_AUTO_CREATE_BUCKET: String(autoCreateBucket),
        S3_ACCESS_KEY_ID: 'synthetic-bin-access',
        S3_SECRET_ACCESS_KEY: S3_SECRET,
        WORKER_CONCURRENCY: '1',
        MAINTENANCE_CLEANUP_PAUSED: String(cleanupPaused),
      },
    });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream?.on('data', (chunk) => {
        const combined = this.output + String(chunk);
        this.secretObserved ||= [ENCRYPTION_KEY, PROVIDER_KEY, S3_SECRET].some((key) =>
          combined.includes(key),
        );
        this.output = combined.slice(-50_000);
      });
    }
    this.exited = new Promise((resolve, reject) => {
      this.child.once('error', reject);
      this.child.once('close', (code, signal) => {
        this.closed = true;
        resolve({ code, signal });
      });
    });
  }

  async ready(createdBucket = false) {
    await waitUntil(() => {
      if (this.closed) throw new Error('Production worker exited before its startup message');
      return this.output.includes('[worker] generation worker started');
    }, 'actual worker bin startup');
    expect(this.output.includes('[worker] created missing S3 bucket')).toBe(createdBucket);
    expect(this.output.includes('[worker] S3 bucket unavailable')).toBe(false);
  }

  async startupOutcome() {
    await waitUntil(
      () => this.closed || this.output.includes('[worker] generation worker started'),
      'actual worker startup decision',
    );
    return this.closed ? { status: 'rejected', ...(await this.exited) } : { status: 'started' };
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM') {
    if (!this.closed) this.child.kill(signal);
    await waitUntil(() => this.closed, `actual worker bin ${signal} exit`);
    return this.exited;
  }

  diagnostics() {
    let output = this.output.replace(/postgres(?:ql)?:\/\/\S+/g, '[database-url]');
    for (const value of [ENCRYPTION_KEY, PROVIDER_KEY, S3_SECRET])
      output = output.replaceAll(value, '[redacted]');
    return output;
  }
}

async function fixtureServer() {
  const calls = new Map<string, number>();
  const objects = new Map<string, Buffer>();
  const held = new Set<string>();
  const responses = new Map<string, ServerResponse>();
  const state = {
    headBucket: 0,
    createBucket: 0,
    wrongAuthorization: 0,
    headStatus: 200,
    createStatus: 200,
  };
  const finish = (response: ServerResponse) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(
        ownedInventoryPage(
          url,
          [...objects.keys()].map((key) => key.replace(/^\/test-bucket\//, '')),
        ),
      );
      return;
    }
    if (request.method === 'HEAD' && /^\/test-bucket\/?$/.test(url.pathname)) {
      state.headBucket += 1;
      response.writeHead(state.headStatus);
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (request.method === 'POST' && url.pathname === '/v1/images/generations') {
      if (request.headers.authorization !== `Bearer ${PROVIDER_KEY}`) state.wrongAuthorization += 1;
      const payload = JSON.parse(bytes.toString()) as { prompt: string };
      calls.set(payload.prompt, (calls.get(payload.prompt) ?? 0) + 1);
      if (held.has(payload.prompt)) responses.set(payload.prompt, response);
      else finish(response);
      return;
    }
    if (request.method === 'PUT') {
      const bucket = /^\/test-bucket\/?$/.test(url.pathname);
      if (bucket) state.createBucket += 1;
      else objects.set(decodeURIComponent(url.pathname), bytes);
      response.writeHead(bucket ? state.createStatus : 200, { ETag: '"synthetic"' });
      response.end();
      return;
    }
    if (request.method === 'POST' && url.searchParams.has('delete')) {
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end('<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></DeleteResult>');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback fixture server');
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    objects,
    held,
    state,
    release(runId: string) {
      held.delete(runId);
      const response = responses.get(runId);
      if (response && !response.destroyed) finish(response);
      responses.delete(runId);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

describeDb('production worker bin: real PG, Graphile, HTTP and S3', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: MusefoldDatabase;
  let databaseName: string;
  let databaseUrl: string;
  let userId: string;
  let authority: FixtureExecutionAuthority;
  let server: Awaited<ReturnType<typeof fixtureServer>>;
  const children: ProductionWorker[] = [];
  const adminEnded: Promise<void>[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    admin.on('connect', (client) =>
      adminEnded.push(new Promise((resolve) => client.once('end', resolve))),
    );
  }, 180_000);

  beforeEach(async () => {
    databaseName = `bin_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(container.getConnectionUri());
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    ({ db, pool } = createDatabase(databaseUrl, { max: 5 }));
    await migrateDatabase(db);
    await runMigrations({ pgPool: pool });
    server = await fixtureServer();
    userId = randomUUID();
    await db
      .insert(user)
      .values({ id: userId, name: 'Synthetic bin owner', email: `${userId}@example.test` });
    authority = await seedExecutionAuthority(db, {
      userId,
      apiIssuer: API_ISSUER,
      upstreamIssuer: server.url,
      encryptionKey: ENCRYPTION_KEY,
      apiKey: PROVIDER_KEY,
    });
  }, 30_000);

  afterEach(async () => {
    const stopped = await Promise.allSettled(children.map((child) => child.stop('SIGKILL')));
    await server?.close();
    await pool?.end();
    await waitUntil(async () => {
      const result = await admin.query<{ count: string }>(
        'SELECT count(*) FROM pg_stat_activity WHERE datname = $1',
        [databaseName],
      );
      return result.rows[0]?.count === '0';
    }, 'actual bin and parent PostgreSQL connections closed');
    await admin.query(`DROP DATABASE ${databaseName}`);
    for (const result of stopped) if (result.status === 'rejected') throw result.reason;
    for (const child of children) expect(child.secretObserved).toBe(false);
    children.length = 0;
  }, 30_000);

  afterAll(async () => {
    await admin?.end();
    await Promise.all(adminEnded);
    await container?.stop();
  });

  async function runFixture() {
    const runId = randomUUID();
    await db.insert(generationRuns).values({
      id: runId,
      userId,
      status: 'queued',
      idempotencyKey: randomUUID(),
      providerModel: 'musefold-image-pro',
      request: cloudGenerationRequestSchema.parse({ prompt: runId }),
    });
    await attachExecutionReceipt(db, { runId, userId, authority });
    return runId;
  }

  async function enqueue(task: string, runId?: string) {
    const result = await pool.query<{ id: string }>(
      "SELECT (graphile_worker.add_job($1::text, $2::json, max_attempts := 1, job_key := $3::text, job_key_mode := 'replace')).id::text AS id",
      [
        task,
        JSON.stringify(runId ? { userId, runId } : {}),
        runId ? `generation:${runId}` : randomUUID(),
      ],
    );
    return result.rows[0].id;
  }

  async function drained(jobId: string) {
    await waitUntil(
      async () =>
        (await pool.query('SELECT id FROM graphile_worker.jobs WHERE id = $1::bigint', [jobId]))
          .rowCount === 0,
      'actual bin consumed Graphile job',
    );
  }

  async function start(apiIssuer = API_ISSUER, cleanupPaused = false) {
    const child = new ProductionWorker(databaseUrl, server.url, apiIssuer, cleanupPaused);
    children.push(child);
    await child.ready();
    expect(server.state.headBucket).toBe(children.length);
    expect(server.state.createBucket).toBe(0);
    expect(await connectionCount(child)).toBeGreaterThan(0);
    return child;
  }

  it.each([
    { head: 404, create: 200, autoCreate: false, expectedCreates: 0 },
    { head: 403, create: 200, autoCreate: true, expectedCreates: 0 },
    { head: 500, create: 200, autoCreate: true, expectedCreates: 0 },
    { head: 404, create: 403, autoCreate: true, expectedCreates: 1 },
  ])(
    'bucket bootstrap rejects $head/$create (autoCreate=$autoCreate) before consuming a queued run',
    async ({ head, create, autoCreate, expectedCreates }) => {
      server.state.headStatus = head;
      server.state.createStatus = create;
      const runId = await runFixture();
      const jobId = await enqueue('generation.generate', runId);
      const child = new ProductionWorker(databaseUrl, server.url, API_ISSUER, false, autoCreate);
      children.push(child);
      expect(await child.startupOutcome()).toEqual({ status: 'rejected', code: 1, signal: null });
      expect(server.state.headBucket).toBeGreaterThan(0);
      expect(server.state.createBucket).toBe(expectedCreates);
      expect(server.calls.size).toBe(0);
      expect(server.objects.size).toBe(0);
      expect(
        (await db.select().from(generationRuns).where(eq(generationRuns.id, runId)))[0].status,
      ).toBe('queued');
      expect(
        (
          await pool.query('SELECT attempts, locked_by FROM graphile_worker.jobs WHERE id=$1', [
            jobId,
          ])
        ).rows,
      ).toEqual([{ attempts: 0, locked_by: null }]);
      expect(await connectionCount(child)).toBe(0);
      expect(child.diagnostics()).toContain('[worker] S3 bucket unavailable');
    },
    30_000,
  );

  it('bucket bootstrap creates a missing bucket when enabled and then processes a real queued run', async () => {
    server.state.headStatus = 404;
    const runId = await runFixture();
    const jobId = await enqueue('generation.generate', runId);
    const child = new ProductionWorker(databaseUrl, server.url);
    children.push(child);
    await child.ready(true);
    await drained(jobId);
    expect(server.state.createBucket).toBe(1);
    expect(server.calls.get(runId)).toBe(1);
    expect(
      (await db.select().from(generationRuns).where(eq(generationRuns.id, runId)))[0].status,
    ).toBe('succeeded');
    expect(server.objects.size).toBe(1);
    await stopped(child, 'SIGTERM');
  }, 30_000);

  it('pauses cleanup with zero deletion and resumes bounded batches after a real worker restart', async () => {
    await pool.query(
      `INSERT INTO prompts(id,user_id,title,content,deleted_at)
      SELECT 'maintenance-'||lpad(n::text,4,'0'),$1,'Synthetic private title','Synthetic private content',now()-interval '31 days'
      FROM generate_series(1,1001) n`,
      [userId],
    );
    await pool.query(`INSERT INTO rate_limit_buckets(bucket_key,window_started_at,updated_at)
      SELECT 'synthetic-private-bucket-'||n,now()-interval '3 days',now()-interval '3 days'
      FROM generate_series(1,1001) n`);
    const counts = async () =>
      (
        await pool.query(`SELECT
      (SELECT count(*)::int FROM prompts) AS prompts,
      (SELECT count(*)::int FROM rate_limit_buckets) AS buckets`)
      ).rows[0];
    const paused = await start(API_ISSUER, true);
    await drained(await enqueue('maintenance/cleanup'));
    expect(await counts()).toEqual({ prompts: 1001, buckets: 1001 });
    expect(paused.diagnostics()).toContain('[maintenance] paused');
    await stopped(paused, 'SIGTERM');
    const resumed = await start();
    expect(resumed.child.pid).not.toBe(paused.child.pid);
    await drained(await enqueue('maintenance.cleanup'));
    expect(await counts()).toEqual({ prompts: 1, buckets: 1 });
    expect(resumed.diagnostics()).toContain('"stage":"prompts","purged":1000');
    expect(resumed.diagnostics()).toContain('"stage":"rate_limits","purged":1000');
    await drained(await enqueue('maintenance/cleanup'));
    expect(await counts()).toEqual({ prompts: 0, buckets: 0 });
    expect(resumed.diagnostics()).toContain('"stage":"prompts","purged":1');
    await drained(await enqueue('maintenance/cleanup'));
    expect(resumed.diagnostics()).toContain('"stage":"prompts","purged":0');
    expect(server.calls.size).toBe(0);
    for (const worker of [paused, resumed]) {
      expect(worker.diagnostics()).not.toContain('Synthetic private');
      expect(worker.diagnostics()).not.toContain('synthetic-private-bucket-');
    }
    await stopped(resumed, 'SIGTERM');
  }, 45_000);

  it('reports only committed stage counts and sanitizes a failed cleanup before a later retry', async () => {
    await pool.query(
      `INSERT INTO prompts(id,user_id,title,content,deleted_at)
      VALUES ('maintenance-failure',$1,'Synthetic private title','Keep',now()-interval '31 days')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO prompt_usage_events(user_id,event_id,prompt_id,action)
      VALUES ($1,'maintenance-event','maintenance-failure','copy')`,
      [userId],
    );
    await pool.query(`INSERT INTO rate_limit_buckets(bucket_key,window_started_at,updated_at)
      VALUES ('synthetic-private-bucket',now()-interval '3 days',now()-interval '3 days')`);
    await pool.query(`CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic-private-database-detail'; END $$;
      CREATE TRIGGER reject_cleanup BEFORE DELETE ON prompts FOR EACH ROW EXECUTE FUNCTION reject_cleanup()`);
    const worker = await start();
    const failedJob = await enqueue('maintenance/cleanup');
    await waitUntil(async () => {
      const result = await pool.query('SELECT last_error FROM graphile_worker.jobs WHERE id=$1', [
        failedJob,
      ]);
      return result.rows[0]?.last_error != null;
    }, 'actual cleanup failure persisted by Graphile');
    const failed = (
      await pool.query('SELECT last_error FROM graphile_worker.jobs WHERE id=$1', [failedJob])
    ).rows[0];
    expect(failed.last_error).toContain('Maintenance stage failed: prompts');
    expect(failed.last_error).not.toContain('synthetic-private-database-detail');
    expect((await pool.query('SELECT count(*)::int AS n FROM prompts')).rows[0].n).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM prompt_usage_events')).rows[0].n).toBe(
      1,
    );
    expect((await pool.query('SELECT count(*)::int AS n FROM rate_limit_buckets')).rows[0].n).toBe(
      0,
    );
    expect(worker.diagnostics()).toContain('"stage":"rate_limits","purged":1');
    expect(worker.diagnostics()).not.toContain('"stage":"prompts","purged":1');
    await pool.query('DROP FUNCTION reject_cleanup() CASCADE');
    await drained(await enqueue('maintenance/cleanup'));
    expect((await pool.query('SELECT count(*)::int AS n FROM prompts')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM prompt_usage_events')).rows[0].n).toBe(
      0,
    );
    expect(worker.diagnostics()).toContain('"stage":"prompts","purged":1');
    for (const value of [
      'Synthetic private',
      'synthetic-private-bucket',
      'synthetic-private-database-detail',
    ])
      expect(worker.diagnostics()).not.toContain(value);
    expect(server.calls.size).toBe(0);
    await stopped(worker, 'SIGTERM');
  }, 30_000);

  async function connectionCount(child: ProductionWorker) {
    const result = await admin.query<{ count: string }>(
      'SELECT count(*) FROM pg_stat_activity WHERE datname = $1 AND application_name = $2',
      [databaseName, child.applicationName],
    );
    return Number(result.rows[0].count);
  }

  async function stopped(child: ProductionWorker, signal: 'SIGTERM' | 'SIGKILL') {
    const result = await child.stop(signal);
    if (signal === 'SIGTERM' && result.code !== 0)
      console.error('[production-bin-exit-diagnostic]', child.diagnostics());
    expect(result).toEqual(
      signal === 'SIGTERM' ? { code: 0, signal: null } : { code: null, signal: 'SIGKILL' },
    );
    await waitUntil(
      async () => (await connectionCount(child)) === 0,
      'actual bin PG disconnection',
    );
    expect(child.secretObserved).toBe(false);
    console.log(
      '[production-bin-evidence]',
      JSON.stringify({
        pid: child.child.pid,
        signalSent: signal,
        exit: result,
        remainingPgConnections: 0,
        secretObserved: child.secretObserved,
      }),
    );
  }

  async function receipt(runId: string) {
    const [row] = await db
      .select()
      .from(generationExecutionReceipts)
      .where(eq(generationExecutionReceipts.originalRunId, runId));
    return row;
  }

  it('bound run sends once, SIGTERM exits cleanly, new PID drains duplicate delivery without resending', async () => {
    const runId = await runFixture();
    const firstJob = await enqueue('generation.generate', runId);
    const original = await start();
    await drained(firstJob);
    expect(await receipt(runId)).toMatchObject({
      status: 'succeeded',
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
    });
    expect(server.calls.get(runId)).toBe(1);
    expect(server.state.wrongAuthorization).toBe(0);
    expect(server.objects.size).toBe(1);
    expect(
      await db.select().from(generationAssets).where(eq(generationAssets.runId, runId)),
    ).toHaveLength(1);
    await stopped(original, 'SIGTERM');
    const replay = await enqueue('generation.generate', runId);
    const replacement = await start();
    expect(replacement.child.pid).not.toBe(original.child.pid);
    await drained(replay);
    expect(server.calls.get(runId)).toBe(1);
    expect(await receipt(runId)).toMatchObject({ status: 'succeeded', dispatch: 'claimed' });
    await stopped(replacement, 'SIGTERM');
  }, 45_000);

  it('PUBLIC_BASE_URL mismatch rejects a normal bound run with zero provider HTTP', async () => {
    const runId = await runFixture();
    const jobId = await enqueue('generation.generate', runId);
    const child = await start('https://wrong-bin-issuer.example.test');
    await drained(jobId);
    expect(server.calls.get(runId) ?? 0).toBe(0);
    expect(server.objects.size).toBe(0);
    expect(await receipt(runId)).toMatchObject({
      status: 'failed',
      dispatch: 'not_started',
      costProvenance: 'not_sent',
      costPoints: 0,
    });
    await stopped(child, 'SIGTERM');
  }, 30_000);

  it('provider accepted before SIGKILL: new PID and accelerated owned crash recovery keep unknown without resend', async () => {
    const runId = await runFixture();
    server.held.add(runId);
    const jobId = await enqueue('generation.generate', runId);
    const original = await start();
    await waitUntil(
      () => server.calls.get(runId) === 1,
      'real provider received the generation request',
    );
    expect(await receipt(runId)).toMatchObject({
      status: 'running',
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
    });
    const locked = await pool.query<{ locked_by: string }>(
      'SELECT locked_by FROM graphile_worker.jobs WHERE id = $1::bigint',
      [jobId],
    );
    expect(typeof locked.rows[0]?.locked_by).toBe('string');
    await stopped(original, 'SIGKILL');
    server.release(runId);
    // Explicit fixture acceleration, after actual PID death + PG disconnect:
    // unlock only this dead worker in this disposable DB, and expire its app lease.
    // Neither operation proves natural Graphile/app lease timeout behavior.
    await pool.query('SELECT graphile_worker.force_unlock_workers($1::text[])', [
      [locked.rows[0].locked_by],
    ]);
    await db
      .update(generationRuns)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(generationRuns.id, runId));
    const replacement = await start();
    expect(replacement.child.pid).not.toBe(original.child.pid);
    const reconcile = await enqueue('generation/reconcile');
    await drained(reconcile);
    await waitUntil(
      async () => (await receipt(runId))?.status === 'failed',
      'actual bin reconciled uncertain send',
    );
    expect(await receipt(runId)).toMatchObject({
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
    });
    const replay = await enqueue('generation.generate', runId);
    await drained(replay);
    expect(server.calls.get(runId)).toBe(1);
    expect(
      await db.select().from(generationAssets).where(eq(generationAssets.runId, runId)),
    ).toHaveLength(0);
    await stopped(replacement, 'SIGTERM');
  }, 45_000);
});
