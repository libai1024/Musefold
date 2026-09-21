import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, it, type expect as defaultExpect } from 'vitest';
import { runResultSchema, cancelDesignSchemeResultSchema } from '@musefold/contracts';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';
import { agentTrialClient } from '../fixtures/agent-trial-client.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
type Fixture = Awaited<ReturnType<typeof startAgentBrowserApp>>;
type Assert = typeof defaultExpect;
const reference = () =>
  sharp({
    create: { width: 8, height: 6, channels: 3, background: '#ad346a' },
  })
    .png()
    .toBuffer();

function pid(value: number | undefined) {
  if (!value) throw new Error('Missing owned generation PID');
  return value;
}
async function pause(fixture: Fixture, oldPid: number, expect: Assert) {
  fixture.signalGeneration(oldPid, 'SIGSTOP');
  await expect
    .poll(() =>
      execFileSync('ps', ['-o', 'state=', '-p', String(oldPid)], {
        encoding: 'utf8',
      }),
    )
    .toContain('T');
}
async function drain(fixture: Fixture, expect: Assert, jobId?: string) {
  await expect
    .poll(
      async () => {
        const jobs = (await fixture.generationRuntime()).jobs;
        return jobId ? jobs.filter((job) => job.id === jobId).length : jobs.length;
      },
      { timeout: 20000 },
    )
    .toBe(0);
}
async function maintenance(fixture: Fixture, expect: Assert) {
  const jobId = await fixture.requestMaintenance();
  await drain(fixture, expect, jobId);
  return jobId;
}

