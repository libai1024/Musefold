import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type AccountModelCatalog,
  type ExecutionBinding,
  type DesignSchemeRevisionDocument,
  type ParsedDesignSchemeRunInput,
  type RunResult,
  prepareDesignSchemeRunInputSchema,
} from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { CLOUD_GENERATION_PROVIDER_ID } from '@musefold/domain/cloud-generation-policy';
import { sealJsonToString } from '@musefold/server-crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from 'graphile-worker';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { DesignSchemeRunService } from '../../modules/design-scheme-runs/service.js';
import { designSchemeRoutes } from '../../modules/design-schemes/routes.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { GenerationService } from '../../modules/generation/service.js';
import {
  GENERATION_TEST_ISSUERS,
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const OWNER = 'cloud-run-owner';
const FOREIGN = 'cloud-run-foreign';
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
function document(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    schemeId: randomUUID(),
    revisionId: randomUUID(),
    name: 'Fixed cloud poster',
    summary: 'Test',
    fidelity: 'faithful',
    sources: [],
    sourceSnapshotIds: [],
    inputs: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'main',
        order: 0,
        kind: 'input-template',
        template: '{{subject}}',
        variables: ['subject'],
        sourceIds: [],
      },
    ],
    assetIds: [],
    compilation: {
      compiledAt: '2026-09-07T00:00:00.000Z',
      model: { model: 'fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    parentRevisionId: null,
    createdBy: 'user',
    createdAt: '2026-09-07T00:00:00.000Z',
  };
}
function appFor(userId: string, service: DesignSchemeService) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('sessionId', generationAuthSession(userId));
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json(toErrorBody(error, 'fixture'), error.status as 400);
    throw error;
  });
  app.route('/', designSchemeRoutes(service));
  return app;
}
async function until(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for isolated worker result');
}

