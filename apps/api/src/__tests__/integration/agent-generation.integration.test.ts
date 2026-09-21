import { randomUUID, createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  designSchemeAgentSessionSchema,
  designSchemeTextModelOfferSchema,
  designSchemeDetailSchema,
  designSchemeRunInputSchema,
  runResultSchema,
  selectCoverDesignSchemeResultSchema,
  formalizeDesignSchemeResultSchema,
} from '@musefold/contracts';
import { startAgentBrowserApp } from '../fixtures/agent-browser-app.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
describeDb('new Agent draft through the actual generation worker and formal qualification', () => {
  it('keeps text and image dispatch independent, persists actual trial assets, and formalizes their exact revision', async () => {
    const fixture = await startAgentBrowserApp();
    let cookie = '';
    const request = (path: string, body?: unknown) =>
      fixture.app.request(path, {
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3399', cookie },
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      });
    async function json(path: string, body?: unknown) {
      const response = await request(path, body);
      expect(response.status, `${body === undefined ? 'GET' : 'POST'} ${path}`).toBe(
        body && path.endsWith('/agent/executions') ? 202 : 200,
      );
      return response.json();
    }
    try {
      const worker = await fixture.startGeneration();
      expect(worker.running).toBe(true);
      expect(worker.pid).toBeGreaterThan(0);
      const login = await request('/api/auth/sign-up/new-api', {
        email: 'generation-joint@example.test',
        password: 'correct-password',
      });
      expect(login.status).toBe(200);
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
      const session = () =>
        json(`/api/v1/design-schemes/agent/executions/${executionId}`).then((value) =>
          designSchemeAgentSessionSchema.parse(value),
        );
      await expect.poll(async () => (await session()).status, { timeout: 20000 }).toBe('completed');
      const created = (await session()).result;
      if (!created) throw new Error('Missing actual Agent result');
      const schemeId = created.scheme.id;
      const detail = () =>
        json(`/api/v1/design-schemes/${schemeId}`).then((value) =>
          designSchemeDetailSchema.parse(value),
        );
      const draft = await detail();
      expect(draft.summary.hasSuccessfulTrial).toBe(false);
      expect((await fixture.snapshot()).imageCalls).toHaveLength(0);
      const prepared = designSchemeRunInputSchema.parse(
        await json('/api/v1/design-schemes/prepare-run', {
          executionId: randomUUID(),
          schemeId,
          revisionId: draft.document.revisionId,
          mode: 'trial',
          brief: '秋季书展',
          inputValues: { topic: '秋季书展' },
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
      expect(prepared.executionBinding?.model).toBe('musefold-image-pro');
      expect((await fixture.snapshot()).imageCalls).toHaveLength(0);
      fixture.setImageMode('hold');
      const accepted = runResultSchema.parse(await json('/api/v1/design-schemes/run', prepared));
      await expect
        .poll(async () => (await fixture.snapshot()).imageCalls.length, { timeout: 20000 })
        .toBe(1);
      expect((await detail()).summary.hasSuccessfulTrial).toBe(false);
      // Accepted replay observes the original job and cannot inherit the old text authorization.
      const replay = runResultSchema.parse(await json('/api/v1/design-schemes/run', prepared));
      expect(replay.runId).toBe(accepted.runId);
      expect((await fixture.snapshot()).imageCalls).toHaveLength(1);
      fixture.releaseImage();
      await expect
        .poll(async () => (await detail()).summary.hasSuccessfulTrial, { timeout: 20000 })
        .toBe(true);
      const completed = await detail();
      const output = completed.assets.find(
        (asset) => asset.origin === 'cloud-run' && asset.role === 'output',
      );
      if (!output) throw new Error('Actual trial output is absent');
      const content = await request(`/api/v1/design-schemes/assets/${output.id}/content`);
      expect(content.status).toBe(200);
      const outputHash = createHash('sha256')
        .update(Buffer.from(await content.arrayBuffer()))
        .digest('hex');
      expect(outputHash).toBe(output.contentHash);
      const selected = selectCoverDesignSchemeResultSchema.parse(
        await json('/api/v1/design-schemes/select-cover', {
          schemeId,
          assetId: output.id,
          expectedVersion: completed.summary.version,
        }),
      );
      const formal = formalizeDesignSchemeResultSchema.parse(
        await json('/api/v1/design-schemes/formalize', {
          schemeId,
          revisionId: draft.document.revisionId,
          coverAssetId: output.id,
          expectedVersion: selected.scheme.version,
          confirmed: true,
        }),
      );
      expect(formal.scheme.status).toBe('formal');
      expect(formal.scheme.currentRevisionId).toBe(draft.document.revisionId);
      const final = await fixture.snapshot();
      expect(final.schemeAssets).toContainEqual(
        expect.objectContaining({
          id: output.id,
          revision_id: draft.document.revisionId,
          content_hash: outputHash,
        }),
      );
      expect(final.modelCalls).toHaveLength(1);
      expect(final.imageCalls).toHaveLength(1);
      expect(final.generationRuns).toContainEqual(
        expect.objectContaining({ design_scheme_run_id: accepted.runId, status: 'succeeded' }),
      );
      expect(final.schemeRuns).toContainEqual(
        expect.objectContaining({
          run_id: accepted.runId,
          revision_id: draft.document.revisionId,
          status: 'completed',
        }),
      );
      const stopped = await fixture.stopGeneration();
      expect(stopped).toEqual({ code: 0, signal: null });
    } finally {
      fixture.releaseImage();
      await fixture.close();
    }
  }, 180000);
});
