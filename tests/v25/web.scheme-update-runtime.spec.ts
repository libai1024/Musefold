import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemeAgentSessionSchema,
  startDesignSchemeAgentInputSchema,
  authorizeDesignSchemeUpdateInputSchema,
  type StartDesignSchemeAgentInput,
  type AuthorizeDesignSchemeUpdateInput,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import {
  connectExchangeBrowser,
  loginExchangeBrowser,
  browserJson,
} from './package-exchange-browser';
import { seedOnboardingCompleted } from './onboarding-helpers';

const prefix = '/api/v1/design-schemes/agent';
async function drain(context: BrowserContext) {
  for (const page of context.pages()) await page.goto('about:blank');
  await context.unrouteAll({ behavior: 'wait' });
}
async function detail(page: Page, id: string) {
  return designSchemeDetailSchema.parse(await browserJson(page, `/api/v1/design-schemes/${id}`));
}
async function base(page: Page, service: AgentBrowserProcess, sources = true) {
  await loginExchangeBrowser(page, 'update-owner@example.test');
  await service.githubVersion('base');
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-idea').click();
  await page
    .getByTestId('composer-prompt')
    .fill(
      `海报${sources ? ' https://github.com/example/design https://github.com/example/layout' : ''}`,
    );
  await page.getByTestId('composer-submit').click();
  await page.getByTestId('scheme-agent-model-offer').click();
  await page.getByTestId('scheme-agent-authorize-create').click();
  if (sources) {
    await expect(page.getByTestId('scheme-agent-source')).toContainText('example/design');
    await page.getByTestId('scheme-agent-confirm-source').click();
    await expect(page.getByTestId('scheme-agent-source')).toContainText('example/layout');
    await page.getByTestId('scheme-agent-confirm-source').click();
  }
  await page.getByTestId('scheme-agent-open-result').click({ timeout: 20000 });
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('scheme');
  if (!id) throw new Error('Missing real Agent draft route');
  const result = await detail(page, id);
  expect(result.document.repositoryImages ?? []).toHaveLength(sources ? 2 : 0);
  return result;
}
async function openCheck(page: Page) {
  await page.getByTestId('runtime-scheme-menu').click();
  await page.getByTestId('runtime-scheme-menu-check-update').click();
  await expect(page.getByTestId('scheme-agent-check-update')).toBeVisible();
}
async function recover(page: Page, id: string) {
  await page.goto('/design-schemes');
  await page.reload();
  await page.getByTestId('scheme-agent-history-open').click();
  await page.getByTestId(`scheme-agent-recover-${id}`).click();
}
async function confirmChange(page: Page) {
  await expect(page.getByTestId('scheme-agent-source')).toContainText('example/design');
  await expect(page.getByTestId('scheme-agent-source')).toContainText('编译仍需单独同意费用');
  await page.getByTestId('scheme-agent-confirm-source').click();
  await expect(page.getByTestId('scheme-agent-session')).toContainText('等待编译授权');
}
async function offer(page: Page) {
  await page.getByTestId('scheme-agent-model-offer').click();
  await expect(page.getByTestId('scheme-agent-authorization')).toContainText(
    '本次最多 2 次模型调用',
  );
}

