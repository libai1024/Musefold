import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type BrowserContext, type TestInfo } from '@playwright/test';
import {
  designSchemeDetailSchema,
  startDesignSchemeAgentInputSchema,
  type StartDesignSchemeAgentInput,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import {
  connectExchangeBrowser,
  loginExchangeBrowser,
  importExchangeBrowser,
  qualifyExchangeBrowser,
  browserJson,
} from './package-exchange-browser';
import { seedOnboardingCompleted } from './onboarding-helpers';

const prefix = '/api/v1/design-schemes/agent';
async function drain(context: BrowserContext) {
  for (const page of context.pages()) await page.goto('about:blank');
  await context.unrouteAll({ behavior: 'wait' });
}
async function formalBase(page: Page, service: AgentBrowserProcess, info: TestInfo) {
  await loginExchangeBrowser(page, 'modify-owner@example.test');
  const file = info.outputPath('pre-existing-base.musefold.design');
  await writeFile(file, Buffer.from(await service.basePackage(), 'base64'));
  const imported = await importExchangeBrowser(page, file);
  // Pre-existing formal base only: actual import/cover/formalize, SQL historical trial fixture.
  // No successful trial or formal status will ever be seeded for the modified Agent result.
  await qualifyExchangeBrowser(page, service, imported.summary.id);
  return detail(page, imported.summary.id);
}
async function detail(page: Page, id: string, revision?: string) {
  const query = revision
    ? `?revisionKind=working-draft&revisionId=${encodeURIComponent(revision)}`
    : '';
  return designSchemeDetailSchema.parse(
    await browserJson(page, `/api/v1/design-schemes/${id}${query}`),
  );
}
async function openModify(page: Page, instruction = '保留图片与结构，改为柔和水彩') {
  await page.getByTestId('runtime-scheme-modify').click();
  await expect(page.getByTestId('composer-prompt')).toBeVisible();
  await page.getByTestId('composer-prompt').fill(instruction);
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('scheme-agent-dialog')).toContainText('修改云端方案');
  await page.getByTestId('scheme-agent-model-offer').click();
  await expect(page.getByTestId('scheme-agent-authorization')).toContainText(
    '本次最多 1 次模型调用',
  );
}
async function recover(page: Page, id: string) {
  await page.goto('/design-schemes');
  await page.reload();
  await page.getByTestId('scheme-agent-history-open').click();
  await page.getByTestId(`scheme-agent-recover-${id}`).click();
}
async function rename(page: Page, id: string, version: number) {
  return browserJson(page, '/api/v1/design-schemes/rename', {
    schemeId: id,
    name: '另一个页面的新名称',
    expectedVersion: version,
  });
}

