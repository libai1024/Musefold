import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  cloudGenerationRequestSchema,
  designSchemeRevisionDocumentSchema,
  designSchemeRunEventSchema,
  prepareDesignSchemeRunInputSchema,
  runResultSchema,
  type ParsedCloudGenerationRequest,
} from '@musefold/contracts';
import {
  createDatabase,
  designSchemeAssets,
  designSchemeEvaluations,
  designSchemeGenerationReferences,
  designSchemeRevisions,
  designSchemeRunExecutions,
  designSchemeRunSteps,
  designSchemeRuns,
  designSchemes,
  enqueueObjectCleanup,
  generationAssets,
  generationEvents,
  generationRuns,
  migrateDatabase,
  objectCleanupQueue,
  user,
  type MusefoldDatabase,
} from '@musefold/db';
import { cloudGenerationProviderSnapshot } from '@musefold/domain/cloud-generation-policy';
import { prepareCloudFixedRunPlan } from '@musefold/domain/design-scheme/fixed-run-plan';
import { and, eq, sql } from 'drizzle-orm';
import { runMigrations, runOnce, type JobHelpers } from 'graphile-worker';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { downloadDesignSchemeReferences } from '../design-scheme-runs.js';
import { loadEnv } from '../env.js';
import {
  seedExecutionAuthority,
  attachExecutionReceipt,
  type FixtureExecutionAuthority,
} from './fixtures/execution-authority.js';
import {
  imageChecksum,
  UpstreamImageError,
  type generateImage,
  type GeneratedImage,
} from '../image-gateway.js';
import { purgeExpiredSoftDeletedRuns } from '../retention.js';
import {
  createTaskList,
  generationJobKey,
  PostgresObjectCleanupStore,
  processObjectCleanupBatch,
  uploadImagesForGeneration,
  type TaskDependencies,
} from '../tasks.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'worker-scheme-owner';
const OTHER = 'worker-scheme-other';
const KEY = 'worker-scheme-test-encryption-key';
const IMAGE: GeneratedImage = {
  bytes: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
  mimeType: 'image/png',
  width: 1,
  height: 1,
};
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused',
  NEW_API_BASE_URL: 'https://provider.test',
  CREDENTIAL_ENCRYPTION_KEY: KEY,
  S3_BUCKET: 'scheme-worker',
});

function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const send = vi.fn(
    async (command: {
      input: { Key?: string; Body?: Buffer; Delete?: { Objects?: Array<{ Key: string }> } };
    }) => {
      const { Key: key, Body: body, Delete: remove } = command.input;
      if (key && body) {
        objects.set(key, Buffer.from(body));
        return {};
      }
      if (key) {
        const bytes = objects.get(key);
        if (!bytes) throw new Error('NoSuchKey');
        return {
          Body: Readable.from([bytes]),
          ContentLength: bytes.length,
          ContentType: 'image/png',
        };
      }
      for (const object of remove?.Objects ?? []) objects.delete(object.Key);
      return { Errors: [] };
    },
  );
  return { objects, send, s3: { send } as unknown as S3Client };
}