describeDb('actual Agent trials preserve assets across storage and process failures', () => {
  for (const outage of ['once', 'always'] as const) {
    it(`a ${outage} lost S3 PUT response retries storage without repeating paid generation`, async ({
      expect,
    }) => {
      const fixture = await startAgentBrowserApp();
      try {
        const client = agentTrialClient(fixture, `lost-put-${outage}@example.test`, expect);
        const { draft, prepared } = await client.prepareNewTrial();
        fixture.storageFault(outage === 'once' ? 'drop-put-once' : 'drop-put-always');
        const oldPid = pid((await fixture.startGeneration()).pid);
        const accepted = runResultSchema.parse(
          await client.json('/api/v1/design-schemes/run', prepared),
        );
        const status = outage === 'once' ? 'succeeded' : 'failed';
        await expect
          .poll(async () => (await fixture.generationRuntime()).runs[0]?.status, { timeout: 30000 })
          .toBe(status);
        await drain(fixture, expect);
        const settled = await fixture.generationRuntime();
        const written = await fixture.storageRuntime();
        expect(settled.runs).toEqual([
          expect.objectContaining({
            status,
            attempt_count: 1,
            upstream_request_sent: true,
          }),
        ]);
        expect(written.objects).toHaveLength(1);
        const keyHash = written.objects[0].keyHash;
        // Multiple real PUT requests must target exactly the same already-written object.
        expect(written.writes.length).toBeGreaterThanOrEqual(2);
        expect(new Set(written.writes.map((write) => write.keyHash))).toEqual(new Set([keyHash]));
        expect(written.droppedPuts).toHaveLength(outage === 'once' ? 1 : written.writes.length);
        expect(new Set(written.droppedPuts)).toEqual(new Set([keyHash]));
        expect(written.cleanup).toHaveLength(outage === 'once' ? 0 : 1);
        if (outage === 'always') {
          expect(written.cleanup[0]).toMatchObject({ keyHash, reason: 'generation_compensation' });
          expect(new Date(written.cleanup[0].next_attempt_at).getTime()).toBeLessThanOrEqual(
            Date.now(),
          );
          expect(settled.receipts).toEqual([
            expect.objectContaining({
              status: 'failed',
              dispatch: 'claimed',
              cost_points: null,
              cost_provenance: 'unknown',
            }),
          ]);
        }
        const canonical = await client.detail(draft.summary.id);
        expect(canonical.summary).toMatchObject({
          status: 'draft',
          hasSuccessfulTrial: outage === 'once',
        });
        expect(canonical.assets).toHaveLength(outage === 'once' ? 1 : 0);
        expect(canonical.document).toEqual(draft.document);
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        fixture.storageFault('none');
        const newPid = pid((await fixture.replaceGeneration()).pid);
        expect(newPid).not.toBe(oldPid);
        expect(
          runResultSchema.parse(await client.json('/api/v1/design-schemes/run', prepared)),
        ).toMatchObject({
          runId: accepted.runId,
          status: outage === 'once' ? 'completed' : 'failed',
        });
        await maintenance(fixture, expect);
        await drain(fixture, expect);
        const cleaned = await fixture.storageRuntime();
        expect(cleaned.cleanup).toHaveLength(0);
        expect(cleaned.objects).toEqual(outage === 'once' ? written.objects : []);
        expect(cleaned.deleted).toEqual(outage === 'once' ? [] : [keyHash]);
        expect(cleaned.writes).toEqual(written.writes);
        const final = await fixture.snapshot();
        expect(final.generationRuns).toEqual([
          expect.objectContaining({
            id: settled.runs[0].id,
            design_scheme_run_id: accepted.runId,
            status,
          }),
        ]);
        expect(final.schemeRuns).toEqual([
          expect.objectContaining({
            run_id: accepted.runId,
            status: outage === 'once' ? 'completed' : 'failed',
          }),
        ]);
        expect(final.imageCalls).toHaveLength(1);
        expect(final.modelCalls).toHaveLength(1);
        expect(final.generationAssets).toHaveLength(outage === 'once' ? 1 : 0);
        expect(final.schemeAssets).toHaveLength(outage === 'once' ? 1 : 0);
        expect((await fixture.generationRuntime()).runs).toEqual(settled.runs);
        expect((await fixture.generationRuntime()).receipts).toEqual(settled.receipts);
        expect(await client.detail(draft.summary.id)).toEqual(canonical);
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        console.log(
          'ASSET_EVIDENCE',
          JSON.stringify({
            scenario: `lost-put-${outage}`,
            oldPid,
            newPid,
            settled,
            written,
            cleaned,
            imageCalls: final.imageCalls.length,
          }),
        );
      } finally {
        fixture.storageFault('none');
        await fixture.close();
      }
    }, 120000);
  }

  for (const fault of ['tamper', 'delete'] as const) {
    it(`a reference ${fault} after acceptance fails before paid dispatch`, async ({ expect }) => {
      const fixture = await startAgentBrowserApp();
      try {
        const client = agentTrialClient(fixture, `${fault}-reference@example.test`, expect);
        const { draft, prepared } = await client.prepareNewTrial(await reference());
        const accepted = runResultSchema.parse(
          await client.json('/api/v1/design-schemes/run', prepared),
        );
        fixture.corruptReference(prepared.executionSettings.referenceAssetIds[0], fault);
        await fixture.startGeneration();
        await expect
          .poll(async () => (await fixture.generationRuntime()).runs[0]?.status, { timeout: 20000 })
          .toBe('failed');
        await drain(fixture, expect);
        const runtime = await fixture.generationRuntime();
        expect(runtime.runs).toEqual([
          expect.objectContaining({
            status: 'failed',
            attempt_count: 1,
            upstream_request_sent: false,
          }),
        ]);
        expect(runtime.receipts).toEqual([
          expect.objectContaining({
            status: 'failed',
            dispatch: 'not_started',
            cost_points: 0,
            cost_provenance: 'not_sent',
          }),
        ]);
        const state = await fixture.snapshot();
        expect(state.imageCalls).toHaveLength(0);
        expect(state.modelCalls).toHaveLength(1);
        expect(state.schemeAssets).toHaveLength(0);
        expect(state.generationAssets).toHaveLength(0);
        const after = await client.detail(draft.summary.id);
        expect(after.document).toEqual(draft.document);
        expect(after.summary).toMatchObject({ status: 'draft', hasSuccessfulTrial: false });
        expect(
          runResultSchema.parse(await client.json('/api/v1/design-schemes/run', prepared)),
        ).toMatchObject({ runId: accepted.runId, status: 'failed' });
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        console.log(
          'ASSET_EVIDENCE',
          JSON.stringify({
            scenario: `reference-${fault}`,
            runtime,
            storage: await fixture.storageRuntime(),
            imageCalls: state.imageCalls.length,
          }),
        );
      } finally {
        await fixture.close();
      }
    }, 120000);
  }

  it.concurrent(
    'a written object survives a deletion error and is reclaimed after natural backoff in a new PID',
    async ({ expect }) => {
      const fixture = await startAgentBrowserApp();
      try {
        const client = agentTrialClient(fixture, 'write-cleanup-backoff@example.test', expect);
        const { draft, prepared } = await client.prepareNewTrial();
        fixture.storageFault('put-after-write');
        const oldPid = pid((await fixture.startGeneration()).pid);
        await client.json('/api/v1/design-schemes/run', prepared);
        await expect
          .poll(async () => (await fixture.generationRuntime()).runs[0]?.status, { timeout: 20000 })
          .toBe('failed');
        await drain(fixture, expect);
        const failed = await fixture.generationRuntime();
        const written = await fixture.storageRuntime();
        expect(written.objects).toHaveLength(1);
        expect(written.cleanup).toEqual([
          expect.objectContaining({
            keyHash: written.objects[0].keyHash,
            reason: 'generation_compensation',
            attempt_count: 0,
          }),
        ]);
        fixture.storageFault('delete');
        const failedCleanupJob = await maintenance(fixture, expect);
        const deferred = await fixture.storageRuntime();
        expect(deferred.objects).toEqual(written.objects);
        expect(deferred.deleted).toHaveLength(0);
        expect(deferred.cleanup).toEqual([
          expect.objectContaining({
            attempt_count: 1,
            last_error: 'S3DeleteObjectsError',
            abandoned_at: null,
          }),
        ]);
        const retryAt = new Date(deferred.cleanup[0].next_attempt_at).getTime();
        expect(retryAt - Date.now()).toBeGreaterThan(4 * 60_000);
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        fixture.storageFault('none');
        const newPid = pid((await fixture.replaceGeneration()).pid);
        expect(newPid).not.toBe(oldPid);
        await maintenance(fixture, expect);
        const early = await fixture.storageRuntime();
        expect(early.cleanup).toEqual(deferred.cleanup);
        expect(early.objects).toEqual(written.objects);
        console.log(
          'ASSET_WAIT',
          JSON.stringify({
            scenario: 'cleanup-backoff',
            oldPid,
            newPid,
            retryAt: new Date(retryAt).toISOString(),
            deferred,
            failedCleanupJob,
          }),
        );
        await expect
          .poll(() => Date.now(), { timeout: 6 * 60_000, interval: 1000 })
          .toBeGreaterThanOrEqual(retryAt);
        const cleanupJob = await maintenance(fixture, expect);
        const cleaned = await fixture.storageRuntime();
        expect(cleaned.cleanup).toHaveLength(0);
        expect(cleaned.objects).toHaveLength(0);
        expect(cleaned.deleted).toEqual([written.objects[0].keyHash]);
        const state = await fixture.snapshot();
        expect(state.imageCalls).toHaveLength(1);
        expect(state.schemeAssets).toHaveLength(0);
        expect(state.generationAssets).toHaveLength(0);
        const after = await client.detail(draft.summary.id);
        expect(after.summary.hasSuccessfulTrial).toBe(false);
        expect(after.document).toEqual(draft.document);
        expect((await fixture.generationRuntime()).runs).toEqual(failed.runs);
        expect((await fixture.generationRuntime()).receipts).toEqual(failed.receipts);
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        console.log(
          'ASSET_EVIDENCE',
          JSON.stringify({
            scenario: 'cleanup-backoff',
            oldPid,
            newPid,
            failed,
            written,
            deferred,
            cleaned,
            cleanupJob,
            imageCalls: state.imageCalls.length,
          }),
        );
      } finally {
        fixture.storageFault('none');
        await fixture.close();
      }
    },
    8 * 60_000,
  );

  for (const phase of [
    'reference-read',
    'uploaded-output',
    'reference-read-cancel',
    'uploaded-output-cancel',
  ] as const) {
    it.skipIf(process.platform === 'win32').concurrent(
      `natural lease recovery during ${phase} fences the old process and protects canonical assets`,
      async ({ expect }) => {
        const fixture = await startAgentBrowserApp();
        try {
          const client = agentTrialClient(fixture, `${phase}-epoch@example.test`, expect);
          const sent = phase.startsWith('uploaded-output');
          const cancelled = phase.endsWith('-cancel');
          const bytes = sent ? undefined : await reference();
          const { draft, prepared } = await client.prepareNewTrial(bytes);
          const accepted = runResultSchema.parse(
            await client.json('/api/v1/design-schemes/run', prepared),
          );
          // Acceptance preflight has finished; the held GET belongs to the generation bin.
          fixture.holdStorage(sent ? 'PUT' : 'GET');
          const oldPid = pid((await fixture.startGeneration()).pid);
          await expect
            .poll(async () => (await fixture.storageRuntime()).barriers.length, { timeout: 20000 })
            .toBe(1);
          await pause(fixture, oldPid, expect);
          if (cancelled)
            expect(
              cancelDesignSchemeResultSchema.parse(
                await client.json('/api/v1/design-schemes/cancel', {
                  executionId: prepared.executionId,
                  runId: accepted.runId,
                }),
              ).status,
            ).toBe('cancelled');
          const interrupted = await fixture.generationRuntime();
          const original = interrupted.runs[0];
          expect(original).toMatchObject({
            status: cancelled ? 'cancelling' : 'running',
            attempt_count: 1,
            upstream_request_sent: sent,
          });
          expect(interrupted.receipts[0].dispatch).toBe(sent ? 'claimed' : 'not_started');
          const held = await fixture.storageRuntime();
          expect(held.barriers[0].released).toBe(false);
          expect(held.objects).toHaveLength(1);
          if (sent) expect(held.cleanup).toHaveLength(1);
          const oldJob = interrupted.jobs.find((job) => job.identifier === 'generation.generate');
          expect(oldJob?.locked_by).toEqual(expect.any(String));
          const expiresAt = new Date(original.lease_expires_at).getTime();
          expect(expiresAt - Date.now()).toBeGreaterThan(9 * 60_000);
          const newPid = pid((await fixture.replaceGeneration()).pid);
          expect(newPid).not.toBe(oldPid);
          console.log(
            'ASSET_WAIT',
            JSON.stringify({
              scenario: phase,
              oldPid,
              newPid,
              expiresAt: new Date(expiresAt).toISOString(),
              interrupted,
              held,
            }),
          );
          const prematureChanges: string[] = [];
          await expect
            .poll(
              async () => {
                const state = await fixture.generationRuntime();
                if (
                  Date.now() < expiresAt &&
                  (state.runs[0].status !== original.status ||
                    new Date(state.runs[0].lease_expires_at).getTime() !== expiresAt)
                )
                  prematureChanges.push(state.observedAt);
                return state.runs[0].status;
              },
              { timeout: 12 * 60_000, interval: 2000 },
            )
            .toBe(sent ? 'failed' : cancelled ? 'cancelled' : 'succeeded');
          expect(prematureChanges).toEqual([]);
          const recovered = await fixture.generationRuntime();
          expect(new Date(recovered.runs[0].finished_at).getTime()).toBeGreaterThanOrEqual(
            expiresAt,
          );
          expect(recovered.runs[0].attempt_count).toBe(sent || cancelled ? 1 : 2);
          const canonical = await client.detail(draft.summary.id);
          expect(canonical.summary.hasSuccessfulTrial).toBe(!sent && !cancelled);
          expect(canonical.assets).toHaveLength(sent || cancelled ? 0 : 1);
          expect(recovered.receipts[0]).toMatchObject({
            dispatch: sent || !cancelled ? 'claimed' : 'not_started',
            cost_points: !sent && cancelled ? 0 : null,
          });
          const beforeLate = await fixture.storageRuntime();
          fixture.releaseStorage();
          fixture.signalGeneration(oldPid, 'SIGCONT');
          await drain(fixture, expect, String(oldJob?.id));
          expect(await fixture.stopGenerationPid(oldPid)).toEqual({ code: 0, signal: null });
          expect((await fixture.storageRuntime()).barriers[0].released).toBe(true);
          expect((await fixture.generationRuntime()).runs).toEqual(recovered.runs);
          expect((await fixture.generationRuntime()).receipts).toEqual(recovered.receipts);
          expect(await client.detail(draft.summary.id)).toEqual(canonical);
          if (sent) {
            const due = await fixture.storageRuntime();
            expect(due.cleanup).toHaveLength(1);
            expect(new Date(due.cleanup[0].next_attempt_at).getTime()).toBeLessThanOrEqual(
              Date.now(),
            );
            await maintenance(fixture, expect);
            expect((await fixture.storageRuntime()).objects).toHaveLength(0);
            expect((await fixture.storageRuntime()).cleanup).toHaveLength(0);
            expect((await fixture.storageRuntime()).deleted).toEqual([held.objects[0].keyHash]);
          } else {
            if (!bytes) throw new Error('Missing explicit reference bytes');
            await maintenance(fixture, expect);
            expect((await fixture.storageRuntime()).objects).toEqual(beforeLate.objects);
            const state = await fixture.snapshot();
            if (!cancelled)
              expect(state.imageCalls[0].references[0].hash).toBe(
                createHash('sha256').update(bytes).digest('hex'),
              );
            expect(state.generationAssets).toHaveLength(cancelled ? 0 : 1);
            expect(state.schemeAssets).toHaveLength(cancelled ? 0 : 1);
            if (!cancelled) expect(state.imageCalls[0].endpoint).toBe('/v1/images/edits');
          }
          const final = await fixture.snapshot();
          expect(final.imageCalls).toHaveLength(!sent && cancelled ? 0 : 1);
          expect(final.modelCalls).toHaveLength(1);
          expect(final.schemeRuns).toEqual([expect.objectContaining({ run_id: accepted.runId })]);
          expect(final.generationRuns).toHaveLength(1);
          await drain(fixture, expect);
          expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
          console.log(
            'ASSET_EVIDENCE',
            JSON.stringify({
              scenario: phase,
              oldPid,
              newPid,
              interrupted,
              recovered,
              held,
              finalStorage: await fixture.storageRuntime(),
              imageCalls: final.imageCalls.length,
              prematureChanges,
            }),
          );
        } finally {
          fixture.releaseStorage();
          await fixture.close();
        }
      },
      15 * 60_000,
    );
  }
});
