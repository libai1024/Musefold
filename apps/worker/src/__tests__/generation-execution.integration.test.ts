import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { S3Client } from '@aws-sdk/client-s3';
import { cloudGenerationRequestSchema } from '@musefold/contracts';
import {
  accountCredentials,
  accountIdentities,
  accountSessionAuthorizations,
  createDatabase,
  generationExecutionReceipts,
  generationRuns,
  generationRequestDigest,
  migrateDatabase,
  session,
  user,
  type MusefoldDatabase,
} from '@musefold/db';
import { sealJsonToString } from '@musefold/server-crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { JobHelpers } from 'graphile-worker';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../env.js';
import { claimGenerationExecution, synchronizeExecutionReceipt } from '../generation-execution.js';
import { generateImage } from '../image-gateway.js';
import { purgeExpiredSoftDeletedRuns } from '../retention.js';
import { createTaskList, GenerationLease, type TaskDependencies } from '../tasks.js';
import { attachExecutionReceipt, seedExecutionAuthority } from './fixtures/execution-authority.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const KEY = 'synthetic-worker-authority-envelope-key';
const API_KEY = 'synthetic-worker-bound-key';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function barrier() {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, release };
}

describeDb('worker durable authority: real PG and paid HTTP fixture', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let server: Server;
  let env: ReturnType<typeof loadEnv>;
  const connectionsEnded: Promise<void>[] = [];
  const requests: Array<{ path: string; authorized: boolean }> = [];
  const sentModels: string[] = [];
  let responseStatus = 200;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      sentModels.push(
        req.url?.endsWith('/edits')
          ? (body.match(/name="model"\r\n\r\n([^\r]+)/)?.[1] ?? '')
          : JSON.parse(body).model,
      );
      requests.push({
        path: req.url ?? '',
        authorized: req.headers.authorization === `Bearer ${API_KEY}`,
      });
      res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          responseStatus === 200
            ? { data: [{ b64_json: PNG.toString('base64') }] }
            : { error: { message: 'fixture rejection' } },
        ),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    ({ db, pool } = createDatabase(container.getConnectionUri(), { max: 8 }));
    pool.on('connect', (client) =>
      connectionsEnded.push(new Promise((resolve) => client.once('end', resolve))),
    );
    await migrateDatabase(db);
    env = loadEnv({
      DATABASE_URL: container.getConnectionUri(),
      NODE_ENV: 'test',
      PUBLIC_BASE_URL: 'https://worker-api.example.test',
      NEW_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      CREDENTIAL_ENCRYPTION_KEY: KEY,
      S3_BUCKET: 'synthetic',
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await Promise.all(connectionsEnded);
    await container?.stop();
    server?.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function fixture(
    options: { references?: boolean; bound?: boolean; running?: boolean; model?: string } = {},
  ) {
    const userId = randomUUID();
    const runId = randomUUID();
    await db
      .insert(user)
      .values({ id: userId, name: 'Synthetic authority', email: `${userId}@example.test` });
    const authority = await seedExecutionAuthority(db, {
      userId,
      apiIssuer: env.PUBLIC_BASE_URL,
      upstreamIssuer: env.NEW_API_BASE_URL,
      encryptionKey: KEY,
      apiKey: API_KEY,
    });
    const request = cloudGenerationRequestSchema.parse({
      model: options.model,
      prompt: 'frozen final prompt',
      referenceImages: options.references
        ? [
            {
              id: randomUUID(),
              name: 'reference.png',
              url: 'https://example.test/reference',
              mimeType: 'image/png',
              byteSize: PNG.length,
            },
          ]
        : [],
    });
    if (options.model) authority.binding.model = options.model;
    await db.insert(generationRuns).values({
      id: runId,
      userId,
      idempotencyKey: randomUUID(),
      providerModel: authority.binding.model,
      request,
      status: options.running ? 'running' : 'queued',
      attemptCount: options.running ? 1 : 0,
      leaseExpiresAt: options.running ? new Date(Date.now() + 60_000) : null,
    });
    const receiptId =
      options.bound === false
        ? null
        : await attachExecutionReceipt(db, { userId, runId, authority });
    const s3 = {
      send: vi.fn(async () => ({ Body: { transformToByteArray: async () => PNG } })),
    } as unknown as S3Client;
    const task = async (overrides: Partial<TaskDependencies> = {}) => {
      const execute = createTaskList({ db, env, s3, ...overrides })['generation.generate'];
      if (!execute) throw new Error('Missing generation task');
      await execute({ userId, runId }, {} as JobHelpers);
    };
    const state = async () => {
      const [run] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId));
      const [receipt] = receiptId
        ? await db
            .select()
            .from(generationExecutionReceipts)
            .where(eq(generationExecutionReceipts.id, receiptId))
        : [];
      return { run, receipt };
    };
    return { userId, runId, authority, request, receiptId, s3, task, state };
  }

  it.each([false, true])(
    'sends the frozen selected model through real HTTP (references=%s)',
    async (references) => {
      const f = await fixture({ model: 'gpt-image-2', references });
      const start = requests.length;
      await f.task();
      await f.task();
      expect(requests.slice(start)).toEqual([
        { path: `/v1/images/${references ? 'edits' : 'generations'}`, authorized: true },
      ]);
      expect(sentModels.slice(start)).toEqual(['gpt-image-2']);
      const state = await f.state();
      expect(state.run).toMatchObject({ status: 'succeeded', providerModel: 'gpt-image-2' });
      expect(state.receipt).toMatchObject({
        binding: { model: 'gpt-image-2' },
        costProvenance: 'unknown',
        costPoints: null,
      });
    },
  );

  it.each(['request', 'provider', 'receipt'] as const)(
    'refuses a changed %s model before HTTP even when request digests agree',
    async (mutation) => {
      const f = await fixture({ model: 'gpt-image-2' });
      if (!f.receiptId) throw new Error('Missing test receipt');
      const start = requests.length;
      if (mutation === 'request') {
        const changed = { ...f.request, model: 'musefold-image' };
        await db
          .update(generationRuns)
          .set({ request: changed })
          .where(eq(generationRuns.id, f.runId));
        await db
          .update(generationExecutionReceipts)
          .set({ finalRequestDigest: generationRequestDigest(changed) })
          .where(eq(generationExecutionReceipts.id, f.receiptId));
      } else if (mutation === 'provider') {
        await db
          .update(generationRuns)
          .set({ providerModel: 'musefold-image' })
          .where(eq(generationRuns.id, f.runId));
      } else {
        await db
          .update(generationExecutionReceipts)
          .set({ binding: { ...f.authority.binding, model: 'musefold-image' } })
          .where(eq(generationExecutionReceipts.id, f.receiptId));
      }
      await f.task();
      expect(requests.slice(start)).toEqual([]);
      expect((await f.state()).run?.upstreamRequestSent).toBe(false);
    },
  );

  it('normal frozen binding sends once and commits receipt; replay sends zero additional HTTP', async () => {
    const f = await fixture();
    const start = requests.length;
    await f.task();
    await f.task();
    expect(requests.slice(start)).toEqual([{ path: '/v1/images/generations', authorized: true }]);
    const state = await f.state();
    expect(state.run).toMatchObject({
      status: 'succeeded',
      upstreamRequestSent: true,
      attemptCount: 1,
    });
    expect(state.receipt).toMatchObject({
      status: 'succeeded',
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
    });
    expect(state.receipt?.terminalAt).toBeInstanceOf(Date);
    expect(JSON.stringify(state).includes(API_KEY)).toBe(false);
  });

  it.each([
    'credential-version',
    'credential-ref',
    'credential-owner',
    'identity-issuer',
    'identity-inactive',
    'logout',
    'session-expired',
    'auth-revision',
    'recovery-only',
    'api-issuer',
    'upstream-issuer',
  ] as const)('rejects %s at final claim with zero paid HTTP', async (mutation) => {
    const f = await fixture();
    const start = requests.length;
    let configured = env;
    if (mutation === 'credential-version')
      await db
        .update(accountCredentials)
        .set({ credentialVersion: 2 })
        .where(eq(accountCredentials.userId, f.userId));
    if (mutation === 'credential-ref')
      await db
        .update(accountCredentials)
        .set({ credentialRef: randomUUID() })
        .where(eq(accountCredentials.userId, f.userId));
    if (mutation === 'credential-owner')
      await db
        .update(accountCredentials)
        .set({ upstreamOwnerId: 'other-owner' })
        .where(eq(accountCredentials.userId, f.userId));
    if (mutation === 'identity-issuer')
      await db
        .update(accountIdentities)
        .set({ upstreamIssuer: 'https://other.example.test' })
        .where(eq(accountIdentities.userId, f.userId));
    if (mutation === 'identity-inactive')
      await db
        .update(accountIdentities)
        .set({ status: 'recovery_required' })
        .where(eq(accountIdentities.userId, f.userId));
    if (mutation === 'logout')
      await db.delete(session).where(eq(session.id, f.authority.sessionId));
    if (mutation === 'session-expired')
      await db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(session.id, f.authority.sessionId));
    if (mutation === 'auth-revision')
      await db
        .update(accountSessionAuthorizations)
        .set({ revision: 2 })
        .where(eq(accountSessionAuthorizations.sessionId, f.authority.sessionId));
    if (mutation === 'recovery-only')
      await db
        .update(accountSessionAuthorizations)
        .set({ mode: 'recovery_only' })
        .where(eq(accountSessionAuthorizations.sessionId, f.authority.sessionId));
    if (mutation === 'api-issuer')
      configured = { ...env, PUBLIC_BASE_URL: 'https://other-api.example.test' };
    if (mutation === 'upstream-issuer')
      configured = { ...env, NEW_API_BASE_URL: 'https://other-provider.example.test' };
    await f.task({ env: configured });
    expect(requests.length).toBe(start);
    expect((await f.state()).receipt).toMatchObject({
      status: 'failed',
      dispatch: 'not_started',
      costProvenance: 'not_sent',
      costPoints: 0,
    });
  });

  it('loads S3 references before rechecking the frozen credential version', async () => {
    const f = await fixture({ references: true });
    const loading = barrier();
    const release = barrier();
    const s3 = {
      send: vi.fn(async () => {
        loading.release();
        await release.reached;
        return { Body: { transformToByteArray: async () => PNG } };
      }),
    } as unknown as S3Client;
    const start = requests.length;
    const running = f.task({ s3 });
    try {
      await loading.reached;
      expect((await f.state()).receipt?.dispatch).toBe('not_started');
      await db
        .update(accountCredentials)
        .set({ credentialVersion: 2 })
        .where(eq(accountCredentials.userId, f.userId));
    } finally {
      release.release();
    }
    await running;
    expect(requests.length).toBe(start);
    expect((await f.state()).receipt).toMatchObject({
      dispatch: 'not_started',
      costProvenance: 'not_sent',
    });
  });

  it('two independent lease claimants have one accepted claim and one HTTP request', async () => {
    const f = await fixture({ running: true });
    const leases = [0, 1].map(
      () =>
        new GenerationLease(db, f.userId, f.runId, 1, new AbortController(), {
          env,
          request: f.request,
        }),
    );
    const start = requests.length;
    const results = await Promise.allSettled(
      leases.map((lease) =>
        generateImage(f.request, [], {
          claimUpstreamRequest: () => lease.claimUpstreamRequest(),
          signal: lease.signal,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(leases.filter((lease) => lease.dispatchClaimed)).toHaveLength(1);
    expect(requests.length - start).toBe(1);
    expect((await f.state()).receipt).toMatchObject({
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
    });
  });

  it('a post-claim rotation cannot replace the validated HTTP credential snapshot', async () => {
    const f = await fixture({ running: true });
    const lease = new GenerationLease(db, f.userId, f.runId, 1, new AbortController(), {
      env,
      request: f.request,
    });
    const start = requests.length;
    await generateImage(f.request, [], {
      claimUpstreamRequest: async () => {
        const snapshot = await lease.claimUpstreamRequest();
        await db
          .update(accountCredentials)
          .set({
            ciphertext: sealJsonToString({ apiKey: 'synthetic-rotated-key' }, KEY),
            credentialVersion: 2,
          })
          .where(eq(accountCredentials.userId, f.userId));
        return snapshot;
      },
    });
    expect(requests.slice(start)).toEqual([{ path: '/v1/images/generations', authorized: true }]);
  });

  it.each(['request', 'epoch', 'lease'] as const)(
    'fences changed %s at the atomic claim',
    async (changed) => {
      const f = await fixture({ running: true });
      if (changed === 'request')
        await db
          .update(generationRuns)
          .set({ request: { ...f.request, prompt: 'tampered' } })
          .where(eq(generationRuns.id, f.runId));
      if (changed === 'epoch')
        await db
          .update(generationRuns)
          .set({ attemptCount: 2 })
          .where(eq(generationRuns.id, f.runId));
      if (changed === 'lease')
        await db
          .update(generationRuns)
          .set({ leaseExpiresAt: new Date(Date.now() - 1) })
          .where(eq(generationRuns.id, f.runId));
      expect(
        await claimGenerationExecution(db, env, {
          userId: f.userId,
          runId: f.runId,
          epoch: 1,
          request: f.request,
        }),
      ).toBeNull();
      expect((await f.state()).receipt?.dispatch).toBe('not_started');
    },
  );

  it('post-claim decryption failure is proven not sent, while a fetched 401 remains unknown', async () => {
    const noSend = await fixture();
    await db
      .update(accountCredentials)
      .set({ ciphertext: 'invalid-ciphertext' })
      .where(eq(accountCredentials.userId, noSend.userId));
    const start = requests.length;
    await noSend.task();
    expect(requests.length).toBe(start);
    expect((await noSend.state()).receipt).toMatchObject({
      status: 'failed',
      dispatch: 'confirmed_not_sent',
      costProvenance: 'not_sent',
      costPoints: 0,
    });
    const sent = await fixture();
    responseStatus = 401;
    try {
      await sent.task();
    } finally {
      responseStatus = 200;
    }
    await sent.task();
    expect(requests.length - start).toBe(1);
    expect((await sent.state()).receipt).toMatchObject({
      status: 'failed',
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
    });
  });

  it('cancellation after this lease claims but before fetch records confirmed_not_sent', async () => {
    const f = await fixture();
    let lease: GenerationLease | undefined;
    const start = requests.length;
    await f.task({
      createLease: (...args) => {
        lease = new GenerationLease(...args);
        return lease;
      },
      generate: (request, references, options) =>
        generateImage(request, references, {
          ...options,
          claimUpstreamRequest: async () => {
            const snapshot = await options.claimUpstreamRequest();
            await db
              .update(generationRuns)
              .set({ status: 'cancelling' })
              .where(eq(generationRuns.id, f.runId));
            await lease?.renewNow();
            return snapshot;
          },
        }),
    });
    expect(requests.length).toBe(start);
    expect((await f.state()).receipt).toMatchObject({
      status: 'cancelled',
      dispatch: 'confirmed_not_sent',
      costProvenance: 'not_sent',
      costPoints: 0,
    });
  });

  it('legacy unbound queued history performs zero HTTP and preserves unknown cost through purge', async () => {
    const f = await fixture({ bound: false });
    const receiptId = randomUUID();
    await db.insert(generationExecutionReceipts).values({
      id: receiptId,
      principalId: f.userId,
      idempotencyKey: randomUUID(),
      operation: 'legacy_unknown',
      originalRunId: f.runId,
      bindingState: 'legacy_unbound',
      status: 'queued',
      dispatch: 'not_started',
      costProvenance: 'unknown',
      costPoints: null,
    });
    await db
      .update(generationRuns)
      .set({ executionReceiptId: receiptId })
      .where(eq(generationRuns.id, f.runId));
    const start = requests.length;
    await f.task();
    expect(requests.length).toBe(start);
    const [receipt] = await db
      .select()
      .from(generationExecutionReceipts)
      .where(eq(generationExecutionReceipts.id, receiptId));
    expect(receipt).toMatchObject({
      status: 'failed',
      dispatch: 'not_started',
      costProvenance: 'unknown',
      costPoints: null,
    });
    await db
      .update(generationRuns)
      .set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(generationRuns.id, f.runId));
    expect((await purgeExpiredSoftDeletedRuns(db)).purged).toBe(1);
    const [purged] = await db
      .select()
      .from(generationExecutionReceipts)
      .where(eq(generationExecutionReceipts.id, receiptId));
    expect(purged?.purgedAt).toBeInstanceOf(Date);
    expect(purged).toMatchObject({
      costProvenance: 'unknown',
      costPoints: null,
      originalRunId: f.runId,
    });
    expect(await db.select().from(generationRuns).where(eq(generationRuns.id, f.runId))).toEqual(
      [],
    );
  });

  it('synchronizing a later failure cannot downgrade a previous claimed send to zero', async () => {
    const f = await fixture({ running: true });
    expect(
      await claimGenerationExecution(db, env, {
        userId: f.userId,
        runId: f.runId,
        epoch: 1,
        request: f.request,
      }),
    ).not.toBeNull();
    await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.id, f.runId))
        .for('update');
      await synchronizeExecutionReceipt(tx, run, 'failed');
    });
    expect((await f.state()).receipt).toMatchObject({
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
    });
  });
});