async function accepted(options: Parameters<typeof generateImage>[2]) {
  if (!(await options.claimUpstreamRequest())) {
    throw new UpstreamImageError('unknown', 'lease lost');
  }
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describeDb('cloud scheme worker double ledger with real PG and Graphile', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let authority: FixtureExecutionAuthority;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    ({ db, pool } = createDatabase(container.getConnectionUri(), { max: 8 }));
    await migrateDatabase(db);
    await runMigrations({ pgPool: pool });
    await db.insert(user).values([
      { id: OWNER, name: 'Worker owner', email: 'worker-scheme@example.test' },
      { id: OTHER, name: 'Other owner', email: 'worker-scheme-other@example.test' },
    ]);
    authority = await seedExecutionAuthority(db, {
      userId: OWNER,
      apiIssuer: env.PUBLIC_BASE_URL,
      upstreamIssuer: env.NEW_API_BASE_URL,
      encryptionKey: KEY,
      apiKey: 'sk-fake',
    });
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function fixture(
    mode: 'trial' | 'formal' = 'trial',
    referenceCount = 0,
    outputCount: 1 | 2 | 4 = 1,
  ) {
    const schemeId = randomUUID();
    const revisionId = randomUUID();
    const runId = randomUUID();
    const generationId = randomUUID();
    const executionId = randomUUID();
    const now = new Date().toISOString();
    const storage = memoryStorage();
    const assetIds = Array.from({ length: referenceCount }, () => randomUUID());
    const document = designSchemeRevisionDocumentSchema.parse({
      schemaVersion: 1,
      schemeId,
      revisionId,
      name: 'Worker fixture',
      summary: '',
      fidelity: 'faithful',
      sources: [],
      sourceSnapshotIds: [],
      inputs: referenceCount
        ? [
            {
              id: 'references',
              label: 'References',
              kind: 'image-set',
              required: true,
              maxItems: referenceCount,
            },
          ]
        : [],
      parameters: [],
      constraints: [],
      promptProgram: [
        {
          id: 'prompt_1',
          order: 0,
          kind: 'input-template',
          template: 'Frozen prompt',
          variables: [],
          sourceIds: [],
        },
      ],
      compilation: {
        compiledAt: now,
        model: { model: 'fixture-compiler' },
        adopted: [],
        omitted: [],
        warnings: [],
        trace: [],
      },
    });
    const prepared = prepareCloudFixedRunPlan(
      prepareDesignSchemeRunInputSchema.parse({
        executionId,
        schemeId,
        revisionId,
        mode,
        brief: '',
        inputValues: {},
        executionSettings: {
          providerId: 'cloud-default',
          size: '1024x1024',
          aspectRatio: '1:1',
          quality: 'high',
          outputCount,
          referenceAssetIds: assetIds,
          promptReferenceSelections: [],
        },
      }),
      {
        summary: {
          id: schemeId,
          status: mode === 'trial' ? 'draft' : 'formal',
          currentRevisionId: revisionId,
          workingDraftRevisionId: null,
        },
        document,
        sourceSnapshotIds: [],
        provider: cloudGenerationProviderSnapshot,
        referenceAssetIds: assetIds,
      },
      {
        planId: randomUUID(),
        stepIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
        now,
      },
    );
    const result = runResultSchema.parse({
      runId,
      schemeId,
      revisionId,
      mode,
      status: 'planning',
      compiledPrompt: 'Frozen prompt',
      outputs: [],
      evaluation: null,
      steps: prepared.plan.steps.map((step, index) =>
        index < 2 ? { ...step, status: 'completed', startedAt: now, completedAt: now } : step,
      ),
      repair: null,
      error: null,
      createdAt: now,
      completedAt: null,
    });
    await db.insert(designSchemes).values({
      id: schemeId,
      userId: OWNER,
      name: 'Worker fixture',
      status: mode === 'trial' ? 'draft' : 'formal',
      sourcePresentation: 'musefold-created',
      currentRevisionId: revisionId,
      fidelity: 'faithful',
    });
    await db.insert(designSchemeRevisions).values({
      revisionId,
      schemeId,
      userId: OWNER,
      schemaVersion: 1,
      document,
      createdBy: 'user',
    });
    await db.insert(designSchemeRuns).values({
      runId,
      userId: OWNER,
      schemeId,
      revisionId,
      mode,
      status: 'planning',
      policy: prepared.plan.policy ?? {},
      provider: prepared.plan.provider,
      plan: prepared.plan,
      result,
    });
    await db.insert(designSchemeRunExecutions).values({
      executionId,
      userId: OWNER,
      requestHash: 'a'.repeat(64),
      preparedInput: prepared,
      runId,
      expiresAt: new Date(Date.now() + 86400000),
    });
    const request = cloudGenerationRequestSchema.parse({
      prompt: 'Frozen prompt',
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'high',
      count: outputCount,
      referenceImages: assetIds.map((id, index) => ({
        id,
        name: `reference-${index}.png`,
        url: `https://app.test/assets/${id}`,
        mimeType: 'image/png',
        byteSize: IMAGE.bytes.length,
      })),
    });
    await db.insert(generationRuns).values({
      id: generationId,
      userId: OWNER,
      idempotencyKey: executionId,
      providerModel: authority.binding.model,
      designSchemeRunId: runId,
      runKind: 'design_scheme',
      status: 'queued',
      request,
    });
    await attachExecutionReceipt(db, { runId: generationId, userId: OWNER, authority });
    const referenceKeys = assetIds.map((id, index) =>
      index === 0
        ? `users/${createHash('sha256').update(OWNER).digest('hex')}/design-scheme-uploads/${id}`
        : `users/${OWNER}/generations/source-run/${id}`,
    );
    for (const [position, assetId] of assetIds.entries()) {
      storage.objects.set(referenceKeys[position], IMAGE.bytes);
      await db.insert(designSchemeGenerationReferences).values({
        generationRunId: generationId,
        userId: OWNER,
        assetId,
        position,
        objectKey: referenceKeys[position],
        name: request.referenceImages[position].name,
        mimeType: 'image/png',
        byteSize: IMAGE.bytes.length,
        contentHash: imageChecksum(IMAGE.bytes),
      });
    }
    return {
      schemeId,
      revisionId,
      runId,
      generationId,
      executionId,
      prepared,
      result,
      request,
      storage,
      assetIds,
      referenceKeys,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function dependencies(data: Fixture, overrides: Partial<TaskDependencies> = {}) {
    return {
      db,
      env,
      s3: data.storage.s3,
      generate: vi.fn(async (...args: Parameters<typeof generateImage>) => {
        await accepted(args[2]);
        return [IMAGE];
      }),
      ...overrides,
    };
  }
  async function runDirect(data: Fixture, overrides: Partial<TaskDependencies> = {}) {
    const deps = dependencies(data, overrides);
    const task = createTaskList(deps)['generation.generate'];
    if (!task) throw new Error('Generation task missing');
    await task({ userId: OWNER, runId: data.generationId }, {} as JobHelpers);
    return deps;
  }
  async function runQueued(data: Fixture, overrides: Partial<TaskDependencies> = {}) {
    await db.execute(
      sql`SELECT graphile_worker.add_job('generation.generate', json_build_object('userId', ${OWNER}::text, 'runId', ${data.generationId}::text), max_attempts := 1, job_key := ${generationJobKey(data.generationId)}, job_key_mode := 'replace')`,
    );
    const deps = dependencies(data, overrides);
    await runOnce({
      pgPool: pool,
      concurrency: 1,
      noHandleSignals: true,
      taskList: createTaskList(deps),
    });
    return deps;
  }
  async function ledgers(data: Fixture) {
    const [generation] = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.id, data.generationId));
    const [scheme] = await db
      .select()
      .from(designSchemeRuns)
      .where(eq(designSchemeRuns.runId, data.runId));
    const result = runResultSchema.parse(scheme.result);
    const assets = await db
      .select()
      .from(generationAssets)
      .where(eq(generationAssets.runId, data.generationId));
    const schemeAssets = await db
      .select()
      .from(designSchemeAssets)
      .where(eq(designSchemeAssets.revisionId, data.revisionId));
    const evaluations = await db
      .select()
      .from(designSchemeEvaluations)
      .where(eq(designSchemeEvaluations.runId, data.runId));
    const steps = await db
      .select()
      .from(designSchemeRunSteps)
      .where(eq(designSchemeRunSteps.runId, data.runId));
    const rows = await db
      .select()
      .from(generationEvents)
      .where(
        and(
          eq(generationEvents.runId, data.generationId),
          eq(generationEvents.eventType, 'design-scheme'),
        ),
      );
    const events = rows.map((row) => designSchemeRunEventSchema.parse(row.payload));
    return { generation, scheme, result, assets, schemeAssets, evaluations, steps, events };
  }

  it.each(['trial', 'formal'] as const)(
    'commits %s through real queue once with canonical events and correct asset registration',
    async (mode) => {
      const data = await fixture(mode, 2);
      const { generate } = await runQueued(data);
      expect(generate).toHaveBeenCalledOnce();
      const first = await ledgers(data);
      expect(first.generation.status).toBe('succeeded');
      expect(first.scheme.status).toBe('completed');
      expect(first.result).toMatchObject({ status: 'completed', evaluation: { passed: true } });
      expect(first.result.outputs[0]).toMatchObject({
        id: first.assets[0].id,
        origin: 'cloud-run',
      });
      expect(first.schemeAssets).toHaveLength(mode === 'trial' ? 1 : 0);
      if (mode === 'trial') expect(first.schemeAssets[0].objectKey).toBe(first.assets[0].objectKey);
      expect(first.steps.every((step) => step.status === 'completed')).toBe(true);
      expect(first.evaluations).toHaveLength(1);
      expect(first.events.map((event) => event.kind)).toEqual([
        'step-started',
        'step-completed',
        'step-started',
        'step-completed',
        'evaluation-completed',
        'completed',
      ]);
      const repeated = await runQueued(data);
      expect(repeated.generate).not.toHaveBeenCalled();
      expect(await ledgers(data)).toEqual(first);
    },
  );

  it.each(['ratio', 'count'] as const)(
    'records %s warnings as evaluation failure without discarding valid completed output',
    async (kind) => {
      const data = await fixture('trial', 0, kind === 'count' ? 2 : 1);
      await runQueued(data, {
        generate: async (...args) => {
          await accepted(args[2]);
          return [{ ...IMAGE, width: kind === 'ratio' ? 2 : 1 }];
        },
      });
      const state = await ledgers(data);
      expect(state.result.status).toBe('completed');
      expect(state.result.evaluation).toMatchObject({
        passed: false,
        repair: null,
        repairHint: null,
      });
      expect(state.result.evaluation?.checks[kind === 'ratio' ? 2 : 0].status).toBe('warn');
      expect(state.schemeAssets).toHaveLength(1);
    },
  );

  it.each([false, true])(
    'effective cancellation wins over provider failure=%s without outputs or evaluations',
    async (fail) => {
      const data = await fixture();
      const entered = gate();
      const released = gate();
      const running = runDirect(data, {
        generate: async (...args) => {
          await accepted(args[2]);
          entered.resolve();
          await released.promise;
          if (fail) throw new UpstreamImageError('unknown', 'interrupted');
          return [IMAGE];
        },
      });
      await entered.promise;
      await db
        .update(generationRuns)
        .set({ status: 'cancelling' })
        .where(eq(generationRuns.id, data.generationId));
      released.resolve();
      await running;
      const state = await ledgers(data);
      expect(state.generation.status).toBe('cancelled');
      expect(state.result.status).toBe('cancelled');
      expect(state.result.steps.map((step) => step.status)).toEqual([
        'completed',
        'completed',
        'cancelled',
        'cancelled',
      ]);
      expect(state.assets).toHaveLength(0);
      expect(state.schemeAssets).toHaveLength(0);
      expect(state.evaluations).toHaveLength(0);
      expect(state.events.at(-1)?.kind).toBe('cancelled');
      expect(data.storage.objects.size).toBe(fail ? 0 : 1);
      await processObjectCleanupBatch(
        new PostgresObjectCleanupStore(db),
        data.storage.s3,
        env.S3_BUCKET,
      );
      expect(data.storage.objects.size).toBe(0);
    },
  );

  it('records provider failure in both ledgers', async () => {
    const data = await fixture();
    await runQueued(data, {
      generate: async (...args) => {
        await accepted(args[2]);
        throw new UpstreamImageError('quota', 'quota exhausted');
      },
    });
    const state = await ledgers(data);
    expect(state.generation).toMatchObject({
      status: 'failed',
      errorCode: 'ACCOUNT_QUOTA_INSUFFICIENT',
    });
    expect(state.result).toMatchObject({
      status: 'failed',
      error: { code: 'ACCOUNT_QUOTA_INSUFFICIENT' },
    });
    expect(state.evaluations).toHaveLength(0);
  });

  it('compensates a partial upload without committing either ledger as completed', async () => {
    const data = await fixture('trial', 0, 2);
    await runQueued(data, {
      generate: async (...args) => {
        await accepted(args[2]);
        return [IMAGE, IMAGE];
      },
      upload: async (s3, bucket, payload, images, keys, beforeUpload) => {
        await uploadImagesForGeneration(
          s3,
          bucket,
          payload,
          images.slice(0, 1),
          keys,
          beforeUpload,
        );
        throw new Error('second upload failed');
      },
    });
    const state = await ledgers(data);
    expect(state.generation.status).toBe('failed');
    expect(state.result.status).toBe('failed');
    expect(state.assets).toHaveLength(0);
    expect(state.schemeAssets).toHaveLength(0);
    expect(state.evaluations).toHaveLength(0);
    expect(data.storage.objects.size).toBe(1);
    await processObjectCleanupBatch(
      new PostgresObjectCleanupStore(db),
      data.storage.s3,
      env.S3_BUCKET,
    );
    expect(data.storage.objects.size).toBe(0);
  });

  it.each([false, true])(
    'expired lease after upstream, cancelling=%s, fails both ledgers as unknown without another call',
    async (cancelling) => {
      const data = await fixture();
      await db
        .update(generationRuns)
        .set({
          status: cancelling ? 'cancelling' : 'running',
          attemptCount: 1,
          upstreamRequestSent: true,
          leaseExpiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(generationRuns.id, data.generationId));
      const deps = await runQueued(data);
      expect(deps.generate).not.toHaveBeenCalled();
      const state = await ledgers(data);
      expect(state.generation.errorCode).toBe('GENERATION_UPSTREAM_UNKNOWN');
      expect(state.result).toMatchObject({
        status: 'failed',
        error: { code: 'GENERATION_UPSTREAM_UNKNOWN', retryable: false, recoveryAction: 'none' },
      });
      expect(state.evaluations).toHaveLength(0);
    },
  );

  it.each([false, true])(
    'expired lease before upstream, cancelling=%s, safely resumes or cancels',
    async (cancelling) => {
      const data = await fixture();
      await db
        .update(generationRuns)
        .set({
          status: cancelling ? 'cancelling' : 'running',
          attemptCount: 1,
          upstreamRequestSent: false,
          leaseExpiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(generationRuns.id, data.generationId));
      const deps = await runQueued(data);
      expect(deps.generate).toHaveBeenCalledTimes(cancelling ? 0 : 1);
      const state = await ledgers(data);
      expect(state.result.status).toBe(cancelling ? 'cancelled' : 'completed');
      expect(state.generation.attemptCount).toBe(cancelling ? 1 : 2);
    },
  );

  it('old epoch cannot send or mark failed over a replacement success', async () => {
    const data = await fixture();
    const entered = gate();
    const released = gate();
    const paid = vi.fn();
    const old = runDirect(data, {
      generate: async (...args) => {
        entered.resolve();
        await released.promise;
        await accepted(args[2]);
        paid();
        return [IMAGE];
      },
    });
    await entered.promise;
    await db
      .update(generationRuns)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(generationRuns.id, data.generationId));
    await runDirect(data, {
      generate: async (...args) => {
        await accepted(args[2]);
        paid();
        return [IMAGE];
      },
    });
    const completed = await ledgers(data);
    released.resolve();
    await old;
    expect(paid).toHaveBeenCalledOnce();
    expect(await ledgers(data)).toEqual(completed);
    expect(completed.generation.attemptCount).toBe(2);
  });

  it('late uploaded output cannot overwrite unknown and is compensated', async () => {
    const data = await fixture();
    const entered = gate();
    const released = gate();
    const old = runDirect(data, {
      upload: async (...args) => {
        const assets = await uploadImagesForGeneration(...args);
        entered.resolve();
        await released.promise;
        return assets;
      },
    });
    await entered.promise;
    await db
      .update(generationRuns)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(generationRuns.id, data.generationId));
    const recovery = await runDirect(data);
    expect(recovery.generate).not.toHaveBeenCalled();
    released.resolve();
    await old;
    const state = await ledgers(data);
    expect(state.result).toMatchObject({
      status: 'failed',
      error: { code: 'GENERATION_UPSTREAM_UNKNOWN' },
    });
    expect(state.assets).toHaveLength(0);
    expect(state.evaluations).toHaveLength(0);
    expect(state.schemeAssets).toHaveLength(0);
    expect(data.storage.objects.size).toBe(1);
    await processObjectCleanupBatch(
      new PostgresObjectCleanupStore(db),
      data.storage.s3,
      env.S3_BUCKET,
    );
    expect(data.storage.objects.size).toBe(0);
    expect(state.events.filter((event) => event.kind === 'failed')).toHaveLength(1);
  });

  it('rolls back generation assets, evaluation and completion events if trial registration fails', async () => {
    const data = await fixture();
    await db.execute(
      sql`CREATE FUNCTION reject_scheme_output() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected trial registration failure'; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER reject_scheme_output BEFORE INSERT ON design_scheme_assets FOR EACH ROW EXECUTE FUNCTION reject_scheme_output()`,
    );
    try {
      await runQueued(data);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_scheme_output ON design_scheme_assets`);
      await db.execute(sql`DROP FUNCTION reject_scheme_output()`);
    }
    const state = await ledgers(data);
    expect(state.generation.status).toBe('failed');
    expect(state.result.status).toBe('failed');
    expect(state.assets).toHaveLength(0);
    expect(state.evaluations).toHaveLength(0);
    expect(state.schemeAssets).toHaveLength(0);
    expect(state.events.some((event) => event.kind === 'completed')).toBe(false);
    expect(data.storage.objects.size).toBe(1);
    await processObjectCleanupBatch(
      new PostgresObjectCleanupStore(db),
      data.storage.s3,
      env.S3_BUCKET,
    );
    expect(data.storage.objects.size).toBe(0);
  });

  it('preserves committed trial output when the database commit response is lost', async () => {
    const data = await fixture();
    let responseLost = false;
    const ambiguousDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (callback: Parameters<MusefoldDatabase['transaction']>[0]) => {
            const result = await target.transaction(callback);
            if (result === 'succeed' && !responseLost) {
              responseLost = true;
              throw new Error('connection lost after commit');
            }
            return result;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    await runQueued(data, { db: ambiguousDb });
    expect(responseLost).toBe(true);
    const state = await ledgers(data);
    expect(state.generation.status).toBe('succeeded');
    expect(state.result.status).toBe('completed');
    expect(state.schemeAssets).toHaveLength(1);
    const objectKey = state.assets[0].objectKey;
    expect(
      await db.select().from(objectCleanupQueue).where(eq(objectCleanupQueue.objectKey, objectKey)),
    ).toHaveLength(1);
    expect(data.storage.objects.has(objectKey)).toBe(true);
    await processObjectCleanupBatch(
      new PostgresObjectCleanupStore(db),
      data.storage.s3,
      env.S3_BUCKET,
    );
    expect(data.storage.objects.has(objectKey)).toBe(true);
    expect(
      await db.select().from(objectCleanupQueue).where(eq(objectCleanupQueue.objectKey, objectKey)),
    ).toHaveLength(0);
    expect(await ledgers(data)).toEqual(state);
  });

  it.each(['owner-key', 'hash', 'metadata', 'order', 'prompt'] as const)(
    'rejects tampered reference/request %s before provider acceptance',
    async (kind) => {
      const data = await fixture('trial', 2);
      if (kind === 'owner-key')
        await db
          .update(designSchemeGenerationReferences)
          .set({ objectKey: `users/${OTHER}/references/private` })
          .where(eq(designSchemeGenerationReferences.generationRunId, data.generationId));
      if (kind === 'hash')
        data.storage.objects.set(data.referenceKeys[0], Buffer.alloc(IMAGE.bytes.length));
      if (kind === 'metadata') data.request.referenceImages[0].name = 'tampered.png';
      if (kind === 'order') data.request.referenceImages.reverse();
      if (kind === 'prompt') data.request.prompt = 'different prompt';
      await db
        .update(generationRuns)
        .set({ request: data.request })
        .where(eq(generationRuns.id, data.generationId));
      const deps = await runQueued(data);
      expect(deps.generate).not.toHaveBeenCalled();
      const state = await ledgers(data);
      expect(state.generation).toMatchObject({ status: 'failed', upstreamRequestSent: false });
      expect(state.result.status).toBe('failed');
      expect(state.assets).toHaveLength(0);
    },
  );

  it('rejects a cross-owner reference row through the composite owner FK', async () => {
    const data = await fixture('trial', 1);
    await expect(
      db
        .update(designSchemeGenerationReferences)
        .set({ userId: OTHER })
        .where(eq(designSchemeGenerationReferences.generationRunId, data.generationId)),
    ).rejects.toThrow();
  });

  it('bounds a streamed reference without trusting ContentLength and closes the reader', async () => {
    const data = await fixture('trial', 1);
    const limit = 20 * 1024 * 1024;
    await db
      .update(designSchemeGenerationReferences)
      .set({ byteSize: limit })
      .where(eq(designSchemeGenerationReferences.generationRunId, data.generationId));
    const request: ParsedCloudGenerationRequest = structuredClone(data.request);
    request.referenceImages[0].byteSize = limit;
    let closed = false;
    async function* oversized() {
      try {
        yield Buffer.alloc(limit);
        yield Buffer.alloc(1);
      } finally {
        closed = true;
      }
    }
    const s3 = { send: async () => ({ Body: oversized() }) } as unknown as S3Client;
    await expect(
      downloadDesignSchemeReferences(
        db,
        s3,
        env.S3_BUCKET,
        { userId: OWNER, runId: data.generationId },
        request,
      ),
    ).rejects.toThrow('完整性校验失败');
    expect(closed).toBe(true);
  });

  it('protects references through soft delete and requeues released keys at purge while retaining trial output', async () => {
    const data = await fixture('trial', 1);
    await runQueued(data);
    const state = await ledgers(data);
    const referenceKey = data.referenceKeys[0];
    const outputKey = state.assets[0].objectKey;
    const store = new PostgresObjectCleanupStore(db);
    await enqueueObjectCleanup(db, [
      {
        objectKey: referenceKey,
        ownerId: OWNER,
        objectType: 'generation_reference',
        reason: 'generation_purge',
      },
    ]);
    await processObjectCleanupBatch(store, data.storage.s3, env.S3_BUCKET);
    expect(data.storage.objects.has(referenceKey)).toBe(true);
    expect(
      await db
        .select()
        .from(objectCleanupQueue)
        .where(eq(objectCleanupQueue.objectKey, referenceKey)),
    ).toHaveLength(0);
    await db
      .update(generationRuns)
      .set({ deletedAt: new Date(Date.now() - 31 * 86400000) })
      .where(eq(generationRuns.id, data.generationId));
    expect((await store.findProtected([referenceKey])).permanent).toEqual([referenceKey]);
    const purged = await purgeExpiredSoftDeletedRuns(db);
    expect(purged.objectKeys).toContain(referenceKey);
    expect(
      await db
        .select()
        .from(designSchemeGenerationReferences)
        .where(eq(designSchemeGenerationReferences.generationRunId, data.generationId)),
    ).toHaveLength(0);
    await processObjectCleanupBatch(store, data.storage.s3, env.S3_BUCKET);
    expect(data.storage.objects.has(referenceKey)).toBe(false);
    expect(data.storage.objects.has(outputKey)).toBe(true);
    expect((await store.findProtected([outputKey])).permanent).toEqual([outputKey]);
  });

  it('deduplicates a shared input object when purge releases multiple reference bindings', async () => {
    const data = await fixture('trial', 2);
    const key = data.referenceKeys[0];
    await db
      .update(designSchemeGenerationReferences)
      .set({ objectKey: key })
      .where(eq(designSchemeGenerationReferences.generationRunId, data.generationId));
    await runQueued(data);
    await db
      .update(generationRuns)
      .set({ deletedAt: new Date(Date.now() - 31 * 86400000) })
      .where(eq(generationRuns.id, data.generationId));
    const purged = await purgeExpiredSoftDeletedRuns(db);
    expect(purged.objectKeys.filter((objectKey) => objectKey === key)).toHaveLength(1);
    expect(
      await db.select().from(objectCleanupQueue).where(eq(objectCleanupQueue.objectKey, key)),
    ).toHaveLength(1);
  });
});
