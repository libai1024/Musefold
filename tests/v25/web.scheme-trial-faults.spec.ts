import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { test, expect, type Page } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemeRunInputSchema,
  designSchemeRunEventPageSchema,
  runResultSchema,
  generationJobSchema,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import {
  browserJson,
  connectExchangeBrowser,
  loginExchangeBrowser,
} from './package-exchange-browser';

async function createDraft(page: Page, name: string) {
  await loginExchangeBrowser(page, `${name}@example.test`);
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-idea').click();
  await page.getByTestId('composer-prompt').fill('黑白书展海报');
  await page.getByTestId('composer-submit').click();
  await page.getByTestId('scheme-agent-model-offer').click();
  await page.getByTestId('scheme-agent-authorize-create').click();
  await page.getByTestId('scheme-agent-open-result').click({ timeout: 20000 });
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('scheme');
  if (!id) throw new Error('Missing actual Agent draft route');
  return designSchemeDetailSchema.parse(await browserJson(page, `/api/v1/design-schemes/${id}`));
}

for (const material of ['text', 'reference-image'] as const) {
  for (const fault of [
    'cancel-before',
    'cancel-after',
    'unknown',
    'lost-acceptance',
    'event-read-outage',
    'run-read-outage',
  ] as const) {
    test(`actual scheme trial ${fault} with ${material} preserves the original execution without automatic image resubmission`, async ({
      page,
      context,
    }, info) => {
      test.skip(
        process.env.RUN_DATABASE_TESTS !== 'true',
        'Requires isolated actual API, PG, Agent and generation bin',
      );
      test.setTimeout(180000);
      const service = new AgentBrowserProcess();
      const readOutage = fault === 'event-read-outage' || fault === 'run-read-outage';
      const completedOriginal = fault === 'lost-acceptance' || readOutage;
      let failedRunReads = 0;
      let failedDetailReads = 0;
      try {
        const { baseUrl } = await service.ready;
        await connectExchangeBrowser(context, baseUrl);
        const reference =
          material === 'reference-image'
            ? await sharp({ create: { width: 6, height: 4, channels: 3, background: '#287c92' } })
                .png()
                .toBuffer()
            : undefined;
        if (reference) await service.requireImageInput();
        const draft = await createDraft(page, `trial-fault-${fault}`);
        await service.imageMode(fault === 'unknown' ? 'drop' : 'hold');
        if (fault !== 'cancel-before') await service.startGeneration();
        let lost = false;
        if (fault === 'lost-acceptance') {
          await page.route('**/api/v1/design-schemes/run', async (route) => {
            if (route.request().method() !== 'POST' || lost) return route.fallback();
            const response = await route.fetch({ url: `${baseUrl}/api/v1/design-schemes/run` });
            expect(response.status()).toBe(200);
            runResultSchema.parse(await response.json());
            lost = true;
            await route.abort('connectionreset');
          });
        }
        if (readOutage)
          await page.route('**/api/v1/design-schemes/runs/**', async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            const matches =
              fault === 'event-read-outage'
                ? pathname.endsWith('/events')
                : /\/runs\/[^/]+$/.test(pathname);
            if (route.request().method() !== 'GET' || !matches || failedRunReads)
              return route.fallback();
            failedRunReads++;
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({
                error: { code: 'TEMPORARY_UNAVAILABLE', message: '暂时无法读取任务' },
              }),
            });
          });
        const posted: unknown[] = [];
        page.on('request', (request) => {
          if (request.method() === 'POST' && request.url().endsWith('/api/v1/design-schemes/run'))
            posted.push(request.postDataJSON());
        });
        await page.getByTestId('runtime-scheme-primary-action').click();
        // The new attachment schedules prompt focus on the next animation frame.
        // Finish that navigation focus before directing keyboard input to a variable.
        await expect(page.getByTestId('composer-prompt')).toBeFocused();
        await page.getByTestId('scheme-run-variable-topic').fill('秋季书展');
        await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('秋季书展');
        await page.getByTestId('composer-prompt').fill('保留这次输入');
        await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('秋季书展');
        await expect(page.getByTestId('composer-prompt')).toHaveValue('保留这次输入');
        if (reference) {
          await expect(page.getByTestId('composer-submit')).toBeDisabled();
          await page.getByTestId('composer-file-input').setInputFiles({
            name: 'trial-reference.png',
            mimeType: 'image/png',
            buffer: reference,
          });
        }
        await expect(page.getByTestId('composer-submit')).toBeEnabled();
        await page.getByTestId('composer-submit').click();
        await expect
          .poll(async () => (await service.snapshot()).schemeRuns.length, { timeout: 20000 })
          .toBe(1);
        if (fault !== 'cancel-before')
          await expect
            .poll(async () => (await service.snapshot()).imageCalls.length, { timeout: 20000 })
            .toBe(1);
        if (fault === 'cancel-before' || fault === 'cancel-after') {
          await page.getByTestId('composer-cancel').click();
          await expect
            .poll(async () => (await service.snapshot()).generationRuns[0].status, {
              timeout: 20000,
            })
            .toBe(fault === 'cancel-before' ? 'cancelled' : 'cancelling');
          await service.releaseImage();
          if (fault === 'cancel-before') await service.startGeneration();
          await expect(page.getByTestId('composer-cancel')).toHaveCount(0, { timeout: 20000 });
        } else {
          await expect(page.getByTestId('scheme-submit-error')).toBeVisible({ timeout: 20000 });
          if (fault === 'lost-acceptance') {
            expect(lost).toBe(true);
          }
          if (readOutage) expect(failedRunReads).toBe(1);
          if (completedOriginal) await service.releaseImage();
        }
        await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('秋季书展');
        await expect(page.getByTestId('composer-prompt')).toHaveValue('保留这次输入');
        const status =
          fault === 'unknown' ? 'failed' : completedOriginal ? 'completed' : 'cancelled';
        await expect
          .poll(async () => (await service.snapshot()).schemeRuns[0].status, { timeout: 20000 })
          .toBe(status);
        await expect
          .poll(async () => (await service.snapshot()).jobs.length, { timeout: 20000 })
          .toBe(0);
        expect(await service.stopGeneration()).toEqual({ code: 0, signal: null });
        expect(posted).toHaveLength(1);
        const input = designSchemeRunInputSchema.parse(posted[0]);
        expect(input.revisionId).toBe(draft.document.revisionId);
        expect(input.executionSettings.referenceAssetIds).toHaveLength(reference ? 1 : 0);
        const state = await service.snapshot();
        const run = state.schemeRuns[0];
        const original = runResultSchema.parse(
          await browserJson(page, `/api/v1/design-schemes/runs/${run.run_id}`),
        );
        expect(original.status).toBe(status);
        expect(original.schemeId).toBe(draft.summary.id);
        expect(original.revisionId).toBe(input.revisionId);
        const events = designSchemeRunEventPageSchema.parse(
          await browserJson(page, `/api/v1/design-schemes/runs/${run.run_id}/events?afterSeq=0`),
        );
        expect(events.events.length).toBeGreaterThan(0);
        expect(events.events.every((item) => item.event.executionId === input.executionId)).toBe(
          true,
        );
        if (fault === 'unknown')
          expect(original.error).toMatchObject({
            code: 'GENERATION_UPSTREAM_UNKNOWN',
            retryable: false,
            recoveryAction: 'none',
          });
        expect(state.modelCalls).toHaveLength(1);
        expect(state.imageCalls).toHaveLength(fault === 'cancel-before' ? 0 : 1);
        for (const call of state.imageCalls) {
          expect(call.endpoint).toBe(reference ? '/v1/images/edits' : '/v1/images/generations');
          expect(call.references).toEqual(
            reference
              ? [
                  {
                    hash: createHash('sha256').update(reference).digest('hex'),
                    bytes: reference.length,
                    mimeType: 'image/png',
                  },
                ]
              : [],
          );
        }
        expect(state.generationRuns).toHaveLength(1);
        expect(state.schemeRuns).toHaveLength(1);
        expect(state.generationRuns[0].design_scheme_run_id).toBe(run.run_id);
        const job = generationJobSchema.parse(
          await browserJson(page, `/api/v1/generations/${state.generationRuns[0].id}`),
        );
        if (fault === 'cancel-after' || fault === 'unknown') expect(job.costPoints).toBeNull();
        await page.reload();
        await expect(page.getByTestId('workbench')).toBeVisible();
        let detailUnavailable = readOutage;
        if (readOutage)
          await page.route(`**/api/v1/design-schemes/${draft.summary.id}*`, async (route) => {
            if (route.request().method() !== 'GET' || !detailUnavailable) return route.fallback();
            failedDetailReads++;
            return route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({
                error: { code: 'TEMPORARY_UNAVAILABLE', message: '暂时无法读取方案' },
              }),
            });
          });
        await page.goto(`/design-schemes?scheme=${draft.summary.id}`);
        if (readOutage) {
          const error = page.getByTestId('runtime-scheme-detail-error');
          await expect(error).toBeVisible({ timeout: 20000 });
          expect(failedDetailReads).toBeGreaterThan(0);
          detailUnavailable = false;
          await error.getByRole('button', { name: '重试', exact: true }).click();
        }
        await expect(page.getByTestId('runtime-scheme-detail')).toHaveAttribute(
          'data-status',
          'draft',
        );
        const after = designSchemeDetailSchema.parse(
          await browserJson(page, `/api/v1/design-schemes/${draft.summary.id}`),
        );
        expect(after.summary.hasSuccessfulTrial).toBe(completedOriginal);
        expect(after.document).toEqual(draft.document);
        expect(after.assets).toHaveLength(completedOriginal ? 1 : 0);
        expect(posted).toHaveLength(1);
        expect((await service.snapshot()).imageCalls).toHaveLength(
          fault === 'cancel-before' ? 0 : 1,
        );
        await info.attach('actual-trial-fault', {
          contentType: 'application/json',
          body: JSON.stringify({
            fault,
            material,
            referenceAssetIds: input.executionSettings.referenceAssetIds,
            failedRunReads,
            failedDetailReads,
            original,
            run,
            imageCalls: state.imageCalls,
            generationRuns: state.generationRuns,
            newTrialQualified: after.summary.hasSuccessfulTrial,
            real: 'UI/BA/Hono/PG/actual generation bin; provider HTTP controlled; lost acceptance drops only an actual accepted response; no trial state injection',
          }),
        });
      } catch (error) {
        await info.attach('trial-fault-state', {
          contentType: 'application/json',
          body: JSON.stringify(await service.snapshot()),
        });
        await info.attach('trial-fault-page', {
          contentType: 'text/plain',
          body: await page.locator('body').innerText(),
        });
        throw error;
      } finally {
        for (const open of context.pages()) await open.goto('about:blank');
        await context.unrouteAll({ behavior: 'wait' });
        await service.dispose();
      }
    });
  }
}
