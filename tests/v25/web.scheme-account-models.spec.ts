import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemeRunInputSchema,
  generationJobSchema,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import { browserJson, connectExchangeBrowser } from './package-exchange-browser';
import { createActualAgentDraft } from './scheme-trial-browser';
import { selectTrialCover } from './web.scheme-promote-helper';

test('account models: actual scheme trial and formal requests keep selected models, references and historical costs', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires isolated actual API/PG/generation bin',
  );
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    await service.requireImageInput();
    await service.startGeneration();
    const draft = await createActualAgentDraft(page, service, 'brief');
    const id = draft.summary.id;
    const read = async () =>
      designSchemeDetailSchema.parse(await browserJson(page, `/api/v1/design-schemes/${id}`));
    const reference = await sharp({
      create: { width: 6, height: 4, channels: 3, background: '#287c92' },
    })
      .png()
      .toBuffer();
    const originalReferenceHash = createHash('sha256').update(reference).digest('hex');
    const requests: ReturnType<typeof designSchemeRunInputSchema.parse>[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/v1/design-schemes/run'))
        requests.push(designSchemeRunInputSchema.parse(request.postDataJSON()));
    });
    async function run(mode: 'trial' | 'formal', model: string, price: string) {
      // Desktop success notifications overlap this action. Move off the toast so
      // its hover-paused lifetime can finish before a real, hit-tested click.
      await page.mouse.move(0, 0);
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
      await page.getByTestId('runtime-scheme-primary-action').click({ timeout: 10000 });
      await expect(page.getByTestId('composer-prompt')).toBeFocused();
      const choice = page.getByRole('combobox', { name: '账号模型' });
      await expect(choice).toBeEnabled();
      await choice.click();
      await page.getByRole('option', { name: new RegExp(`^${model}\\b`) }).click();
      await expect(choice).toBeFocused();
      await expect(page.getByTestId('composer-model-price')).toContainText(price);
      await page.getByTestId('scheme-run-variable-topic').fill(`${mode}模型选择`);
      await page.getByTestId('composer-prompt').fill('保持当前模型和参考图');
      await page
        .getByTestId('composer-file-input')
        .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: reference });
      await expect(page.getByTestId('composer-submit')).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`scheme-${mode}-model.png`) });
      await page.getByTestId('composer-submit').click();
      await expect(page.getByTestId('composer-prompt')).toHaveValue('', { timeout: 20000 });
      const sent = requests.at(-1);
      expect(sent).toMatchObject({
        mode,
        revisionId: draft.document.revisionId,
        executionSettings: { model, expectedBinding: { model } },
        executionBinding: { model },
        plan: { provider: { model } },
      });
      expect(sent?.executionSettings.referenceAssetIds).toHaveLength(1);
      expect((await service.snapshot()).imageCalls.at(-1)).toMatchObject({
        model,
        endpoint: '/v1/images/edits',
        count: 1,
        references: [{ hash: originalReferenceHash }],
      });
      await page.getByTestId('scheme-run-chip-body').click();
      await page.getByTestId('scheme-attachment-detail').click();
      await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
      return read();
    }
    const tried =
      await test.step('Select and execute the trial model with an actual reference', () =>
        run('trial', 'gpt-image-2', '2.4 积分/计费次'));
    expect(tried.summary.hasSuccessfulTrial).toBe(true);
    const outputs = tried.assets.filter(
      (asset) => asset.origin === 'cloud-run' && asset.role === 'output',
    );
    expect(outputs).toHaveLength(1);
    const firstState = await service.snapshot();
    const firstId = firstState.generationRuns[0].id as string;
    const originalJob = generationJobSchema.parse(
      await browserJson(page, `/api/v1/generations/${firstId}`),
    );
    expect(originalJob.providerModel).toBe('gpt-image-2');
    // Hold the actual post-write detail request beyond Playwright's default 5s.
    // No response body is replaced and the cover write must still occur once.
    let coverWrites = 0;
    let heldCoverReads = 0;
    const coverUrl = '**/api/v1/design-schemes/select-cover';
    const detailUrl = `**/api/v1/design-schemes/${id}`;
    await page.route(coverUrl, async (route) => {
      coverWrites++;
      await route.fallback();
    });
    await page.route(detailUrl, async (route) => {
      if (coverWrites === 0 || route.request().method() !== 'GET') return route.fallback();
      heldCoverReads++;
      await new Promise((resolve) => setTimeout(resolve, 6500));
      await route.fallback();
    });
    const coverResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/design-schemes/select-cover',
    );
    await selectTrialCover(page, outputs[0].id, tried.assets.length);
    expect((await coverResponse).status()).toBe(200);
    expect(coverWrites).toBe(1);
    expect(heldCoverReads).toBeGreaterThan(0);
    await page.unroute(coverUrl);
    await page.unroute(detailUrl);
    expect((await read()).summary.coverAssetId).toBe(outputs[0].id);
    await page.getByTestId('runtime-scheme-formalize').click();
    await expect.poll(async () => (await read()).summary.status).toBe('formal');
    const formal =
      await test.step('Select a different formal model without rewriting trial costs', () =>
        run('formal', 'musefold-image-pro', '1.2 积分/计费次'));
    expect(
      formal.assets
        .filter((asset) => asset.origin === 'cloud-run' && asset.role === 'output')
        .map((asset) => asset.id),
    ).toEqual(outputs.map((asset) => asset.id));
    const final = await service.snapshot();
    expect(final.imageCalls.map((call) => call.model)).toEqual([
      'gpt-image-2',
      'musefold-image-pro',
    ]);
    expect(final.generationRuns).toHaveLength(2);
    const retained = generationJobSchema.parse(
      await browserJson(page, `/api/v1/generations/${firstId}`),
    );
    expect(retained.providerModel).toBe(originalJob.providerModel);
    expect(retained.costPoints).toBe(originalJob.costPoints);
    expect(requests).toHaveLength(2);
  } finally {
    try {
      for (const tab of context.pages()) await tab.goto('about:blank');
      await context.unrouteAll({ behavior: 'wait' });
    } finally {
      await service.dispose();
    }
  }
});
