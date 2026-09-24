import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';
import type { AccountModelCatalog, AccountSummary } from '@musefold/contracts';

// 已登录账号云生图夹具；身份和定价同源，首启引导不影响工作台用例。
test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

// Web 工作台 E2E:UI 流程走真实 features/api-client 代码,
// 网络层内存 mock,生成任务模拟 queued → running → succeeded 状态机。

interface MockSession {
  id: string;
  title: string;
  draft: {
    prompt: string;
    negative: string;
    params: Record<string, unknown>;
    promptReferenceSelections: Array<
      | { promptId: string; scope: 'full'; expectedVersion: number }
      | {
          promptId: string;
          scope: 'excerpt';
          expectedVersion: number;
          range: { start: number; end: number };
        }
    >;
    promptReferenceIds: string[];
  };
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

interface MockPrompt {
  id: string;
  title: string;
  description: string | null;
  content: string;
  negative: string | null;
  folderId: string | null;
  tags: unknown[];
  modelId: string | null;
  params: Record<string, unknown> | null;
  rating: number;
  isPinned: boolean;
  pinOrder: number | null;
  usageCount: number;
  lastUsedAt: string | null;
  source: 'manual';
  sourceUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface MockJob {
  id: string;
  sessionId: string | null;
  parentRunId: string | null;
  promptId: string | null;
  userPrompt?: string;
  promptReferences: Array<{
    promptId: string | null;
    title: string;
    text: string;
    scope: 'full' | 'excerpt';
    sourceVersion: number;
  }>;
  actorType: 'web';
  approvalStatus: 'not_required';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  request: Record<string, unknown>;
  providerModel: string;
  costPoints: number | null;
  assets: unknown[];
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  deletedAt: string | null;
  /** mock 内部:list 每读一次推进一步的剩余步数。 */
  ticksToDone: number;
}

function nowIso(): string {
  return new Date().toISOString().replace(/Z$/, '+00:00');
}

// 1x1 透明 PNG,资产 URL 直接可加载。
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const MODEL_ACCOUNT: AccountSummary = {
  id: 'workbench-owner',
  username: 'workbench-test',
  displayName: null,
  quota: 500000,
  quotaUnit: 'quota',
  canGenerate: true,
  identity: {
    apiIssuer: 'https://workbench-api.test',
    principalId: 'workbench-principal',
    status: 'active',
    identityVersion: 1,
  },
};
const MODEL_CATALOG: AccountModelCatalog = {
  identity: {
    apiIssuer: 'https://workbench-api.test',
    principalId: 'workbench-principal',
    payer: { issuer: 'https://workbench-payer.test', ownerId: 'workbench-owner' },
    credential: { ref: 'workbench-credential', version: 1 },
  },
  group: 'vip',
  checkedAt: '2026-09-20T00:00:00.000Z',
  models: ['musefold-image-pro', 'gpt-image-2'].map((model, index) => ({
    model,
    supportedEndpointTypes: ['image-generation'],
    imageGeneration: true,
    pricing: {
      kind: 'per_call',
      baseUsd: 0.04 * (index + 1),
      groupRatio: 3,
      quotaPerCall: 60000 * (index + 1),
    },
  })),
};

async function installWorkbenchApiMock(
  page: Page,
  options: { assetUrl?: string } = {},
): Promise<void> {
  let seq = 0;
  const sessions = new Map<string, MockSession>();
  const jobs = new Map<string, MockJob>();
  const promptTimestamp = nowIso();
  const prompts = new Map<string, MockPrompt>([
    [
      'prompt-reference-e2e',
      {
        id: 'prompt-reference-e2e',
        title: '晨雾构图参考',
        description: null,
        content: 'foreground mist, centered lighthouse, quiet negative space',
        negative: null,
        folderId: null,
        tags: [],
        modelId: null,
        params: null,
        rating: 0,
        isPinned: false,
        pinOrder: null,
        usageCount: 0,
        lastUsedAt: null,
        source: 'manual',
        sourceUrl: null,
        version: 1,
        createdAt: promptTimestamp,
        updatedAt: promptTimestamp,
        deletedAt: null,
      },
    ],
  ]);

  function json(body: unknown, status = 200) {
    return { status, contentType: 'application/json', body: JSON.stringify(body) };
  }

  function stripInternal(job: MockJob): Omit<MockJob, 'ticksToDone'> {
    const { ticksToDone: _ticks, ...wire } = job;
    return wire;
  }

  function advance(job: MockJob): void {
    if (job.status === 'queued') {
      job.status = 'running';
      job.progress = 40;
      job.startedAt = nowIso();
      return;
    }
    if (job.status === 'running') {
      job.ticksToDone -= 1;
      if (job.ticksToDone <= 0) {
        job.status = 'succeeded';
        job.progress = 100;
        job.finishedAt = nowIso();
        // 张数(§9-D3):按 request.count 回 N 个资产,position 即数组下标。
        const count = Number(job.request.count ?? 1);
        job.assets = Array.from({ length: count }, (_, index) => ({
          id: index === 0 ? `${job.id}-asset` : `${job.id}-asset-${index + 1}`,
          url: options.assetUrl ?? `data:image/png;base64,${TINY_PNG}`,
          mimeType: 'image/png',
          width: 1,
          height: 1,
          byteSize: 68,
          expiresAt: '2099-01-01T00:00:00+00:00',
        }));
      }
    }
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/account/status') {
      return route.fulfill(json(MODEL_ACCOUNT));
    }
    if (path === '/account/models') {
      return route.fulfill(json(MODEL_CATALOG));
    }

    if (path === '/prompts' && method === 'GET') {
      const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
      const items = [...prompts.values()].filter(
        (prompt) =>
          prompt.deletedAt === null &&
          (!q ||
            prompt.title.toLowerCase().includes(q) ||
            prompt.content.toLowerCase().includes(q)),
      );
      return route.fulfill(json({ items, nextCursor: null }));
    }
    const promptMatch = path.match(/^\/prompts\/([^/]+)$/);
    if (promptMatch) {
      const prompt = prompts.get(promptMatch[1] ?? '');
      if (!prompt || prompt.deletedAt !== null) {
        return route.fulfill(json({ code: 'NOT_FOUND', message: '提示词不存在' }, 404));
      }
      if (method === 'GET') return route.fulfill(json(prompt));
      if (method === 'PATCH') {
        const patch = request.postDataJSON() as Record<string, unknown>;
        if (patch.title !== undefined) prompt.title = String(patch.title);
        if (patch.content !== undefined) prompt.content = String(patch.content);
        prompt.version += 1;
        prompt.updatedAt = nowIso();
        return route.fulfill(json(prompt));
      }
    }

    if (path === '/workbench/sessions' && method === 'GET') {
      const items = [...sessions.values()]
        .filter((session) => session.deletedAt == null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return route.fulfill(json({ items, nextCursor: null }));
    }
    if (path === '/workbench/sessions' && method === 'POST') {
      const input = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      seq += 1;
      const session: MockSession = {
        id: `session-${seq}`,
        title: (input.title as string) || '未命名创作',
        draft: {
          prompt: '',
          negative: '',
          params: {},
          promptReferenceSelections: [],
          promptReferenceIds: [],
        },
        version: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        archivedAt: null,
        deletedAt: null,
      };
      sessions.set(session.id, session);
      return route.fulfill(json(session, 201));
    }

    const sessionMatch = path.match(/^\/workbench\/sessions\/([^/]+)(?:\/(restore))?$/);
    if (sessionMatch) {
      const [, id, action] = sessionMatch;
      const session = sessions.get(id);
      if (!session) return route.fulfill(json({ code: 'NOT_FOUND', message: '不存在' }, 404));
      if (action === 'restore' && method === 'POST') {
        session.deletedAt = null;
        return route.fulfill(json(session));
      }
      if (method === 'GET') return route.fulfill(json(session));
      if (method === 'PATCH') {
        const patch = request.postDataJSON() as Record<string, unknown>;
        if (patch.title !== undefined) session.title = String(patch.title);
        if (patch.draft !== undefined) session.draft = patch.draft as MockSession['draft'];
        session.version += 1;
        session.updatedAt = nowIso();
        return route.fulfill(json(session));
      }
      if (method === 'DELETE') {
        session.deletedAt = nowIso();
        return route.fulfill(json(session));
      }
    }

    if (path === '/generations/providers' && method === 'GET') {
      return route.fulfill(
        json([
          {
            id: 'cloud-default',
            label: 'Musefold 云生图',
            model: 'musefold-image-pro',
            kind: 'cloud',
            available: true,
          },
        ]),
      );
    }
    // 参考图上传(multipart):返回契约引用;字节不落盘,展示 URL 由下方 GET 路由回小图。
    if (path === '/reference-images' && method === 'POST') {
      seq += 1;
      const id = `REF${String(seq).padStart(23, '0')}`;
      return route.fulfill(
        json(
          {
            id,
            url: `/api/v1/reference-images/${id}/url`,
            name: `ref-${seq}.png`,
            mimeType: 'image/png',
            byteSize: 68,
          },
          201,
        ),
      );
    }
    // Memory transport fixture: release is idempotent and has no response body.
    if (/^\/reference-images\/[^/]+$/.test(path) && method === 'DELETE') {
      return route.fulfill({ status: 204 });
    }
    if (/^\/reference-images\/[^/]+\/url$/.test(path) && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(TINY_PNG, 'base64'),
      });
    }

