import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { designSchemeDetailSchema, designSchemeRunInputSchema } from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import { createActualAgentDraft as create } from './scheme-trial-browser';
import { raceWorkingDraftPromotion } from './web.scheme-promote-conflict-helper';
import { promoteWithDelayedDetail } from './web.scheme-promote-refresh-helper';
import {
  iterateFormalScheme,
  selectTrialReferences,
  selectTrialCover,
} from './web.scheme-promote-helper';
import {
  browserJson,
  connectExchangeBrowser,
  exportExchangeBrowser,
  importExchangeBrowser,
} from './package-exchange-browser';

async function drain(context: BrowserContext) {
  for (const page of context.pages()) await page.goto('about:blank');
  await context.unrouteAll({ behavior: 'wait' });
}
async function detail(page: Page, id: string) {
  return designSchemeDetailSchema.parse(await browserJson(page, `/api/v1/design-schemes/${id}`));
}

for (const scenario of [
  'brief',
  'github',
  'history',
  'github-conflict',
  'github-refresh',
] as const) {
  const kind =
    scenario === 'github-conflict' || scenario === 'github-refresh' ? 'github' : scenario;
  test(`actual ${scenario} Agent draft earns trial qualification with generation bin, formalizes and exports a reimportable package`, async ({
    page,
    context,
  }, info) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires real isolated API/PG and generation bin',
    );
    test.setTimeout(240000);
    const service = new AgentBrowserProcess();
    try {
      await connectExchangeBrowser(context, (await service.ready).baseUrl);
      const worker = await service.startGeneration(kind !== 'brief');
      expect(worker.pid).toBeGreaterThan(0);
      expect(worker.running).toBe(true);
      const draft = await create(page, service, kind);
      const id = draft.summary.id;
      const before = await service.snapshot();
      await expect(page.getByTestId('runtime-scheme-formalize')).toHaveCount(0);
      await page.getByTestId('runtime-scheme-primary-action').click();
      await expect(page.getByTestId('scheme-run-chip')).toBeVisible();
      // Attachment focuses the prompt on the next frame; let that focus settle
      // before filling a different input, or keyboard insertion can land there.
      await expect(page.getByTestId('composer-prompt')).toBeFocused();
      await page.getByTestId('scheme-run-variable-topic').fill('秋季书展');
      await page.getByTestId('composer-prompt').fill('清晰的大标题');
      await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('秋季书展');
      if (kind !== 'brief') await selectTrialReferences(page, draft);
      const count = kind === 'github' ? 2 : 1;
      if (count === 2) {
        await page.getByTestId('composer-settings').click();
        await page.getByTestId('composer-count-2').click();
        await page.keyboard.press('Escape');
      }
      expect((await service.snapshot()).imageCalls).toHaveLength(0);
      await service.imageMode('hold');
      const sent = page.waitForRequest(
        (request) =>
          request.method() === 'POST' && request.url().endsWith('/api/v1/design-schemes/run'),
      );
      await page.getByTestId('composer-submit').click();
      const prepared = designSchemeRunInputSchema.parse((await sent).postDataJSON());
      expect(prepared.revisionId).toBe(draft.document.revisionId);
      expect(prepared.mode).toBe('trial');
      expect(prepared.executionSettings.outputCount).toBe(count);
      expect(prepared.executionBinding?.model).toBe('musefold-image-pro');
      await expect
        .poll(async () => (await service.snapshot()).imageCalls.length, { timeout: 20000 })
        .toBe(1);
      expect((await detail(page, id)).summary.hasSuccessfulTrial).toBe(false);
      const active = await service.snapshot();
      expect(active.modelCalls).toEqual(before.modelCalls);
      expect(active.imageCalls[0]).toMatchObject({
        endpoint: kind === 'brief' ? '/v1/images/generations' : '/v1/images/edits',
        model: 'musefold-image-pro',
        count,
      });
      expect(active.imageCalls[0].references.map((item) => item.hash).sort()).toEqual(
        draft.assets.map((asset) => asset.contentHash).sort(),
      );
      await service.releaseImage();
      await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('', {
        timeout: 20000,
      });
      await expect(page.getByTestId('composer-prompt')).toHaveValue('');
      const completed = await detail(page, id);
      expect(completed.summary.hasSuccessfulTrial).toBe(true);
      const outputs = completed.assets.filter(
        (asset) => asset.origin === 'cloud-run' && asset.role === 'output',
      );
      expect(outputs).toHaveLength(count);
      const final = await service.snapshot();
      const run = final.schemeRuns.find((item) => item.revision_id === draft.document.revisionId);
      expect(run).toMatchObject({ status: 'completed', mode: 'trial' });
      expect(final.generationRuns).toContainEqual(
        expect.objectContaining({ design_scheme_run_id: run?.run_id, status: 'succeeded' }),
      );
      for (const output of outputs) {
        expect(final.schemeAssets).toContainEqual(
          expect.objectContaining({
            id: output.id,
            revision_id: draft.document.revisionId,
            content_hash: output.contentHash,
          }),
        );
        expect(final.generationAssets).toContainEqual(
          expect.objectContaining({ id: output.id, checksum_sha256: output.contentHash }),
        );
        expect(final.objects).toContainEqual(
          expect.objectContaining({ hash: output.contentHash, bytes: output.byteSize }),
        );
      }
      await page.goto(`/design-schemes?scheme=${encodeURIComponent(id)}`);
      await selectTrialCover(page, outputs[0].id, completed.assets.length);
      await expect(page.getByTestId('runtime-scheme-formalize')).toBeVisible();
      await page.getByTestId('runtime-scheme-formalize').click();
      await expect(page.getByTestId('runtime-scheme-detail')).toHaveAttribute(
        'data-status',
        'formal',
      );
      let formal = await detail(page, id);
      expect(formal.summary.currentRevisionId).toBe(draft.document.revisionId);
      expect(outputs.map((output) => output.id)).toContain(formal.summary.coverAssetId);
      if (kind === 'github')
        formal = await iterateFormalScheme(
          page,
          service,
          formal,
          scenario === 'github-conflict'
            ? raceWorkingDraftPromotion(page, service, info)
            : undefined,
          scenario === 'github-refresh' ? promoteWithDelayedDetail(page, service, info) : undefined,
        );
      await page
        .getByTestId('runtime-scheme-detail')
        .screenshot({ path: info.outputPath(`${kind}-formal.png`) });
      const file = info.outputPath(`${kind}-actual-trial.musefold.design`);
      const exported = await test.step(
        'Export the exact formal revision',
        () => exportExchangeBrowser(page, file),
        { timeout: 30000 },
      );
      expect(exported.archive.manifest.assets.some((asset) => asset.role === 'cover')).toBe(true);
      const selectedIds = new Set([...formal.document.assetIds, formal.summary.coverAssetId]);
      const state = await service.snapshot();
      for (const asset of state.schemeAssets) {
        if (asset.revision_id === formal.document.revisionId) selectedIds.add(asset.id);
      }
      expect(exported.archive.manifest.assets.map((asset) => asset.id).sort()).toEqual(
        [...selectedIds].sort(),
      );
      const imported = await test.step(
        'Reimport actual package bytes',
        () => importExchangeBrowser(page, file),
        { timeout: 30000 },
      );
      expect(imported.summary.id).not.toBe(id);
      expect(imported.summary.status).toBe('draft');
      expect(imported.summary.hasSuccessfulTrial).toBe(false);
      expect(imported.assets.map((asset) => asset.contentHash).sort()).toEqual(
        exported.archive.manifest.assets.map((asset) => asset.contentHash).sort(),
      );
      expect((await service.snapshot()).imageCalls).toHaveLength(kind === 'github' ? 3 : 1);
      await info.attach('actual-trial-chain', {
        contentType: 'application/json',
        body: JSON.stringify({
          kind,
          worker,
          revision: draft.document.revisionId,
          run,
          outputs,
          packageHash: exported.hash,
          real: 'UI/BA/Hono/PG/Agent/actual generation bin/AWS SDK',
          controlled:
            'NewAPI, text/image HTTP, GitHub and S3; history input is pre-existing seeded material; new trial and formal qualification are never seeded',
        }),
      });
      const stopped = await service.stopGeneration();
      expect(stopped).toEqual({ code: 0, signal: null });
    } catch (error) {
      await info.attach('joint-failure-state', {
        contentType: 'application/json',
        body: JSON.stringify(await service.snapshot()),
      });
      await info.attach('joint-failure-page', {
        contentType: 'text/plain',
        body: await page.locator('body').innerText(),
      });
      throw error;
    } finally {
      try {
        await drain(context);
      } finally {
        await service.dispose();
      }
    }
  });
}
