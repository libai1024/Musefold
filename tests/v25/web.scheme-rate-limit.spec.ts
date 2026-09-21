import { expect, test } from '@playwright/test';
import { designSchemeDetailSchema, runResultSchema } from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import {
  browserJson,
  connectExchangeBrowser,
  loginExchangeBrowser,
} from './package-exchange-browser';

for (const limitedRead of ['events', 'status', 'revoked'] as const) {
  test(`limited scheme ${limitedRead} read preserves original execution and fresh authorization`, async ({
    page,
    context,
  }) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires actual isolated API, PG, Agent and generation Worker',
    );
    test.setTimeout(180_000);
    const service = new AgentBrowserProcess();
    try {
      const { baseUrl } = await service.ready;
      await connectExchangeBrowser(context, baseUrl);
      await loginExchangeBrowser(page, `read-backoff-${limitedRead}@example.test`);
      await page.getByTestId('scheme-create').click();
      await page.getByTestId('scheme-create-option-idea').click();
      await page.getByTestId('composer-prompt').fill('黑白书展海报');
      await page.getByTestId('composer-submit').click();
      await page.getByTestId('scheme-agent-model-offer').click();
      await page.getByTestId('scheme-agent-authorize-create').click();
      await page.getByTestId('scheme-agent-open-result').click({ timeout: 20_000 });
      await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
      const id = new URL(page.url()).searchParams.get('scheme');
      const draft = designSchemeDetailSchema.parse(
        await browserJson(page, `/api/v1/design-schemes/${id}`),
      );
      await service.imageMode('hold');
      await service.startGeneration();
      let limitedUrl = '';
      let resumedUrl = '';
      let limitedAt = 0;
      const retryAfterSeconds = limitedRead === 'revoked' ? 10 : 2;
      await page.route('**/api/v1/design-schemes/runs/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const matches =
          limitedRead !== 'status'
            ? url.pathname.endsWith('/events')
            : /\/runs\/[^/]+$/.test(url.pathname);
        if (request.method() !== 'GET' || !matches) return route.fallback();
        if (limitedUrl) {
          resumedUrl ||= request.url();
          return route.fallback();
        }
        limitedUrl = request.url();
        limitedAt = Date.now();
        return route.fulfill({
          status: 429,
          headers: { 'retry-after': String(retryAfterSeconds) },
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: '请稍后读取原任务',
              requestId: 'injected-read-limit',
              retryable: true,
            },
          }),
        });
      });
      const posts: string[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/v1/design-schemes/run'
        )
          posts.push(request.postData() ?? '');
      });
      await page.getByTestId('runtime-scheme-primary-action').click();
      await expect(page.getByTestId('composer-prompt')).toBeFocused();
      await page.getByTestId('scheme-run-variable-topic').fill('秋季书展');
      await page.getByTestId('composer-prompt').fill('核对原任务，不重复扣费');
      await page.getByTestId('composer-submit').click();
      await expect.poll(() => limitedUrl).not.toBe('');
      await expect(page.getByTestId('composer-prompt')).toHaveValue('核对原任务，不重复扣费');
      await expect(page.getByTestId('scheme-submit-error')).toHaveCount(0);
      await expect
        .poll(async () => (await service.snapshot()).imageCalls.length, { timeout: 20_000 })
        .toBe(1);
      if (limitedRead === 'revoked') {
        // connectExchangeBrowser forwards to the isolated API; Playwright reports that
        // final origin on the response, while the page route observes the original URL.
        const originalUrl = new URL(limitedUrl);
        const forwardedUrl = `${baseUrl}${originalUrl.pathname}${originalUrl.search}`;
        const rejectedRead = page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            response.url() === forwardedUrl &&
            response.status() === 403,
          { timeout: 20_000 },
        );
        await service.revoke();
        expect(Date.now() - limitedAt).toBeLessThan(retryAfterSeconds * 1_000);
        await service.releaseImage();
        await rejectedRead;
        expect(Date.now() - limitedAt).toBeGreaterThanOrEqual(retryAfterSeconds * 1_000);
        expect(resumedUrl).toBe(limitedUrl);
        await expect(page.getByTestId('generation-account-recovery')).toBeVisible();
        await expect(page.getByTestId('composer-prompt')).toHaveValue('核对原任务，不重复扣费');
        await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('秋季书展');
        await expect(page.getByTestId('composer-submit')).toBeDisabled();
        expect(posts).toHaveLength(1);
        const snapshot = await service.snapshot();
        expect(snapshot.imageCalls).toHaveLength(1);
        expect(snapshot.generationRuns).toHaveLength(1);
        expect(snapshot.schemeRuns).toHaveLength(1);
        return;
      }
      await service.releaseImage();
      await expect(page.getByTestId('composer-prompt')).toHaveValue('', { timeout: 30_000 });
      expect(resumedUrl).toBe(limitedUrl);
      expect(posts).toHaveLength(1);
      const snapshot = await service.snapshot();
      expect(snapshot.imageCalls).toHaveLength(1);
      expect(snapshot.generationRuns).toHaveLength(1);
      expect(snapshot.schemeRuns).toHaveLength(1);
      const original = runResultSchema.parse(
        await browserJson(page, `/api/v1/design-schemes/runs/${snapshot.schemeRuns[0].run_id}`),
      );
      expect(original).toMatchObject({
        schemeId: draft.summary.id,
        revisionId: draft.document.revisionId,
        status: 'completed',
      });
      await page.goto(`/design-schemes?scheme=${draft.summary.id}`);
      await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
      const completed = designSchemeDetailSchema.parse(
        await browserJson(page, `/api/v1/design-schemes/${draft.summary.id}`),
      );
      expect(completed.summary.hasSuccessfulTrial).toBe(true);
      expect(
        completed.assets.some((asset) => asset.origin === 'cloud-run' && asset.role === 'output'),
      ).toBe(true);
    } finally {
      await service.dispose();
    }
  });
}