for (const sources of [false, true]) {
  test(`actual free update ${sources ? 'unchanged' : 'no-source'} inspection never authorizes text`, async ({
    page,
    context,
  }) => {
    test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires actual isolated backend');
    test.setTimeout(180000);
    const service = new AgentBrowserProcess();
    try {
      await connectExchangeBrowser(context, (await service.ready).baseUrl);
      const original = await base(page, service, sources);
      const before = await service.snapshot();
      await openCheck(page);
      expect((await service.snapshot()).sessions).toHaveLength(1);
      await page.getByTestId('scheme-agent-check-update').click();
      await expect(page.getByTestId('scheme-agent-session')).toContainText(
        sources ? '来源没有更新' : '没有可检查的来源',
      );
      await expect(page.getByTestId('scheme-agent-model-offer')).toHaveCount(0);
      const id = (await service.snapshot()).sessions[1].execution_id;
      await page.keyboard.press('Escape');
      await recover(page, id);
      await page.getByTestId('scheme-agent-refresh').click();
      const after = await service.snapshot();
      expect(after.sessions).toHaveLength(2);
      expect(after.modelCalls).toEqual(before.modelCalls);
      expect(after.modelDiscovery).toBe(before.modelDiscovery);
      expect(after.authorizations).toEqual(before.authorizations);
      expect((await detail(page, original.summary.id)).document).toEqual(original.document);
    } finally {
      try {
        await drain(context);
      } finally {
        await service.dispose();
      }
    }
  });
}

test('actual changed-source update separates free consent, survives lost replies, and preserves unchanged images', async ({
  page,
  context,
}, info) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires actual isolated backend');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    const backend = await service.ready;
    await connectExchangeBrowser(context, backend.baseUrl);
    const original = await base(page, service);
    const initial = await service.snapshot();
    await service.githubVersion('changed');
    let free: StartDesignSchemeAgentInput | undefined;
    await context.route(`**${prefix}/executions`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      free = startDesignSchemeAgentInputSchema.parse(route.request().postDataJSON());
      const response = await route.fetch({ url: `${backend.baseUrl}${prefix}/executions` });
      expect(response.status()).toBe(202);
      return route.abort('failed');
    });
    await openCheck(page);
    await page.getByTestId('scheme-agent-check-update').click();
    await expect(page.getByTestId('scheme-agent-source')).toBeVisible();
    if (free?.operation !== 'check-update') throw new Error('Missing free request');
    expect(free).toEqual({
      operation: 'check-update',
      input: {
        executionId: free.input.executionId,
        schemeId: original.summary.id,
        baseRevisionId: original.document.revisionId,
        expectedVersion: original.summary.version,
      },
    });
    const id = free.input.executionId;
    expect((await service.snapshot()).modelCalls).toEqual(initial.modelCalls);
    await expect(page.getByTestId('scheme-agent-dialog')).not.toContainText('操作结果尚未核对');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
    await page
      .getByTestId('scheme-agent-dialog')
      .screenshot({ path: info.outputPath('update-source.png') });
    await page.keyboard.press('Escape');
    await recover(page, id);
    const second = await context.newPage();
    await seedOnboardingCompleted(second);
    await recover(second, id);
    await context.unroute(`**${prefix}/executions`);
    const beforeReplay = await service.snapshot();
    await browserJson(second, `${prefix}/executions`, free);
    expect((await service.snapshot()).githubRequests).toBe(beforeReplay.githubRequests);
    await confirmChange(second);
    const freeDone = await service.snapshot();
    expect(freeDone.modelCalls).toEqual(initial.modelCalls);
    expect(freeDone.authorizations).toEqual(initial.authorizations);
    await offer(second);
    await second
      .getByTestId('scheme-agent-dialog')
      .screenshot({ path: info.outputPath('update-authorization.png') });
    // Closing after source confirmation/offer still does not grant paid execution.
    await second.keyboard.press('Escape');
    await recover(second, id);
    await offer(second);
    expect((await service.snapshot()).modelCalls).toEqual(initial.modelCalls);
    await service.mode('hold-compiler');
    let authorization: AuthorizeDesignSchemeUpdateInput | undefined;
    await context.route(`**${prefix}/authorize-update`, async (route) => {
      authorization = authorizeDesignSchemeUpdateInputSchema.parse(route.request().postDataJSON());
      const response = await route.fetch({ url: `${backend.baseUrl}${prefix}/authorize-update` });
      expect(response.status()).toBe(200);
      return route.abort('failed');
    });
    await second.getByTestId('scheme-agent-authorize-check-update').click();
    await expect
      .poll(async () => (await service.snapshot()).modelCalls.length)
      .toBe(initial.modelCalls.length + 2);
    if (!authorization) throw new Error('Missing explicit update authorization');
    expect(authorization.text.maxModelCalls).toBe(2);
    const paid = await service.snapshot();
    await context.unroute(`**${prefix}/authorize-update`);
    await browserJson(second, `${prefix}/authorize-update`, authorization);
    const replayed = await service.snapshot();
    expect(replayed.jobs).toEqual(paid.jobs);
    expect(replayed.calls).toEqual(paid.calls);
    expect(replayed.modelDiscovery).toBe(paid.modelDiscovery);
    expect(replayed.githubRequests).toBe(paid.githubRequests);
    await second.reload();
    await second.getByTestId('scheme-agent-history-open').click();
    await second.getByTestId(`scheme-agent-recover-${id}`).click();
    await service.release();
    await second.getByTestId('scheme-agent-open-result').click({ timeout: 20000 });
    const result = await detail(second, original.summary.id);
    expect(result.summary.status).toBe('draft');
    expect(result.summary.hasSuccessfulTrial).toBe(false);
    expect(result.document.revisionId).not.toBe(original.document.revisionId);
    expect(result.document.parentRevisionId).toBe(original.document.revisionId);
    const byRepo = (value: typeof result, repo: string) =>
      value.sourceSnapshots.find((item) => item.repositoryUrl?.endsWith(repo));
    expect(byRepo(result, '/layout')).toEqual(byRepo(original, '/layout'));
    expect(byRepo(result, '/design')?.commitHash).toBe('b'.repeat(40));
    expect(byRepo(result, '/design')?.contentHash).not.toBe(
      byRepo(original, '/design')?.contentHash,
    );
    const oldLayout = original.document.repositoryImages?.find(
      (item) => item.snapshotId === byRepo(original, '/layout')?.id,
    );
    expect(oldLayout).toBeDefined();
    expect(result.document.repositoryImages).toContainEqual(oldLayout);
    const final = await service.snapshot();
    expect(final.sessions).toHaveLength(2);
    expect(final.schemes).toHaveLength(1);
    expect(
      final.calls
        .filter((call) => call.execution_id === id)
        .map((call) => call.role)
        .sort(),
    ).toEqual(['analyst', 'compiler']);
    expect(final.authorizations.find((entry) => entry.execution_id === id)?.max_calls).toBe(2);
    await second
      .getByTestId('runtime-scheme-detail')
      .screenshot({ path: info.outputPath('update-result.png') });
    await info.attach('actual-update-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        final,
        real: 'shared UI/client/BA/Hono/PG/Graphile/text HTTP and real source/assets',
        controlled: 'NewAPI/GitHub/text model/S3; no image trial or SQL qualification',
      }),
    });
    await second.close();
  } finally {
    try {
      await drain(context);
    } finally {
      await service.dispose();
    }
  }
});

