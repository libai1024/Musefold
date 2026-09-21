import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';
import {
  designSchemeAgentSessionSchema,
  designSchemeTextModelOfferSchema,
  designSchemeDetailSchema,
  designSchemeRunInputSchema,
  runResultSchema,
  generationJobSchema,
  cancelDesignSchemeResultSchema,
} from '@musefold/contracts';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
async function until<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Deadline: ${label}`);
}

describeDb(
  'actual generation bin preserves original scheme execution through cancellation and unknown response',
  () => {
    it.each(['cancel-before', 'cancel-after', 'unknown'] as const)(
      '%s never grants trial or redispatches an accepted execution',
      async (scenario) => {
        const fixture = await startAgentBrowserApp();
        let cookie = '';
        const request = (path: string, body?: unknown) =>
          fixture.app.request(path, {
            headers: {
              'content-type': 'application/json',
              origin: 'http://127.0.0.1:3399',
              cookie,
            },
            ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
          });
        const json = async (path: string, body?: unknown) => {
          const response = await request(path, body);
          assert.equal(
            response.status,
            body && path.endsWith('/agent/executions') ? 202 : 200,
            path,
          );
          return response.json();
        };
        try {
          const login = await request('/api/auth/sign-up/new-api', {
            email: `${scenario}@example.test`,
            password: 'correct-password',
          });
          assert.equal(login.status, 200);
          cookie = (login.headers.get('set-cookie') ?? '')
            .split(/,(?=[^;]+=)/)
            .map((part) => part.split(';')[0])
            .join('; ');
          const offer = designSchemeTextModelOfferSchema.parse(
            await json('/api/v1/design-schemes/agent/text-model'),
          );
          const executionId = randomUUID();
          await json('/api/v1/design-schemes/agent/executions', {
            operation: 'create',
            input: {
              executionId,
              brief: '黑白海报',
              sourceUris: [],
              sourceBindings: [],
              sourceAssetIds: [],
            },
            text: {
              binding: offer.binding,
              maxModelCalls: 1,
              maxOutputTokens: offer.maxOutputTokens,
              acceptUnknownCost: true,
            },
          });
          const agent = await until(
            async () =>
              designSchemeAgentSessionSchema.parse(
                await json(`/api/v1/design-schemes/agent/executions/${executionId}`),
              ),
            (s) => s.status === 'completed',
            'agent completion',
          );
          if (!agent.result) throw new Error('Missing actual Agent result');
          const schemeId = agent.result.scheme.id;
          const detail = async () =>
            designSchemeDetailSchema.parse(await json(`/api/v1/design-schemes/${schemeId}`));
          const draft = await detail();
          const prepared = designSchemeRunInputSchema.parse(
            await json('/api/v1/design-schemes/prepare-run', {
              executionId: randomUUID(),
              schemeId,
              revisionId: draft.document.revisionId,
              mode: 'trial',
              brief: '书展',
              inputValues: { topic: '书展' },
              executionSettings: {
                providerId: 'cloud-default',
                size: 'auto',
                quality: 'auto',
                outputCount: 1,
                referenceAssetIds: [],
                promptReferenceSelections: [],
              },
            }),
          );
          fixture.setImageMode(scenario === 'unknown' ? 'drop' : 'hold');
          if (scenario !== 'cancel-before') await fixture.startGeneration();
          const accepted = runResultSchema.parse(
            await json('/api/v1/design-schemes/run', prepared),
          );
          if (scenario !== 'cancel-before')
            await until(
              () => fixture.snapshot(),
              (s) => s.imageCalls.length === 1,
              'image dispatch',
            );
          if (scenario !== 'unknown') {
            const cancelled = cancelDesignSchemeResultSchema.parse(
              await json('/api/v1/design-schemes/cancel', {
                executionId: prepared.executionId,
                runId: accepted.runId,
              }),
            );
            assert.equal(cancelled.status, 'cancelled');
            fixture.releaseImage();
          }
          if (scenario === 'cancel-before') await fixture.startGeneration();
          const terminal = await until(
            async () =>
              runResultSchema.parse(await json(`/api/v1/design-schemes/runs/${accepted.runId}`)),
            (r) => ['failed', 'cancelled', 'completed', 'blocked'].includes(r.status),
            'run terminal',
          );
          assert.equal(terminal.status, scenario === 'unknown' ? 'failed' : 'cancelled');
          await until(
            () => fixture.snapshot(),
            (s) => s.jobs.length === 0,
            'actual worker acknowledged terminal queue job',
          );
          assert.deepEqual(await fixture.stopGeneration(), { code: 0, signal: null });
          const after = await detail();
          assert.equal(after.summary.hasSuccessfulTrial, false);
          assert.equal(after.summary.status, 'draft');
          assert.equal(after.assets.length, 0);
          const replay = runResultSchema.parse(await json('/api/v1/design-schemes/run', prepared));
          assert.equal(replay.runId, accepted.runId);
          assert.equal(replay.status, terminal.status);
          const snapshot = await fixture.snapshot();
          assert.equal(snapshot.imageCalls.length, scenario === 'cancel-before' ? 0 : 1);
          assert.equal(snapshot.modelCalls.length, 1);
          assert.equal(snapshot.generationRuns.length, 1);
          assert.equal(snapshot.schemeRuns.length, 1);
          assert.equal(snapshot.generationRuns[0].design_scheme_run_id, accepted.runId);
          assert.equal(snapshot.schemeRuns[0].revision_id, draft.document.revisionId);
          if (scenario !== 'cancel-before') {
            const job = generationJobSchema.parse(
              await json(`/api/v1/generations/${snapshot.generationRuns[0].id}`),
            );
            assert.equal(job.costPoints, null);
            assert.equal(job.assets.length, 0);
          }
          if (scenario === 'unknown') {
            assert.equal(terminal.error?.code, 'GENERATION_UPSTREAM_UNKNOWN');
            assert.equal(terminal.error?.retryable, false);
            assert.equal(terminal.error?.recoveryAction, 'none');
          }
        } finally {
          fixture.releaseImage();
          await fixture.close();
        }
      },
      180000,
    );
  },
);
