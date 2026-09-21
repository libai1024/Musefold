import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getRequestListener } from '@hono/node-server';
import { childMessage, startManagedGenerationChild } from '../fixtures/managed-generation-child.js';
import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
  type ExecutionBinding,
  type GenerationJob,
  type ParsedDesignSchemeRunInput,
  generationExecutionReceiptSchema,
} from '@musefold/contracts';
import { createDatabase, generationRequestDigest, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from 'graphile-worker';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { DesignSchemeRunService } from '../../modules/design-scheme-runs/service.js';
import { designSchemeRoutes } from '../../modules/design-schemes/routes.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { generationRoutes } from '../../modules/generation/routes.js';
import { GenerationService } from '../../modules/generation/service.js';
import {
  GENERATION_TEST_ISSUERS,
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'receipt-owner';
const FOREIGN = 'receipt-foreign';
const AUTH = generationAuthSession(OWNER);
const forbiddenIo = async (): Promise<never> => {
  throw new Error('This receipt fixture must not perform object or provider IO');
};
function barrier() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describeDb('execution receipts: all authenticated entry points, immutable replay and purge', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let generation: GenerationService;
  let schemes: DesignSchemeService;
  let binding: ExecutionBinding;
  let app: OpenAPIHono<AuthedEnv>;
  const connectionEnds: Promise<void>[] = [];
  let poolErrors = 0;
  let assetRead: (key: string) => Promise<Uint8Array> = forbiddenIo;
  let png: Buffer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 10 });
    database.pool.on('error', () => {
      poolErrors += 1;
    });
    database.pool.on('connect', (client) => {
      connectionEnds.push(new Promise<void>((done) => client.once('end', done)));
    });
    await migrateDatabase(database.db);
    await runMigrations({ pgPool: database.pool });
    png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#abcdef' } })
      .png()
      .toBuffer();
    generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        sign: forbiddenIo,
        readObject: forbiddenIo,
        putObject: forbiddenIo,
        removeObjects: forbiddenIo,
      },
      GENERATION_TEST_ISSUERS,
    );
    const assets = new DesignSchemeAssetService(database.db, {
      put: forbiddenIo,
      read: (key) => assetRead(key),
    });
    const runtime = new DesignSchemeRunService(database.db, assets, generation);
    schemes = new DesignSchemeService(database.db, assets, runtime);
    app = new OpenAPIHono<AuthedEnv>();
    app.use('*', async (c, next) => {
      c.set('userId', OWNER);
      c.set('sessionId', AUTH);
      await next();
    });
    app.onError((error, c) => {
      if (error instanceof AppError)
        return c.json(toErrorBody(error, 'receipt-fixture'), error.status as 400);
      throw error;
    });
    app.route('/', generationRoutes(generation));
    app.route('/', designSchemeRoutes(schemes));
  }, 120_000);

  beforeEach(async () => {
    assetRead = forbiddenIo;
    await database.pool.query('TRUNCATE "user" CASCADE');
    await database.pool.query('DELETE FROM generation_execution_receipts');
    await database.pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$1),($2,$2,$2)', [
      OWNER,
      FOREIGN,
    ]);
    binding = await seedGenerationAuthority(database.db, { principalId: OWNER, ownerId: '42' });
  });

  afterAll(async () => {
    await database?.pool.end();
    await Promise.all(connectionEnds);
    await container?.stop();
    expect(poolErrors).toBe(0);
  });

  function post(path: string, body?: unknown, key: string = randomUUID()) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function create(key: string = randomUUID(), extra: Record<string, unknown> = {}) {
    const response = await post('/generations', { prompt: 'Immutable poster', ...extra }, key);
    expect(response.status).toBe(201);
    return (await response.json()) as GenerationJob;
  }
  async function rawReceipt(key: string) {
    const result = await database.pool.query(
      'SELECT * FROM generation_execution_receipts WHERE principal_id=$1 AND idempotency_key=$2',
      [OWNER, key],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
  }
  async function publicReceipt(key: string) {
    const response = await app.request(
      `/generations/receipts/by-key?key=${encodeURIComponent(key)}`,
    );
    expect(response.status).toBe(200);
    return generationExecutionReceiptSchema.parse(await response.json());
  }
  async function counts() {
    return (
      await database.pool.query(`SELECT
      (SELECT count(*)::int FROM generation_runs) AS runs,
      (SELECT count(*)::int FROM generation_execution_receipts) AS receipts,
      (SELECT count(*)::int FROM graphile_worker._private_jobs j JOIN generation_runs r ON j.payload->>'runId'=r.id) AS jobs`)
    ).rows[0];
  }
  async function rotate() {
    await database.pool.query(
      'UPDATE account_credentials SET credential_version=credential_version+1 WHERE user_id=$1',
      [OWNER],
    );
    return { ...binding, credential: { ...binding.credential, version: 2 } };
  }

  it('freezes omitted expectations with the trusted BA session; result and queue share one receipt', async () => {
    const workbench = randomUUID();
    await database.pool.query(
      "INSERT INTO workbench_sessions(id,user_id,title,draft) VALUES ($1,$2,$3,'{}'::jsonb)",
      [workbench, OWNER, 'Workbench'],
    );
    const key = randomUUID();
    const job = await create(key, { sessionId: workbench });
    const receipt = await rawReceipt(key);
    const run = (await database.pool.query('SELECT * FROM generation_runs WHERE id=$1', [job.id]))
      .rows[0];
    expect(receipt.binding).toEqual(binding);
    expect(receipt.authorizing_session_id).toBe(AUTH);
    expect(receipt.auth_revision).toBe(1);
    expect(run.session_id).toBe(workbench);
    expect(run.execution_receipt_id).toBe(receipt.id);
    expect(receipt.final_request_digest).toBe(generationRequestDigest(run.request));
    expect(await counts()).toEqual({ runs: 1, receipts: 1, jobs: 1 });
    const visible = await publicReceipt(key);
    expect(visible).toMatchObject({
      operation: 'ordinary_create',
      bindingState: 'bound',
      status: 'queued',
      dispatch: 'not_started',
      costProvenance: 'not_sent',
      costPoints: null,
    });
    for (const privateField of [
      'authorizingSessionId',
      'authRevision',
      'ciphertext',
      'logicalInputDigest',
      'finalRequestDigest',
    ])
      expect(visible).not.toHaveProperty(privateField);
  });

  it('replays before current prompt/key lookup; explicit different binding is rejected separately', async () => {
    const promptId = randomUUID();
    await database.pool.query(
      'INSERT INTO prompts(id,user_id,title,content) VALUES ($1,$2,$3,$4)',
      [promptId, OWNER, 'Reference', 'Original text'],
    );
    const input = { prompt: 'Immutable poster', promptId };
    const key = randomUUID();
    const first = await create(key, { promptId });
    await database.pool.query('DELETE FROM prompts WHERE id=$1', [promptId]);
    const changed = await rotate();
    const replay = await post('/generations', input, key);
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as GenerationJob).id).toBe(first.id);
    expect((await post('/generations', { ...input, expectedBinding: binding }, key)).status).toBe(
      201,
    );
    const mismatch = await post('/generations', { ...input, expectedBinding: changed }, key);
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({
      error: {
        code: 'GENERATION_BINDING_CHANGED',
        details: { receiptId: (await rawReceipt(key)).id },
      },
    });
    expect(await counts()).toEqual({ runs: 1, receipts: 1, jobs: 1 });
  });

  it('serializes same-key concurrent calls and rejects a different logical intent', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([create(key), create(key)]);
    expect(a.id).toBe(b.id);
    const conflict = await post('/generations', { prompt: 'Different' }, key);
    expect(conflict.status).toBe(409);
    expect(await counts()).toEqual({ runs: 1, receipts: 1, jobs: 1 });
  });

  it('rejects a new expected-binding mismatch without receipt, run or job', async () => {
    const response = await post('/generations', {
      prompt: 'Poster',
      expectedBinding: { ...binding, credential: { ...binding.credential, version: 2 } },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'GENERATION_BINDING_CHANGED' } });
    expect(await counts()).toEqual({ runs: 0, receipts: 0, jobs: 0 });
  });

  it('rejects a new cloud intent with a different provider without receipt or queue', async () => {
    const response = await post('/generations', { prompt: 'Poster', providerId: 'desktop-custom' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(await counts()).toEqual({ runs: 0, receipts: 0, jobs: 0 });
  });

  it('still replays an accepted legacy provider value before applying the new cloud-provider rule', async () => {
    const key = randomUUID();
    const original = await create(key);
    await database.pool.query(
      `UPDATE generation_runs SET prompt_snapshot='{}',
      request=jsonb_set(request,'{providerId}','"desktop-custom"') WHERE id=$1`,
      [original.id],
    );
    await database.pool.query(
      `UPDATE generation_execution_receipts SET binding_state='legacy_unbound',binding=NULL,
      authorizing_session_id=NULL,auth_revision=NULL,logical_input_digest=NULL,final_request_digest=NULL,
      cost_provenance='unknown',cost_points=NULL WHERE original_run_id=$1`,
      [original.id],
    );
    const response = await post(
      '/generations',
      { prompt: 'Immutable poster', providerId: 'desktop-custom' },
      key,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: original.id });
    expect(await counts()).toEqual({ runs: 1, receipts: 1, jobs: 1 });
  });

  it('rolls back receipt, result and event if the real Graphile job insertion fails', async () => {
    await database.pool.query(`CREATE FUNCTION public.reject_receipt_test_job() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic queue write rejected'; END $$`);
    await database.pool.query(`CREATE TRIGGER reject_receipt_test_job BEFORE INSERT ON graphile_worker._private_jobs
      FOR EACH ROW EXECUTE FUNCTION public.reject_receipt_test_job()`);
    try {
      await expect(
        generation.create(OWNER, { prompt: 'Atomic poster' }, randomUUID(), AUTH),
      ).rejects.toBeDefined();
      expect(await counts()).toEqual({ runs: 0, receipts: 0, jobs: 0 });
      expect(
        (await database.pool.query('SELECT count(*)::int AS n FROM generation_events')).rows[0].n,
      ).toBe(0);
    } finally {
      await database.pool.query(
        'DROP TRIGGER reject_receipt_test_job ON graphile_worker._private_jobs',
      );
      await database.pool.query('DROP FUNCTION public.reject_receipt_test_job()');
    }
  });

  it.each(['unknown', 'legacy', 'missing', 'wrong-status', 'missing-terminal', 'payer-changed'])(
    'refuses a fresh retry with %s source evidence without receipt or queue writes',
    async (fault) => {
      const source = await create();
      await generation.cancel(OWNER, source.id);
      if (fault === 'unknown')
        await database.pool.query(
          "UPDATE generation_execution_receipts SET dispatch='claimed',cost_provenance='unknown',cost_points=NULL WHERE original_run_id=$1",
          [source.id],
        );
      if (fault === 'legacy')
        await database.pool.query(
          "UPDATE generation_execution_receipts SET binding_state='legacy_unbound',binding=NULL,authorizing_session_id=NULL,auth_revision=NULL WHERE original_run_id=$1",
          [source.id],
        );
      if (fault === 'missing') {
        await database.pool.query(
          'UPDATE generation_runs SET execution_receipt_id=NULL WHERE id=$1',
          [source.id],
        );
        await database.pool.query(
          'DELETE FROM generation_execution_receipts WHERE original_run_id=$1',
          [source.id],
        );
      }
      if (fault === 'wrong-status')
        await database.pool.query(
          "UPDATE generation_execution_receipts SET status='failed' WHERE original_run_id=$1",
          [source.id],
        );
      if (fault === 'missing-terminal')
        await database.pool.query(
          'UPDATE generation_execution_receipts SET terminal_at=NULL WHERE original_run_id=$1',
          [source.id],
        );
      if (fault === 'payer-changed')
        await database.pool.query(
          `UPDATE generation_execution_receipts SET binding=jsonb_set(binding,'{payer,ownerId}','"old-owner"') WHERE original_run_id=$1`,
          [source.id],
        );
      const before = await counts();
      const response = await post(`/generations/${source.id}/retry`);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: {
          code: fault === 'payer-changed' ? 'GENERATION_BINDING_CHANGED' : 'VALIDATION_FAILED',
        },
      });
      expect(await counts()).toEqual(before);
    },
  );

  it('accepts known billed failure with a new credential, without rewriting its original cost or binding', async () => {
    const sourceKey = randomUUID();
    const source = await create(sourceKey);
    await generation.cancel(OWNER, source.id);
    // Synthetic authoritative billing fixture; real provider settlement is covered separately.
    await database.pool.query(
      "UPDATE generation_runs SET status='failed',cost_points=3 WHERE id=$1",
      [source.id],
    );
    await database.pool.query(
      "UPDATE generation_execution_receipts SET status='failed',dispatch='claimed',cost_provenance='provider_reported',cost_points=3 WHERE original_run_id=$1",
      [source.id],
    );
    const before = await rawReceipt(sourceKey);
    await rotate();
    const key = randomUUID();
    const response = await post(`/generations/${source.id}/retry`, undefined, key);
    expect(response.status).toBe(201);
    const child = (await response.json()) as GenerationJob;
    expect(child).toMatchObject({ parentRunId: source.id, request: source.request });
    expect(await rawReceipt(sourceKey)).toEqual(before);
    expect(await publicReceipt(key)).toMatchObject({
      operation: 'explicit_retry',
      sourceRunId: source.id,
      binding: { payer: binding.payer, credential: { version: binding.credential.version + 1 } },
    });
  });

  it('explicit retry replays after its source is purged and does not adopt a rotated credential', async () => {
    const source = await create();
    await generation.cancel(OWNER, source.id);
    const key = randomUUID();
    const accepted = await post(`/generations/${source.id}/retry`, undefined, key);
    expect(accepted.status).toBe(201);
    const retry = (await accepted.json()) as GenerationJob;
    await generation.remove(OWNER, source.id);
    await generation.purge(OWNER, source.id);
    await rotate();
    const replay = await post(`/generations/${source.id}/retry`, undefined, key);
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as GenerationJob).id).toBe(retry.id);
    expect(await publicReceipt(key)).toMatchObject({
      operation: 'explicit_retry',
      sourceRunId: source.id,
      binding,
    });
    expect((await post(`/generations/${randomUUID()}/retry`, undefined, key)).status).toBe(409);
    expect(await counts()).toEqual({ runs: 1, receipts: 2, jobs: 1 });
  });

  it('cancelling a legacy unbound task does not manufacture known-zero cost', async () => {
    const key = randomUUID();
    const job = await create(key);
    await database.pool.query(
      "UPDATE generation_execution_receipts SET binding_state='legacy_unbound', binding=NULL, authorizing_session_id=NULL, auth_revision=NULL, cost_provenance='unknown', cost_points=NULL WHERE original_run_id=$1",
      [job.id],
    );
    await generation.cancel(OWNER, job.id);
    expect(await publicReceipt(key)).toMatchObject({
      status: 'cancelled',
      bindingState: 'legacy_unbound',
      costProvenance: 'unknown',
      costPoints: null,
    });
  });

  it('purge and empty-trash preserve receipts and reserve accepted keys', async () => {
    const key = randomUUID();
    const job = await create(key);
    await generation.cancel(OWNER, job.id);
    expect(await publicReceipt(key)).toMatchObject({
      status: 'cancelled',
      dispatch: 'confirmed_not_sent',
      costProvenance: 'not_sent',
      costPoints: 0,
    });
    await generation.remove(OWNER, job.id);
    expect(await generation.cleanup(OWNER, { scope: 'empty-trash' })).toEqual({ affected: 1 });
    const receipt = await publicReceipt(key);
    expect(receipt.purgedAt).not.toBeNull();
    const replay = await post('/generations', { prompt: 'Immutable poster' }, key);
    expect(replay.status).toBe(410);
    expect(await replay.json()).toMatchObject({
      error: { code: 'GENERATION_RESULT_CLEANED', details: { receiptId: receipt.id } },
    });
    expect((await post('/generations', { prompt: 'Different' }, key)).status).toBe(409);
    expect(await counts()).toEqual({ runs: 0, receipts: 1, jobs: 0 });
  });

  it.each(['legacy-identity', 'recovery-only', 'missing-session'] as const)(
    'rejects %s authority without manufacturing a legacy grant',
    async (kind) => {
      if (kind === 'legacy-identity')
        await database.pool.query(
          "UPDATE account_identities SET status='recovery_required' WHERE user_id=$1",
          [OWNER],
        );
      if (kind === 'recovery-only')
        await database.pool.query(
          "UPDATE account_session_authorizations SET mode='recovery_only',revision=revision+1 WHERE session_id=$1",
          [AUTH],
        );
      if (kind === 'missing-session')
        await database.pool.query('DELETE FROM session WHERE id=$1', [AUTH]);
      const response = await post('/generations', { prompt: 'Poster' });
      expect([401, 403]).toContain(response.status);
      expect(await counts()).toEqual({ runs: 0, receipts: 0, jobs: 0 });
    },
  );

  it('requires receipt ownership and reserves scheme keys only for new ordinary intents', async () => {
    const key = randomUUID();
    await create(key);
    await expect(generation.getReceipt(FOREIGN, key)).rejects.toMatchObject({
      code: 'GENERATION_RECEIPT_NOT_FOUND',
    });
    expect((await post('/generations', { prompt: 'Poster' }, 'scheme:new-execution')).status).toBe(
      409,
    );
    expect(await counts()).toEqual({ runs: 1, receipts: 1, jobs: 1 });
  });

  async function prepareScheme(referenceAssetIds: string[] = []) {
    const schemeId = randomUUID();
    const revisionId = randomUUID();
    const document: DesignSchemeRevisionDocument = {
      schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
      schemeId,
      revisionId,
      name: 'Receipt poster',
      summary: 'Synthetic',
      fidelity: 'faithful',
      sources: [],
      sourceSnapshotIds: [],
      inputs: referenceAssetIds.length
        ? [{ id: 'image', label: 'Image', kind: 'image', required: true }]
        : [],
      parameters: [],
      constraints: [],
      promptProgram: [
        {
          id: 'main',
          order: 0,
          kind: 'input-template',
          template: 'A poster',
          variables: [],
          sourceIds: [],
        },
      ],
      assetIds: [],
      compilation: {
        compiledAt: new Date().toISOString(),
        model: { model: 'synthetic' },
        adopted: [],
        omitted: [],
        warnings: [],
        trace: [],
      },
      parentRevisionId: null,
      createdBy: 'user',
      createdAt: new Date().toISOString(),
    };
    await schemes.create(OWNER, {
      executionId: randomUUID(),
      brief: 'Create',
      sourceUris: [],
      sourceBindings: [],
      sourcePackages: [],
      sourceSnapshots: [],
      sourceAssetIds: [],
      sourceAssets: [],
      historySources: [],
      document,
    });
    const choice = {
      executionId: randomUUID(),
      schemeId,
      revisionId,
      mode: 'trial',
      brief: 'A poster',
      inputValues: {},
      executionSettings: {
        providerId: 'cloud-default',
        size: 'auto',
        quality: 'auto',
        outputCount: 1,
        referenceAssetIds,
        promptReferenceSelections: [],
      },
    };
    const response = await post('/design-schemes/prepare-run', choice);
    const body = await response.json();
    expect(response.status, response.status === 200 ? undefined : JSON.stringify(body)).toBe(200);
    return body as ParsedDesignSchemeRunInput;
  }

  it('replays a migrated ordinary refinement with its historical reserved-prefix key after parent purge', async () => {
    const parent = await create();
    const key = randomUUID();
    const payload = { prompt: 'Immutable poster', parentRunId: parent.id, runKind: 'refinement' };
    const child = await create(key, { parentRunId: parent.id, runKind: 'refinement' });
    const historicalKey = `scheme:historical-${key}`;
    // The exact conservative ordinary/refinement representation produced by
    // 0011: no invented authorization, digests, cost or source-run identity.
    await database.pool.query(
      `UPDATE generation_execution_receipts SET
      idempotency_key=$1,binding_state='legacy_unbound',binding=NULL,
      authorizing_session_id=NULL,auth_revision=NULL,logical_input_digest=NULL,
      final_request_digest=NULL,cost_provenance='unknown',cost_points=NULL
      WHERE original_run_id=$2`,
      [historicalKey, child.id],
    );
    await database.pool.query('UPDATE generation_runs SET idempotency_key=$1 WHERE id=$2', [
      historicalKey,
      child.id,
    ]);
    await generation.cancel(OWNER, parent.id);
    await generation.remove(OWNER, parent.id);
    await generation.purge(OWNER, parent.id);
    const replay = await post('/generations', payload, historicalKey);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ id: child.id });
    expect(await publicReceipt(historicalKey)).toMatchObject({
      bindingState: 'legacy_unbound',
      binding: null,
      sourceRunId: null,
    });
    expect(
      (await post('/generations', { ...payload, parentRunId: randomUUID() }, historicalKey)).status,
    ).toBe(409);
    expect(await counts()).toEqual({ runs: 1, receipts: 2, jobs: 1 });
  });

  it.each(['restore', 'retention'] as const)(
    'locks a purge run before its receipt when %s has the row lock',
    async (kind) => {
      const key = randomUUID();
      const job = await create(key);
      await generation.cancel(OWNER, job.id);
      await generation.remove(OWNER, job.id);
      const held = await database.pool.connect();
      let outcome: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
      try {
        await held.query('BEGIN');
        const holder = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await held.query('SELECT id FROM generation_runs WHERE id=$1 FOR UPDATE', [job.id]);
        outcome = generation.purge(OWNER, job.id).then(
          () => ({ ok: true as const }),
          (error) => ({ ok: false as const, error }),
        );
        await expect
          .poll(
            async () =>
              (
                await database.pool.query(
                  `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
        AND query LIKE '%"generation_runs"%for update%'
        AND $1::int=ANY(pg_blocking_pids(pid))`,
                  [holder],
                )
              ).rows[0].n,
            { timeout: 5000, interval: 20 },
          )
          .toBe(1);
        // An old receipt-first purge would hold this lock and fail NOWAIT.
        await held.query(
          'SELECT id FROM generation_execution_receipts WHERE original_run_id=$1 FOR UPDATE NOWAIT',
          [job.id],
        );
        if (kind === 'restore')
          await held.query('UPDATE generation_runs SET deleted_at=NULL WHERE id=$1', [job.id]);
        else {
          await held.query(
            'UPDATE generation_execution_receipts SET purged_at=now(),revision=revision+1 WHERE original_run_id=$1',
            [job.id],
          );
          await held.query('DELETE FROM generation_runs WHERE id=$1', [job.id]);
        }
        await held.query('COMMIT');
        expect(await outcome).toMatchObject({
          ok: false,
          error: { code: kind === 'restore' ? 'VALIDATION_FAILED' : 'GENERATION_NOT_FOUND' },
        });
        const receipt = await publicReceipt(key);
        expect(receipt.purgedAt === null).toBe(kind === 'restore');
        expect(
          (
            await database.pool.query(
              'SELECT count(*)::int AS n FROM generation_runs WHERE id=$1',
              [job.id],
            )
          ).rows[0].n,
        ).toBe(kind === 'restore' ? 1 : 0);
      } finally {
        try {
          await held.query('ROLLBACK');
        } finally {
          held.release();
        }
        if (outcome) await outcome;
      }
    },
  );

  it('scheme prepare freezes binding in the execution envelope and run joins the same receipt transaction', async () => {
    const prepared = await prepareScheme();
    expect(prepared.executionBinding).toEqual(binding);
    expect(prepared.plan).not.toHaveProperty('executionBinding');
    expect(await counts()).toEqual({ runs: 0, receipts: 0, jobs: 0 });
    const response = await post('/design-schemes/run', prepared);
    expect(response.status).toBe(200);
    const first = (await response.json()) as { runId: string };
    const key = `scheme:${prepared.executionId}`;
    const receipt = await publicReceipt(key);
    expect(receipt).toMatchObject({ operation: 'scheme_run', sourceRunId: null, binding });
    await rotate();
    await database.pool.query('UPDATE design_schemes SET deleted_at=now() WHERE id=$1', [
      prepared.schemeId,
    ]);
    const replay = await post('/design-schemes/run', prepared);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ runId: first.runId });
    expect((await post('/generations', { prompt: 'Collision' }, key)).status).toBe(409);
    expect(await counts()).toEqual({ runs: 1, receipts: 1, jobs: 1 });
    await generation.cancel(OWNER, receipt.originalRunId);
    await generation.remove(OWNER, receipt.originalRunId);
    await generation.purge(OWNER, receipt.originalRunId);
    expect((await post('/design-schemes/run', prepared)).status).toBe(410);
  });

  it('new scheme run requires the frozen binding and rejects a rotation before queue insertion', async () => {
    const prepared = await prepareScheme();
    const { executionBinding: _, ...unbound } = prepared;
    expect((await post('/design-schemes/run', unbound)).status).toBe(409);
    await rotate();
    const changed = await post('/design-schemes/run', prepared);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: { code: 'GENERATION_BINDING_CHANGED' } });
    expect(await counts()).toEqual({ runs: 0, receipts: 0, jobs: 0 });
  });

  async function stageReference() {
    const id = randomUUID();
    const key = `users/${OWNER}/references/${id}`;
    await database.pool.query(
      `INSERT INTO generation_reference_uploads
      (id,user_id,object_key,original_name,mime_type,byte_size,status,uploaded_at,expires_at)
      VALUES ($1,$2,$3,'reference.png','image/png',$4,'available',now(),now()+interval '1 hour')`,
      [id, OWNER, key, png.byteLength],
    );
    assetRead = async (objectKey) => {
      expect(objectKey).toBe(key);
      return png;
    };
    return id;
  }

  it.each(['rotation', 'logout', 'asset-metadata', 'asset-expiry', 'revision'] as const)(
    'does not hold admission locks during object preflight; rejects concurrent %s',
    async (mutation) => {
      const id = await stageReference();
      const prepared = await prepareScheme([id]);
      const reached = barrier();
      const release = barrier();
      assetRead = async () => {
        reached.resolve();
        await release.promise;
        return png;
      };
      const client = await database.pool.connect();
      const pending = Promise.resolve(post('/design-schemes/run', prepared));
      const errors: unknown[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          reached.promise,
          pending.then((response) => {
            throw new Error(`Run ended before object barrier: HTTP ${response.status}`);
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Object barrier was not reached')), 5000);
          }),
        ]);
        await client.query('BEGIN');
        // This fails against the former in-transaction S3 path, rather than
        // allowing a blocked mutation to turn into a test-wide timeout.
        await client.query("SET LOCAL statement_timeout = '1500ms'");
        if (mutation === 'rotation')
          await client.query(
            'UPDATE account_credentials SET credential_version=credential_version+1 WHERE user_id=$1',
            [OWNER],
          );
        else if (mutation === 'logout')
          await client.query('DELETE FROM session WHERE id=$1', [AUTH]);
        else if (mutation === 'asset-metadata')
          await client.query(
            'UPDATE generation_reference_uploads SET byte_size=byte_size+1 WHERE id=$1',
            [id],
          );
        else if (mutation === 'asset-expiry')
          await client.query(
            "UPDATE generation_reference_uploads SET expires_at=now()-interval '1 second' WHERE id=$1",
            [id],
          );
        else
          await client.query(
            "UPDATE design_scheme_revisions SET document=jsonb_set(document,'{name}','\"Changed during preflight\"') WHERE revision_id=$1",
            [prepared.revisionId],
          );
        await client.query('COMMIT');
        release.resolve();
        const response = await pending;
        expect(response.status).toBe(
          mutation === 'rotation' || mutation === 'revision'
            ? 409
            : mutation === 'logout'
              ? 401
              : 404,
        );
        expect(await response.json()).toMatchObject({
          error: {
            code:
              mutation === 'rotation'
                ? 'GENERATION_BINDING_CHANGED'
                : mutation === 'logout'
                  ? 'AUTH_SESSION_EXPIRED'
                  : 'VALIDATION_FAILED',
          },
        });
        expect(await counts()).toEqual({ runs: 0, receipts: 0, jobs: 0 });
        expect(
          (await database.pool.query('SELECT count(*)::int AS n FROM design_scheme_runs')).rows[0]
            .n,
        ).toBe(0);
      } catch (error) {
        errors.push(error);
      } finally {
        if (timer) clearTimeout(timer);
        release.resolve();
        const outcomes = await Promise.allSettled([
          client.query('ROLLBACK').finally(() => client.release()),
          pending,
        ]);
        for (const result of outcomes) if (result.status === 'rejected') errors.push(result.reason);
      }
      if (errors.length)
        throw new AggregateError(errors, 'Preflight concurrency regression failed');
    },
  );

  it('uses the verified reference snapshot for admission and skips object IO on an accepted replay', async () => {
    const id = await stageReference();
    const prepared = await prepareScheme([id]);
    const accepted = await post('/design-schemes/run', prepared);
    expect(accepted.status).toBe(200);
    const first = await accepted.json();
    const reference = (
      await database.pool.query(
        'SELECT * FROM design_scheme_generation_references WHERE asset_id=$1',
        [id],
      )
    ).rows[0];
    expect(reference.byte_size).toBe(png.byteLength);
    expect(reference.mime_type).toBe('image/png');
    expect(reference.content_hash).toMatch(/^[a-f0-9]{64}$/);
    assetRead = forbiddenIo;
    await database.pool.query(
      "UPDATE generation_reference_uploads SET expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    expect((await post('/design-schemes/run', prepared)).status).toBe(200);
    expect(await (await post('/design-schemes/run', prepared)).json()).toEqual(first);
    expect(await counts()).toEqual({ runs: 1, receipts: 1, jobs: 1 });
  });
  it('recovers a lost desktop POST response through real PG receipts after SIGKILL, rotation and purge', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'musefold-pg-local-receipt-'));
    const processes: ReturnType<typeof startManagedGenerationChild>[] = [];
    const accepted = barrier();
    const release = barrier();
    let posts = 0;
    let gets = 0;
    let status = 0;
    const listener = createServer(
      getRequestListener(async (request) => {
        if (request.method === 'POST') posts++;
        else gets++;
        const response = await app.fetch(request);
        if (request.method === 'POST') {
          status = response.status;
          accepted.resolve();
          await release.promise; // DB commit happened; the original caller cannot see this response.
        }
        return response;
      }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
      const address = listener.address();
      if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
      const endpoint = `http://127.0.0.1:${address.port}`;
      const command = {
        callerKey: 'desktop-pg-stable-key',
        caller: 'fixture',
        executionId: randomUUID(),
        binding,
        authEpoch: randomUUID(),
        request: { prompt: 'Synthetic desktop PG fixture', count: 4 },
        estimatedPoints: 4,
        now: Date.UTC(2026, 8, 8),
      };
      async function start(mode: string) {
        const process = startManagedGenerationChild([
          join(dir, 'data.db'),
          join(dir, 'anchor'),
          endpoint,
          mode,
        ]);
        processes.push(process);
        await childMessage(process.child, 'ready');
        return process;
      }
      const first = await start('api');
      first.child.send(command);
      await Promise.race([
        accepted.promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Desktop fixture POST did not reach API')),
            10000,
          );
        }),
      ]);
      if (timer) clearTimeout(timer);
      expect(status).toBe(201);
      expect(await counts()).toEqual({ runs: 1, receipts: 1, jobs: 1 });
      expect(first.child.kill('SIGKILL')).toBe(true);
      expect(await first.closed).toEqual({ code: null, signal: 'SIGKILL' });
      release.resolve();
      await rotate();
      async function recover() {
        const next = await start('recover');
        const result = childMessage<{
          pid: number;
          status: number;
          sendRefused: boolean;
          key: string;
          record: { receipt: unknown };
          budget: { hasUnknown: boolean; usedPoints: number };
        }>(next.child, 'result');
        next.child.send({ ...command, authEpoch: randomUUID() });
        const value = await result;
        expect(await next.closed).toEqual({ code: 0, signal: null });
        expect(value.pid).not.toBe(first.child.pid);
        expect(value.sendRefused).toBe(true);
        expect(value.status).toBe(200);
        return { ...value, receipt: generationExecutionReceiptSchema.parse(value.record.receipt) };
      }
      const queued = await recover();
      expect(queued.receipt).toMatchObject({ status: 'queued', binding });
      await generation.cancel(OWNER, queued.receipt.originalRunId);
      await generation.remove(OWNER, queued.receipt.originalRunId);
      await generation.purge(OWNER, queued.receipt.originalRunId);
      const purged = await recover();
      expect(purged.key).toBe(queued.key);
      expect(purged.receipt.purgedAt).not.toBeNull();
      expect(purged.receipt.costProvenance).toBe('not_sent');
      expect(purged.budget).toMatchObject({ hasUnknown: false, usedPoints: 0 });
      expect(posts).toBe(1);
      expect(gets).toBe(2);
      expect(await counts()).toMatchObject({ runs: 0, receipts: 1 });
    } finally {
      if (timer) clearTimeout(timer);
      release.resolve();
      for (const process of processes) {
        if (process.child.exitCode === null && process.child.signalCode === null)
          process.child.kill('SIGKILL');
        await process.closed;
      }
      listener.closeAllConnections();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
