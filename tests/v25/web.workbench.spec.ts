import { expect, type Page, test } from '@playwright/test';

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

async function installWorkbenchApiMock(page: Page): Promise<void> {
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
        job.assets = [
          {
            id: `${job.id}-asset`,
            url: `data:image/png;base64,${TINY_PNG}`,
            mimeType: 'image/png',
            width: 1,
            height: 1,
            byteSize: 68,
            expiresAt: '2099-01-01T00:00:00+00:00',
          },
        ];
      }
    }
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/account/status') {
      return route.fulfill(json({ code: 'AUTH_REQUIRED', message: '未登录' }, 401));
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
          count: 1,
          providerId: input.providerId,
          referenceImages: input.referenceImages ?? [],
        },
        providerModel: 'musefold-image-pro',
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

test('删除会话经确认对话框', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'web-mobile', '移动布局删除入口随会话管理面后续排卡');

  // 发送建会话(草稿态语义下唯一入列路径),再走删除流。
  await page.getByTestId('composer-prompt').fill('待删除的会话');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('session-panel').getByText('待删除的会话')).toBeVisible();

  await page.getByTestId('session-panel').getByText('待删除的会话').hover();
  await page.getByTestId('session-remove').click();
  await page.getByTestId('session-remove-confirm').click();
  await expect(page.getByTestId('session-panel').getByText('待删除的会话')).toBeHidden();
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

test('生成完成后的视觉基线', async ({ page }) => {
  await page.getByTestId('composer-prompt').fill('baseline shot');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
    timeout: 15_000,
  });
  await expect(page).toHaveScreenshot('workbench-finished.png');
});