    if (path === '/generations' && method === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>;
      const selections = (input.promptReferenceSelections ??
        []) as MockSession['draft']['promptReferenceSelections'];
      const promptReferences: MockJob['promptReferences'] = [];
      for (const selection of selections) {
        const source = prompts.get(selection.promptId);
        if (!source || source.deletedAt !== null) {
          return route.fulfill(
            json({ code: 'PROMPT_NOT_FOUND', message: '引用的提示词不存在' }, 404),
          );
        }
        if (source.version !== selection.expectedVersion) {
          return route.fulfill(
            json({ code: 'PROMPT_VERSION_CONFLICT', message: '引用的提示词已更新' }, 409),
          );
        }
        const text =
          selection.scope === 'full'
            ? source.content
            : source.content.slice(selection.range.start, selection.range.end);
        promptReferences.push({
          promptId: source.id,
          title: source.title,
          text,
          scope: selection.scope,
          sourceVersion: source.version,
        });
      }
      const userPrompt = String(input.prompt ?? '').trim();
      const referenceBlocks = promptReferences.map(
        (reference) =>
          `【${reference.title}｜${reference.scope === 'full' ? '整条' : '选中片段'}】\n${reference.text}`,
      );
      const finalPrompt = referenceBlocks.length
        ? `${userPrompt ? `${userPrompt}\n\n` : ''}参考提示词：\n${referenceBlocks.join('\n\n')}`
        : userPrompt;
      seq += 1;
      const job: MockJob = {
        id: `job-${seq}`,
        sessionId: (input.sessionId as string) ?? null,
        parentRunId: null,
        promptId: (input.promptId as string) ?? null,
        userPrompt,
        promptReferences,
        actorType: 'web',
        approvalStatus: 'not_required',
        status: 'queued',
        progress: 0,
        request: {
          prompt: finalPrompt,
          negative: input.negative,
          size: input.size ?? 'auto',
          aspectRatio: input.aspectRatio,
          quality: input.quality ?? 'auto',
          count: input.count ?? 1,
          providerId: input.providerId,
          model: input.model,
          referenceImages: input.referenceImages ?? [],
        },
        providerModel: String(input.model ?? 'musefold-image-pro'),
        costPoints: null,
        assets: [],
        error: null,
        createdAt: nowIso(),
        startedAt: null,
        finishedAt: null,
        deletedAt: null,
        ticksToDone: 2,
      };
      jobs.set(job.id, job);
      return route.fulfill(json(stripInternal(job), 201));
    }
    if (path === '/generations' && method === 'GET') {
      const sessionId = url.searchParams.get('sessionId');
      const items = [...jobs.values()].filter((job) => !sessionId || job.sessionId === sessionId);
      for (const job of items) advance(job);
      return route.fulfill(json({ items: items.map(stripInternal), nextCursor: null }));
    }

