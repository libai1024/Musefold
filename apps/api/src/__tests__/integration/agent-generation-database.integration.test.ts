import { describe, it, type expect as defaultExpect } from 'vitest';
import { runResultSchema } from '@musefold/contracts';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';
import { agentTrialClient } from '../fixtures/agent-trial-client.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
type Fixture = Awaited<ReturnType<typeof startAgentBrowserApp>>;
async function drain(fixture: Fixture, expect: typeof defaultExpect) {
  await expect
    .poll(async () => (await fixture.generationRuntime()).jobs.length, { timeout: 20000 })
    .toBe(0);
}
function pid(value: number | undefined) {
  if (!value) throw new Error('Missing actual generation process');
  return value;
}

describeDb('actual new Agent trial database outcomes', () => {
  for (const mode of ['output-rollback', 'commit-response'] as const) {
    it(`${mode} preserves authoritative output and compensation across a new PID`, async ({
      expect,
    }) => {
      const fixture = await startAgentBrowserApp();
      try {
        const client = agentTrialClient(fixture, `${mode}@example.test`, expect);
        const { draft, prepared } = await client.prepareNewTrial();
        await fixture.armDatabaseFault(mode);
        const oldPid = pid((await fixture.startGeneration()).pid);
        const accepted = runResultSchema.parse(
          await client.json('/api/v1/design-schemes/run', prepared),
        );
        const committed = mode === 'commit-response';
        let beforeDrop: Awaited<ReturnType<typeof fixture.generationRuntime>> | undefined;
        if (committed) {
          // The proxy holds PostgreSQL's actual CommandComplete(COMMIT). API and this observer
          // have independent direct connections, so this read proves server-side durability.
          await expect
            .poll(() => fixture.databaseFaultSnapshot(), { timeout: 20000 })
            .toMatchObject({
              commitHeld: true,
              responseDropped: false,
              insertsObserved: 1,
              errors: [],
            });
          beforeDrop = await fixture.generationRuntime();
          expect(beforeDrop.runs).toEqual([
            expect.objectContaining({ status: 'succeeded', attempt_count: 1 }),
          ]);
          expect((await client.detail(draft.summary.id)).summary.hasSuccessfulTrial).toBe(true);
          const pending = await fixture.storageRuntime();
          expect(pending.objects).toHaveLength(1);
          expect(pending.cleanup).toHaveLength(1);
          expect(
            new Date(pending.cleanup[0].next_attempt_at).getTime() - Date.now(),
          ).toBeGreaterThan(55 * 60_000);
          fixture.dropDatabaseResponse();
        }
        const status = committed ? 'succeeded' : 'failed';
        await expect
          .poll(async () => (await fixture.generationRuntime()).runs[0]?.status, { timeout: 20000 })
          .toBe(status);
        await drain(fixture, expect);
        const settled = await fixture.generationRuntime();
        const fault = await fixture.databaseFaultSnapshot();
        if (committed) {
          expect(fault).toMatchObject({
            commitHeld: true,
            responseDropped: true,
            insertsObserved: 1,
            errors: [],
          });
          expect(settled.runs).toEqual(beforeDrop?.runs);
          expect(settled.receipts).toEqual(beforeDrop?.receipts);
        } else {
          expect(fault).toEqual({ mode, outputRegistrationHits: 1 });
          expect(settled.receipts).toEqual([
            expect.objectContaining({
              status: 'failed',
              dispatch: 'claimed',
              cost_provenance: 'unknown',
              cost_points: null,
            }),
          ]);
        }
        expect(settled.runs).toEqual([
          expect.objectContaining({ status, attempt_count: 1, upstream_request_sent: true }),
        ]);
        const canonical = await client.detail(draft.summary.id);
        expect(canonical.document).toEqual(draft.document);
        expect(canonical.summary).toMatchObject({ status: 'draft', hasSuccessfulTrial: committed });
        expect(canonical.assets).toHaveLength(committed ? 1 : 0);
        const outcome = await fixture.generationOutcome();
        expect(outcome.evaluations).toHaveLength(committed ? 1 : 0);
        expect(
          outcome.events.filter((event) => event.event_type === 'generation.succeeded'),
        ).toHaveLength(committed ? 1 : 0);
        expect(
          outcome.events.filter(
            (event) => event.event_type === 'design-scheme' && event.kind === 'completed',
          ),
        ).toHaveLength(committed ? 1 : 0);
        const beforeCleanup = await fixture.storageRuntime();
        expect(beforeCleanup.objects).toHaveLength(1);
        expect(beforeCleanup.cleanup).toEqual([
          expect.objectContaining({
            reason: 'generation_compensation',
            keyHash: beforeCleanup.objects[0].keyHash,
          }),
        ]);
        expect(new Date(beforeCleanup.cleanup[0].next_attempt_at).getTime()).toBeLessThanOrEqual(
          Date.now(),
        );
        const beforeRestart = await fixture.snapshot();
        expect(beforeRestart.schemeAssets).toHaveLength(committed ? 1 : 0);
        expect(beforeRestart.generationAssets).toHaveLength(committed ? 1 : 0);
        expect(beforeRestart.imageCalls).toHaveLength(1);
        expect(beforeRestart.modelCalls).toHaveLength(1);
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        const newPid = pid((await fixture.replaceGeneration()).pid);
        expect(newPid).not.toBe(oldPid);
        expect(
          runResultSchema.parse(await client.json('/api/v1/design-schemes/run', prepared)),
        ).toMatchObject({ runId: accepted.runId, status: committed ? 'completed' : 'failed' });
        const maintenanceJob = await fixture.requestMaintenance();
        await drain(fixture, expect);
        const afterCleanup = await fixture.storageRuntime();
        expect(afterCleanup.cleanup).toHaveLength(0);
        expect(afterCleanup.objects).toEqual(committed ? beforeCleanup.objects : []);
        expect(afterCleanup.deleted).toEqual(committed ? [] : [beforeCleanup.objects[0].keyHash]);
        expect(afterCleanup.writes).toEqual(beforeCleanup.writes);
        expect(await fixture.generationOutcome()).toEqual(outcome);
        expect((await fixture.generationRuntime()).runs).toEqual(settled.runs);
        expect((await fixture.generationRuntime()).receipts).toEqual(settled.receipts);
        expect(await client.detail(draft.summary.id)).toEqual(canonical);
        const final = await fixture.snapshot();
        expect(final.imageCalls).toHaveLength(1);
        expect(final.modelCalls).toHaveLength(1);
        expect(final.generationRuns).toEqual([
          expect.objectContaining({
            id: settled.runs[0].id,
            design_scheme_run_id: accepted.runId,
            status,
          }),
        ]);
        expect(final.schemeAssets).toEqual(beforeRestart.schemeAssets);
        expect(final.generationAssets).toEqual(beforeRestart.generationAssets);
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        console.log(
          'DATABASE_EVIDENCE',
          JSON.stringify({
            mode,
            oldPid,
            newPid,
            fault,
            beforeDrop,
            settled,
            outcome,
            beforeCleanup,
            afterCleanup,
            maintenanceJob,
            imageCalls: final.imageCalls.length,
          }),
        );
      } finally {
        fixture.dropDatabaseResponse();
        await fixture.close();
      }
    }, 120000);
  }
});