describeDb(
  'authoritative cloud scheme execution (PostgreSQL, HTTP, queue and fake Provider)',
  () => {
    let container: StartedPostgreSqlContainer;
    let database: ReturnType<typeof createDatabase>;
    let s3: Awaited<ReturnType<typeof startS3Fixture>>;
    let assets: DesignSchemeAssetService;
    let generation: GenerationService;
    let runtime: DesignSchemeRunService;
    let schemes: DesignSchemeService;
    let owner: ReturnType<typeof appFor>;
    let foreign: ReturnType<typeof appFor>;
    let png: Buffer;
    let ownerBinding: ExecutionBinding;
    const readCatalog = vi.fn<(sessionId: string) => Promise<AccountModelCatalog>>();
    function catalog(): AccountModelCatalog {
      const { apiIssuer, principalId, payer, credential } = ownerBinding;
      return {
        identity: { apiIssuer, principalId, payer, credential },
        group: 'vip',
        checkedAt: new Date().toISOString(),
        models: ['musefold-image-pro', 'gpt-image-2', 'musefold-image'].map((model, index) => ({
          model,
          supportedEndpointTypes: ['image-generation'],
          imageGeneration: true,
          pricing: {
            kind: 'per_call',
            baseUsd: 0.04 * (index + 1),
            groupRatio: 2,
            quotaPerCall: 40000 * (index + 1),
          },
        })),
      };
    }
    const removed: string[][] = [];
    function configureGeneration(upstreamIssuer = GENERATION_TEST_ISSUERS.upstreamIssuer) {
      generation = new GenerationService(
        database.db,
        {
          urlTtlSeconds: 60,
          async sign(key) {
            return { url: `https://fixture.test/${key}`, expiresAt: new Date().toISOString() };
          },
          async readObject() {
            throw new Error('Unexpected asset read');
          },
          async putObject() {},
          async removeObjects(keys) {
            removed.push(keys);
          },
        },
        { ...GENERATION_TEST_ISSUERS, upstreamIssuer },
        readCatalog,
      );
      runtime = new DesignSchemeRunService(database.db, assets, generation);
      schemes = new DesignSchemeService(database.db, assets, runtime);
      owner = appFor(OWNER, schemes);
      foreign = appFor(FOREIGN, schemes);
    }
    beforeAll(async () => {
      container = await new PostgreSqlContainer('postgres:17-alpine').start();
      database = createDatabase(container.getConnectionUri(), { max: 10 });
      await migrateDatabase(database.db);
      await runMigrations({ pgPool: database.pool });
      await database.pool.query(
        'INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2), ($3, $3, $4)',
        [OWNER, 'run-owner@example.test', FOREIGN, 'run-foreign@example.test'],
      );
      ownerBinding = await seedGenerationAuthority(database.db, {
        principalId: OWNER,
        ownerId: '42',
      });
      await seedGenerationAuthority(database.db, { principalId: FOREIGN, ownerId: '84' });
      s3 = await startS3Fixture();
      assets = new DesignSchemeAssetService(database.db, s3.storage);
      configureGeneration();
      png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#abcdef' } })
        .png()
        .toBuffer();
    }, 180_000);
    afterAll(async () => {
      await s3?.close();
      await database?.pool.end();
      await container?.stop();
    });
    const prepare = (userId: string, input: Parameters<DesignSchemeRunService['prepare']>[1]) =>
      runtime.prepare(userId, input, generationAuthSession(userId));
    const run = (userId: string, input: Parameters<DesignSchemeRunService['run']>[1]) =>
      runtime.run(userId, input, generationAuthSession(userId));
    async function create(doc = document()) {
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
        document: doc,
      });
      return doc;
    }
    function choices(doc: DesignSchemeRevisionDocument) {
      return prepareDesignSchemeRunInputSchema.parse({
        executionId: randomUUID(),
        schemeId: doc.schemeId,
        revisionId: doc.revisionId,
        mode: 'trial',
        brief: 'A poster',
        inputValues: { subject: 'Night market' },
        executionSettings: {
          providerId: CLOUD_GENERATION_PROVIDER_ID,
          size: 'auto',
          aspectRatio: '3:2',
          quality: 'auto',
          outputCount: 1,
          referenceAssetIds: [],
          promptReferenceSelections: [],
        },
      });
    }
    async function post(path: string, body: unknown, app = owner) {
      return app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    async function queued(runId: string) {
      return (
        await database.pool.query('SELECT * FROM generation_runs WHERE design_scheme_run_id = $1', [
          runId,
        ])
      ).rows[0];
    }

    it('prepares without enqueue, deduplicates concurrent prepare/run and exposes owned cursor events', async () => {
      const input = choices(await create());
      const responses = await Promise.all([
        post('/design-schemes/prepare-run', input),
        post('/design-schemes/prepare-run', input),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const [prepared, replay] = (await Promise.all(
        responses.map((response) => response.json()),
      )) as ParsedDesignSchemeRunInput[];
      expect(prepared).toEqual(replay);
      expect(
        (await database.pool.query('SELECT count(*)::int n FROM generation_runs')).rows[0].n,
      ).toBe(0);
      const [first, second] = await Promise.all([run(OWNER, prepared), run(OWNER, prepared)]);
      expect(first.runId).toBe(second.runId);
      expect(first.status).toBe('planning');
      const row = await queued(first.runId);
      expect(row.request.prompt).toBe(first.compiledPrompt);
      expect(row.status).toBe('queued');
      expect(
        (
          await database.pool.query(
            'SELECT count(*)::int n FROM generation_runs WHERE design_scheme_run_id = $1',
            [first.runId],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(
        database.pool.query(
          `INSERT INTO generation_runs (id, user_id, design_scheme_run_id, request) VALUES ($1, $2, $3, '{}'::jsonb)`,
          [randomUUID(), FOREIGN, first.runId],
        ),
      ).rejects.toMatchObject({ code: '23503', constraint: 'generation_runs_scheme_owner_fk' });
      await expect(
        database.pool.query(
          `INSERT INTO design_scheme_generation_references (generation_run_id, user_id, asset_id, position, object_key, name, mime_type, byte_size, content_hash) VALUES ($1, $2, 'foreign-ref', 0, 'foreign/key', 'Reference', 'image/png', 1, repeat('a',64))`,
          [row.id, FOREIGN],
        ),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'design_scheme_generation_references_run_owner_fk',
      });
      const events = await runtime.events(OWNER, first.runId);
      expect(events.events.map(({ event }) => event.kind)).toEqual([
        'run-created',
        'run-planned',
        'step-completed',
        'step-completed',
      ]);
      expect((await runtime.events(OWNER, first.runId, events.nextSeq)).events).toEqual([]);
      expect((await foreign.request(`/design-schemes/runs/${first.runId}`)).status).toBe(404);
      expect((await foreign.request(`/design-schemes/runs/${first.runId}/events`)).status).toBe(
        404,
      );
      await runtime.cancel(OWNER, { executionId: input.executionId, runId: first.runId });
      expect((await queued(first.runId)).status).toBe('cancelled');
      expect((await runtime.get(OWNER, first.runId)).status).toBe('cancelled');
      expect(
        (await runtime.events(OWNER, first.runId, events.nextSeq)).events.map(
          ({ event }) => event.kind,
        ),
      ).toEqual(['cancelled']);
      await expect(
        generation.retry(OWNER, row.id, randomUUID(), generationAuthSession(OWNER)),
      ).rejects.toMatchObject({
        details: { designSchemeCode: 'DESIGN_SCHEME_RETRY_REQUIRES_PLAN' },
      });
    });

    it.each(['gpt-image-2', 'musefold-image'])(
      'binds selected model %s through preparation, plan, request, history and receipt; accepted replay needs no catalog',
      async (model) => {
        readCatalog.mockReset().mockResolvedValue(catalog());
        const input = choices(await create());
        input.executionSettings.model = model;
        input.executionSettings.expectedBinding = { ...ownerBinding, model };
        const response = await post('/design-schemes/prepare-run', input);
        expect(response.status).toBe(200);
        const prepared = (await response.json()) as ParsedDesignSchemeRunInput;
        expect(prepared.plan.provider.model).toBe(model);
        expect(prepared.executionBinding).toEqual({ ...ownerBinding, model });
        expect(readCatalog).toHaveBeenLastCalledWith(generationAuthSession(OWNER));
        const result = await run(OWNER, prepared);
        const row = await queued(result.runId);
        expect(row.request.model).toBe(model);
        expect(row.provider_model).toBe(model);
        const receipt = await generation.receipts.find(
          database.db,
          OWNER,
          `scheme:${input.executionId}`,
        );
        expect(receipt?.binding?.model).toBe(model);
        expect(readCatalog).toHaveBeenCalledTimes(2);
        readCatalog.mockRejectedValue(new Error('Catalog offline after acceptance'));
        expect(await prepare(OWNER, input)).toEqual(prepared);
        expect((await run(OWNER, prepared)).runId).toBe(result.runId);
        expect(readCatalog).toHaveBeenCalledTimes(2);
        const changed = structuredClone(prepared);
        changed.executionSettings.model = 'musefold-image-pro';
        changed.executionSettings.expectedBinding = ownerBinding;
        changed.plan.provider.model = 'musefold-image-pro';
        changed.executionBinding = ownerBinding;
        await expect(run(OWNER, changed)).rejects.toMatchObject({
          code: 'GENERATION_IDEMPOTENCY_CONFLICT',
        });
        await runtime.cancel(OWNER, { executionId: input.executionId, runId: result.runId });
      },
    );

    it('rechecks current cloud price and identity before a scheme can enqueue, without trusting the expected binding', async () => {
      readCatalog.mockReset().mockResolvedValue(catalog());
      const input = choices(await create());
      input.executionSettings.model = 'gpt-image-2';
      input.executionSettings.expectedBinding = { ...ownerBinding, model: 'gpt-image-2' };
      const unavailable = catalog();
      unavailable.models[1].pricing = { kind: 'unavailable', reason: 'missing_price' };
      readCatalog.mockResolvedValue(unavailable);
      await expect(prepare(OWNER, input)).rejects.toMatchObject({
        code: 'GENERATION_UPSTREAM_UNKNOWN',
      });
      readCatalog.mockResolvedValue(catalog());
      const prepared = await prepare(OWNER, input);
      readCatalog.mockResolvedValue(unavailable);
      await expect(run(OWNER, prepared)).rejects.toMatchObject({
        code: 'GENERATION_UPSTREAM_UNKNOWN',
      });
      const changed = catalog();
      changed.identity.credential = { ...changed.identity.credential, version: 2 };
      readCatalog.mockResolvedValue(changed);
      await expect(run(OWNER, prepared)).rejects.toMatchObject({
        code: 'GENERATION_BINDING_CHANGED',
      });
      expect(
        await generation.receipts.find(database.db, OWNER, `scheme:${input.executionId}`),
      ).toBeNull();
      expect(
        (
          await database.pool.query(
            'SELECT count(*)::int n FROM generation_runs WHERE idempotency_key=$1',
            [`scheme:${input.executionId}`],
          )
        ).rows[0].n,
      ).toBe(0);
      readCatalog.mockResolvedValue(catalog());
      const result = await run(OWNER, prepared);
      await runtime.cancel(OWNER, { executionId: input.executionId, runId: result.runId });
    });

    it('rejects forged plans, repair/cost caps, unsupported counts and owner/revision mismatch before enqueue', async () => {
      const input = choices(await create());
      const prepared = await prepare(OWNER, input);
      await expect(prepare(FOREIGN, input)).rejects.toMatchObject({ status: 404 });
      await expect(prepare(OWNER, { ...input, brief: 'Changed' })).rejects.toMatchObject({
        details: { designSchemeCode: 'DESIGN_SCHEME_EXECUTION_CONFLICT' },
      });
      for (const edit of [
        (copy: ParsedDesignSchemeRunInput) => {
          copy.brief = 'Forged';
        },
        (copy: ParsedDesignSchemeRunInput) => {
          copy.plan.provider.model = 'unapproved-model';
        },
        (copy: ParsedDesignSchemeRunInput) => {
          if (copy.plan.budget) copy.plan.budget.maxRepairRuns = 1;
        },
        (copy: ParsedDesignSchemeRunInput) => {
          if (copy.plan.budget) {
            copy.plan.budget.maxCostUnits = 1;
            copy.plan.budget.currency = 'points';
          }
        },
      ]) {
        const forged = structuredClone(prepared);
        edit(forged);
        await expect(run(OWNER, forged)).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
        });
      }
      await expect(
        prepare(OWNER, {
          ...input,
          executionId: randomUUID(),
          executionSettings: { ...input.executionSettings, outputCount: 3 },
        }),
      ).rejects.toMatchObject({ details: { capability: 'output-count' } });
      await expect(
        prepare(OWNER, { ...input, executionId: randomUUID(), mode: 'formal' }),
      ).rejects.toMatchObject({
        details: { designSchemeCode: 'DESIGN_SCHEME_CAPABILITY_UNAVAILABLE' },
      });
      await expect(
        prepare(OWNER, { ...input, executionId: randomUUID(), inputValues: {} }),
      ).rejects.toMatchObject({
        details: { designSchemeCode: 'DESIGN_SCHEME_CAPABILITY_UNAVAILABLE' },
      });
      expect(await queued(prepared.plan.id ?? '')).toBeUndefined();
    });

    it('durably cancels before prepare and rejects expired or changed-head preparations', async () => {
      const doc = await create();
      const input = choices(doc);
      await runtime.cancel(OWNER, { executionId: input.executionId });
      await expect(prepare(OWNER, input)).rejects.toMatchObject({
        details: { designSchemeCode: 'DESIGN_SCHEME_EXECUTION_CANCELLED' },
      });
      const expiring = await prepare(OWNER, { ...input, executionId: randomUUID() });
      await database.pool.query(
        "UPDATE design_scheme_run_executions SET expires_at = now() - interval '1 second' WHERE execution_id = $1",
        [expiring.executionId],
      );
      await expect(run(OWNER, expiring)).rejects.toMatchObject({
        details: { designSchemeCode: 'DESIGN_SCHEME_PREPARATION_EXPIRED' },
      });
      const stale = await prepare(OWNER, { ...input, executionId: randomUUID() });
      await schemes.update(OWNER, {
        schemeId: doc.schemeId,
        baseRevisionId: doc.revisionId,
        expectedVersion: 1,
        document: { ...doc, revisionId: randomUUID(), parentRevisionId: doc.revisionId },
      });
      await expect(run(OWNER, stale)).rejects.toMatchObject({
        details: { designSchemeCode: 'DESIGN_SCHEME_CAPABILITY_UNAVAILABLE' },
      });
    });

    it('rolls back both ledgers and queue when the selected workbench session is not owned', async () => {
      const input = choices(await create());
      input.executionSettings.workbenchSessionId = randomUUID();
      const prepared = await prepare(OWNER, input);
      await expect(run(OWNER, prepared)).rejects.toMatchObject({
        code: 'WORKBENCH_SESSION_NOT_FOUND',
      });
      const execution = (
        await database.pool.query(
          'SELECT run_id FROM design_scheme_run_executions WHERE execution_id = $1',
          [input.executionId],
        )
      ).rows[0];
      expect(execution.run_id).toBeNull();
      expect(
        (
          await database.pool.query(
            'SELECT count(*)::int n FROM design_scheme_runs WHERE scheme_id = $1',
            [input.schemeId],
          )
        ).rows[0].n,
      ).toBe(0);
    });

    it('validates prompt expectedVersion again at enqueue and retains resolved text in history', async () => {
      const promptId = randomUUID();
      await database.pool.query(
        'INSERT INTO prompts (id, user_id, title, content) VALUES ($1, $2, $3, $4)',
        [promptId, OWNER, 'Reference', 'Keep this exact palette'],
      );
      const input = choices(await create());
      input.executionSettings.promptReferenceSelections = [
        { promptId, scope: 'full', expectedVersion: 1 },
      ];
      const prepared = await prepare(OWNER, input);
      await database.pool.query('UPDATE prompts SET version = 2, content = $2 WHERE id = $1', [
        promptId,
        'Updated palette',
      ]);
      await expect(run(OWNER, prepared)).rejects.toMatchObject({
        code: 'PROMPT_VERSION_CONFLICT',
      });
      const fresh = await prepare(OWNER, {
        ...input,
        executionId: randomUUID(),
        executionSettings: {
          ...input.executionSettings,
          promptReferenceSelections: [{ promptId, scope: 'full', expectedVersion: 2 }],
        },
      });
      const result = await run(OWNER, fresh);
      const row = await queued(result.runId);
      expect(row.prompt_snapshot.promptReferences).toMatchObject([
        { text: 'Updated palette', sourceVersion: 2 },
      ]);
      expect((await generation.get(OWNER, row.id)).promptReferences).toMatchObject([
        { text: 'Updated palette' },
      ]);
      await runtime.cancel(OWNER, { executionId: fresh.executionId });
    });

    it('serializes run/cancel races without a late uncancelled queue insertion', async () => {
      for (let index = 0; index < 3; index++) {
        const prepared = await prepare(OWNER, choices(await create()));
        const outcomes = await Promise.allSettled([
          run(OWNER, prepared),
          runtime.cancel(OWNER, { executionId: prepared.executionId }),
        ]);
        expect(outcomes[1].status).toBe('fulfilled');
        if (outcomes[0].status === 'fulfilled') {
          expect((await runtime.get(OWNER, outcomes[0].value.runId)).status).toBe('cancelled');
          expect((await queued(outcomes[0].value.runId)).status).toBe('cancelled');
        } else
          expect(outcomes[0].reason).toMatchObject({
            details: { designSchemeCode: 'DESIGN_SCHEME_EXECUTION_CANCELLED' },
          });
      }
    });

    it('freezes owned reference bytes and re-enqueues reference cleanup before history purge', async () => {
      const doc = document();
      doc.inputs.push({ id: 'image', label: 'Image', kind: 'image', required: true });
      await create(doc);
      const staged = await assets.stage(OWNER, {
        name: 'reference.png',
        bytes: new Uint8Array(png),
      });
      const input = choices(doc);
      input.executionSettings.referenceAssetIds = [staged.id];
      const prepared = await prepare(OWNER, input);
      const foreignStage = await assets.stage(FOREIGN, {
        name: 'foreign.png',
        bytes: new Uint8Array(png),
      });
      await expect(
        prepare(OWNER, {
          ...input,
          executionId: randomUUID(),
          executionSettings: { ...input.executionSettings, referenceAssetIds: [foreignStage.id] },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const result = await run(OWNER, prepared);
      const row = await queued(result.runId);
      const reference = (
        await database.pool.query(
          'SELECT * FROM design_scheme_generation_references WHERE generation_run_id = $1',
          [row.id],
        )
      ).rows[0];
      expect(reference).toMatchObject({
        asset_id: staged.id,
        position: 0,
        content_hash: staged.contentHash,
        byte_size: png.length,
      });
      expect(row.request.referenceImages[0].id).toBe(staged.id);
      await assets.discard(OWNER, staged.id);
      expect(Buffer.from((await assets.content(OWNER, staged.id)).bytes)).toEqual(png);
      await expect(assets.content(FOREIGN, staged.id)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await generation.cancel(OWNER, row.id);
      expect((await runtime.get(OWNER, result.runId)).status).toBe('cancelled');
      await generation.remove(OWNER, row.id);
      await generation.purge(OWNER, row.id);
      expect(
        (
          await database.pool.query(
            'SELECT * FROM design_scheme_generation_references WHERE generation_run_id = $1',
            [row.id],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key = $1', [
            reference.object_key,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(removed).toEqual([]);
      expect((await runtime.get(OWNER, result.runId)).status).toBe('cancelled');
    });

    it('detects mutated persisted reference bytes between prepare and run', async () => {
      const doc = document();
      doc.inputs.push({ id: 'image', label: 'Image', kind: 'image', required: true });
      await create(doc);
      const staged = await assets.stage(OWNER, {
        name: 'reference.png',
        bytes: new Uint8Array(png),
      });
      const input = choices(doc);
      input.executionSettings.referenceAssetIds = [staged.id];
      const prepared = await prepare(OWNER, input);
      const registry = (
        await database.pool.query(
          'SELECT object_key FROM generation_reference_uploads WHERE id = $1',
          [staged.id],
        )
      ).rows[0];
      s3.objects.set(registry.object_key, Buffer.from('not an image'));
      await expect(run(OWNER, prepared)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it.each([undefined, 'gpt-image-2'] as const)(
      'runs HTTP → real queue → isolated worker with a fake Provider (%s); trial/working-draft/formal gates and album ownership hold',
      async (selectedModel) => {
        let calls = 0;
        const sentModels: string[] = [];
        const stored = new Map<string, Buffer>();
        const server = createServer(async (request, response) => {
          const parts: Buffer[] = [];
          for await (const part of request) parts.push(Buffer.from(part));
          const bytes = Buffer.concat(parts);
          const url = new URL(request.url ?? '/', 'http://localhost');
          if (url.pathname === '/v1/images/generations') {
            calls++;
            sentModels.push(JSON.parse(bytes.toString('utf8')).model);
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
            return;
          }
          const key = decodeURIComponent(url.pathname.replace(/^\/test-bucket\//, ''));
          if (request.method === 'PUT') {
            stored.set(key, bytes);
            response.writeHead(200);
            response.end();
            return;
          }
          response.writeHead(404);
          response.end();
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing fixture endpoint');
        const endpoint = `http://127.0.0.1:${address.port}`;
        await database.pool.query(
          'UPDATE account_credentials SET ciphertext=$3, upstream_issuer=$4 WHERE user_id=$1 AND provider=$2',
          [
            OWNER,
            'new-api',
            sealJsonToString({ apiKey: 'fake-provider-only' }, 'process-runtime-encryption-key'),
            endpoint,
          ],
        );
        await database.pool.query(
          'UPDATE account_identities SET upstream_issuer=$1 WHERE user_id=$2',
          [endpoint, OWNER],
        );
        configureGeneration(endpoint);
        ownerBinding = { ...ownerBinding, payer: { ...ownerBinding.payer, issuer: endpoint } };
        readCatalog.mockReset().mockResolvedValue(catalog());
        let worker: ChildProcess | undefined;
        let exited = false;
        let output = '';
        try {
          const doc = await create();
          const input = choices(doc);
          if (selectedModel) {
            input.executionSettings.model = selectedModel;
            input.executionSettings.expectedBinding = { ...ownerBinding, model: selectedModel };
          }
          const prepared = await prepare(OWNER, input);
          const response = await post('/design-schemes/run', prepared);
          expect(response.status).toBe(200);
          const started = (await response.json()) as RunResult;
          worker = fork(
            fileURLToPath(
              new URL(
                '../../../../worker/src/__tests__/fixtures/process-worker.ts',
                import.meta.url,
              ),
            ),
            [],
            {
              execArgv: ['--import', 'tsx'],
              stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
              env: {
                PATH: process.env.PATH,
                NODE_ENV: 'test',
                WORKER_PROCESS_TEST: '1',
                DATABASE_URL: container.getConnectionUri(),
                NEW_API_BASE_URL: endpoint,
                PUBLIC_BASE_URL: GENERATION_TEST_ISSUERS.apiIssuer,
                S3_ENDPOINT: endpoint,
                S3_BUCKET: 'test-bucket',
                CREDENTIAL_ENCRYPTION_KEY: 'process-runtime-encryption-key',
              },
            },
          );
          worker.once('close', () => {
            exited = true;
          });
          for (const stream of [worker.stdout, worker.stderr])
            stream?.on('data', (chunk) => {
              output = `${output}${String(chunk)}`.slice(-6000);
            });
          await until(async () => {
            if (exited) throw new Error(output);
            return ['completed', 'failed'].includes(
              (await runtime.get(OWNER, started.runId)).status,
            );
          });
          const completed = await runtime.get(OWNER, started.runId);
          expect(completed, output).toMatchObject({
            status: 'completed',
            mode: 'trial',
            error: null,
            outputs: [{ origin: 'cloud-run', role: 'primary' }],
          });
          const row = await queued(started.runId);
          expect(row.status).toBe('succeeded');
          expect(calls).toBe(1);
          expect(sentModels).toEqual([selectedModel ?? 'musefold-image-pro']);
          expect(row.provider_model).toBe(selectedModel ?? 'musefold-image-pro');
          const album = (
            await database.pool.query('SELECT * FROM design_scheme_assets WHERE revision_id = $1', [
              doc.revisionId,
            ])
          ).rows;
          expect(album).toHaveLength(1);
          expect(stored.has(album[0].object_key)).toBe(true);
          const detail = await schemes.get(OWNER, { id: doc.schemeId });
          expect(detail.summary.hasSuccessfulTrial).toBe(true);
          await schemes.selectCover(OWNER, {
            schemeId: doc.schemeId,
            assetId: album[0].id,
            expectedVersion: 1,
          });
          await schemes.formalize(OWNER, {
            schemeId: doc.schemeId,
            revisionId: doc.revisionId,
            coverAssetId: album[0].id,
            expectedVersion: 2,
            confirmed: true,
          });
          const workingDraft = {
            ...doc,
            revisionId: randomUUID(),
            parentRevisionId: doc.revisionId,
          };
          await schemes.update(OWNER, {
            schemeId: doc.schemeId,
            baseRevisionId: doc.revisionId,
            expectedVersion: 3,
            document: workingDraft,
          });
          expect((await prepare(OWNER, choices(workingDraft))).revisionId).toBe(
            workingDraft.revisionId,
          );
          await expect(
            prepare(OWNER, { ...choices(workingDraft), mode: 'formal' }),
          ).rejects.toMatchObject({
            details: { designSchemeCode: 'DESIGN_SCHEME_CAPABILITY_UNAVAILABLE' },
          });
          const formal = await prepare(OWNER, {
            ...input,
            executionId: randomUUID(),
            mode: 'formal',
            executionSettings: selectedModel
              ? {
                  ...input.executionSettings,
                  model: 'musefold-image',
                  expectedBinding: { ...ownerBinding, model: 'musefold-image' },
                }
              : input.executionSettings,
          });
          const next = await run(OWNER, formal);
          await until(async () =>
            ['completed', 'failed'].includes((await runtime.get(OWNER, next.runId)).status),
          );
          expect((await runtime.get(OWNER, next.runId)).status).toBe('completed');
          expect(calls).toBe(2);
          expect(sentModels).toEqual(
            selectedModel
              ? ['gpt-image-2', 'musefold-image']
              : ['musefold-image-pro', 'musefold-image-pro'],
          );
          expect((await queued(next.runId)).provider_model).toBe(
            selectedModel ? 'musefold-image' : 'musefold-image-pro',
          );
          expect(
            (
              await database.pool.query(
                'SELECT * FROM design_scheme_assets WHERE revision_id = $1',
                [doc.revisionId],
              )
            ).rows,
          ).toHaveLength(1);
          expect((await run(OWNER, prepared)).runId).toBe(started.runId);
          expect(calls).toBe(2);
        } finally {
          worker?.kill('SIGTERM');
          if (worker && !exited) await until(async () => exited);
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      60_000,
    );
  },
);
