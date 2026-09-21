import { test, expect, type BrowserContext } from '@playwright/test';
import {
  designSchemeAgentSessionSchema,
  startDesignSchemeAgentInputSchema,
  designSchemeTextModelOfferSchema,
  createDesignSchemeResultSchema,
  type DesignSchemeAgentSession,
  type StartDesignSchemeAgentInput,
  type WorkbenchSession,
} from '@musefold/contracts';
import { seedOnboardingCompleted } from './onboarding-helpers';

// Production shared views and api-client; HTTP is a deterministic protocol fixture, not PG or a paid model.
async function protocolFixture(context: BrowserContext) {
  const now = '2026-09-09T00:00:00.000Z';
  const offer = designSchemeTextModelOfferSchema.parse({
    binding: {
      apiIssuer: 'https://api.example.test',
      principalId: 'owner',
      payer: { issuer: 'https://account.example.test', ownerId: 'payer' },
      credential: { ref: 'credential', version: 1 },
      providerId: 'cloud-agent',
      model: 'fixture-text',
      capabilities: { image: false, text: true },
      policyVersion: 'agent-text-v1',
    },
    maxModelCalls: 17,
    maxOutputTokens: 8192,
    cost: 'unknown',
  });
  let execution: DesignSchemeAgentSession | null = null;
  let workbench: WorkbenchSession | null = null;
  const starts: StartDesignSchemeAgentInput[] = [];
  const confirmations: unknown[] = [];
  let cancels = 0;
  let loseStartReply = true;
  let offers = 0;
  const result = createDesignSchemeResultSchema.parse({
    scheme: {
      id: 'created-scheme',
      name: '水彩海报方案',
      summary: '可重复使用的水彩风格',
      status: 'draft',
      sourcePresentation: 'musefold-created',
      sourceLabel: 'Musefold 创建',
      currentRevisionId: 'created-revision',
      fidelity: 'faithful',
      createdAt: now,
      updatedAt: now,
    },
    document: {
      schemaVersion: 1,
      schemeId: 'created-scheme',
      revisionId: 'created-revision',
      name: '水彩海报方案',
      summary: '可重复使用的水彩风格',
      fidelity: 'faithful',
      sources: [],
      sourceSnapshotIds: [],
      inputs: [],
      parameters: [],
      constraints: [],
      assetIds: [],
      promptProgram: [
        {
          id: 'module',
          order: 0,
          kind: 'input-template',
          template: '水彩海报',
          variables: [],
          sourceIds: [],
        },
      ],
      compilation: {
        compiledAt: now,
        model: { model: 'fixture-text' },
        adopted: [],
        omitted: [],
        warnings: [],
        trace: [],
      },
      parentRevisionId: null,
      createdBy: 'agent',
      createdAt: now,
    },
    trace: [],
  });
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    const reply = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    if (path === '/account/status')
      return reply({
        id: 'owner',
        username: 'fixture-owner',
        displayName: null,
        quota: 100,
        quotaUnit: '积分',
        canGenerate: true,
      });
    if (path === '/workbench/sessions') {
      if (method === 'GET') return reply({ items: workbench ? [workbench] : [], nextCursor: null });
      const body = request.postDataJSON();
      workbench = {
        id: 'workbench-original',
        title: body.title,
        draft: body.draft,
        version: 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
        latestJobStatus: null,
        latestJobFinishedAt: null,
      };
      return reply(workbench, 201);
    }
    if (path === '/workbench/sessions/workbench-original' && workbench) {
      if (method === 'PATCH') {
        workbench = { ...workbench, ...request.postDataJSON(), version: workbench.version + 1 };
      }
      return reply(workbench);
    }
    if (path === '/generations/providers')
      return reply([
        {
          id: 'cloud-default',
          label: '云生图',
          model: 'fixture-image',
          kind: 'cloud',
          available: true,
        },
      ]);
    if (path === '/generations' || path === '/prompts')
      return reply({ items: [], nextCursor: null });
    if (path === '/design-schemes/agent/text-model') {
      offers++;
      return reply(offer);
    }
    if (path === '/design-schemes/agent/executions') {
      if (method === 'GET')
        return reply({
          items: execution
            ? [
                {
                  executionId: execution.executionId,
                  operation: execution.operation,
                  status: execution.status,
                  version: execution.version,
                  createdAt: now,
                  expiresAt: execution.expiresAt,
                  schemeId: execution.result?.scheme.id ?? null,
                  schemeName: execution.result?.scheme.name ?? null,
                },
              ]
            : [],
          nextCursor: null,
        });
      const body = startDesignSchemeAgentInputSchema.parse(request.postDataJSON());
      starts.push(body);
      execution = designSchemeAgentSessionSchema.parse({
        executionId: body.input.executionId,
        operation: 'create',
        status: 'queued',
        version: 1,
        sourceCount: 1,
        confirmedSources: 0,
        pendingSource: null,
        blocker: null,
        result: null,
        createdAt: now,
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
      if (loseStartReply) {
        loseStartReply = false;
        return route.abort('failed');
      }
      return reply(execution, 202);
    }
    if (execution && path === `/design-schemes/agent/executions/${execution.executionId}`)
      return reply(execution);
    if (execution && path === `/design-schemes/agent/executions/${execution.executionId}/events`) {
      const after = Number(url.searchParams.get('afterSeq'));
      return reply({
        events: execution.version > after ? [{ seq: execution.version, session: execution }] : [],
        nextSeq: Math.max(after, execution.version),
      });
    }
    if (execution && path === '/design-schemes/agent/confirm-source') {
      confirmations.push(request.postDataJSON());
      execution = designSchemeAgentSessionSchema.parse({
        ...execution,
        status: 'completed',
        version: 3,
        confirmedSources: 1,
        pendingSource: null,
        result,
      });
      return reply(execution);
    }
    if (execution && path === '/design-schemes/agent/cancel') {
      cancels++;
      execution = {
        ...execution,
        status: 'cancelled',
        version: execution.version + 1,
        pendingSource: null,
        result: null,
      };
      return reply(execution);
    }
    if (path === '/design-schemes')
      return reply({ items: execution?.result ? [result.scheme] : [], nextCursor: null });
    if (path === '/design-schemes/created-scheme')
      return reply({
        summary: result.scheme,
        document: result.document,
        assets: [],
        sourceSnapshots: [],
      });
    return reply(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Fixture endpoint unavailable',
          requestId: 'fixture',
          retryable: false,
        },
      },
      404,
    );
  });
  return {
    starts,
    confirmations,
    offers: () => offers,
    cancels: () => cancels,
    id: () => execution?.executionId,
    prepareSource: () => {
      if (!execution) throw new Error('No original execution');
      execution = designSchemeAgentSessionSchema.parse({
        ...execution,
        status: 'confirmation-required',
        version: 2,
        pendingSource: {
          executionId: 'child-source',
          confirmationId: 'confirmation-frozen',
          status: 'ready',
          snapshotId: 'snapshot-frozen',
          contentHash: 'a'.repeat(64),
          expiresAt: execution.expiresAt,
          source: {
            repositoryUrl: 'https://github.com/fixture/watercolor/tree/main',
            name: '水彩规则来源',
            description: '',
            resolvedRef: 'main',
            commitHash: 'a'.repeat(40),
            textFileCount: 3,
            textNames: ['README.md'],
            imageFileCount: 2,
            license: 'MIT',
          },
        },
      });
    },
  };
}

