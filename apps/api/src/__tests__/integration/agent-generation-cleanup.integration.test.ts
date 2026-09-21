import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { describe, it, type expect as defaultExpect } from 'vitest';
import { runResultSchema } from '@musefold/contracts';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';
import { agentTrialClient } from '../fixtures/agent-trial-client.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
type Fixture = Awaited<ReturnType<typeof startAgentBrowserApp>>;
const reference = () =>
  sharp({ create: { width: 8, height: 6, channels: 3, background: '#ad346a' } })
    .png()
    .toBuffer();
function pid(value: number | undefined) {
  if (!value) throw new Error('Missing owned generation PID');
  return value;
}
async function drain(fixture: Fixture, expect: typeof defaultExpect, jobId?: string) {
  await expect
    .poll(
      async () => {
        const jobs = (await fixture.generationRuntime()).jobs;
        return jobId ? jobs.filter((job) => String(job.id) === jobId).length : jobs.length;
      },
      { timeout: 20000 },
    )
    .toBe(0);
}

describeDb('actual new Agent reference adoption versus maintenance deletion', () => {
  it('rechecks adopted metadata after an in-flight preflight GET outlives physical cleanup', async ({
    expect,
  }) => {
    const fixture = await startAgentBrowserApp();
    let pending: Promise<Response> | undefined;
    try {
      const client = agentTrialClient(fixture, 'preflight-cleanup@example.test', expect);
      const { draft, prepared } = await client.prepareNewTrial(await reference());
      const observer = await fixture.observeReferenceCleanup();
      const original = await fixture.storageRuntime();
      expect(original.objects).toHaveLength(1);
      fixture.holdStorage('GET');
      const request = Promise.resolve(client.request('/api/v1/design-schemes/run', prepared));
      pending = request;
      await expect
        .poll(async () => (await fixture.storageRuntime()).barriers, { timeout: 20000 })
        .toEqual([
          expect.objectContaining({
            method: 'GET',
            released: false,
            keyHash: original.objects[0].keyHash,
          }),
        ]);
      // API already selected available metadata and S3 captured valid bytes for this response.
      const reading = await observer.snapshot();
      expect(reading.uploads).toEqual([expect.objectContaining({ status: 'available' })]);
      expect(reading.references).toEqual([]);
      const acceleratedExpiry = await observer.expireReference(
        prepared.executionSettings.referenceAssetIds[0],
      );
      const workerPid = pid((await fixture.startGeneration()).pid);
      const maintenanceJob = await fixture.requestMaintenance();
      await drain(fixture, expect, maintenanceJob);
      const cleaned = await observer.snapshot();
      const afterCleanup = await fixture.storageRuntime();
      expect(cleaned.uploads).toEqual([]);
      expect(cleaned.references).toEqual([]);
      expect(afterCleanup.objects).toEqual([]);
      expect(afterCleanup.cleanup).toEqual([]);
      expect(afterCleanup.deleted).toEqual([original.objects[0].keyHash]);
      expect(afterCleanup.barriers).toEqual([
        expect.objectContaining({ method: 'GET', released: false }),
      ]);
      // The in-flight GET still returns its captured bytes. Only the admission recheck can reject them.
      fixture.releaseStorage();
      const response = await request;
      const rejected = { status: response.status, body: await response.json() };
      expect(rejected).toMatchObject({
        status: 404,
        body: { error: { code: 'VALIDATION_FAILED', message: '方案图片不存在或已过期' } },
      });
      expect((await client.request('/api/v1/design-schemes/run', prepared)).status).toBe(404);
      expect(await client.detail(draft.summary.id)).toEqual(draft);
      const final = await fixture.snapshot();
      expect(final.generationRuns).toEqual([]);
      expect(final.schemeRuns).toEqual([]);
      expect(final.imageCalls).toEqual([]);
      expect(final.modelCalls).toHaveLength(1);
      expect(final.generationAssets).toEqual([]);
      expect(final.schemeAssets).toEqual([]);
      expect((await fixture.generationRuntime()).receipts).toEqual([]);
      expect((await fixture.generationOutcome()).evaluations).toEqual([]);
      expect((await observer.snapshot()).references).toEqual([]);
      expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
      console.log(
        'INFLIGHT_CLEANUP_EVIDENCE',
        JSON.stringify({
          workerPid,
          acceleratedExpiry,
          reading,
          original,
          cleaned,
          afterCleanup,
          rejected,
          maintenanceJob,
          imageCalls: final.imageCalls.length,
        }),
      );
    } finally {
      fixture.releaseStorage();
      try {
        await pending;
      } finally {
        await fixture.close();
      }
    }
  }, 120000);

  it.skipIf(process.platform === 'win32')(
    'accepted reference survives cleanup while its actual worker is paused',
    async ({ expect }) => {
      const fixture = await startAgentBrowserApp();
      try {
        const client = agentTrialClient(fixture, 'reference-wins@example.test', expect);
        const { draft, prepared } = await client.prepareNewTrial(await reference());
        const observer = await fixture.observeReferenceCleanup();
        const accepted = runResultSchema.parse(
          await client.json('/api/v1/design-schemes/run', prepared),
        );
        const protectedBefore = await observer.snapshot();
        expect(protectedBefore.references).toEqual([
          expect.objectContaining({ asset_id: prepared.executionSettings.referenceAssetIds[0] }),
        ]);
        const original = await fixture.storageRuntime();
        expect(original.objects).toHaveLength(1);
        fixture.holdStorage('GET');
        const oldPid = pid((await fixture.startGeneration()).pid);
        await expect
          .poll(async () => (await fixture.storageRuntime()).barriers, { timeout: 20000 })
          .toEqual([
            expect.objectContaining({ method: 'GET', keyHash: original.objects[0].keyHash }),
          ]);
        fixture.signalGeneration(oldPid, 'SIGSTOP');
        await expect
          .poll(() =>
            execFileSync('ps', ['-o', 'state=', '-p', String(oldPid)], { encoding: 'utf8' }),
          )
          .toContain('T');
        // Only reference expiry is accelerated in this disposable DB. No lease or qualification is changed.
        const acceleratedExpiry = await observer.expireReference(
          prepared.executionSettings.referenceAssetIds[0],
        );
        const newPid = pid((await fixture.replaceGeneration()).pid);
        expect(newPid).not.toBe(oldPid);
        const maintenanceJob = await fixture.requestMaintenance();
        await drain(fixture, expect, maintenanceJob);
        const protectedAfter = await observer.snapshot();
        const afterCleanup = await fixture.storageRuntime();
        expect(protectedAfter.references).toEqual(protectedBefore.references);
        // A permanently adopted reference must not consume every batch of each cleanup tick.
        expect(protectedAfter.audit).toEqual([]);
        expect(protectedAfter.uploads).toEqual([
          expect.objectContaining({ status: 'available', cleanup_queued_at: null }),
        ]);
        expect(afterCleanup.objects).toEqual(original.objects);
        expect(afterCleanup.deleted).toEqual([]);
        expect(afterCleanup.cleanup).toEqual([]);
        fixture.releaseStorage();
        fixture.signalGeneration(oldPid, 'SIGCONT');
        await drain(fixture, expect);
        const settled = await fixture.generationRuntime();
        expect(settled.runs).toEqual([
          expect.objectContaining({ status: 'succeeded', attempt_count: 1 }),
        ]);
        const detail = await client.detail(draft.summary.id);
        expect(detail.document).toEqual(draft.document);
        expect(detail.summary).toMatchObject({ status: 'draft', hasSuccessfulTrial: true });
        expect(detail.assets).toHaveLength(1);
        const final = await fixture.snapshot();
        expect(final.imageCalls).toHaveLength(1);
        expect(final.modelCalls).toHaveLength(1);
        expect(final.generationRuns).toEqual([
          expect.objectContaining({ design_scheme_run_id: accepted.runId, status: 'succeeded' }),
        ]);
        expect((await fixture.storageRuntime()).objects).toEqual(
          expect.arrayContaining(original.objects),
        );
        expect((await fixture.generationOutcome()).evaluations).toHaveLength(1);
        expect(await fixture.stopGenerationPid(oldPid)).toEqual({ code: 0, signal: null });
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        console.log(
          'CLEANUP_EVIDENCE',
          JSON.stringify({
            order: 'reference-first',
            oldPid,
            newPid,
            acceleratedExpiry,
            protectedBefore,
            protectedAfter,
            original,
            afterCleanup,
            maintenanceJob,
            settled,
          }),
        );
      } finally {
        fixture.releaseStorage();
        await fixture.close();
      }
    },
    120000,
  );

  it('claimed cleanup rejects late adoption before deleting reference bytes', async ({
    expect,
  }) => {
    const fixture = await startAgentBrowserApp();
    try {
      const client = agentTrialClient(fixture, 'cleanup-wins@example.test', expect);
      const { draft, prepared } = await client.prepareNewTrial(await reference());
      const observer = await fixture.observeReferenceCleanup();
      const original = await fixture.storageRuntime();
      expect(original.objects).toHaveLength(1);
      const acceleratedExpiry = await observer.expireReference(
        prepared.executionSettings.referenceAssetIds[0],
      );
      fixture.holdStorage('DELETE');
      const workerPid = pid((await fixture.startGeneration()).pid);
      const maintenanceJob = await fixture.requestMaintenance();
      await expect
        .poll(async () => (await fixture.storageRuntime()).barriers, { timeout: 20000 })
        .toEqual([
          expect.objectContaining({ method: 'DELETE', keyHash: original.objects[0].keyHash }),
        ]);
      const claimed = await observer.snapshot();
      expect(claimed.references).toEqual([]);
      expect(claimed.uploads).toEqual([expect.objectContaining({ status: 'cleanup_pending' })]);
      expect(claimed.audit).toEqual([
        expect.objectContaining({ operation: 'INSERT', attempt_count: 0 }),
        expect.objectContaining({ operation: 'UPDATE', attempt_count: 1 }),
      ]);
      expect((await fixture.storageRuntime()).objects).toEqual(original.objects);
      const response = await client.request('/api/v1/design-schemes/run', prepared);
      const rejected = { status: response.status, body: await response.json() };
      expect(rejected.status).toBe(404);
      expect((await observer.snapshot()).references).toEqual([]);
      const beforeDelete = await fixture.snapshot();
      expect(beforeDelete.generationRuns).toEqual([]);
      expect(beforeDelete.schemeRuns).toEqual([]);
      expect(beforeDelete.imageCalls).toEqual([]);
      expect((await fixture.generationRuntime()).receipts).toEqual([]);
      fixture.releaseStorage();
      await drain(fixture, expect, maintenanceJob);
      const afterCleanup = await fixture.storageRuntime();
      expect(afterCleanup.objects).toEqual([]);
      expect(afterCleanup.cleanup).toEqual([]);
      expect(afterCleanup.deleted).toEqual([original.objects[0].keyHash]);
      const cleaned = await observer.snapshot();
      expect(cleaned.uploads).toEqual([]);
      expect(cleaned.references).toEqual([]);
      expect((await client.request('/api/v1/design-schemes/run', prepared)).status).toBe(404);
      expect(await client.detail(draft.summary.id)).toEqual(draft);
      const final = await fixture.snapshot();
      expect(final.imageCalls).toEqual([]);
      expect(final.modelCalls).toHaveLength(1);
      expect(final.schemeAssets).toEqual([]);
      expect(final.generationAssets).toEqual([]);
      expect((await fixture.generationOutcome()).evaluations).toEqual([]);
      expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
      console.log(
        'CLEANUP_EVIDENCE',
        JSON.stringify({
          order: 'cleanup-first',
          workerPid,
          acceleratedExpiry,
          original,
          claimed,
          rejected,
          cleaned,
          afterCleanup,
          maintenanceJob,
        }),
      );
    } finally {
      fixture.releaseStorage();
      await fixture.close();
    }
  }, 120000);
});
