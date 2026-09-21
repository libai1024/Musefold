import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { describe, it } from 'vitest';
import { runResultSchema, designSchemeRunInputSchema } from '@musefold/contracts';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';
import { agentTrialClient } from '../fixtures/agent-trial-client.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('actual Agent trial with upstream credential revocation', () => {
  for (const material of ['text', 'reference-image'] as const) {
    for (const phase of ['before-dispatch', 'after-dispatch'] as const) {
      it(`${material}: provider revocation ${phase} preserves accepted work and requires explicit new execution`, async ({
        expect,
      }) => {
        const fixture = await startAgentBrowserApp();
        const client = agentTrialClient(
          fixture,
          `provider-${material}-${phase}@example.test`,
          expect,
        );
        try {
          const reference =
            material === 'reference-image'
              ? await sharp({ create: { width: 6, height: 4, channels: 3, background: '#287c92' } })
                  .png()
                  .toBuffer()
              : undefined;
          const { draft, prepared } = await client.prepareNewTrial(reference);
          const prepareAgain = async () =>
            designSchemeRunInputSchema.parse(
              await client.json('/api/v1/design-schemes/prepare-run', {
                executionId: randomUUID(),
                schemeId: prepared.schemeId,
                revisionId: prepared.revisionId,
                mode: prepared.mode,
                priorityMode: prepared.priorityMode,
                brief: prepared.brief,
                inputValues: prepared.inputValues,
                executionSettings: prepared.executionSettings,
              }),
            );
          const alreadyAccepted = phase === 'after-dispatch';
          fixture.setImageMode('hold');
          if (alreadyAccepted) await fixture.startGeneration();
          const original = runResultSchema.parse(
            await client.json('/api/v1/design-schemes/run', prepared),
          );
          if (alreadyAccepted)
            await expect
              .poll(async () => (await fixture.snapshot()).imageCalls.length, { timeout: 20000 })
              .toBe(1);
          const revoked = fixture.revokeUpstreamCredentials();
          expect(revoked).toHaveLength(1);
          if (!alreadyAccepted) await fixture.startGeneration();
          fixture.releaseImage();
          await expect
            .poll(async () => (await fixture.snapshot()).schemeRuns[0].status, { timeout: 20000 })
            .toBe(alreadyAccepted ? 'completed' : 'failed');
          await expect
            .poll(async () => (await fixture.snapshot()).jobs.length, { timeout: 20000 })
            .toBe(0);
          const first = await client.detail(draft.summary.id);
          expect(first.document).toEqual(draft.document);
          expect(first.summary).toMatchObject({
            status: 'draft',
            hasSuccessfulTrial: alreadyAccepted,
          });
          expect(first.assets).toHaveLength(alreadyAccepted ? 1 : 0);
          const firstResult = runResultSchema.parse(
            await client.json(`/api/v1/design-schemes/runs/${original.runId}`),
          );
          expect(firstResult.status).toBe(alreadyAccepted ? 'completed' : 'failed');
          const rejectedInput = alreadyAccepted ? await prepareAgain() : prepared;
          // This is an explicit second submission, not automatic redispatch of the accepted run.
          const rejected = alreadyAccepted
            ? runResultSchema.parse(await client.json('/api/v1/design-schemes/run', rejectedInput))
            : original;
          await expect
            .poll(async () => (await fixture.snapshot()).schemeRuns.at(-1)?.status, {
              timeout: 20000,
            })
            .toBe('failed');
          await expect
            .poll(async () => (await fixture.snapshot()).jobs.length, { timeout: 20000 })
            .toBe(0);
          const denied = runResultSchema.parse(
            await client.json(`/api/v1/design-schemes/runs/${rejected.runId}`),
          );
          expect(denied.error?.code).toBe('GENERATION_UPSTREAM_REJECTED');
          expect(denied.outputs).toEqual([]);
          const runtime = await fixture.generationRuntime();
          const failedRun = runtime.runs.find((run) => run.status === 'failed');
          expect(failedRun).toMatchObject({
            attempt_count: 1,
            upstream_request_sent: true,
            error_code: 'GENERATION_UPSTREAM_REJECTED',
          });
          expect(
            runtime.receipts.find((receipt) => receipt.original_run_id === failedRun?.id),
          ).toMatchObject({
            status: 'failed',
            dispatch: 'claimed',
            cost_points: null,
            cost_provenance: 'unknown',
          });
          const authority = fixture.providerAuthorizationSnapshot();
          const imageRequests = authority.requests.filter((r) =>
            r.endpoint.startsWith('/v1/images/'),
          );
          expect(imageRequests.map((r) => r.authorized)).toEqual(
            alreadyAccepted ? [true, false] : [false],
          );
          expect(imageRequests.every((r) => r.method === 'POST' && r.keyHash === revoked[0])).toBe(
            true,
          );
          expect(
            imageRequests.every((r) => r.endpoint.endsWith(reference ? '/edits' : '/generations')),
          ).toBe(true);
          const settled = await fixture.snapshot();
          const settledDetail = await client.detail(draft.summary.id);
          expect(settledDetail.document).toEqual(first.document);
          expect(settledDetail.assets).toEqual(first.assets);
          expect(settledDetail.summary.hasSuccessfulTrial).toBe(alreadyAccepted);
          expect(settled.imageCalls).toHaveLength(alreadyAccepted ? 1 : 0);
          expect(settled.modelCalls).toHaveLength(1);
          if (reference && alreadyAccepted)
            expect(settled.imageCalls[0].references).toHaveLength(1);
          // Re-enabling the same upstream key does not grant or replay any Musefold execution.
          fixture.restoreUpstreamCredentials();
          for (const [input, runId] of [
            [prepared, original.runId],
            [rejectedInput, rejected.runId],
          ] as const) {
            const replay = runResultSchema.parse(
              await client.json('/api/v1/design-schemes/run', input),
            );
            expect(replay.runId).toBe(runId);
          }
          expect(await client.detail(draft.summary.id)).toEqual(settledDetail);
          expect((await fixture.snapshot()).imageCalls).toEqual(settled.imageCalls);
          expect(fixture.providerAuthorizationSnapshot().requests).toEqual(authority.requests);
          const freshInput = await prepareAgain();
          const fresh = runResultSchema.parse(
            await client.json('/api/v1/design-schemes/run', freshInput),
          );
          expect(fresh.runId).not.toBe(original.runId);
          await expect
            .poll(async () => (await fixture.snapshot()).schemeRuns.at(-1)?.status, {
              timeout: 20000,
            })
            .toBe('completed');
          await expect
            .poll(async () => (await fixture.snapshot()).jobs.length, { timeout: 20000 })
            .toBe(0);
          expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
          const final = await fixture.snapshot();
          expect(final.imageCalls).toHaveLength(alreadyAccepted ? 2 : 1);
          expect(final.modelCalls).toHaveLength(1);
          expect(final.schemeRuns).toHaveLength(alreadyAccepted ? 3 : 2);
          expect(await client.json(`/api/v1/design-schemes/runs/${original.runId}`)).toEqual(
            firstResult,
          );
          expect((await client.detail(draft.summary.id)).summary.hasSuccessfulTrial).toBe(true);
          console.log(
            'PROVIDER_REVOCATION_EVIDENCE',
            JSON.stringify({
              material,
              phase,
              originalRunId: original.runId,
              rejectedRunId: rejected.runId,
              freshRunId: fresh.runId,
              authority,
              rejectedReceipt: runtime.receipts.find((r) => r.original_run_id === failedRun?.id),
              originalStatus: firstResult.status,
              acceptedImageCalls: final.imageCalls.length,
              textCalls: final.modelCalls.length,
              finalAuthority: fixture.providerAuthorizationSnapshot(),
            }),
          );
        } finally {
          fixture.releaseImage();
          await fixture.close();
        }
      }, 120000);
    }
  }
});
