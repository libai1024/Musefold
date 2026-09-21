import { describe, it, expect } from 'vitest';
import {
  runResultSchema,
  selectCoverResultSchema,
  renameDesignSchemeResultSchema,
  formalizeDesignSchemeResultSchema,
  designSchemeRunEventPageSchema,
} from '@musefold/contracts';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';
import { agentTrialClient } from '../fixtures/agent-trial-client.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('actual new Agent trials preserve authorization and version boundaries', () => {
  for (const authority of ['recovery-only', 'logout'] as const) {
    for (const phase of ['before-dispatch', 'after-dispatch'] as const) {
      it(`${authority} ${phase} rejects old-session operations without redispatching accepted work`, async () => {
        const fixture = await startAgentBrowserApp();
        const client = agentTrialClient(fixture, `${authority}-${phase}@example.test`);
        try {
          const { draft, prepared } = await client.prepareNewTrial();
          fixture.setImageMode('hold');
          if (phase === 'after-dispatch') await fixture.startGeneration();
          const accepted = runResultSchema.parse(
            await client.json('/api/v1/design-schemes/run', prepared),
          );
          if (phase === 'after-dispatch')
            await expect
              .poll(async () => (await fixture.snapshot()).imageCalls.length, { timeout: 20000 })
              .toBe(1);
          if (authority === 'logout')
            expect((await client.request('/api/auth/sign-out', {})).status).toBe(200);
          // This scenario explicitly injects authorization mode/revision, not provider logout.
          else await fixture.revoke();
          if (phase === 'before-dispatch') await fixture.startGeneration();
          fixture.releaseImage();
          await expect
            .poll(async () => (await fixture.snapshot()).schemeRuns[0].status, { timeout: 20000 })
            .toBe(phase === 'before-dispatch' ? 'failed' : 'completed');
          await expect
            .poll(async () => (await fixture.snapshot()).jobs.length, { timeout: 20000 })
            .toBe(0);
          expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
          const state = await fixture.snapshot();
          expect(state.modelCalls).toHaveLength(1);
          expect(state.imageCalls).toHaveLength(phase === 'before-dispatch' ? 0 : 1);
          expect(state.schemeRuns).toEqual([
            expect.objectContaining({
              run_id: accepted.runId,
              revision_id: draft.document.revisionId,
              mode: 'trial',
              status: phase === 'before-dispatch' ? 'failed' : 'completed',
            }),
          ]);
          expect(state.generationRuns).toEqual([
            expect.objectContaining({
              design_scheme_run_id: accepted.runId,
              status: phase === 'before-dispatch' ? 'failed' : 'succeeded',
            }),
          ]);
          expect(state.schemeAssets).toHaveLength(phase === 'before-dispatch' ? 0 : 1);
          expect(state.schemes[0].status).toBe('draft');
          const denied = authority === 'logout' ? 401 : 403;
          expect((await client.request('/api/v1/design-schemes/run', prepared)).status).toBe(
            denied,
          );
          expect((await client.request(`/api/v1/design-schemes/${draft.summary.id}`)).status).toBe(
            denied,
          );
          // A fresh login reads the original owner's result; it does not grant another run.
          await client.authenticate('sign-in');
          const recovered = await client.detail(draft.summary.id);
          expect(recovered.document).toEqual(draft.document);
          expect(recovered.summary.status).toBe('draft');
          expect(recovered.summary.hasSuccessfulTrial).toBe(phase === 'after-dispatch');
          if (phase === 'after-dispatch')
            expect(recovered.assets[0].contentHash).toBe(state.imageOutput.hash);
          const events = designSchemeRunEventPageSchema.parse(
            await client.json(`/api/v1/design-schemes/runs/${accepted.runId}/events?afterSeq=0`),
          );
          expect(events.events.length).toBeGreaterThan(0);
          expect(
            events.events.every((item) => item.event.executionId === prepared.executionId),
          ).toBe(true);
          expect((await fixture.snapshot()).imageCalls).toEqual(state.imageCalls);
        } finally {
          fixture.releaseImage();
          await fixture.close();
        }
      }, 120000);
    }
  }

  it.each(['select-cover', 'formalize'] as const)(
    'stale %s after a concurrent rename preserves actual trial and immutable revision',
    async (operation) => {
      const fixture = await startAgentBrowserApp();
      const client = agentTrialClient(fixture, `version-${operation}@example.test`);
      try {
        const { draft, prepared } = await client.prepareNewTrial();
        await fixture.startGeneration();
        const accepted = runResultSchema.parse(
          await client.json('/api/v1/design-schemes/run', prepared),
        );
        await expect
          .poll(async () => (await fixture.snapshot()).schemeRuns[0].status, { timeout: 20000 })
          .toBe('completed');
        await expect
          .poll(async () => (await fixture.snapshot()).jobs.length, { timeout: 20000 })
          .toBe(0);
        expect(await fixture.stopGeneration()).toEqual({ code: 0, signal: null });
        const tried = await client.detail(draft.summary.id);
        expect(tried.summary.hasSuccessfulTrial).toBe(true);
        const schemeId = draft.summary.id;
        const assetId = tried.assets[0].id;
        let version = tried.summary.version;
        if (operation === 'formalize')
          version = selectCoverResultSchema.parse(
            await client.json('/api/v1/design-schemes/select-cover', {
              schemeId,
              assetId,
              expectedVersion: version,
            }),
          ).scheme.version;
        const renamed = renameDesignSchemeResultSchema.parse(
          await client.json('/api/v1/design-schemes/rename', {
            schemeId,
            name: '另一页面更新后的名称',
            expectedVersion: version,
          }),
        );
        expect(renamed.scheme.version).toBe(version + 1);
        const input =
          operation === 'select-cover'
            ? { schemeId, assetId, expectedVersion: version }
            : {
                schemeId,
                revisionId: draft.document.revisionId,
                coverAssetId: assetId,
                expectedVersion: version,
                confirmed: true,
              };
        expect((await client.request(`/api/v1/design-schemes/${operation}`, input)).status).toBe(
          409,
        );
        const after = await client.detail(schemeId);
        expect(after.summary).toMatchObject({
          name: '另一页面更新后的名称',
          version: renamed.scheme.version,
          status: 'draft',
          hasSuccessfulTrial: true,
        });
        expect(after.document).toEqual(tried.document);
        const current = await client.json(`/api/v1/design-schemes/${operation}`, {
          ...input,
          expectedVersion: after.summary.version,
        });
        if (operation === 'select-cover') selectCoverResultSchema.parse(current);
        else formalizeDesignSchemeResultSchema.parse(current);
        const state = await fixture.snapshot();
        expect(state.imageCalls).toHaveLength(1);
        expect(state.modelCalls).toHaveLength(1);
        expect(state.schemeRuns).toEqual([expect.objectContaining({ run_id: accepted.runId })]);
      } finally {
        fixture.releaseImage();
        await fixture.close();
      }
    },
    120000,
  );
});