test('explicit cloud create consent, lost response, close, reload and second-page source confirmation preserve one execution', async ({
  page,
  context,
}, info) => {
  const api = await protocolFixture(context);
  await seedOnboardingCompleted(page);
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-idea').click();
  await expect(page).toHaveURL(/\/workbench/);
  await page
    .getByTestId('composer-prompt')
    .fill('创建水彩海报 https://github.com/fixture/watercolor/tree/main');
  await page.getByTestId('composer-submit').click();
  const dialog = page.getByTestId('scheme-agent-dialog');
  await expect(dialog).toBeVisible();
  expect(api.starts).toHaveLength(0);
  expect(api.offers()).toBe(0);
  await page.getByTestId('scheme-agent-model-offer').click();
  await expect(page.getByTestId('scheme-agent-authorization')).toContainText(
    '本次最多 2 次模型调用',
  );
  expect(api.starts).toHaveLength(0);
  await dialog.screenshot({ path: info.outputPath('agent-authorization.png') });
  await page.getByTestId('scheme-agent-authorize-create').click();
  await expect(page.getByTestId('scheme-agent-session')).toContainText('排队中');
  expect(api.starts).toHaveLength(1);
  expect(api.starts[0]).toMatchObject({
    operation: 'create',
    text: { maxModelCalls: 2, maxOutputTokens: 8192, acceptUnknownCost: true },
  });
  await expect(page.getByTestId('composer-prompt')).toHaveValue(/创建水彩海报/);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(api.cancels()).toBe(0);
  await page.goto('/design-schemes');
  await page.reload();
  const opener = page.getByTestId('scheme-agent-history-open');
  await opener.click();
  await page.getByTestId(`scheme-agent-recover-${api.id()}`).click();
  await expect(page.getByTestId('scheme-agent-session')).toContainText('排队中');
  api.prepareSource();
  await page.getByTestId('scheme-agent-refresh').click();
  await expect(page.getByTestId('scheme-agent-source')).toContainText('MIT');
  await dialog.screenshot({ path: info.outputPath('agent-source-confirmation.png') });
  const geometry = await dialog.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    viewport: innerWidth,
    overflow: node.scrollWidth > node.clientWidth,
    paddingLeft: Number.parseFloat(getComputedStyle(node).paddingLeft),
  }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.overflow).toBe(false);
  expect(geometry.paddingLeft).toBeGreaterThanOrEqual(16);
  const other = await context.newPage();
  await seedOnboardingCompleted(other);
  await other.goto('/design-schemes');
  await other.getByTestId('scheme-agent-history-open').click();
  await other.getByTestId(`scheme-agent-recover-${api.id()}`).click();
  await other.getByTestId('scheme-agent-confirm-source').click();
  await expect(other.getByTestId('scheme-agent-open-result')).toBeVisible();
  await page.getByTestId('scheme-agent-refresh').click();
  await expect(page.getByTestId('scheme-agent-session')).toContainText('草稿已完成');
  expect(api.confirmations).toEqual([
    { executionId: api.id(), confirmationId: 'confirmation-frozen', decision: 'install' },
  ]);
  expect(api.starts).toHaveLength(1);
  expect(api.cancels()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await other.getByTestId('scheme-agent-open-result').click();
  await expect(other.getByTestId('runtime-scheme-detail')).toContainText('水彩海报方案');
  await other.close();
});