test('actual cloud modify preserves the formal revision, recovers lost acceptance, and revises the exact working draft', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires actual PG/BA/Agent and controlled model/S3; pre-existing formal trial is seeded',
  );
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    const backend = await service.ready;
    await connectExchangeBrowser(context, backend.baseUrl);
    const base = await formalBase(page, service, info);
    expect(base.summary.status).toBe('formal');
    await service.mode('hold');
    let request: StartDesignSchemeAgentInput | undefined;
    await context.route(`**${prefix}/executions`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      request = startDesignSchemeAgentInputSchema.parse(route.request().postDataJSON());
      const response = await route.fetch({ url: `${backend.baseUrl}${prefix}/executions` });
      expect(response.status()).toBe(202);
      return route.abort('failed');
    });
    await openModify(page);
    expect((await service.snapshot()).modelCalls).toHaveLength(0);
    await page
      .getByTestId('scheme-agent-dialog')
      .screenshot({ path: info.outputPath('modify-authorization.png') });
    // Closing before consent leaves the user instruction and never sends a request.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('composer-prompt')).toHaveValue('保留图片与结构，改为柔和水彩');
    expect((await service.snapshot()).sessions).toHaveLength(0);
    await page.getByTestId('composer-submit').click();
    await page.getByTestId('scheme-agent-model-offer').click();
    await page.getByTestId('scheme-agent-authorize-modify').click();
    await expect.poll(async () => (await service.snapshot()).modelCalls.length).toBe(1);
    if (request?.operation !== 'modify') throw new Error('Missing accepted modification');
    expect(request.input).toMatchObject({
      schemeId: base.summary.id,
      baseRevisionId: base.document.revisionId,
      expectedVersion: base.summary.version,
    });
    const id = request.input.executionId;
    await page.keyboard.press('Escape');
    await recover(page, id);
    const second = await context.newPage();
    await seedOnboardingCompleted(second);
    await recover(second, id);
    const before = await service.snapshot();
    await context.unroute(`**${prefix}/executions`);
    await browserJson(second, `${prefix}/executions`, request);
    const replay = await service.snapshot();
    expect(replay.jobs).toEqual(before.jobs);
    expect(replay.calls).toEqual(before.calls);
    expect(replay.modelDiscovery).toBe(before.modelDiscovery);
    expect(replay.githubRequests).toBe(before.githubRequests);
    await service.release();
    await expect(second.getByTestId('scheme-agent-open-result')).toBeVisible({ timeout: 20000 });
    await second.getByTestId('scheme-agent-open-result').click();
    await expect(second.getByTestId('runtime-scheme-working-draft')).toBeVisible();
    const after = await detail(second, base.summary.id);
    expect(after.document).toEqual(base.document);
    expect(after.summary.currentRevisionId).toBe(base.document.revisionId);
    expect(after.summary.status).toBe('formal');
    if (!after.summary.workingDraftRevisionId) throw new Error('Missing working draft');
    const firstDraft = await detail(second, base.summary.id, after.summary.workingDraftRevisionId);
    expect(firstDraft.document.parentRevisionId).toBe(base.document.revisionId);
    expect(firstDraft.document.assetIds.slice().sort()).toEqual(
      base.document.assetIds.slice().sort(),
    );
    await second
      .getByTestId('runtime-scheme-detail')
      .screenshot({ path: info.outputPath('modify-working-draft.png') });
    // The base's historical qualification cannot qualify this newly modified revision.
    await second.getByTestId('runtime-scheme-promote-working-draft').click();
    await expect(second.getByText('还不能更新正式版本', { exact: true })).toBeVisible();
    expect((await detail(second, base.summary.id)).document).toEqual(base.document);
    await page.close();
    await service.mode('normal');
    await openModify(second, '继续调整待验证版本的文字层次');
    let nextRequest: StartDesignSchemeAgentInput | undefined;
    second.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === `${prefix}/executions`)
        nextRequest = startDesignSchemeAgentInputSchema.parse(r.postDataJSON());
    });
    await second.getByTestId('scheme-agent-authorize-modify').click();
    await expect(second.getByTestId('scheme-agent-open-result')).toBeVisible({ timeout: 20000 });
    await expect(second.getByTestId('composer-prompt')).toHaveValue('');
    if (nextRequest?.operation !== 'modify') throw new Error('Missing second modification');
    expect(nextRequest.input).toMatchObject({
      baseRevisionId: firstDraft.document.revisionId,
      expectedVersion: after.summary.version,
    });
    const finalDetail = await detail(second, base.summary.id);
    if (!finalDetail.summary.workingDraftRevisionId) throw new Error('Missing latest draft');
    const latest = await detail(
      second,
      base.summary.id,
      finalDetail.summary.workingDraftRevisionId,
    );
    expect(latest.document.parentRevisionId).toBe(firstDraft.document.revisionId);
    expect(finalDetail.document).toEqual(base.document);
    const final = await service.snapshot();
    expect(final.schemes).toHaveLength(1);
    expect(final.sessions).toHaveLength(2);
    expect(final.calls).toHaveLength(2);
    expect(
      final.calls.every((call) => call.status === 'completed' && call.role === 'reviser'),
    ).toBe(true);
    expect(final.authorizations.map((a) => a.max_calls)).toEqual([1, 1]);
    await info.attach('modify-real-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        final,
        baseRevision: base.document.revisionId,
        firstDraft: firstDraft.document.revisionId,
        latest: latest.document.revisionId,
        controlled:
          'New API/text/GitHub/S3; only pre-existing imported base has SQL historical trial, no new image trial or production acceptance',
      }),
    });
  } finally {
    await drain(context);
    await service.dispose();
  }
});

