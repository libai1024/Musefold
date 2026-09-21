import { test, expect, type Page } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemeRunInputSchema,
  runResultSchema,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import { createActualAgentDraft } from './scheme-trial-browser';
import {
  browserJson,
  connectExchangeBrowser,
  loginExchangeBrowser,
} from './package-exchange-browser';

async function status(page: Page, path: string, body?: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        credentials: 'include',
        ...(body === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
      return response.status;
    },
    { path, body },
  );
}

for (const phase of ['before-dispatch', 'after-dispatch'] as const) {
  test(`logout in a second page ${phase} rejects stale trial actions and recovers the original result`, async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires actual login/API/PG/Agent and generation bin',
    );
    test.setTimeout(180000);
    const service = new AgentBrowserProcess();
    const posted: unknown[] = [];
    try {
      await connectExchangeBrowser(context, (await service.ready).baseUrl);
      const draft = await createActualAgentDraft(page, service, 'brief');
      await service.imageMode('hold');
      if (phase === 'after-dispatch') await service.startGeneration();
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().endsWith('/api/v1/design-schemes/run'))
          posted.push(request.postDataJSON());
      });
      await page.getByTestId('runtime-scheme-primary-action').click();
      await expect(page.getByTestId('composer-prompt')).toBeFocused();
      await page.getByTestId('scheme-run-variable-topic').fill('双页面登出试跑');
      await page.getByTestId('composer-prompt').fill('仅核对这次执行');
      await page.getByTestId('composer-submit').click();
      await expect
        .poll(async () => (await service.snapshot()).schemeRuns.length, { timeout: 20000 })
        .toBe(1);
      expect(posted).toHaveLength(1);
      const input = designSchemeRunInputSchema.parse(posted[0]);
      if (phase === 'after-dispatch')
        await expect
          .poll(async () => (await service.snapshot()).imageCalls.length, { timeout: 20000 })
          .toBe(1);
      const original = (await service.snapshot()).schemeRuns[0];
      const account = await context.newPage();
      await account.goto('/settings');
      await account.getByTestId('settings-nav-account').click();
      await expect(account.getByTestId('account-signed-in')).toBeVisible();
      await account.getByTestId('account-logout').click();
      await account.getByTestId('account-logout-confirm').click();
      await expect(account.getByTestId('account-auth-form')).toBeVisible();
      const denied = {
        detail: await status(page, `/api/v1/design-schemes/${draft.summary.id}`),
        run: await status(page, `/api/v1/design-schemes/runs/${original.run_id}`),
        cancel: await status(page, '/api/v1/design-schemes/cancel', {
          executionId: input.executionId,
          runId: original.run_id,
        }),
      };
      expect(denied).toEqual({ detail: 401, run: 401, cancel: 401 });
      await expect(page.getByTestId('scheme-submit-error')).toBeVisible({ timeout: 20000 });
      // The stale Composer ends observation; it must not automatically submit a replacement.
      expect(posted).toHaveLength(1);
      if (phase === 'before-dispatch') await service.startGeneration();
      await service.releaseImage();
      const completed = phase === 'after-dispatch';
      await expect
        .poll(async () => (await service.snapshot()).schemeRuns[0].status, { timeout: 20000 })
        .toBe(completed ? 'completed' : 'failed');
      await expect
        .poll(async () => (await service.snapshot()).jobs.length, { timeout: 20000 })
        .toBe(0);
      expect(await service.stopGeneration()).toEqual({ code: 0, signal: null });
      await page.goto(`/design-schemes?scheme=${draft.summary.id}`);
      await expect(page.getByTestId('runtime-scheme-detail-error')).toBeVisible();
      await expect(page.getByTestId('runtime-scheme-detail')).toHaveCount(0);
      // A separately authenticated owner must not recover this execution or its result either.
      const outsider = await browser.newContext({
        baseURL: 'http://127.0.0.1:3399',
        viewport: page.viewportSize(),
      });
      const crossOwner: Record<string, number> = {};
      try {
        await connectExchangeBrowser(outsider, (await service.ready).baseUrl);
        const visitor = await outsider.newPage();
        await loginExchangeBrowser(visitor, `other-owner-${phase}@example.test`);
        crossOwner.detail = await status(visitor, `/api/v1/design-schemes/${draft.summary.id}`);
        crossOwner.run = await status(visitor, `/api/v1/design-schemes/runs/${original.run_id}`);
        crossOwner.events = await status(
          visitor,
          `/api/v1/design-schemes/runs/${original.run_id}/events?afterSeq=0`,
        );
        crossOwner.submit = await status(visitor, '/api/v1/design-schemes/run', input);
        crossOwner.cancel = await status(visitor, '/api/v1/design-schemes/cancel', {
          executionId: input.executionId,
          runId: original.run_id,
        });
        expect(crossOwner).toEqual({
          detail: 404,
          run: 404,
          events: 404,
          submit: 404,
          cancel: 404,
        });
        if (completed) {
          const asset = (await service.snapshot()).schemeAssets[0];
          crossOwner.asset = await status(
            visitor,
            `/api/v1/design-schemes/assets/${asset.id}/content`,
          );
          expect(crossOwner.asset).toBe(404);
        }
        await visitor.goto(`/design-schemes?scheme=${draft.summary.id}`);
        await expect(visitor.getByTestId('runtime-scheme-detail-error')).toBeVisible();
        await expect(visitor.getByTestId('runtime-scheme-detail')).toHaveCount(0);
      } finally {
        for (const open of outsider.pages()) await open.goto('about:blank');
        await outsider.unrouteAll({ behavior: 'wait' });
        await outsider.close();
      }
      await account.getByTestId('account-username').fill('trial-brief@example.test');
      await account.getByTestId('account-password').fill('correct-password');
      await account.getByTestId('account-auth-submit').click();
      await expect(account.getByTestId('account-signed-in')).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('runtime-scheme-detail')).toHaveAttribute(
        'data-status',
        'draft',
      );
      const recovered = designSchemeDetailSchema.parse(
        await browserJson(page, `/api/v1/design-schemes/${draft.summary.id}`),
      );
      expect(recovered.document).toEqual(draft.document);
      expect(recovered.summary.hasSuccessfulTrial).toBe(completed);
      expect(recovered.assets).toHaveLength(completed ? 1 : 0);
      const result = runResultSchema.parse(
        await browserJson(page, `/api/v1/design-schemes/runs/${original.run_id}`),
      );
      expect(result).toMatchObject({
        runId: original.run_id,
        revisionId: draft.document.revisionId,
        status: completed ? 'completed' : 'failed',
      });
      const final = await service.snapshot();
      expect(final.imageCalls).toHaveLength(completed ? 1 : 0);
      expect(final.modelCalls).toHaveLength(1);
      expect(final.schemeRuns).toHaveLength(1);
      expect(final.generationRuns).toEqual([
        expect.objectContaining({
          design_scheme_run_id: original.run_id,
          status: completed ? 'succeeded' : 'failed',
        }),
      ]);
      expect(posted).toHaveLength(1);
      if (completed) expect(recovered.assets[0].contentHash).toBe(final.imageOutput.hash);
      await info.attach('two-page-trial-logout', {
        contentType: 'application/json',
        body: JSON.stringify({
          phase,
          denied,
          crossOwner,
          original,
          result,
          newTrialQualified: recovered.summary.hasSuccessfulTrial,
          imageCalls: final.imageCalls.length,
          textCalls: final.modelCalls.length,
          real: 'Actual UI logout/login, BA, API, PG, Agent and generation bin; upstream identity/model/S3 controlled; no SQL trial qualification',
        }),
      });
    } catch (error) {
      await info.attach('two-page-logout-state', {
        contentType: 'application/json',
        body: JSON.stringify(await service.snapshot()),
      });
      await info.attach('two-page-logout-page', {
        contentType: 'text/plain',
        body: await page.locator('body').innerText(),
      });
      throw error;
    } finally {
      await service.releaseImage().catch(() => undefined);
      for (const open of context.pages()) await open.goto('about:blank');
      await context.unrouteAll({ behavior: 'wait' });
      await service.dispose();
    }
  });
}