test('the workbench reports creation only after a completed draft and keeps image generation separate', async ({
  page,
  context,
}) => {
  const api = await protocolFixture(context);
  await seedOnboardingCompleted(page);
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-github').click();
  await page.getByTestId('composer-prompt').fill('水彩海报 https://github.com/fixture/watercolor');
  await page.getByTestId('composer-submit').click();
  await page.getByTestId('scheme-agent-model-offer').click();
  await page.getByTestId('scheme-agent-authorize-create').click();
  await expect(page.getByTestId('scheme-agent-session')).toContainText('排队中');
  await expect(page.getByTestId('composer-prompt')).toHaveValue(/水彩海报/);
  api.prepareSource();
  await page.getByTestId('scheme-agent-refresh').click();
  await page.getByTestId('scheme-agent-confirm-source').click();
  await expect(page.getByTestId('scheme-agent-session')).toContainText('草稿已完成');
  await expect(page.getByTestId('composer-prompt')).toHaveValue('');
  await expect(page.getByText('方案草稿已创建', { exact: true })).toBeVisible();
  expect(api.starts).toHaveLength(1);
  await page.getByTestId('scheme-agent-open-result').click();
  await expect(page.getByTestId('runtime-scheme-detail')).toContainText('水彩海报方案');
  await expect(page.getByTestId('runtime-scheme-detail')).toHaveAttribute('data-status', 'draft');
  await expect(page.getByTestId('runtime-scheme-detail')).toContainText('等待试运行');
});