test('actual cloud modify rejects a changed version before sending any text call and keeps the instruction', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires actual PG/BA/Agent with controlled upstream',
  );
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    const base = await formalBase(page, service, info);
    await openModify(page);
    await rename(page, base.summary.id, base.summary.version);
    await page.getByTestId('scheme-agent-authorize-modify').click();
    await expect(page.getByTestId('scheme-agent-dialog')).toContainText('本次修改未提交');
    await expect(page.getByTestId('scheme-agent-replay')).toHaveCount(0);
    expect((await service.snapshot()).modelCalls).toHaveLength(0);
    expect((await service.snapshot()).sessions).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('composer-prompt')).toHaveValue('保留图片与结构，改为柔和水彩');
    const after = await detail(page, base.summary.id);
    expect(after.summary.name).toBe('另一个页面的新名称');
    expect(after.summary.workingDraftRevisionId).toBeNull();
  } finally {
    await drain(context);
    await service.dispose();
  }
});

for (const fault of ['version-conflict', 'cancel', 'revoke', 'unknown'] as const) {
  test(`actual cloud modify ${fault} after dispatch cannot overwrite the formal version or resend`, async ({
    page,
    context,
  }, info) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires actual PG/BA/Agent with controlled upstream',
    );
    test.setTimeout(180000);
    const service = new AgentBrowserProcess();
    try {
      await connectExchangeBrowser(context, (await service.ready).baseUrl);
      const base = await formalBase(page, service, info);
      await service.mode(fault === 'unknown' ? 'drop' : 'hold');
      await openModify(page);
      await page.getByTestId('scheme-agent-authorize-modify').click();
      await expect.poll(async () => (await service.snapshot()).modelCalls.length).toBe(1);
      const id = (await service.snapshot()).sessions[0].execution_id;
      if (fault === 'version-conflict') await rename(page, base.summary.id, base.summary.version);
      if (fault === 'cancel') {
        await page.getByRole('button', { name: '取消此任务', exact: true }).click();
        await page.getByRole('button', { name: '确认取消任务', exact: true }).click();
        await expect(page.getByTestId('scheme-agent-session')).toContainText('已取消');
      }
      if (fault === 'revoke') await service.revoke();
      await service.release();
      await expect
        .poll(async () => (await service.snapshot()).sessions[0].status, { timeout: 20000 })
        .toBe(fault === 'cancel' ? 'cancelled' : 'blocked');
      await page.getByTestId('scheme-agent-refresh').click();
      if (fault === 'revoke') await expect(page.getByTestId('scheme-agent-session')).toHaveCount(0);
      else {
        await expect(page.getByTestId('scheme-agent-session')).toContainText(
          fault === 'cancel'
            ? '已取消'
            : fault === 'unknown'
              ? '模型调用结果尚不确定'
              : '方案版本已经变化',
        );
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('composer-prompt')).toHaveValue(
          '保留图片与结构，改为柔和水彩',
        );
        await recover(page, id);
        await page.getByTestId('scheme-agent-refresh').click();
      }
      await expect(page.getByTestId('scheme-agent-open-result')).toHaveCount(0);
      const final = await service.snapshot();
      expect(final.modelCalls).toHaveLength(1);
      expect(final.calls).toHaveLength(1);
      expect(final.schemes).toHaveLength(1);
      expect(final.schemes[0].current_revision_id).toBe(base.document.revisionId);
      expect(final.schemes[0].working_draft_revision_id).toBeNull();
      expect(final.schemes[0].status).toBe('formal');
      if (fault === 'cancel' || fault === 'unknown')
        expect(final.sessions[0].text.cost).toBe('unknown');
      await info.attach('modify-fault-evidence', {
        contentType: 'application/json',
        body: JSON.stringify({ fault, final }),
      });
    } finally {
      await drain(context);
      await service.dispose();
    }
  });
}