    const jobMatch = path.match(/^\/generations\/([^/]+)(?:\/(cancel|retry))?$/);
    if (jobMatch) {
      const [, id, action] = jobMatch;
      const job = jobs.get(id);
      if (!job)
        return route.fulfill(json({ code: 'GENERATION_NOT_FOUND', message: '不存在' }, 404));
      if (action === 'cancel' && method === 'POST') {
        job.status = 'cancelled';
        job.finishedAt = nowIso();
        return route.fulfill(json(stripInternal(job)));
      }
      if (action === 'retry' && method === 'POST') {
        seq += 1;
        const retry: MockJob = {
          ...job,
          id: `job-${seq}`,
          status: 'queued',
          progress: 0,
          assets: [],
          error: null,
          createdAt: nowIso(),
          startedAt: null,
          finishedAt: null,
          ticksToDone: 1,
        };
        jobs.set(retry.id, retry);
        return route.fulfill(json(stripInternal(retry), 201));
      }
      if (method === 'GET') return route.fulfill(json(stripInternal(job)));
    }

    return route.fulfill(
      json({ code: 'NOT_FOUND', message: `mock 未覆盖:${method} ${path}` }, 404),
    );
  });
}

test.beforeEach(async ({ page }) => {
  // 空态问候语随本地时段变化;固定页面时钟保证视觉基线确定(15:00 → 下午档)。
  // setFixedTime 只钉 Date,定时器照常走,不影响轮询用例。
  await page.clock.setFixedTime(new Date('2026-08-29T15:00:00'));
  await installWorkbenchApiMock(page);
  await page.goto('/workbench');
  await expect(page.getByTestId('workbench')).toBeVisible();
});

