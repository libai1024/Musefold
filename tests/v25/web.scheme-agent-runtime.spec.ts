import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  designSchemeDetailSchema,
  startDesignSchemeAgentInputSchema,
  type StartDesignSchemeAgentInput,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import {
  connectExchangeBrowser,
  loginExchangeBrowser,
  browserJson,
} from './package-exchange-browser';
import { seedOnboardingCompleted } from './onboarding-helpers';

// Drain every active forwarding callback before terminating the backend it uses.
async function drainBrowser(context: BrowserContext) {
  for (const page of context.pages()) await page.goto('about:blank');
  await context.unrouteAll({ behavior: 'wait' });
}

const prefix = '/api/v1/design-schemes/agent';
async function openCreate(page: Page, source: boolean) {
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-idea').click();
  await page
    .getByTestId('composer-prompt')
    .fill(
      `黑白海报${source ? ' https://github.com/example/design https://github.com/example/layout' : ''}`,
    );
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('scheme-agent-dialog')).toBeVisible();
}
async function recover(page: Page, id: string) {
  await page.goto('/design-schemes');
  await page.reload();
  await page.getByTestId('scheme-agent-history-open').click();
  await page.getByTestId(`scheme-agent-recover-${id}`).click();
}

for (const source of [false, true]) {
  test(`actual Agent ${source ? 'GitHub source confirmation' : 'brief-only'} creation survives lost acceptance and two-page recovery`, async ({
    page,
    context,
  }, info) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires actual Hono/Better Auth/PG/Graphile with controlled external services',
    );
    test.setTimeout(180000);
    const service = new AgentBrowserProcess();
    try {
      const backend = await service.ready;
      await connectExchangeBrowser(context, backend.baseUrl);
      let original: StartDesignSchemeAgentInput | undefined;
      let starts = 0;
      await context.route(`**${prefix}/executions`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        starts++;
        original = startDesignSchemeAgentInputSchema.parse(route.request().postDataJSON());
        const response = await route.fetch({ url: `${backend.baseUrl}${prefix}/executions` });
        expect(response.status()).toBe(202);
        // Lose only the actual committed acceptance reply; no fabricated state or data.
        return route.abort('failed');
      });
      await loginExchangeBrowser(page, 'agent-runtime@example.test');
      await service.mode('hold-compiler');
      await openCreate(page, source);
      expect((await service.snapshot()).modelCalls).toHaveLength(0);
      await page.getByTestId('scheme-agent-model-offer').click();
      await expect(page.getByTestId('scheme-agent-authorization')).toContainText(
        `本次最多 ${source ? 3 : 1} 次模型调用`,
      );
      expect((await service.snapshot()).sessions).toHaveLength(0);
      expect((await service.snapshot()).modelCalls).toHaveLength(0);
      await page.getByTestId('scheme-agent-authorize-create').click();
      await expect.poll(async () => (await service.snapshot()).sessions.length).toBe(1);
      if (!original) throw new Error('Missing accepted original intent');
      const id = original.input.executionId;
      if (source) {
        await expect(page.getByTestId('scheme-agent-source')).toContainText('许可证：未声明');
        expect((await service.snapshot()).modelCalls).toHaveLength(0);
      } else {
        await expect.poll(async () => (await service.snapshot()).modelCalls.length).toBe(1);
      }
      await expect(page.getByTestId('scheme-agent-open-result')).toHaveCount(0);
      await expect(page.getByTestId('composer-prompt')).toHaveValue(/黑白海报/);
      await page.keyboard.press('Escape');
      await recover(page, id);
      const second = await context.newPage();
      await seedOnboardingCompleted(second);
      await recover(second, id);
      if (source) {
        await expect(second.getByTestId('scheme-agent-source')).toContainText('a'.repeat(40));
        await second
          .getByTestId('scheme-agent-dialog')
          .screenshot({ path: info.outputPath('actual-agent-source.png') });
        await second.getByTestId('scheme-agent-confirm-source').click();
        await expect(second.getByTestId('scheme-agent-source')).toContainText('example/layout');
        expect((await service.snapshot()).modelCalls).toHaveLength(0);
        await second.getByTestId('scheme-agent-confirm-source').click();
      }
      const expectedCalls = source ? 3 : 1;
      await expect
        .poll(async () => (await service.snapshot()).modelCalls.length, { timeout: 20000 })
        .toBe(expectedCalls);
      expect((await service.snapshot()).schemes).toHaveLength(0);
      const beforeReplay = await service.snapshot();
      expect(beforeReplay.jobs).toHaveLength(1);
      // Replay via the original production write endpoint after losing local dialog state.
      await context.unroute(`**${prefix}/executions`);
      const replay = await browserJson(second, `${prefix}/executions`, original);
      expect(replay.executionId).toBe(id);
      const afterReplay = await service.snapshot();
      expect(afterReplay.sessions).toHaveLength(1);
      expect(afterReplay.calls).toEqual(beforeReplay.calls);
      expect(afterReplay.jobs).toEqual(beforeReplay.jobs);
      expect(afterReplay.modelDiscovery).toBe(beforeReplay.modelDiscovery);
      expect(afterReplay.githubRequests).toBe(beforeReplay.githubRequests);
      await service.release();
      await expect(second.getByTestId('scheme-agent-open-result')).toBeVisible({ timeout: 20000 });
      await page.getByTestId('scheme-agent-refresh').click();
      await expect(page.getByTestId('scheme-agent-session')).toContainText('草稿已完成');
      await second.getByTestId('scheme-agent-open-result').click();
      await expect(second.getByTestId('runtime-scheme-detail')).toHaveAttribute(
        'data-status',
        'draft',
      );
      const schemeId = new URL(second.url()).searchParams.get('scheme');
      const detail = designSchemeDetailSchema.parse(
        await browserJson(second, `/api/v1/design-schemes/${schemeId}`),
      );
      await second
        .getByTestId('runtime-scheme-detail')
        .screenshot({ path: info.outputPath('actual-agent-draft.png') });
      expect(detail.document.createdBy).toBe('agent');
      expect(
        detail.document.sources.filter((entry) => entry.kind.startsWith('github-')),
      ).toHaveLength(source ? 2 : 0);
      expect(detail.document.sources.some((entry) => entry.kind === 'user-brief')).toBe(true);
      expect(detail.summary.hasSuccessfulTrial).toBe(false);
      const final = await service.snapshot();
      expect(final.sessions).toHaveLength(1);
      expect(final.schemes).toHaveLength(1);
      expect(final.schemes[0].id).toBe(detail.summary.id);
      expect(final.schemes[0].current_revision_id).toBe(detail.document.revisionId);
      expect(final.calls).toHaveLength(expectedCalls);
      expect(final.calls.every((call) => call.status === 'completed')).toBe(true);
      expect(final.authorizations).toEqual([{ execution_id: id, max_calls: expectedCalls }]);
      expect(final.modelCalls).toHaveLength(expectedCalls);
      expect(starts).toBe(1);
      await info.attach('actual-agent-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({
          final,
          real: 'production UI/client/Hono/Better Auth credential hooks/PG/Graphile/AWS SDK/text HTTP',
          controlled:
            'New API account, text model, GitHub and S3 upstream; no actual paid model or image trial',
        }),
      });
      await second.close();
    } finally {
      await drainBrowser(context);
      await service.dispose();
    }
  });
}

