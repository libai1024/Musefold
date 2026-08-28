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
    promptReferenceIds: string[];
  };
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

interface MockJob {
  id: string;
  sessionId: string | null;
  parentRunId: string | null;
  promptId: string | null;
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
        draft: { prompt: '', negative: '', params: {}, promptReferenceIds: [] },
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
    if (path === '/generations' && method === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>;
      seq += 1;
      const job: MockJob = {
        id: `job-${seq}`,
        sessionId: (input.sessionId as string) ?? null,
        parentRunId: null,
        promptId: null,
        actorType: 'web',
        approvalStatus: 'not_required',
        status: 'queued',
        progress: 0,
        request: {
          prompt: input.prompt,
          size: input.size ?? 'auto',
          quality: input.quality ?? 'auto',
          count: 1,
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
  await installWorkbenchApiMock(page);
  await page.goto('/workbench');
  await expect(page.getByTestId('workbench')).toBeVisible();
});

test('空态与视觉基线', async ({ page }) => {
  await expect(page.getByTestId('timeline-empty')).toBeVisible();
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

test('会话新建与重命名', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'web-mobile') {
    // 移动布局无行内重命名入口,只验证顶栏新建;重命名走桌面布局分支。
    await page.getByTestId('session-create-mobile').click();
    await expect(page.getByTestId('session-picker')).toContainText('未命名创作');
    return;
  }

  const create = page.getByTestId('session-create');
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByTestId('session-panel').getByText('未命名创作')).toBeVisible();

  await page.getByTestId('session-rename').click();
  await page.getByTestId('session-rename-input').fill('落日湖泊系列');
  await page.getByTestId('session-rename-commit').click();
  await expect(page.getByTestId('session-panel').getByText('落日湖泊系列')).toBeVisible();
});

test('删除会话经确认对话框', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'web-mobile', '移动布局删除入口随会话管理面后续排卡');

  await page.getByTestId('session-create').click();
  await expect(page.getByTestId('session-panel').getByText('未命名创作')).toBeVisible();

  await page.getByTestId('session-remove').click();
  await page.getByTestId('session-remove-confirm').click();
  await expect(page.getByTestId('session-panel').getByText('未命名创作')).toBeHidden();
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

test('生成完成后的视觉基线', async ({ page }) => {
  await page.getByTestId('composer-prompt').fill('baseline shot');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
    timeout: 15_000,
  });
  await expect(page).toHaveScreenshot('workbench-finished.png');
});