test('actual source refusal cancels free inspection without creating paid authorization', async ({
  page,
  context,
}) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires actual isolated backend');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    const original = await base(page, service);
    const before = await service.snapshot();
    await service.githubVersion('changed');
    await openCheck(page);
    await page.getByTestId('scheme-agent-check-update').click();
    await expect(page.getByTestId('scheme-agent-source')).toBeVisible();
    await page.getByRole('button', { name: '取消此任务', exact: true }).click();
    await page.getByRole('button', { name: '确认取消任务', exact: true }).click();
    await expect(page.getByTestId('scheme-agent-session')).toContainText('已取消');
    expect((await service.snapshot()).authorizations).toEqual(before.authorizations);
    expect((await service.snapshot()).modelCalls).toEqual(before.modelCalls);
    expect((await detail(page, original.summary.id)).document).toEqual(original.document);
  } finally {
    try {
      await drain(context);
    } finally {
      await service.dispose();
    }
  }
});

for (const fault of ['version-conflict', 'cancel', 'revoke', 'unknown'] as const) {
  test(`actual update ${fault} preserves original content and never resends uncertain calls`, async ({
    page,
    context,
  }) => {
    test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires actual isolated backend');
    test.setTimeout(180000);
    const service = new AgentBrowserProcess();
    try {
      await connectExchangeBrowser(context, (await service.ready).baseUrl);
      const original = await base(page, service);
      const initial = await service.snapshot();
      await service.githubVersion('changed');
      await openCheck(page);
      await page.getByTestId('scheme-agent-check-update').click();
      await confirmChange(page);
      await offer(page);
      await service.mode(fault === 'unknown' ? 'drop' : 'hold');
      await page.getByTestId('scheme-agent-authorize-check-update').click();
      await expect
        .poll(async () => (await service.snapshot()).modelCalls.length)
        .toBe(initial.modelCalls.length + 1);
      const id = (await service.snapshot()).sessions[1].execution_id;
      if (fault === 'version-conflict')
        await browserJson(page, '/api/v1/design-schemes/rename', {
          schemeId: original.summary.id,
          name: '并发更新的新名称',
          expectedVersion: original.summary.version,
        });
      if (fault === 'cancel') {
        await page.getByRole('button', { name: '取消此任务', exact: true }).click();
        await page.getByRole('button', { name: '确认取消任务', exact: true }).click();
        await expect(page.getByTestId('scheme-agent-session')).toContainText('已取消');
      }
      if (fault === 'revoke') await service.revoke();
      await service.release();
      await expect
        .poll(
          async () =>
            (await service.snapshot()).sessions.find((entry) => entry.execution_id === id)?.status,
        )
        .toBe(fault === 'cancel' ? 'cancelled' : 'blocked');
      if (fault !== 'revoke') {
        await page.keyboard.press('Escape');
        await recover(page, id);
        await page.getByTestId('scheme-agent-refresh').click();
        const session = designSchemeAgentSessionSchema.parse(
          await browserJson(page, `${prefix}/executions/${id}`),
        );
        expect(session.text?.cost).toBe('unknown');
        expect((await detail(page, original.summary.id)).document).toEqual(original.document);
      } else {
        await page.getByTestId('scheme-agent-refresh').click();
        await expect(page.getByTestId('scheme-agent-session')).toHaveCount(0);
      }
      const after = await service.snapshot();
      expect(after.modelCalls).toHaveLength(initial.modelCalls.length + 1);
      expect(after.schemes[0].current_revision_id).toBe(original.document.revisionId);
      expect(after.schemes[0].working_draft_revision_id).toBeNull();
    } finally {
      try {
        await drain(context);
      } finally {
        await service.dispose();
      }
    }
  });
}

test('a version changed after opening free inspection is rejected without replacing the frozen basis', async ({
  page,
  context,
}) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires actual isolated backend');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    const original = await base(page, service, false);
    const before = await service.snapshot();
    await openCheck(page);
    await browserJson(page, '/api/v1/design-schemes/rename', {
      schemeId: original.summary.id,
      name: '检查前的新名称',
      expectedVersion: original.summary.version,
    });
    await page.getByTestId('scheme-agent-check-update').click();
    await expect(page.getByTestId('scheme-agent-dialog')).toContainText('本次检查未提交');
    await expect(page.getByTestId('scheme-agent-replay')).toHaveCount(0);
    await expect(page.getByTestId('scheme-agent-refresh')).toHaveCount(0);
    const after = await service.snapshot();
    expect(after.sessions).toHaveLength(1);
    expect(after.modelCalls).toEqual(before.modelCalls);
    expect(after.authorizations).toEqual(before.authorizations);
    const current = await detail(page, original.summary.id);
    expect(current.summary.name).toBe('检查前的新名称');
    expect(current.document).toEqual(original.document);
  } finally {
    try {
      await drain(context);
    } finally {
      await service.dispose();
    }
  }
});