test('账号模型：键盘选择、刷新持久化与实际请求一致', async ({ page }, testInfo) => {
  const model = page.getByRole('combobox', { name: '账号模型' });
  await expect(model).toHaveText('musefold-image-pro');
  await model.focus();
  await model.press('ArrowDown');
  await page.getByRole('option', { name: /gpt-image-2/ }).focus();
  await page.keyboard.press('Enter');
  await expect(model).toBeFocused();
  await expect(model).toHaveText('gpt-image-2');
  await expect(page.getByTestId('composer-model-price')).toContainText('2.4 积分/计费次');
  await page.reload();
  await expect(model).toHaveText('gpt-image-2');
  await page.getByTestId('composer-prompt').fill('Use the chosen account model');
  const posted = page.waitForRequest(
    (request) => request.url().endsWith('/generations') && request.method() === 'POST',
  );
  await page.getByTestId('composer-submit').click();
  expect((await posted).postDataJSON()).toMatchObject({
    model: 'gpt-image-2',
    expectedBinding: { model: 'gpt-image-2', principalId: MODEL_CATALOG.identity.principalId },
  });
  // The fixture completes after two 3s polls, matching the ordinary generation test below.
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('job-asset').first()).toBeVisible();
  // 模型选择器内联进 Composer 右簇(2026-09 走查美化)后不再有独立高度行,
  // 旧 data-composer-extra-inset 非零断言随之退役:直接断言选择器在 Composer
  // 边界内,时间线不被遮挡的几何核对仍由下方滚动断言承担。
  const selectorBox = await model.boundingBox();
  const composerBar = await page.getByTestId('composer').boundingBox();
  expect(selectorBox).not.toBeNull();
  expect(composerBar).not.toBeNull();
  if (selectorBox && composerBar) {
    expect(selectorBox.y).toBeGreaterThanOrEqual(composerBar.y);
    expect(selectorBox.y + selectorBox.height).toBeLessThanOrEqual(
      composerBar.y + composerBar.height,
    );
  }
  await page.getByTestId('timeline').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const image = await page.getByTestId('job-asset').first().boundingBox();
  const composer = await page.getByTestId('composer').boundingBox();
  expect(image).not.toBeNull();
  expect(composer).not.toBeNull();
  if (image && composer) expect(image.y + image.height).toBeLessThanOrEqual(composer.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('account-model-timeline.png') });
});

test('账号模型：价格变化要求重新确认发送，读取失败不显示旧价', async ({ page }) => {
  await expect(page.getByTestId('composer-model-price')).toContainText('1.2 积分/计费次');
  let calls = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/generations') && request.method() === 'POST') calls++;
  });
  const next = structuredClone(MODEL_CATALOG);
  next.models[0].pricing = { kind: 'per_call', baseUsd: 0.06, groupRatio: 3, quotaPerCall: 90000 };
  await page.route('**/api/v1/account/models', (route) => route.fulfill({ json: next }));
  await page.getByTestId('composer-prompt').fill('Preserve input on changed prices');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByText('云端价格已更新，请核对后重新发送')).toBeVisible();
  await expect(page.getByTestId('composer-model-price')).toContainText('1.8 积分/计费次');
  await expect(page.getByTestId('composer-prompt')).toHaveValue('Preserve input on changed prices');
  expect(calls).toBe(0);
  await page.route('**/api/v1/account/models', (route) =>
    route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'pricing unavailable' } }),
  );
  await page.getByRole('button', { name: '刷新云端模型与价格' }).click();
  await expect(page.getByTestId('composer-model-price')).toContainText('读取失败');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
  await expect(page.getByTestId('composer-model-price')).not.toContainText('1.8');
  expect(calls).toBe(0);
  await page.route('**/api/v1/account/models', (route) => route.fulfill({ json: next }));
  // 恢复路径走整页重载(与菜单内刷新等价的恢复语义;首次失败已在上面走菜单刷新覆盖)。
  await page.reload();
  await expect(page.getByTestId('composer-model-price')).toContainText('1.8 积分/计费次');
  // 重载清空了未发送输入(草稿不落库),重新填入后再发。
  await page.getByTestId('composer-prompt').fill('Retry after price recovery');
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  await page.getByTestId('composer-submit').click();
  await expect.poll(() => calls).toBe(1);
});

test('账号模型：换号隔离与缺价拒绝', async ({ page }) => {
  await page.getByRole('combobox', { name: '账号模型' }).click();
  await page.getByRole('option', { name: /gpt-image-2/ }).click();
  const nextAccount: AccountSummary = {
    ...MODEL_ACCOUNT,
    id: 'other-owner',
    identity: {
      apiIssuer: MODEL_CATALOG.identity.apiIssuer,
      principalId: 'other-principal',
      status: 'active',
      identityVersion: 1,
    },
  };
  const next = structuredClone(MODEL_CATALOG);
  next.identity.principalId = 'other-principal';
  next.identity.payer.ownerId = 'other-owner';
  next.identity.credential.ref = 'other-credential';
  await page.route('**/api/v1/account/status', (route) => route.fulfill({ json: nextAccount }));
  await page.route('**/api/v1/account/models', (route) => route.fulfill({ json: next }));
  await page.reload();
  await expect(page.getByRole('combobox', { name: '账号模型' })).toHaveText('musefold-image-pro');
  next.models[0].pricing = { kind: 'unavailable', reason: 'missing_price' };
  // Even the initially displayed choice must stay fixed when its cloud price disappears.
  await page.reload();
  await expect(page.getByTestId('composer-model-price')).toContainText('云端未提供价格');
  await page.getByTestId('composer-prompt').fill('Do not silently switch models');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '账号模型' })).toHaveText('musefold-image-pro');
});

