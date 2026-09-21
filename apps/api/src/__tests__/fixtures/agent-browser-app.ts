import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { imageModelFixture } from './image-model.js';
import { GenerationBrowserWorker } from './generation-browser-worker.js';
import { generationDatabaseFault } from './generation-database-fault.js';
import { generationCleanupObserver } from './generation-cleanup-observer.js';
import { startPackageExchangeApp } from './package-exchange-app.js';
import { sourceGithubFixture } from './source-github.js';
import { textModelFixture } from './text-model.js';
import { providerAuthorizationFixture } from './provider-authorization.js';
import { startDesignSchemeAgentWorker } from '../../modules/design-scheme-agent/worker.js';

/** Actual login hooks, encrypted credentials, Hono, PG and Graphile. External services are loopback fixtures. */
export async function startAgentBrowserApp() {
  const image = await imageModelFixture();
  const providerAuthorization = providerAuthorizationFixture();
  const model = await textModelFixture(providerAuthorization.authorize, image.handle);
  function requireImageInput() {
    if (!model.state.compiler.inputs.some((input) => input.kind === 'image-set'))
      model.state.compiler.inputs.push(
        Object.assign(
          { label: '参考图', kind: 'image-set', required: true, variable: '' },
          { imageRole: 'style-reference' },
        ),
      );
  }
  let generationWorker: GenerationBrowserWorker | undefined;
  let databaseFault: Awaited<ReturnType<typeof generationDatabaseFault>> | undefined;
  let cleanupObserver: Awaited<ReturnType<typeof generationCleanupObserver>> | undefined;
  const generationWorkers = new Set<GenerationBrowserWorker>();
  function ownedGeneration(pid: number) {
    const owned = [...generationWorkers].find((item) => item.snapshot().pid === pid);
    if (!owned) throw new Error('Generation PID does not belong to this fixture');
    return owned;
  }
  const github = await sourceGithubFixture();
  let exchange: Awaited<ReturnType<typeof startPackageExchangeApp>> | undefined;
  let worker: Awaited<ReturnType<typeof startDesignSchemeAgentWorker>> | undefined;
  async function close() {
    // A queued Compiler can start while the Analyst drains; it must not enter a new hold.
    model.state.mode = 'normal';
    model.release();
    image.release();
    exchange?.s3.releaseHolds();
    databaseFault?.dropResponse();
    let failure: unknown;
    for (const dispose of [
      ...[...generationWorkers].map((item) => () => item.stop()),
      () => worker?.stop(),
      () => databaseFault?.close(),
      () => cleanupObserver?.close(),
      () => exchange?.close(),
      () => github.close(),
      () => model.close(),
    ]) {
      try {
        await dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }
  try {
    exchange = await startPackageExchangeApp({
      agent: { modelEndpoint: model.endpoint, sourceReader: github.reader },
    });
    if (!exchange.agent) throw new Error('Missing actual Agent service');
    worker = await startDesignSchemeAgentWorker(exchange.database.pool, exchange.agent);
    const { database, app, s3, workerEnvironment } = exchange;
    return {
      app,
      close,
      revokeUpstreamCredentials: providerAuthorization.revokeObservedKeys,
      restoreUpstreamCredentials: providerAuthorization.restoreKeys,
      providerAuthorizationSnapshot: providerAuthorization.snapshot,
      requireImageInput,
      async observeReferenceCleanup() {
        if (cleanupObserver) throw new Error('Reference cleanup observer already installed');
        cleanupObserver = await generationCleanupObserver(database.pool);
        return cleanupObserver;
      },
      async armDatabaseFault(mode: 'output-rollback' | 'commit-response') {
        if (generationWorker || databaseFault)
          throw new Error('Arm database fault before starting generation');
        databaseFault = await generationDatabaseFault(
          database.pool,
          workerEnvironment.DATABASE_URL,
          mode,
        );
      },
      databaseFaultSnapshot: () => databaseFault?.snapshot(),
      dropDatabaseResponse: () => databaseFault?.dropResponse(),
      async generationOutcome() {
        return {
          evaluations: (
            await database.pool.query(
              'SELECT evaluation_id,run_id,passed FROM design_scheme_evaluations ORDER BY created_at',
            )
          ).rows,
          events: (
            await database.pool.query(
              "SELECT run_id,event_type,payload->>'kind' AS kind FROM generation_events ORDER BY seq",
            )
          ).rows,
        };
      },
      async startGeneration(imageInput = false) {
        if (imageInput) requireImageInput();
        if (!generationWorker) {
          generationWorker = new GenerationBrowserWorker({
            ...workerEnvironment,
            DATABASE_URL: databaseFault?.databaseUrl ?? workerEnvironment.DATABASE_URL,
          });
          generationWorkers.add(generationWorker);
        }
        await generationWorker.waitUntilReady();
        return generationWorker.snapshot();
      },
      async stopGeneration() {
        if (!generationWorker) throw new Error('Generation worker was not started');
        return generationWorker.stop();
      },
      async replaceGeneration() {
        if (!generationWorker?.canReplace())
          throw new Error('Replacement requires an exited or explicitly paused worker');
        generationWorker = new GenerationBrowserWorker({
          ...workerEnvironment,
          DATABASE_URL: databaseFault?.databaseUrl ?? workerEnvironment.DATABASE_URL,
        });
        generationWorkers.add(generationWorker);
        await generationWorker.waitUntilReady();
        return generationWorker.snapshot();
      },
      signalGeneration(pid: number, signal: 'SIGSTOP' | 'SIGCONT') {
        ownedGeneration(pid).signal(signal);
      },
      stopGenerationPid(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
        return ownedGeneration(pid).stop(signal);
      },
      holdStorage(method: 'GET' | 'PUT' | 'DELETE') {
        s3.holdNext(method);
      },
      releaseStorage() {
        s3.releaseHolds();
      },
      storageFault(
        mode: 'none' | 'put-after-write' | 'delete' | 'drop-put-once' | 'drop-put-always',
      ) {
        s3.state.failPutAfterWrite = mode === 'put-after-write';
        s3.state.failDelete = mode === 'delete';
        s3.state.dropPutResponses =
          mode === 'drop-put-once' ? 1 : mode === 'drop-put-always' ? Number.POSITIVE_INFINITY : 0;
      },
      corruptReference(id: string, mode: 'tamper' | 'delete') {
        const entry = [...s3.objects].find(([key]) => key.endsWith(`/references/${id}`));
        if (!entry) throw new Error('Missing owned reference object');
        if (mode === 'delete') s3.objects.delete(entry[0]);
        else {
          const changed = Buffer.from(entry[1]);
          changed[changed.length - 1] ^= 255;
          s3.objects.set(entry[0], changed);
        }
      },
      /** Explicitly request the actual maintenance task; does not advance any clock or lease. */
      async requestMaintenance() {
        const result = await database.pool.query(
          "SELECT (graphile_worker.add_job('maintenance/cleanup', '{}'::json, max_attempts := 1, job_key := $1)).id",
          [`fixture-maintenance:${randomUUID()}`],
        );
        return String(result.rows[0].id);
      },
      async storageRuntime() {
        const queue = await database.pool.query(
          'SELECT object_key,object_type,reason,attempt_count,next_attempt_at,last_error,abandoned_at FROM object_cleanup_queue ORDER BY object_key',
        );
        return {
          observedAt: new Date().toISOString(),
          barriers: s3.barriers.map((value) => ({ ...value })),
          deleted: [...s3.deleted],
          droppedPuts: [...s3.droppedPuts],
          writes: s3.writes.map(({ path }) => ({
            keyHash: createHash('sha256')
              .update(decodeURIComponent(path.replace(/^\/test-scheme-assets\//, '')))
              .digest('hex'),
          })),
          objects: [...s3.objects].map(([key, bytes]) => ({
            keyHash: createHash('sha256').update(key).digest('hex'),
            contentHash: createHash('sha256').update(bytes).digest('hex'),
            bytes: bytes.length,
          })),
          cleanup: queue.rows.map(({ object_key, ...row }) => ({
            ...row,
            keyHash: createHash('sha256').update(object_key).digest('hex'),
          })),
        };
      },
      /** Read-only process evidence: no clock/lease changes, queue injection or force unlock. */
      async generationRuntime() {
        return {
          observedAt: new Date().toISOString(),
          runs: (
            await database.pool.query(
              'SELECT id,execution_receipt_id,status,attempt_count,upstream_request_sent,lease_expires_at,error_code,finished_at FROM generation_runs ORDER BY created_at',
            )
          ).rows,
          receipts: (
            await database.pool.query(
              'SELECT id,original_run_id,status,dispatch,cost_provenance,cost_points,revision FROM generation_execution_receipts ORDER BY created_at',
            )
          ).rows,
          jobs: (
            await database.pool.query(
              'SELECT j.id,j.key,j.locked_by,j.locked_at,j.attempts,j.max_attempts,t.identifier FROM graphile_worker._private_jobs j JOIN graphile_worker._private_tasks t ON t.id=j.task_id ORDER BY j.id',
            )
          ).rows,
        };
      },
      setImageMode(mode: 'normal' | 'hold' | 'drop' | 'reject') {
        image.state.mode = mode;
      },
      releaseImage() {
        image.release();
      },
      /** Only qualifies the pre-existing imported formal base; never the new Agent revision. */
      seedTrial: exchange.seedTrial,
      async githubVersion(version: 'base' | 'changed' | 'next') {
        Object.assign(model.state.analyst, {
          referenceImages: [{ path: 'style.png', role: 'style-reference' }],
        });
        // External upstream input only. Keep the second repository byte-identical across updates.
        for (const name of ['design', 'layout']) {
          const changed = name === 'design' && version !== 'base';
          const commit = changed ? (version === 'next' ? 'c' : 'b') : 'a';
          const image = await sharp({
            create: {
              width: name === 'design' ? 6 : 7,
              height: 4,
              channels: 3,
              background: changed ? '#db2777' : name === 'design' ? '#2463eb' : '#22aa66',
            },
          })
            .png()
            .toBuffer();
          github.state.overrides[`example/${name}`] = {
            commit: commit.repeat(40),
            content: Buffer.from(`Synthetic ${name} instructions ${commit}\n`.repeat(30)),
            files: [{ name: 'style.png', content: image }],
          };
        }
      },
      setMode(mode: 'normal' | 'hold' | 'hold-compiler' | 'drop') {
        model.state.mode = mode;
      },
      release() {
        model.release();
      },
      async revoke() {
        await database.pool.query(
          "UPDATE account_session_authorizations SET mode='recovery_only',revision=revision+1",
        );
      },
      async seedHistory(userId: string) {
        const user = await database.pool.query('SELECT id FROM "user" WHERE id=$1', [userId]);
        if (user.rowCount !== 1) throw new Error('Missing authenticated history owner');
        const bytes = await sharp({
          create: { width: 4, height: 3, channels: 3, background: '#22aabb' },
        })
          .png()
          .toBuffer();
        const runId = randomUUID();
        const assetId = randomUUID();
        const key = `users/${userId}/generations/${runId}/${assetId}`;
        const hash = createHash('sha256').update(bytes).digest('hex');
        const prompt = 'Synthetic history typography';
        await database.pool.query(
          "INSERT INTO generation_runs(id,user_id,status,request,prompt_snapshot) VALUES($1,$2,'succeeded',$3,$4)",
          [
            runId,
            userId,
            JSON.stringify({ prompt }),
            JSON.stringify({ schemaVersion: 1, finalPrompt: prompt, userPrompt: prompt }),
          ],
        );
        await database.pool.query(
          'INSERT INTO generation_assets(id,run_id,user_id,object_key,mime_type,width,height,byte_size,checksum_sha256) VALUES($1,$2,$3,$4,$5,4,3,$6,$7)',
          [assetId, runId, userId, key, 'image/png', bytes.length, hash],
        );
        s3.objects.set(key, bytes);
        return { runId, assetId, hash };
      },
      async snapshot() {
        const read = async (sql: string) => (await database.pool.query(sql)).rows;
        return {
          sessions: await read(
            "SELECT user_id,execution_id,view->>'status' AS status,view->'text' AS text,view->'error' AS error FROM design_scheme_agent_sessions ORDER BY created_at",
          ),
          schemes: await read(
            'SELECT id,user_id,current_revision_id,working_draft_revision_id,version,status FROM design_schemes ORDER BY created_at',
          ),
          calls: await read(
            'SELECT user_id,execution_id,ordinal,role,status,usage FROM design_scheme_text_calls ORDER BY execution_id,ordinal',
          ),
          authorizations: await read(
            "SELECT execution_id,t.authorization->'maxModelCalls' AS max_calls FROM design_scheme_text_executions t",
          ),
          jobs: await read('SELECT id,task_id FROM graphile_worker._private_jobs'),
          // Deliberately do not export credentials, full prompts, private documents or source bytes.
          modelCalls: model.posts.map((post) => ({
            model: post.model,
            maxTokens: post.max_tokens,
          })),
          modelDiscovery: model.gets.length,
          githubRequests: github.requests.length,
          imageCalls: image.calls,
          imageOutput: image.output,
          generationWorker: generationWorker?.snapshot() ?? null,
          generationRuns: await read(
            'SELECT id,user_id,design_scheme_run_id,status FROM generation_runs ORDER BY created_at',
          ),
          schemeRuns: await read(
            'SELECT run_id,user_id,scheme_id,revision_id,mode,status FROM design_scheme_runs ORDER BY created_at',
          ),
          schemeAssets: await read(
            'SELECT id,user_id,revision_id,origin,role,content_hash FROM design_scheme_assets ORDER BY created_at',
          ),
          generationAssets: await read(
            'SELECT id,run_id,user_id,checksum_sha256 FROM generation_assets ORDER BY created_at',
          ),
          objects: [...s3.objects.values()].map((bytes) => ({
            bytes: bytes.length,
            hash: createHash('sha256').update(bytes).digest('hex'),
          })),
        };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