test('actual Agent cancellation before source consent stops both pages without model calls', async ({
  page,
  context,
}, info) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires disposable database');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    await loginExchangeBrowser(page, 'agent-cancel@example.test');
    await openCreate(page, true);
    await page.getByTestId('scheme-agent-model-offer').click();
    await page.getByTestId('scheme-agent-authorize-create').click();
    await expect(page.getByTestId('scheme-agent-source')).toBeVisible();
    const id = (await service.snapshot()).sessions[0].execution_id;
    const second = await context.newPage();
    await seedOnboardingCompleted(second);
    await recover(second, id);
    await second.getByRole('button', { name: '取消此任务', exact: true }).click();
    await second.getByRole('button', { name: '确认取消任务', exact: true }).click();
    await expect(second.getByTestId('scheme-agent-session')).toContainText('已取消');
    await page.getByTestId('scheme-agent-refresh').click();
    await expect(page.getByTestId('scheme-agent-session')).toContainText('已取消');
    await expect(page.getByTestId('scheme-agent-confirm-source')).toHaveCount(0);
    const final = await service.snapshot();
    expect(final.modelCalls).toHaveLength(0);
    expect(final.calls).toHaveLength(0);
    expect(final.schemes).toHaveLength(0);
    await info.attach('cancel-evidence', {
      contentType: 'application/json',
      body: JSON.stringify(final),
    });
    await second.close();
  } finally {
    await drainBrowser(context);
    await service.dispose();
  }
});

test('actual Agent rejects another owner and revoked authorization during an in-flight model call', async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires disposable database');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3399' });
  try {
    const backend = await service.ready;
    await connectExchangeBrowser(context, backend.baseUrl);
    await connectExchangeBrowser(otherContext, backend.baseUrl);
    await loginExchangeBrowser(page, 'agent-authority@example.test');
    const other = await otherContext.newPage();
    await loginExchangeBrowser(other, 'other-authority@example.test');
    await service.mode('hold');
    await openCreate(page, false);
    await page.getByTestId('scheme-agent-model-offer').click();
    await page.getByTestId('scheme-agent-authorize-create').click();
    await expect.poll(async () => (await service.snapshot()).modelCalls.length).toBe(1);
    const id = (await service.snapshot()).sessions[0].execution_id;
    // Read the actual owner-scoped history and execution; no injected identity header.
    expect((await browserJson(other, `${prefix}/executions`)).items).toEqual([]);
    const denied = await other.evaluate(
      async (path) => (await fetch(path)).status,
      `${prefix}/executions/${id}`,
    );
    expect(denied).toBe(404);
    await service.revoke();
    await page.getByTestId('scheme-agent-refresh').click();
    await expect(page.getByTestId('scheme-agent-session')).toHaveCount(0);
    await expect(page.getByTestId('scheme-agent-open-result')).toHaveCount(0);
    await service.release();
    await expect
      .poll(async () => (await service.snapshot()).sessions[0].status, { timeout: 20000 })
      .toBe('blocked');
    const final = await service.snapshot();
    expect(final.modelCalls).toHaveLength(1);
    expect(final.schemes).toHaveLength(0);
    await info.attach('revocation-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({ final, denied }),
    });
  } finally {
    await drainBrowser(otherContext);
    await otherContext.close();
    await drainBrowser(context);
    await service.dispose();
  }
});

