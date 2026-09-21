import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  accountModelCatalogSchema,
  accountSummarySchema,
  designSchemeAgentSessionSchema,
  designSchemeDetailSchema,
  designSchemeTextModelOfferSchema,
  generationJobSchema,
  runResultSchema,
} from '@musefold/contracts';
import { validateLiveVerification } from '../../scripts/v25-live-verification.mjs';
import { logoutLiveWeb, submitLiveLogin } from './live-account-helpers';
import { seedOnboardingCompleted } from './onboarding-helpers';
import { browserJson, exportExchangeBrowser } from './package-exchange-browser';
import { selectTrialCover } from './web.scheme-promote-helper';

test.describe.configure({ retries: 0, timeout: 900000 });
test.use({ trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 30000 });
test.skip(
  process.env.MUSEFOLD_LIVE_ACCOUNT_GENERATION !== '1',
  'Account spending requires separate opt-in',
);

test.afterEach(async ({ page }) => {
  await logoutLiveWeb(page);
});

test('real account: selected model → Agent draft → trial/cover/formal → mobile revision → real package', async ({
  page,
  isMobile,
}, info) => {
  // One paid journey changes viewport mid-flight; do not duplicate charges in the second project.
  test.skip(isMobile, 'Mobile is covered in the same paid desktop-to-mobile journey');
  validateLiveVerification(process.env);
  // Exercise the mobile-compatible browser download path with real archive bytes.
  // Native picker permission/cancel/write semantics have their own host tests.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await seedOnboardingCompleted(page);
  await page.goto('/settings');
  await page.getByTestId('settings-nav-account').click();
  await submitLiveLogin(page);
  const account = async () =>
    accountSummarySchema.parse(await browserJson(page, '/api/v1/account/status'));
  const before = await account();
  expect(before.canGenerate).toBe(true);
  const textOffer = designSchemeTextModelOfferSchema.parse(
    await browserJson(page, '/api/v1/design-schemes/agent/text-model'),
  );
  const catalog = accountModelCatalogSchema.parse(
    await browserJson(page, '/api/v1/account/models'),
  );
  const model = process.env.MUSEFOLD_E2E_ACCOUNT_IMAGE_MODEL ?? '';
  const selected = catalog.models.find((item) => item.model === model);
  expect(selected?.imageGeneration).toBe(true);
  expect(selected?.pricing.kind).toBe('per_call');
  if (selected?.pricing.kind !== 'per_call')
    throw new Error('Selected live model has no verified flat price');
  const alternate = catalog.models
    .filter(
      (item) => item.imageGeneration && item.model !== model && item.pricing.kind === 'per_call',
    )
    .sort(
      (a, b) =>
        (a.pricing.kind === 'per_call' ? a.pricing.quotaPerCall : Infinity) -
        (b.pricing.kind === 'per_call' ? b.pricing.quotaPerCall : Infinity),
    )[0];
  if (alternate?.pricing.kind !== 'per_call')
    throw new Error('A second priced image model is required');
  expect(before.quota).toBeGreaterThan(
    Math.max(selected.pricing.quotaPerCall, alternate.pricing.quotaPerCall) * 4,
  );
  const events: Array<{ path: string; status: number }> = [];
  const reads: Array<{ at: string; path: string; status: number }> = [];
  const runs = new Set<string>();
  const agents = new Set<string>();
  const observations: Promise<void>[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.request().method() === 'GET' && path.startsWith('/api/v1/') && reads.length < 5000)
      reads.push({ at: new Date().toISOString(), path, status: response.status() });
    if (response.request().method() === 'POST' && path.startsWith('/api/v1/')) {
      events.push({ path, status: response.status() });
      if (response.ok() && path === '/api/v1/design-schemes/run')
        observations.push(
          response.json().then((value) => {
            runs.add(runResultSchema.parse(value).runId);
          }),
        );
      if (response.ok() && path === '/api/v1/design-schemes/agent/executions')
        observations.push(
          response.json().then((value) => {
            agents.add(designSchemeAgentSessionSchema.parse(value).executionId);
          }),
        );
    }
  });
  const evidence: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    beforeQuota: before.quota,
    quotaUnit: before.quotaUnit,
    selectedModel: model,
    price: selected.pricing,
    textModel: textOffer.binding.model,
    exportTransport: 'browser-download',
  };
  async function openAgentResult(previousCount: number) {
    await expect.poll(() => agents.size).toBeGreaterThan(previousCount);
    const executionId = [...agents].at(-1);
    const read = async () =>
      designSchemeAgentSessionSchema.parse(
        await browserJson(page, `/api/v1/design-schemes/agent/executions/${executionId}`),
      );
    // Observe the product's own completion, then independently verify its durable result.
    // A second test-only poller would distort the same upstream authentication budget.
    await expect(page.getByTestId('scheme-agent-open-result')).toBeVisible({ timeout: 180000 });
    const result = await read();
    expect({ status: result.status, blocker: result.blocker }).toEqual({
      status: 'completed',
      blocker: null,
    });
    await page.getByTestId('scheme-agent-open-result').click();
    await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('scheme'))
      .toBe(result.result?.scheme.id);
  }
  try {
    const resumedRunId = process.env.MUSEFOLD_LIVE_RESUME_RUN_ID;
    if (resumedRunId) {
      const completed = generationJobSchema.parse(
        await browserJson(page, `/api/v1/generations/${encodeURIComponent(resumedRunId)}`),
      );
      expect(completed.status).toBe('succeeded');
      expect(completed.providerModel).toBe(model);
      expect(completed.assets).toHaveLength(1);
      evidence.ordinary = {
        reusedPreviouslyVerifiedRun: true,
        runId: completed.id,
        model: completed.providerModel,
        costPoints: completed.costPoints,
        assetIds: completed.assets.map((asset) => asset.id),
      };
      console.log(`Live paid stage: reused-ordinary ${completed.id}`);
    } else {
      await page.goto('/workbench');
      const choice = page.getByRole('combobox', { name: '账号模型' });
      await choice.click();
      await page
        .getByRole('option', {
          name: new RegExp(`^${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
        })
        .click();
      // Wait for the Select to restore focus before opening another Radix layer.
      await expect(choice).toBeFocused();
      await expect(page.getByTestId('composer-model-price')).toBeVisible();
      await page.getByTestId('composer-settings').click();
      await expect(page.getByTestId('composer-count')).toBeVisible();
      await page.getByTestId('composer-count-1').click();
      await expect(page.getByTestId('composer-count-1')).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      await page
        .getByTestId('composer-prompt')
        .fill('A red ceramic cup, cream studio background, soft daylight, no text.');
      const sent = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/generations',
      );
      await page.getByTestId('composer-submit').click();
      const response = await sent;
      expect(response.ok()).toBe(true);
      expect(response.request().postDataJSON()).toMatchObject({ count: 1 });
      const initial = generationJobSchema.parse(await response.json());
      evidence.ordinaryRunId = initial.id;
      console.log(`Live paid stage: ordinary-submitted ${initial.id}`);
      const turn = page.getByTestId(`job-${initial.id}`);
      await expect(turn.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
        timeout: 300000,
      });
      const completed = generationJobSchema.parse(
        await browserJson(page, `/api/v1/generations/${initial.id}`),
      );
      expect(completed.providerModel).toBe(model);
      expect(completed.assets).toHaveLength(1);
      await expect(turn.getByTestId('job-asset').locator('img').first()).toBeVisible();
      evidence.ordinary = {
        runId: completed.id,
        model: completed.providerModel,
        costPoints: completed.costPoints,
        assets: completed.assets.map(({ id, width, height, byteSize }) => ({
          id,
          width,
          height,
          byteSize,
        })),
      };
      console.log('Live paid stage: ordinary-succeeded');
    }

    await page.goto('/design-schemes');
    const resumedAgentId = process.env.MUSEFOLD_LIVE_RESUME_AGENT_ID;
    if (resumedAgentId) {
      const previous = designSchemeAgentSessionSchema.parse(
        await browserJson(
          page,
          `/api/v1/design-schemes/agent/executions/${encodeURIComponent(resumedAgentId)}`,
        ),
      );
      expect(previous).toMatchObject({ operation: 'create', status: 'completed', blocker: null });
      agents.add(resumedAgentId);
      evidence.reusedAgentExecutionId = resumedAgentId;
      await page.getByTestId('scheme-agent-history-open').click();
      await page.getByTestId(`scheme-agent-recover-${resumedAgentId}`).click();
      await openAgentResult(0);
    } else {
      await page.getByTestId('scheme-create').click();
      await page.getByTestId('scheme-create-option-idea').click();
      await page
        .getByTestId('composer-prompt')
        .fill(
          `真实验收 ${randomUUID()}：创建一个极简咖啡海报方案，只需一个必填文字主题输入 topic，无需任何图片输入或外部来源。暖白背景、砖红咖啡杯、简洁留白。`,
        );
      await page.getByTestId('composer-submit').click();
      await page.getByTestId('scheme-agent-model-offer').click();
      const beforeCreate = agents.size;
      await page.getByTestId('scheme-agent-authorize-create').click();
      await openAgentResult(beforeCreate);
    }
    const id = new URL(page.url()).searchParams.get('scheme');
    if (!id) throw new Error('Missing actual Agent scheme id');
    const read = (revisionId?: string) =>
      browserJson(
        page,
        `/api/v1/design-schemes/${id}${revisionId ? `?revisionKind=working-draft&revisionId=${encodeURIComponent(revisionId)}` : ''}`,
      ).then((value) => designSchemeDetailSchema.parse(value));
    const draft = await read();
    expect(draft.document.createdBy).toBe('agent');
    const resumeExport = process.env.MUSEFOLD_LIVE_RESUME_STAGE === 'export';
    const resumeAlternate = process.env.MUSEFOLD_LIVE_RESUME_STAGE === 'alternate-completed';
    const resumeInitialTrial = process.env.MUSEFOLD_LIVE_RESUME_STAGE === 'initial-tried';
    const resumeModifiedTrial = process.env.MUSEFOLD_LIVE_RESUME_STAGE === 'modified-tried';
    const resumeFormal =
      process.env.MUSEFOLD_LIVE_RESUME_STAGE === 'formal' ||
      resumeModifiedTrial ||
      resumeExport ||
      resumeAlternate;
    expect(draft.summary.hasSuccessfulTrial).toBe(resumeFormal || resumeInitialTrial);
    expect(draft.summary.status).toBe(resumeFormal ? 'formal' : 'draft');
    evidence.schemeId = id;
    evidence.initialRevision = draft.document.revisionId;
    if (resumeAlternate) {
      const formalRunId = process.env.MUSEFOLD_LIVE_RESUME_FORMAL_RUN_ID;
      const generationId = process.env.MUSEFOLD_LIVE_RESUME_FORMAL_GENERATION_ID;
      if (!formalRunId || !generationId) throw new Error('Exact completed formal run required');
      const completed = runResultSchema.parse(
        await browserJson(page, `/api/v1/design-schemes/runs/${encodeURIComponent(formalRunId)}`),
      );
      const generated = generationJobSchema.parse(
        await browserJson(page, `/api/v1/generations/${encodeURIComponent(generationId)}`),
      );
      expect(completed.runId).toBe(formalRunId);
      expect(completed.schemeId).toBe(id);
      expect(completed.revisionId).toBe(draft.document.revisionId);
      expect(completed.mode).toBe('formal');
      expect(completed.status).toBe('completed');
      expect(completed.evaluation?.passed).toBe(true);
      expect(completed.outputs).toHaveLength(1);
      expect(generated.status).toBe('succeeded');
      expect(generated.providerModel).toBe(alternate.model);
      expect(generated.request.prompt).toBe(completed.compiledPrompt);
      expect(generated.assets).toHaveLength(1);
      const asset = generated.assets[0];
      const output = completed.outputs[0];
      if (!asset || !output) throw new Error('Completed formal run has no durable output');
      const response = await page.request.get(asset.url);
      expect(response.status()).toBe(200);
      const bytes = await response.body();
      expect(bytes.length).toBe(output.byteSize);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(output.contentHash);
      runs.add(formalRunId);
      evidence.formalRun = {
        reusedPreviouslyVerifiedRun: true,
        runId: formalRunId,
        generationId,
        model: generated.providerModel,
        revisionId: completed.revisionId,
        imageSha256: output.contentHash,
        bytes: bytes.length,
      };
    }
    console.log(`Live paid stage: agent-created ${id}`);
    const versions: Array<'initial' | 'modified'> = resumeExport ? [] : ['initial', 'modified'];
    if (resumeExport) {
      expect(draft.summary.workingDraftRevisionId).toBeNull();
      expect(draft.summary.coverAssetId).toBeTruthy();
      expect(draft.document.parentRevisionId).toBeTruthy();
      evidence.reusedFormalRevision = draft.document.revisionId;
      await page.setViewportSize({ width: 390, height: 844 });
    }
    for (const version of versions) {
      const reuseTrial =
        (version === 'initial' && resumeInitialTrial) ||
        (version === 'modified' && resumeModifiedTrial);
      await page.mouse.move(0, 0);
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
      let working = await read();
      let tried = working;
      if (version === 'initial' && resumeFormal) {
        expect(working.summary.coverAssetId).toBeTruthy();
        evidence.initial = {
          reusedPreviouslyVerifiedTrial: true,
          revisionId: working.document.revisionId,
          coverAssetId: working.summary.coverAssetId,
        };
      } else {
        if (version === 'modified') {
          await page.setViewportSize({ width: 390, height: 844 });
          if (!resumeModifiedTrial) {
            await page.getByTestId('runtime-scheme-modify').click();
            await page
              .getByTestId('composer-prompt')
              .fill(
                '保留唯一的文字主题输入和无需参考图的规则，将配色改为冷白与深蓝，增强标题层次。',
              );
            await page.getByTestId('composer-submit').click();
            await page.getByTestId('scheme-agent-model-offer').click();
            const beforeModify = agents.size;
            await page.getByTestId('scheme-agent-authorize-modify').click();
            await openAgentResult(beforeModify);
          }
          const staged = await read();
          expect(staged.summary.status).toBe('formal');
          expect(staged.document.revisionId).toBe(draft.document.revisionId);
          if (!staged.summary.workingDraftRevisionId)
            throw new Error('Missing actual revised draft');
          working = await read(staged.summary.workingDraftRevisionId);
          expect(working.document.parentRevisionId).toBe(draft.document.revisionId);
          if (resumeModifiedTrial) {
            expect(working.summary.hasSuccessfulTrial).toBe(true);
            evidence.reusedModifiedTrial = working.document.revisionId;
          } else await page.getByTestId('runtime-scheme-trial-working-draft').click();
        } else if (!reuseTrial) await page.getByTestId('runtime-scheme-primary-action').click();
        if (!reuseTrial) {
          const trialModel = page.getByRole('combobox', { name: '账号模型' });
          await trialModel.click();
          await page.getByRole('option', { name: new RegExp(`^${model}\\b`) }).click();
          await expect(trialModel).toBeFocused();
          await expect(trialModel).toHaveText(model);
          for (const slot of working.document.inputs) {
            if (slot.kind === 'image' || slot.kind === 'image-set') {
              if (slot.required)
                throw new Error(
                  'Actual Agent unexpectedly requires an image; no fake qualification',
                );
              continue;
            }
            const field = page.getByTestId(`scheme-run-variable-${slot.id}`);
            if (slot.required || (await field.isVisible())) {
              await expect(field).toBeVisible();
              await field.fill('秋日咖啡，慢一点享受生活');
            }
          }
          await page
            .getByTestId('composer-prompt')
            .fill('排版清晰、比例均衡，按当前方案生成一张海报。');
          await page.getByTestId('composer-submit').click();
          await expect(page.getByTestId('composer-prompt')).toHaveValue('', { timeout: 300000 });
        }
        await page.goto(`/design-schemes?scheme=${id}`);
        tried = await read(version === 'modified' ? working.document.revisionId : undefined);
        expect(tried.summary.hasSuccessfulTrial).toBe(true);
        const output = tried.assets.find(
          (asset) => asset.origin === 'cloud-run' && asset.role === 'output',
        );
        if (!output) throw new Error('Actual trial output missing');
        const bytes = await page.evaluate(async (assetId) => {
          const r = await fetch(`/api/v1/design-schemes/assets/${assetId}/content`);
          if (!r.ok) throw new Error(`Actual image HTTP ${r.status}`);
          return Array.from(new Uint8Array(await r.arrayBuffer()));
        }, output.id);
        expect(createHash('sha256').update(Buffer.from(bytes)).digest('hex')).toBe(
          output.contentHash,
        );
        expect(bytes.length).toBeGreaterThan(1024);
        if (tried.summary.coverAssetId !== output.id)
          await selectTrialCover(page, output.id, tried.assets.length);
        else {
          await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible({ timeout: 30000 });
          await expect(
            page.getByTestId('runtime-scheme-album').getByRole('img', {
              name: '方案示例',
              exact: true,
            }),
          ).toHaveAttribute('src', new RegExp(`/${output.id}/content$`));
        }
        await page
          .getByTestId(
            version === 'initial'
              ? 'runtime-scheme-formalize'
              : 'runtime-scheme-promote-working-draft',
          )
          .click();
        await expect
          .poll(async () => (await read()).summary)
          .toMatchObject({
            currentRevisionId: working.document.revisionId,
            status: 'formal',
            workingDraftRevisionId: null,
          });
        evidence[version] = {
          reusedPreviouslyVerifiedTrial: reuseTrial,
          revisionId: working.document.revisionId,
          outputId: output.id,
          imageSha256: output.contentHash,
          bytes: bytes.length,
        };
        console.log(`Live paid stage: ${version}-formalized`);
      }
      if (version === 'initial' && !resumeModifiedTrial && !resumeAlternate) {
        await page.mouse.move(0, 0);
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
        await page.getByTestId('runtime-scheme-primary-action').click();
        const modelChoice = page.getByRole('combobox', { name: '账号模型' });
        await modelChoice.click();
        await page
          .getByRole('option', {
            name: new RegExp(`^${alternate.model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
          })
          .click();
        await expect(modelChoice).toBeFocused();
        await expect(modelChoice).toHaveText(alternate.model);
        for (const slot of working.document.inputs) {
          if (slot.kind === 'image' || slot.kind === 'image-set') continue;
          const field = page.getByTestId(`scheme-run-variable-${slot.id}`);
          if (slot.required || (await field.isVisible())) {
            await expect(field).toBeVisible();
            await field.fill('正式版咖啡海报');
            await expect(field).toHaveValue('正式版咖啡海报');
          }
        }
        await page.getByTestId('composer-prompt').fill('使用正式版本完成咖啡海报。');
        await page.getByTestId('composer-submit').click();
        await expect(page.getByTestId('composer-prompt')).toHaveValue('', { timeout: 300000 });
        await page.goto(`/design-schemes?scheme=${id}`);
        const afterFormalRun = await read();
        expect(afterFormalRun.assets.map((asset) => asset.id).sort()).toEqual(
          tried.assets.map((asset) => asset.id).sort(),
        );
        evidence.formalRun = {
          model: alternate.model,
          price: alternate.pricing,
          revisionId: working.document.revisionId,
        };
        console.log('Live paid stage: alternate-model-completed');
      }
    }
    // No external source was supplied: a real free check must not invent a paid update.
    await page.getByTestId('runtime-scheme-menu').click();
    await page.getByTestId('runtime-scheme-menu-check-update').click();
    await page.getByTestId('scheme-agent-check-update').click();
    await expect(page.getByTestId('scheme-agent-session')).toContainText('没有可检查的来源', {
      timeout: 30000,
    });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    const exported = await exportExchangeBrowser(
      page,
      info.outputPath('real-account.musefold.design'),
    );
    evidence.package = {
      bytes: exported.bytes,
      sha256: exported.hash,
      formatVersion: exported.archive.formatVersion,
    };
    await page.screenshot({ path: info.outputPath('real-mobile-formal.png') });
  } catch (error) {
    if (!(await page.getByTestId('account-auth-form').isVisible()))
      await info.attach('paid-failure-ui', {
        body: await page.locator('body').ariaSnapshot(),
        contentType: 'text/plain',
      });
    throw error;
  } finally {
    const captured = await Promise.allSettled(observations);
    evidence.observationFailures = captured.filter((value) => value.status === 'rejected').length;
    evidence.endedAt = new Date().toISOString();
    evidence.readRequests = reads;
    evidence.afterQuota = await account()
      .then((value) => value.quota)
      .catch(() => null);
    evidence.schemeRuns = await Promise.all(
      [...runs].map(async (id) => {
        const value = runResultSchema.parse(
          await browserJson(page, `/api/v1/design-schemes/runs/${id}`),
        );
        return value;
      }),
    ).catch(() => ({ unread: [...runs] }));
    evidence.agentExecutions = await Promise.all(
      [...agents].map(async (id) =>
        designSchemeAgentSessionSchema.parse(
          await browserJson(page, `/api/v1/design-schemes/agent/executions/${id}`),
        ),
      ),
    ).catch(() => ({ unread: [...agents] }));
    evidence.requests = events;
    // Account delta is an observation, not fabricated per-call settlement.
    await info.attach('real-account-journey', {
      body: JSON.stringify(evidence),
      contentType: 'application/json',
    });
  }
});