test('会话 URL:深链恢复、跨会话 push、back/forward 回放与无效 id replace', async ({
  page,
}, testInfo) => {
  const firstPrompt = 'first session url check';
  const secondPrompt = 'second session url check';

  await page.getByTestId('composer-prompt').fill(firstPrompt);
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('timeline').getByText(firstPrompt)).toBeVisible();
  const firstSessionId = new URL(page.url()).searchParams.get('session');
  if (!firstSessionId) throw new Error('first session URL pointer missing');
  await expect(page).toHaveURL(new RegExp(`/workbench\\?session=${firstSessionId}$`));

  if (testInfo.project.name === 'web-mobile') {
    await page.getByTestId('session-create-mobile').click();
  } else {
    await page.getByTestId('session-create').click();
  }
  await page.getByTestId('composer-prompt').fill(secondPrompt);
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('timeline').getByText(secondPrompt)).toBeVisible();
  const secondSessionId = new URL(page.url()).searchParams.get('session');
  if (!secondSessionId) throw new Error('second session URL pointer missing');
  await expect(page).toHaveURL(new RegExp(`/workbench\\?session=${secondSessionId}$`));

  // Explicitly select each existing session so the adapter's store writes are
  // user-action pushes, then verify browser history restores the same pointer.
  const selectSession = async (title: string) => {
    if (testInfo.project.name === 'web-mobile') {
      await page.getByTestId('session-picker').click();
      await page.getByRole('option', { name: title }).click();
    } else {
      await page.getByTestId('session-panel').getByText(title).click();
    }
  };

  await selectSession(firstPrompt);
  await expect(page).toHaveURL(new RegExp(`/workbench\\?session=${firstSessionId}$`));
  await expect(page.getByTestId('timeline').getByText(firstPrompt)).toBeVisible();
  await selectSession(secondPrompt);
  await expect(page).toHaveURL(new RegExp(`/workbench\\?session=${secondSessionId}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/workbench\\?session=${firstSessionId}$`));
  await expect(page.getByTestId('timeline').getByText(firstPrompt)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/workbench\\?session=${secondSessionId}$`));
  await expect(page.getByTestId('timeline').getByText(secondPrompt)).toBeVisible();

  // A reload/deep link applies the authorized session and keeps unrelated URL
  // state. An unauthorized id is replaced without retaining stale session data.
  await page.goto(`/workbench?view=compact&session=${firstSessionId}#composer`);
  await expect(page.getByTestId('timeline').getByText(firstPrompt)).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/workbench\\?view=compact&session=${firstSessionId}#composer$`),
  );
  await page.goto('/workbench?view=compact&session=not-authorized#composer');
  await expect(page.getByTestId('timeline').getByText(secondPrompt)).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(
      `/workbench\\?view=compact&session=(${firstSessionId}|${secondSessionId})#composer$`,
    ),
  );
});

test('空态与视觉基线', async ({ page }) => {
  // 品牌空态(V25-UI-SPEC §3.1):问候语 + 标语 + 内联 Composer + 快捷建议。
  await expect(page.getByTestId('workbench-empty')).toBeVisible();
  await expect(page.getByTestId('workbench-empty-greeting')).toHaveText('下午好，继续你的创作');
  await expect(page.getByTestId('workbench-empty-slogan')).toHaveText('把想法变成可生成的视觉');
  await expect(page.getByTestId('workbench-empty').getByTestId('composer-prompt')).toBeVisible();
  await expect(page.getByTestId('generation-example').first()).toBeVisible();
  await expect(page).toHaveScreenshot('workbench-empty.png');
});

test('提交生成:排队→运行→成图', async ({ page }) => {
  await page.getByTestId('composer-prompt').fill('sunset over mountain lake');
  await page.getByTestId('composer-submit').click();

  // 自动建会话,用户气泡入时间线
  await expect(page.getByTestId('timeline').getByText('sunset over mountain lake')).toBeVisible();
  // 轮询驱动状态机到成图
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('job-asset')).toBeVisible();
  // 成功后输入框清空
  await expect(page.getByTestId('composer-prompt')).toHaveValue('');
});

test('单图从生成中完成后在真实图片字节到达前保留可见尺寸', async ({ page }) => {
  await installWorkbenchApiMock(page, { assetUrl: '/delayed-workbench-result.png' });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/delayed-workbench-result.png', async (route) => {
    requested = true;
    await gate;
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(TINY_PNG, 'base64') });
  });
  await page.reload();
  await page.getByTestId('composer-prompt').fill('delayed image geometry');
  await page.getByTestId('composer-submit').click();
  try {
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
      timeout: 15000,
    });
    const image = page.getByTestId('job-asset').locator('img');
    await expect(image).toBeAttached();
    await expect(image).toHaveAttribute('data-loaded', 'false');
    await expect.poll(async () => (await image.boundingBox())?.height ?? 0).toBeGreaterThan(0);
    await expect.poll(() => requested).toBe(true);
  } finally {
    release();
  }
  const image = page.getByTestId('job-asset').locator('img');
  await expect(image).toHaveAttribute('data-loaded', 'true');
  expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
});

