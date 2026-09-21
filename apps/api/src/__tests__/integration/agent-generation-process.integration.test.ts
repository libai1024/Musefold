import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { runResultSchema, generationJobSchema } from '@musefold/contracts';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';
import { agentTrialClient } from '../fixtures/agent-trial-client.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

function requirePid(pid: number | undefined) {
  if (!pid) throw new Error('Missing actual generation PID');
  return pid;
}

async function pause(
  fixture: Awaited<ReturnType<typeof startAgentBrowserApp>>,
  pid: number,
  assert: typeof expect,
) {
  fixture.signalGeneration(pid, 'SIGSTOP');
  await assert
    .poll(() => execFileSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' }))
    .toContain('T');
}

describeDb('new Agent trials survive actual generation process interruption', () => {
  // SIGSTOP semantics require a POSIX host. Windows is explicitly unverified by this suite.
  it.skipIf(process.platform === 'win32')(
    'a consumer killed before acquisition leaves the accepted job for a new PID',
    async () => {
      const fixture = await startAgentBrowserApp();
      try {
        const client = agentTrialClient(fixture, 'queued-process@example.test');
        const { draft, prepared } = await client.prepareNewTrial();
        const oldPid = requirePid((await fixture.startGeneration()).pid);
        await pause(fixture, oldPid, expect);
        const accepted = runResultSchema.parse(
          await client.json('/api/v1/design-schemes/run', prepared),
        );
        const queued = await fixture.generationRuntime();
        expect(queued.runs[0]).toMatchObject({ status: 'queued', attempt_count: 0 });
        expect((await fixture.snapshot()).imageCalls).toHaveLength(0);
        expect(await fixture.stopGenerationPid(oldPid, 'SIGKILL')).toEqual({
          code: null,
          signal: 'SIGKILL',
        });
        const newPid = requirePid((await fixture.replaceGeneration()).pid);
        expect(newPid).not.toBe(oldPid);
        await expect
          .poll(async () => (await fixture.snapshot()).schemeRuns[0].status, { timeout: 20000 })
          .toBe('completed');
        await expect
          .poll(async () => (await fixture.snapshot()).jobs.length, { timeout: 20000 })
          .toBe(0);
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        const final = await fixture.snapshot();
        expect(final.imageCalls).toHaveLength(1);
        expect(final.modelCalls).toHaveLength(1);
        expect(final.schemeRuns).toEqual([expect.objectContaining({ run_id: accepted.runId })]);
        expect(final.generationRuns).toHaveLength(1);
        expect(final.generationAssets).toHaveLength(1);
        const after = await client.detail(draft.summary.id);
        expect(after.summary).toMatchObject({ status: 'draft', hasSuccessfulTrial: true });
        expect(after.document).toEqual(draft.document);
        expect(after.assets[0].contentHash).toBe(final.imageOutput.hash);
        console.log(
          'PROCESS_EVIDENCE',
          JSON.stringify({
            scenario: 'kill-before-acquisition',
            oldPid,
            newPid,
            queued,
            terminal: await fixture.generationRuntime(),
            imageCalls: final.imageCalls.length,
          }),
        );
      } finally {
        await fixture.close();
      }
    },
    120000,
  );

  for (const scenario of ['kill', 'pause'] as const) {
    it.skipIf(process.platform === 'win32').concurrent(
      `${scenario} after dispatch recovers on the natural production lease without a second image request`,
      async ({ expect }) => {
        const fixture = await startAgentBrowserApp();
        try {
          const client = agentTrialClient(
            fixture,
            `${scenario}-natural-lease@example.test`,
            expect,
          );
          const { draft, prepared } = await client.prepareNewTrial();
          fixture.setImageMode('hold');
          const oldPid = requirePid((await fixture.startGeneration()).pid);
          const accepted = runResultSchema.parse(
            await client.json('/api/v1/design-schemes/run', prepared),
          );
          await expect
            .poll(async () => (await fixture.snapshot()).imageCalls.length, { timeout: 20000 })
            .toBe(1);
          if (scenario === 'kill')
            expect(await fixture.stopGenerationPid(oldPid, 'SIGKILL')).toEqual({
              code: null,
              signal: 'SIGKILL',
            });
          else await pause(fixture, oldPid, expect);
          // Read after interruption, so a final heartbeat cannot move the observed deadline.
          const interrupted = await fixture.generationRuntime();
          const original = interrupted.runs[0];
          expect(original).toMatchObject({
            status: 'running',
            attempt_count: 1,
            upstream_request_sent: true,
          });
          const expiresAt = new Date(original.lease_expires_at).getTime();
          expect(expiresAt - Date.now()).toBeGreaterThan(9 * 60_000);
          const oldJob = interrupted.jobs.find((job) => job.identifier === 'generation.generate');
          expect(oldJob?.locked_by).toEqual(expect.any(String));
          const newPid = requirePid((await fixture.replaceGeneration()).pid);
          expect(newPid).not.toBe(oldPid);
          console.log(
            'PROCESS_WAIT',
            JSON.stringify({
              scenario,
              oldPid,
              newPid,
              expiresAt: new Date(expiresAt).toISOString(),
              interrupted,
            }),
          );
          // No SQL expiry, fake timers, queue injection, forced unlock or alternate task list.
          const prematureChanges: string[] = [];
          let observationsBeforeExpiry = 0;
          await expect
            .poll(
              async () => {
                const state = await fixture.generationRuntime();
                if (Date.now() < expiresAt) {
                  observationsBeforeExpiry += 1;
                  if (
                    state.runs[0].status !== 'running' ||
                    new Date(state.runs[0].lease_expires_at).getTime() !== expiresAt
                  )
                    prematureChanges.push(state.observedAt);
                }
                return state.runs[0].status;
              },
              { timeout: 12 * 60_000, interval: 2000 },
            )
            .toBe('failed');
          // Keep violations outside expect.poll: a later successful poll must not hide one.
          expect(observationsBeforeExpiry).toBeGreaterThan(0);
          expect(prematureChanges).toEqual([]);
          const recovered = await fixture.generationRuntime();
          expect(new Date(recovered.runs[0].finished_at).getTime()).toBeGreaterThanOrEqual(
            expiresAt,
          );
          expect(recovered.runs).toEqual([
            expect.objectContaining({
              id: original.id,
              status: 'failed',
              attempt_count: 1,
              lease_expires_at: null,
              error_code: 'GENERATION_UPSTREAM_UNKNOWN',
            }),
          ]);
          expect(recovered.receipts).toEqual([
            expect.objectContaining({
              id: original.execution_receipt_id,
              original_run_id: original.id,
              status: 'failed',
              dispatch: 'claimed',
              cost_points: null,
            }),
          ]);
          const beforeLate = await fixture.snapshot();
          if (scenario === 'pause') {
            // Offer late upstream bytes before resume. The normal HTTP timeout/lease guards
            // may abort first; this proves terminal preservation, not late upload cleanup.
            fixture.releaseImage();
            fixture.signalGeneration(oldPid, 'SIGCONT');
            await expect
              .poll(
                async () =>
                  (await fixture.generationRuntime()).jobs.some((job) => job.id === oldJob?.id),
                { timeout: 20000 },
              )
              .toBe(false);
            expect(await fixture.stopGenerationPid(oldPid)).toEqual({ code: 0, signal: null });
          } else {
            // Graphile retains the dead worker's lock; recovery clears its key, not its lock.
            expect(recovered.jobs.find((job) => job.id === oldJob?.id)).toMatchObject({
              key: null,
              locked_by: oldJob?.locked_by,
              attempts: oldJob?.max_attempts,
            });
          }
          await expect
            .poll(
              async () =>
                (await fixture.generationRuntime()).jobs.filter(
                  (job) => job.identifier === 'generation.generate' && job.id !== oldJob?.id,
                ).length,
              { timeout: 20000 },
            )
            .toBe(0);
          expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
          const final = await fixture.snapshot();
          expect(final.imageCalls).toHaveLength(1);
          expect(final.modelCalls).toHaveLength(1);
          expect(final.generationAssets).toHaveLength(0);
          expect(final.schemeAssets).toHaveLength(0);
          expect(final.objects).toEqual(beforeLate.objects);
          expect(final.generationRuns).toHaveLength(1);
          expect(final.schemeRuns).toEqual([
            expect.objectContaining({
              run_id: accepted.runId,
              revision_id: draft.document.revisionId,
              status: 'failed',
            }),
          ]);
          const replay = runResultSchema.parse(
            await client.json('/api/v1/design-schemes/run', prepared),
          );
          expect(replay).toMatchObject({
            runId: accepted.runId,
            status: 'failed',
            error: {
              code: 'GENERATION_UPSTREAM_UNKNOWN',
              retryable: false,
              recoveryAction: 'none',
            },
          });
          const job = generationJobSchema.parse(
            await client.json(`/api/v1/generations/${original.id}`),
          );
          expect(job.costPoints).toBe(null);
          expect(job.assets).toHaveLength(0);
          const after = await client.detail(draft.summary.id);
          expect(after.document).toEqual(draft.document);
          expect(after.summary).toMatchObject({ status: 'draft', hasSuccessfulTrial: false });
          expect(after.assets).toHaveLength(0);
          const terminal = await fixture.generationRuntime();
          expect(terminal.runs).toEqual(recovered.runs);
          expect(terminal.receipts).toEqual(recovered.receipts);
          console.log(
            'PROCESS_EVIDENCE',
            JSON.stringify({
              scenario,
              oldPid,
              newPid,
              observationsBeforeExpiry,
              prematureChanges,
              interrupted,
              recovered,
              terminal,
              imageCalls: final.imageCalls.length,
              objects: final.objects,
            }),
          );
        } finally {
          fixture.releaseImage();
          await fixture.close();
        }
      },
      15 * 60_000,
    );
  }
});