test('actual Agent uses selected owner history material and preserves the resulting image in its draft', async ({
  page,
  context,
}, info) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires disposable database');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    const email = 'agent-history@example.test';
    await loginExchangeBrowser(page, email);
    // AccountSummary.id is the upstream payer, not the local Better Auth principal.
    const principalId = await page.evaluate(async () => {
      const response = await fetch('/api/auth/get-session');
      if (!response.ok) throw new Error('Missing authenticated principal');
      return (await response.json()).user.id as string;
    });
    const material = await service.seedHistory(principalId);
    await page.getByTestId('scheme-create').click();
    await page.getByTestId('scheme-create-option-history').click();
    await page.getByTestId(`history-pick-${material.runId}`).click();
    await page.getByTestId('history-source-confirm').click();
    await page.getByTestId('composer-submit').click();
    await page.getByTestId('scheme-agent-model-offer').click();
    await expect(page.getByTestId('scheme-agent-dialog')).toContainText('1 项历史素材');
    await page.getByTestId('scheme-agent-authorize-create').click();
    await expect(page.getByTestId('scheme-agent-open-result')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('composer-prompt')).toHaveValue('');
    await page.getByTestId('scheme-agent-open-result').click();
    await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
    await page
      .getByTestId('runtime-scheme-detail')
      .screenshot({ path: info.outputPath('history-agent-draft.png') });
    const id = new URL(page.url()).searchParams.get('scheme');
    const detail = designSchemeDetailSchema.parse(
      await browserJson(page, `/api/v1/design-schemes/${id}`),
    );
    expect(detail.document.sources.some((source) => source.kind === 'history-image')).toBe(true);
    expect(detail.assets.some((asset) => asset.contentHash === material.hash)).toBe(true);
    expect(detail.summary.hasSuccessfulTrial).toBe(false);
    const final = await service.snapshot();
    expect(final.schemes).toHaveLength(1);
    expect(final.sessions).toHaveLength(1);
    expect(final.modelCalls).toHaveLength(1);
    await info.attach('history-material-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        material,
        final,
        controlledHistory:
          'PG generation history and S3 PNG seeded as pre-existing material; not a newly generated image trial',
      }),
    });
  } finally {
    await drainBrowser(context);
    await service.dispose();
  }
});

for (const scenario of ['cancel-after-send', 'unknown-upstream'] as const) {
  test(`actual Agent ${scenario} preserves the original paid call without a draft or automatic resend`, async ({
    page,
    context,
  }, info) => {
    test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires disposable database');
    test.setTimeout(180000);
    const service = new AgentBrowserProcess();
    try {
      await connectExchangeBrowser(context, (await service.ready).baseUrl);
      await loginExchangeBrowser(page, `${scenario}@example.test`);
      await service.mode(scenario === 'cancel-after-send' ? 'hold' : 'drop');
      await openCreate(page, false);
      await page.getByTestId('scheme-agent-model-offer').click();
      await page.getByTestId('scheme-agent-authorize-create').click();
      await expect.poll(async () => (await service.snapshot()).modelCalls.length).toBe(1);
      const id = (await service.snapshot()).sessions[0].execution_id;
      if (scenario === 'cancel-after-send') {
        await page.getByRole('button', { name: '取消此任务', exact: true }).click();
        await page.getByRole('button', { name: '确认取消任务', exact: true }).click();
        await expect(page.getByTestId('scheme-agent-session')).toContainText('已取消');
        await service.release();
      } else {
        await expect(page.getByTestId('scheme-agent-session')).toContainText(
          '模型调用结果尚不确定',
        );
      }
      await page.keyboard.press('Escape');
      await recover(page, id);
      await expect(page.getByTestId('scheme-agent-session')).toContainText(
        scenario === 'cancel-after-send' ? '已取消' : '模型调用结果尚不确定',
      );
      await page.getByTestId('scheme-agent-refresh').click();
      await expect(page.getByTestId('scheme-agent-open-result')).toHaveCount(0);
      await expect.poll(async () => (await service.snapshot()).jobs.length).toBe(0);
      const final = await service.snapshot();
      expect(final.sessions).toHaveLength(1);
      expect(final.calls).toHaveLength(1);
      expect(final.modelCalls).toHaveLength(1);
      expect(final.schemes).toHaveLength(0);
      expect(final.sessions[0].text.cost).toBe('unknown');
      await info.attach(scenario, { contentType: 'application/json', body: JSON.stringify(final) });
    } finally {
      await drainBrowser(context);
      await service.dispose();
    }
  });
}