test('「新设计」草稿态:发送才建会话(标题取首句),随后可重命名', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'web-mobile') {
    // 移动布局:顶栏「+」进草稿态(选择器回占位),发送后会话出现且标题取首句。
    await page.getByTestId('session-create-mobile').click();
    await expect(page.getByTestId('workbench-empty')).toBeVisible();
    await page.getByTestId('composer-prompt').fill('晨雾中的灯塔');
    await page.getByTestId('composer-submit').click();
    await expect(page.getByTestId('session-picker')).toContainText('晨雾中的灯塔');
    return;
  }

  // 「新设计」只进草稿空态,不落「未命名创作」行。
  const create = page.getByTestId('session-create');
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByTestId('workbench-empty')).toBeVisible();
  await expect(page.getByTestId('session-panel').getByText('未命名创作')).toBeHidden();

  // 首次发送才建会话,标题由首句派生。
  await page.getByTestId('composer-prompt').fill('落日湖泊系列草稿');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('session-panel').getByText('落日湖泊系列草稿')).toBeVisible();

  // 行动作 hover 渐显(静息态让位给相对时间戳),先悬停会话行。
  await page.getByTestId('session-panel').getByText('落日湖泊系列草稿').hover();
  await page.getByTestId('session-rename').click();
  await page.getByTestId('session-rename-input').fill('落日湖泊系列');
  await page.getByTestId('session-rename-commit').click();
  await expect(page.getByTestId('session-panel').getByText('落日湖泊系列')).toBeVisible();
});

async function requestSessionRemoval(page: Page, id: string, mobile: boolean): Promise<void> {
  if (mobile && !(await page.getByTestId('session-panel').isVisible())) {
    await page.getByTestId('sidebar-drawer-open').click();
  }
  const row = page.getByTestId(`session-row-${id}`);
  await expect(row).toBeVisible();
  if (!mobile) await row.hover();
  const more = row.getByTestId('session-more');
  await expect(more).toBeVisible();
  if (mobile) {
    const box = await more.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await more.click();
  await page.getByTestId('session-menu-remove').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

test('删除会话经确认对话框,取消保留且最后一条删除后回空态', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'web-mobile';
  const deletions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletions.push(new URL(request.url()).pathname);
  });
  await page.getByTestId('composer-prompt').fill('待删除的会话');
  await page.getByTestId('composer-submit').click();
  await expect(page).toHaveURL(/\/workbench\?session=/);
  const id = new URL(page.url()).searchParams.get('session');
  expect(id).toBeTruthy();
  if (!id) throw new Error('未创建会话');

  await requestSessionRemoval(page, id, mobile);
  await expect(page.getByRole('alertdialog')).toContainText('待删除的会话');
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByTestId(`session-row-${id}`)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('session')).toBe(id);
  expect(deletions).toEqual([]);

  await requestSessionRemoval(page, id, mobile);
  await page.getByTestId('session-remove-confirm').click();
  await expect(page.getByTestId(`session-row-${id}`)).toBeHidden();
  await expect(page.getByTestId('session-panel')).toContainText('还没有对话');
  await expect(page).toHaveURL(/\/workbench$/);
  expect(deletions).toEqual([`/api/v1/workbench/sessions/${id}`]);
  if (mobile) await page.getByTestId('sidebar-collapse').click();
  await expect(page.getByTestId('workbench-empty-greeting')).toBeVisible();
  if (mobile) await expect(page.getByTestId('session-picker')).toContainText('选择创作会话');
});

