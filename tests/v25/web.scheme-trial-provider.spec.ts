import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { test, expect } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemeRunInputSchema,
  generationJobSchema,
  runResultSchema,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import { createActualAgentDraft } from './scheme-trial-browser';
import { browserJson, connectExchangeBrowser } from './package-exchange-browser';

for (const material of ['text', 'reference-image'] as const) {
  for (const phase of ['before-dispatch', 'after-dispatch'] as const) {
    test(`provider credential ${phase} with ${material} preserves the original trial and requires explicit retry`, async ({
      page,
      context,
    }, info) => {
      test.skip(
        process.env.RUN_DATABASE_TESTS !== 'true',
        'Requires actual API/PG/Agent/generation bin',
      );
      test.setTimeout(180000);
      const service = new AgentBrowserProcess();
      const posted: unknown[] = [];
      try {
        await connectExchangeBrowser(context, (await service.ready).baseUrl);
        const reference =
          material === 'reference-image'
            ? await sharp({ create: { width: 6, height: 4, channels: 3, background: '#287c92' } })
                .png()
                .toBuffer()
            : undefined;
        if (reference) await service.requireImageInput();
        const draft = await createActualAgentDraft(page, service, 'brief');
        const read = async () =>
          designSchemeDetailSchema.parse(
            await browserJson(page, `/api/v1/design-schemes/${draft.summary.id}`),
          );
        const result = async (id: string) =>
          runResultSchema.parse(await browserJson(page, `/api/v1/design-schemes/runs/${id}`));
        const alreadyAccepted = phase === 'after-dispatch';
        page.on('request', (request) => {
          if (request.method() === 'POST' && request.url().endsWith('/api/v1/design-schemes/run'))
            posted.push(request.postDataJSON());
        });
        async function submit(label: string, count: number) {
          await page.goto(`/design-schemes?scheme=${draft.summary.id}`);
          await page.getByTestId('runtime-scheme-primary-action').click();
          await page.getByTestId('composer-prompt').click();
          await expect(page.getByTestId('composer-prompt')).toBeFocused();
          await page.getByTestId('scheme-run-variable-topic').fill(label);
          await page.getByTestId('composer-prompt').fill('保留这次授权输入');
          if (reference) {
            await expect(page.getByTestId('composer-submit')).toBeDisabled();
            await page
              .getByTestId('composer-file-input')
              .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: reference });
          }
          await expect(page.getByTestId('composer-submit')).toBeEnabled();
          await page.getByTestId('composer-submit').click();
          await expect
            .poll(async () => (await service.snapshot()).schemeRuns.length, { timeout: 20000 })
            .toBe(count);
          expect(posted).toHaveLength(count);
          return (await service.snapshot()).schemeRuns[count - 1];
        }
        await service.imageMode('hold');
        if (alreadyAccepted) await service.startGeneration();
        const original = await submit('原始试跑', 1);
        if (alreadyAccepted)
          await expect
            .poll(async () => (await service.snapshot()).imageCalls.length, { timeout: 20000 })
            .toBe(1);
        const revoked = await service.revokeUpstream();
        expect(revoked).toHaveLength(1);
        if (!alreadyAccepted) await service.startGeneration();
        await service.releaseImage();
        await expect
          .poll(async () => (await result(original.run_id)).status, { timeout: 20000 })
          .toBe(alreadyAccepted ? 'completed' : 'failed');
        const originalResult = await result(original.run_id);
        expect((await read()).summary.hasSuccessfulTrial).toBe(alreadyAccepted);
        if (alreadyAccepted) await expect(page.getByTestId('composer-prompt')).toHaveValue('');
        const deniedRun = alreadyAccepted ? await submit('撤销后明确提交', 2) : original;
        await expect(page.getByTestId('scheme-submit-error')).toBeVisible({ timeout: 20000 });
        await expect(page.getByTestId('composer-prompt')).toHaveValue('保留这次授权输入');
        await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue(
          alreadyAccepted ? '撤销后明确提交' : '原始试跑',
        );
        const denied = await result(deniedRun.run_id);
        expect(denied.status).toBe('failed');
        expect(denied.error?.code).toBe('GENERATION_UPSTREAM_REJECTED');
        expect(denied.outputs).toEqual([]);
        await expect
          .poll(async () => (await service.snapshot()).jobs.length, { timeout: 20000 })
          .toBe(0);
        const state = await service.snapshot();
        const generation = state.generationRuns.find(
          (run) => run.design_scheme_run_id === deniedRun.run_id,
        );
        const job = generationJobSchema.parse(
          await browserJson(page, `/api/v1/generations/${generation?.id}`),
        );
        expect(job.costPoints).toBeNull();
        const authority = await service.providerAuthorization();
        const requests = authority.requests.filter((r) => r.endpoint.startsWith('/v1/images/'));
        expect(requests.map((r) => r.authorized)).toEqual(
          alreadyAccepted ? [true, false] : [false],
        );
        expect(
          requests.every(
            (r) =>
              r.keyHash === revoked[0] &&
              r.endpoint.endsWith(reference ? '/edits' : '/generations'),
          ),
        ).toBe(true);
        expect(state.imageCalls).toHaveLength(alreadyAccepted ? 1 : 0);
        expect(state.modelCalls).toHaveLength(1);
        const settled = await read();
        expect(settled.summary.hasSuccessfulTrial).toBe(alreadyAccepted);
        expect(settled.document).toEqual(draft.document);
        expect(settled.assets).toHaveLength(alreadyAccepted ? 1 : 0);
        await service.restoreUpstream();
        await page.reload();
        await expect(page.getByTestId('workbench')).toBeVisible();
        await page.goto(`/design-schemes?scheme=${draft.summary.id}`);
        await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
        expect(await read()).toEqual(settled);
        expect(await result(original.run_id)).toEqual(originalResult);
        expect((await service.snapshot()).imageCalls).toEqual(state.imageCalls);
        expect((await service.providerAuthorization()).requests).toEqual(authority.requests);
        expect(posted).toHaveLength(alreadyAccepted ? 2 : 1);
        const fresh = await submit('恢复后明确新试跑', alreadyAccepted ? 3 : 2);
        await expect
          .poll(async () => (await result(fresh.run_id)).status, { timeout: 20000 })
          .toBe('completed');
        await expect
          .poll(async () => (await service.snapshot()).jobs.length, { timeout: 20000 })
          .toBe(0);
        const final = await service.snapshot();
        expect(final.imageCalls).toHaveLength(alreadyAccepted ? 2 : 1);
        expect(final.modelCalls).toHaveLength(1);
        expect(
          new Set(posted.map((input) => designSchemeRunInputSchema.parse(input).executionId)).size,
        ).toBe(posted.length);
        if (reference) {
          const hash = createHash('sha256').update(reference).digest('hex');
          for (const call of final.imageCalls)
            expect(call.references).toEqual([
              { hash, bytes: reference.length, mimeType: 'image/png' },
            ]);
        }
        expect(await result(original.run_id)).toEqual(originalResult);
        expect((await read()).summary.hasSuccessfulTrial).toBe(true);
        expect(await service.stopGeneration()).toEqual({ code: 0, signal: null });
        await info.attach('provider-revocation-browser', {
          contentType: 'application/json',
          body: JSON.stringify({
            material,
            phase,
            originalResult,
            denied,
            freshRunId: fresh.run_id,
            authority,
            finalAuthority: await service.providerAuthorization(),
            imageCalls: final.imageCalls,
            textCalls: final.modelCalls.length,
            posted: posted.length,
            unknownCost: job.costPoints === null,
          }),
        });
      } catch (error) {
        await info.attach('provider-failure-page', {
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
