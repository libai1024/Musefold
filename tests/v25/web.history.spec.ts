import { expect, type Page, test } from '@playwright/test';

// Web 历史屏 E2E:features/history + api-client 真代码,网络层内存 mock。
// 预置:成功 1(含重试子行)+ 失败 1 + 已删 1,覆盖筛选/详情/回收站/线程缩进。

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface SeedJob {
  id: string;
  parentRunId: string | null;
  status: 'succeeded' | 'failed';
  prompt: string;
  deletedAt: string | null;
  createdAt: string;
}

function iso(offsetMinutes: number): string {
  return new Date(Date.now() - offsetMinutes * 60_000).toISOString().replace(/Z$/, '+00:00');
}

const SEEDS: SeedJob[] = [
  {
    id: 'run-a',
    parentRunId: null,
    status: 'succeeded',
    prompt: 'castle in clouds',
    deletedAt: null,
    createdAt: iso(30),
  },
  {
    id: 'run-a2',
    parentRunId: 'run-a',
    status: 'succeeded',
    prompt: 'castle in clouds v2',
    deletedAt: null,
    createdAt: iso(20),
  },
  {
    id: 'run-b',
    parentRunId: null,
    status: 'failed',
    prompt: 'broken robot sketch',
    deletedAt: null,
    createdAt: iso(10),
  },
  {
    id: 'run-c',
    parentRunId: null,
    status: 'succeeded',
    prompt: 'deleted artifact',
    deletedAt: iso(5),
    createdAt: iso(60),
  },
];

async function installHistoryApiMock(page: Page): Promise<void> {
  const jobs = new Map(
    SEEDS.map((seed) => [
      seed.id,
      {
        id: seed.id,
        sessionId: 'session-1',
        parentRunId: seed.parentRunId,
        promptId: null,
        actorType: 'web' as const,
        approvalStatus: 'not_required' as const,
        status: seed.status,
        progress: 100,
        request: { prompt: seed.prompt, size: 'auto', quality: 'auto', count: 1 },
        providerModel: 'musefold-image-pro',
        costPoints: 2,
        assets:
          seed.status === 'succeeded'
            ? [
                {
                  id: `${seed.id}-asset`,
                  url: `data:image/png;base64,${TINY_PNG}`,
                  mimeType: 'image/png',
                  width: 1,
                  height: 1,
                  byteSize: 68,
                  expiresAt: '2099-01-01T00:00:00+00:00',
                },
              ]
            : [],
        error:
          seed.status === 'failed'
            ? { code: 'GENERATION_UPSTREAM_REJECTED', message: '上游拒绝了请求' }
            : null,
        createdAt: seed.createdAt,
        startedAt: seed.createdAt,
        finishedAt: seed.createdAt,
        deletedAt: seed.deletedAt,
      },
    ]),
  );

  function json(body: unknown, status = 200) {
    return { status, contentType: 'application/json', body: JSON.stringify(body) };
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
      return route.fulfill(json({ items: [], nextCursor: null }));
    }
    if (path === '/generations/providers') {
      return route.fulfill(json([]));
    }

    if (path === '/generations' && method === 'GET') {
      const deletedOnly = url.searchParams.get('deletedOnly') === 'true';
      const status = url.searchParams.get('status');
      const search = url.searchParams.get('search')?.toLowerCase();
      let items = [...jobs.values()];
      items = deletedOnly
        ? items.filter((job) => job.deletedAt != null)
        : items.filter((job) => job.deletedAt == null);
      if (status) items = items.filter((job) => job.status === status);
      if (search) items = items.filter((job) => job.request.prompt.toLowerCase().includes(search));
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return route.fulfill(json({ items, nextCursor: null }));
    }

    const jobMatch = path.match(/^\/generations\/([^/]+)(?:\/(cancel|retry|restore))?$/);
    if (jobMatch) {
      const [, id, action] = jobMatch;
      const job = jobs.get(id);
      if (!job)
        return route.fulfill(json({ code: 'GENERATION_NOT_FOUND', message: '不存在' }, 404));
      if (action === 'restore' && method === 'POST') {
        job.deletedAt = null;
        return route.fulfill(json(job));
      }
      if (action === 'retry' && method === 'POST') {
        const retry = { ...job, id: `${id}-retry`, parentRunId: id, createdAt: iso(0) };
        jobs.set(retry.id, retry);
        return route.fulfill(json(retry, 201));
      }
      if (method === 'DELETE') {
        job.deletedAt = iso(0);
        return route.fulfill(json(job));
      }
      if (method === 'GET') return route.fulfill(json(job));
    }

    return route.fulfill(
      json({ code: 'NOT_FOUND', message: `mock 未覆盖:${method} ${path}` }, 404),
    );
  });
}

test.beforeEach(async ({ page }) => {
  await installHistoryApiMock(page);
  await page.goto('/history');
  await expect(page.getByTestId('history')).toBeVisible();
});

test('列表渲染:线程缩进与状态徽标', async ({ page }) => {
  await expect(page.getByTestId('history-row')).toHaveCount(3);
  // 重试子行缩进连接线
  await expect(page.getByTestId('history-thread-connector')).toHaveCount(1);
  await expect(
    page.getByTestId('history-row').filter({ hasText: 'castle in clouds v2' }),
  ).toBeVisible();
});

test('状态筛选与清除', async ({ page }) => {
  await page.getByTestId('history-filter-status').click();
  await page.getByRole('option', { name: '失败' }).click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-row')).toHaveAttribute('data-status', 'failed');

  await page.getByTestId('history-filter-clear').click();
  await expect(page.getByTestId('history-row')).toHaveCount(3);
});

test('搜索防抖过滤', async ({ page }) => {
  await page.getByTestId('history-filter-search').fill('robot');
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-row')).toContainText('broken robot sketch');
});

test('详情面板:参数与错误信息', async ({ page }) => {
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'broken robot sketch' })
    .getByTestId('history-row-open')
    .click();
  await expect(page.getByTestId('history-inspector')).toBeVisible();
  await expect(page.getByTestId('history-inspector-error')).toContainText('上游拒绝了请求');
  await expect(page.getByTestId('history-inspector-prompt')).toContainText('broken robot sketch');
  await page.getByTestId('history-inspector-close').click();
  await expect(page.getByTestId('history-inspector')).toBeHidden();
});

test('移入回收站与恢复闭环', async ({ page }) => {
  const target = page.getByTestId('history-row').filter({ hasText: 'broken robot sketch' });
  await target.getByTestId('history-row-remove').click();
  await expect(page.getByTestId('history-row')).toHaveCount(2);

  await page.getByTestId('history-tab-trash').click();
  // 预置已删 1 + 刚删 1
  await expect(page.getByTestId('history-row')).toHaveCount(2);
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'broken robot sketch' })
    .getByTestId('history-row-restore')
    .click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);

  await page.getByTestId('history-tab-all').click();
  await expect(page.getByTestId('history-row')).toHaveCount(3);
});

test('历史屏视觉基线', async ({ page }) => {
  await expect(page.getByTestId('history-row')).toHaveCount(3);
  // 行时间戳随运行时刻变化,mask 掉保证基线稳定。
  await expect(page).toHaveScreenshot('history-list.png', {
    mask: [page.getByTestId('history-row-time')],
  });
});