test('删除会话经确认对话框,非当前不切换且当前删除回退到剩余会话', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'web-mobile';
  const ids: string[] = [];
  for (const title of ['先前对话', '保留对话', '当前对话']) {
    if (ids.length > 0) {
      await page.getByTestId(mobile ? 'session-create-mobile' : 'session-create').click();
      await expect(page).toHaveURL(/\/workbench$/);
    }
    await page.getByTestId('composer-prompt').fill(title);
    await page.getByTestId('composer-submit').click();
    await expect(page).toHaveURL(/\/workbench\?session=/);
    const id = new URL(page.url()).searchParams.get('session');
    if (!id) throw new Error('未创建会话');
    ids.push(id);
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
      timeout: 15_000,
    });
  }
  const [earlierId, remainingId, currentId] = ids;
  if (!earlierId || !remainingId || !currentId) throw new Error('会话夹具不完整');

  await requestSessionRemoval(page, earlierId, mobile);
  await page.getByTestId('session-remove-confirm').click();
  await expect(page.getByTestId(`session-row-${earlierId}`)).toBeHidden();
  expect(new URL(page.url()).searchParams.get('session')).toBe(currentId);

  await requestSessionRemoval(page, currentId, mobile);
  await page.getByTestId('session-remove-confirm').click();
  await expect(page.getByTestId(`session-row-${currentId}`)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/workbench\\?session=${remainingId}$`));
  await expect(page.getByTestId(`session-row-${remainingId}`)).toBeVisible();
  if (mobile) await page.getByTestId('sidebar-collapse').click();
  await expect(
    page.getByTestId(mobile ? 'session-picker' : 'workbench-session-title'),
  ).toContainText('保留对话');
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded');
});

test('运行中可取消', async ({ page }) => {
  await page.getByTestId('composer-prompt').fill('slow burn test');
  await page.getByTestId('composer-submit').click();

  await page.getByTestId('job-cancel').click();
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'cancelled', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('job-retry')).toBeVisible();
});

test('拖拽参考图:覆盖层→缩略条→随生成入回合附件', async ({ page }) => {
  // 页面上下文构造带 PNG File 的 DataTransfer,驱动真实 drag 事件链。
  const dataTransfer = await page.evaluateHandle((base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'ref.png', { type: 'image/png' }));
    return transfer;
  }, TINY_PNG);

  const prompt = page.getByTestId('composer-prompt');
  await prompt.dispatchEvent('dragenter', { dataTransfer });
  await expect(page.getByTestId('composer-drop-overlay')).toBeVisible();

  await prompt.dispatchEvent('drop', { dataTransfer });
  await expect(page.getByTestId('composer-drop-overlay')).toBeHidden();
  await expect(page.getByTestId('composer-reference')).toHaveAttribute('data-status', 'ready');

  await prompt.fill('remix with reference');
  await page.getByTestId('composer-submit').click();

  // 参考图缩略图进入回合附件区,提交后草稿缩略条清空
  await expect(page.getByTestId('job-references').locator('img')).toHaveCount(1);
  await expect(page.getByTestId('composer-reference')).toHaveCount(0);
});

test('提示词引用:纯引用生成并在源编辑后保留时间线快照', async ({ page }) => {
  await page.getByTestId('composer-attach').click();
  await page.getByTestId('workbench-context-ref-prompt').click();
  await expect(page.getByTestId('workbench-reference-sidebar')).toBeVisible();

  const sourceRow = page.getByTestId('workbench-reference-row').filter({ hasText: '晨雾构图参考' });
  await sourceRow.getByTestId('workbench-reference-expand').click();
  await sourceRow.getByTestId('workbench-reference-full').click();

  const draftReference = page.getByTestId('prompt-reference-card');
  await expect(draftReference).toContainText('晨雾构图参考');
  await expect(draftReference).toContainText('引用提示词 · 整条');
  await expect(draftReference).toContainText(
    'foreground mist, centered lighthouse, quiet negative space',
  );
  await page.getByTestId('workbench-materials-close').click();

  // 正文为空时仍可显式提交；服务端只接收 selection intent 并解析不可变快照。
  await expect(page.getByTestId('composer-prompt')).toHaveValue('');
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  await page.getByTestId('composer-submit').click();

  const frozenReference = page.getByTestId('job-prompt-reference');
  await expect(frozenReference).toContainText('晨雾构图参考');
  await expect(frozenReference).toContainText('整条');
  await expect(frozenReference).toContainText(
    'foreground mist, centered lighthouse, quiet negative space',
  );
  await expect(page.getByTestId('prompt-reference-card')).toHaveCount(0);

  const responseStatus = await page.evaluate(async () => {
    const response = await fetch('/api/v1/prompts/prompt-reference-e2e', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 1,
        title: '已更新的晨雾参考',
        content: 'new source content that must not rewrite the old generation',
      }),
    });
    return response.status;
  });
  expect(responseStatus).toBe(200);

  await page.reload();
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('job-prompt-reference')).toContainText('晨雾构图参考');
  await expect(page.getByTestId('job-prompt-reference')).toContainText(
    'foreground mist, centered lighthouse, quiet negative space',
  );
  await expect(page.getByTestId('job-prompt-reference')).not.toContainText('已更新的晨雾参考');

  await page.getByTestId('composer-attach').click();
  await page.getByTestId('workbench-context-ref-prompt').click();
  await expect(page.getByTestId('workbench-reference-sidebar')).toContainText('已更新的晨雾参考');
  await expect(page.getByTestId('workbench-reference-sidebar')).toContainText(
    'new source content that must not rewrite the old generation',
  );
});

test('张数 2:两列结果网格 + 参数 meta 行 + Lightbox 翻页(§9-D3)', async ({ page }) => {
  // 张数控件在设置弹层内(值摘要钮 → 304px 弹层),选 2 后摘要文案带张数。
  await page.getByTestId('composer-settings').click();
  await page.getByTestId('composer-count-2').click();
  await expect(page.getByTestId('composer-count-2')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('composer-settings')).toContainText('2 张');

  await page.getByTestId('composer-prompt').fill('twin moons over the sea');
  await page.getByTestId('composer-submit').click();

  // 生成中骨架按张数占位,成图后两列网格落位。
  await expect(page.getByTestId('job-placeholder-grid')).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('job-asset-grid')).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('job-asset')).toHaveCount(2);
  const grid = page.getByTestId('job-asset-grid');
  await expect(grid).toHaveClass(/grid-cols-2/);
  // Tiles enter with staggered transforms. Assert the final two-column geometry,
  // keeping exact row alignment rather than sampling a transitional frame.
  await expect
    .poll(() =>
      page.getByTestId('job-asset-tile').evaluateAll((nodes) => {
        const boxes = nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { x: Math.round(rect.x), y: Math.round(rect.y) };
        });
        return boxes.length === 2 && boxes[0].y === boxes[1].y && boxes[0].x !== boxes[1].x;
      }),
    )
    .toBe(true);

  // 参数 meta 行:比例 · 质量 · 张数(>1 时)。
  await expect(page.getByTestId('job-meta')).toContainText('2 张');
  await expect(page.getByTestId('job-meta')).toContainText('自动');

  // 回合级「全部保存」在多图时才出现,单图仍是保存单钮。
  await expect(page.getByTestId('job-save-all')).toBeVisible();
  await expect(page.getByTestId('job-save-asset')).toHaveCount(0);

  // Lightbox:计数 + 按钮翻页 + 方向键翻页;Web 不渲染「复制图片」(D2)。
  await page.getByTestId('job-asset').first().click();
  await expect(page.getByTestId('job-lightbox')).toBeVisible();
  await expect(page.getByTestId('lightbox-counter')).toHaveText('1 / 2');
  await expect(page.getByTestId('lightbox-copy-asset')).toHaveCount(0);
  await page.getByTestId('lightbox-next').click();
  await expect(page.getByTestId('lightbox-counter')).toHaveText('2 / 2');
  await expect(page.getByTestId('lightbox-next')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('lightbox-counter')).toHaveText('1 / 2');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lightbox-counter')).toHaveText('2 / 2');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('job-lightbox')).toBeHidden();
  // 焦点归还打开灯箱的图格(§8-I9)。
  await expect(page.getByTestId('job-asset').first()).toBeFocused();
});

test('生成完成后的视觉基线', async ({ page }) => {
  await page.getByTestId('composer-prompt').fill('baseline shot');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('job-asset').locator('img')).toHaveAttribute('data-loaded', 'true');
  const timeline = page.getByTestId('timeline');
  // A taller account-model Composer changes bottom-following scroll, not the saved user message.
  const message = timeline.getByText('baseline shot', { exact: true });
  await expect(message).toHaveCount(1);
  await timeline.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(message).toBeInViewport();
  await timeline.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(
      () =>
        timeline.evaluate((element) => {
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
          return distance <= 80;
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
  await expect(page).toHaveScreenshot('workbench-finished.png');
});

test('清空工作台后迟到的文件读取不上传，新参考图仍可正常上传', async ({ page }, testInfo) => {
  const sessionId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/workbench/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '待清空的参考图会话' }),
    });
    if (!response.ok) throw new Error('Fixture session creation failed');
    return (await response.json()).id as string;
  });
  await page.goto(`/workbench?session=${sessionId}`);
  await expect(page).toHaveURL(new RegExp(`/workbench\\?session=${sessionId}$`));
  await expect(page.getByTestId('composer-prompt')).toBeVisible();
  const uploadedNames: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/v1/reference-images'
    ) {
      const name = /filename="([^"]+)"/.exec(request.postData() ?? '')?.[1];
      uploadedNames.push(name ?? 'missing filename');
    }
  });
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = { started: false, returned: false, release };
    Object.assign(window, { referenceReadProbe: probe });
    File.prototype.arrayBuffer = async function () {
      const bytes = await original.call(this);
      if (this.name === 'cleared-reference.png') {
        probe.started = true;
        await gate;
        probe.returned = true;
      }
      return bytes;
    };
  });
  await page.getByTestId('composer-file-input').setInputFiles({
    name: 'cleared-reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG, 'base64'),
  });
  await page.waitForFunction(
    () =>
      (window as unknown as { referenceReadProbe: { started: boolean } }).referenceReadProbe
        .started,
  );
  await expect(page.getByTestId('composer-reference')).toHaveAttribute('data-status', 'uploading');
  await page
    .getByTestId(
      testInfo.project.name === 'web-mobile' ? 'session-create-mobile' : 'session-create',
    )
    .click();
  await expect(page.getByTestId('composer-reference')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { referenceReadProbe: { release(): void } }).referenceReadProbe.release(),
  );
  await page.waitForFunction(
    () =>
      (window as unknown as { referenceReadProbe: { returned: boolean } }).referenceReadProbe
        .returned,
  );
  await page.getByTestId('composer-file-input').setInputFiles({
    name: 'current-reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG, 'base64'),
  });
  await expect(page.getByTestId('composer-reference')).toHaveAttribute('data-status', 'ready');
  expect(uploadedNames).toEqual(['current-reference.png']);
});

test('移除参考图通过正式 Web gateway 发送无请求体 DELETE 并接受 204', async ({ page }) => {
  const creations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/generations')
      creations.push(request.url());
  });
  const upload = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/reference-images',
  );
  await page.getByTestId('composer-file-input').setInputFiles({
    name: 'release-me.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG, 'base64'),
  });
  const image = (await (await upload).json()) as { id: string; name: string };
  await expect(page.getByTestId('composer-reference')).toHaveAttribute('data-status', 'ready');
  const released = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname === `/api/v1/reference-images/${image.id}`,
  );
  await page.getByRole('button', { name: '移除参考图 release-me.png' }).click();
  const response = await released;
  expect(response.status()).toBe(204);
  expect(response.request().postData()).toBeNull();
  expect(new URL(response.url()).search).toBe('');
  await expect(page.getByTestId('composer-reference')).toHaveCount(0);
  expect(creations).toEqual([]);
});
