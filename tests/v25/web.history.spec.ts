import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

// 首启引导夹具(U01-onboarding):既有用例都是未登录环境,不预置完成哨兵会被引导层盖住。
test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

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
  /** 宿主上报的终态用时(05 §7 元信息);缺省即未上报。 */
  durationMs?: number;
  seed?: number;
  /** 失败行的错误码(决定检视建议动作与重试可用性)。 */
  errorCode?: string;
}

function localDayString(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** 近 N 分钟的 ISO。UTC+8 午夜后「30 分钟前」会落到昨天,自定义「今天」会漏行,故夹到当日本地。 */
function iso(offsetMinutes: number): string {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const raw = now - offsetMinutes * 60_000;
  const created =
    raw >= startOfToday.getTime() ? raw : startOfToday.getTime() + (70 - offsetMinutes) * 1000;
  return new Date(created).toISOString().replace(/Z$/, '+00:00');
}

const SEEDS: SeedJob[] = [
  {
    id: 'run-a',
    parentRunId: null,
    status: 'succeeded',
    prompt: 'castle in clouds',
    deletedAt: null,
    createdAt: iso(30),
    durationMs: 1_500,
    seed: 987_654,
  },
  {
    id: 'run-a2',
    parentRunId: 'run-a',
    status: 'succeeded',
    prompt: 'castle in clouds v2',
    deletedAt: null,
    createdAt: iso(20),
    durationMs: 2_100,
  },
  {
    id: 'run-b',
    parentRunId: null,
    status: 'failed',
    prompt: 'broken robot sketch',
    deletedAt: null,
    createdAt: iso(10),
    errorCode: 'GENERATION_UPSTREAM_REJECTED',
  },
  {
    id: 'run-c',
    parentRunId: null,
    status: 'succeeded',
    prompt: 'deleted artifact',
    deletedAt: iso(5),
    createdAt: iso(60),
    durationMs: 900,
  },
  // 父记录已被永久删除的微调:列表降级为孤儿根,检视给「来源记录已删除」。
  {
    id: 'run-orphan',
    parentRunId: 'run-vanished',
    status: 'succeeded',
    prompt: 'orphan refinement',
    deletedAt: null,
    createdAt: iso(2),
    durationMs: 1_100,
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
        request: {
          prompt: seed.prompt,
          size: '1024x1024',
          quality: 'high',
          aspectRatio: '1:1',
          count: 1,
        },
        providerModel: 'musefold-image-pro',
        costPoints: 2,
        durationMs: seed.durationMs ?? null,
        seed: seed.seed ?? null,
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
            ? { code: seed.errorCode ?? 'GENERATION_UPSTREAM_REJECTED', message: '上游拒绝了请求' }
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
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let items = [...jobs.values()];
      items = deletedOnly
        ? items.filter((job) => job.deletedAt != null)
        : items.filter((job) => job.deletedAt == null);
      if (status) items = items.filter((job) => job.status === status);
      if (search) items = items.filter((job) => job.request.prompt.toLowerCase().includes(search));
      // 自定义区间含首含尾(05 §7):按 epoch 比较,避免时区串比较歧义。
      if (from) items = items.filter((job) => Date.parse(job.createdAt) >= Date.parse(from));
      if (to) items = items.filter((job) => Date.parse(job.createdAt) <= Date.parse(to));
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return route.fulfill(json({ items, nextCursor: null }));
    }

    // 批量清理(05 §7):前两种软删入回收站(资产保留),empty-trash 永久删除回收站全部。
    if (path === '/generations/cleanup' && method === 'POST') {
      const { scope } = JSON.parse(request.postData() ?? '{}') as { scope: string };
      let affected = 0;
      for (const job of [...jobs.values()]) {
        if (scope === 'empty-trash') {
          if (job.deletedAt == null) continue;
          jobs.delete(job.id);
          affected += 1;
          continue;
        }
        const match =
          scope === 'failed-and-cancelled'
            ? job.status === 'failed'
            : Date.parse(job.createdAt) < Date.now() - 30 * 86_400_000;
        if (job.deletedAt != null || !match) continue;
        job.deletedAt = iso(0);
        affected += 1;
      }
      return route.fulfill(json({ affected }));
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
  await expect(page.getByTestId('history-row')).toHaveCount(4);
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
  await expect(page.getByTestId('history-row')).toHaveCount(4);
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
  await expect(page.getByTestId('history-row')).toHaveCount(3);

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
  await expect(page.getByTestId('history-row')).toHaveCount(4);
});

test('行元信息:成功行给「x 积分 · ys」,检视参数区补齐尺寸/比例/质量/种子/成本/用时', async ({
  page,
}) => {
  const row = page.getByTestId('history-row').filter({ hasText: 'castle in clouds v2' });
  await expect(row).toContainText('2 积分');
  await expect(row).toContainText('2.1s');

  await page
    .getByTestId('history-row')
    .filter({ hasText: 'castle in clouds' })
    .first()
    .getByTestId('history-row-open')
    .click();
  const params = page.getByTestId('history-inspector-params');
  await expect(params).toContainText('musefold-image-pro');
  await expect(params).toContainText('1:1');
  await expect(params).toContainText('high');
  await expect(params).toContainText('987654');
  await expect(params).toContainText('2 积分');
  await expect(params).toContainText('1.5s');
});

test('错误建议:检视给标题 + 建议动作,重试按错误码放开', async ({ page }) => {
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'broken robot sketch' })
    .getByTestId('history-row-open')
    .click();
  await expect(page.getByTestId('history-inspector-error')).toContainText('上游拒绝了这次生成');
  await expect(page.getByTestId('history-detail-error-action')).toContainText('检查参数');
  // GENERATION_UPSTREAM_REJECTED 是可重试错误码 → 检视给重试入口。
  await expect(page.getByTestId('history-inspector-retry')).toBeVisible();
});

test('成功行不给重试入口(宿主 retry 只受理失败/取消)', async ({ page }) => {
  const row = page.getByTestId('history-row').filter({ hasText: 'castle in clouds v2' });
  await expect(row.getByTestId('history-row-remove')).toHaveCount(1);
  await expect(row.getByTestId('history-row-retry')).toHaveCount(0);
});

test('谱系区:「派生 n 条」与「来自」可点跳,孤儿链路给降级文案', async ({ page }) => {
  // 根行显示微调计数。
  await expect(page.getByTestId('history-thread-count')).toContainText('+1 微调');

  await page
    .getByTestId('history-row')
    .filter({ hasText: 'castle in clouds' })
    .first()
    .getByTestId('history-row-open')
    .click();
  await expect(page.getByTestId('history-lineage')).toContainText('派生 1 条');
  await page.getByTestId('history-lineage-node').first().click();
  await expect(page.getByTestId('history-inspector-prompt')).toContainText('castle in clouds v2');
  await expect(page.getByTestId('history-lineage')).toContainText('来自');
});

test('孤儿微调:行标注「微调」,检视给「来源记录已删除」降级文案', async ({ page }) => {
  const orphan = page.getByTestId('history-row').filter({ hasText: 'orphan refinement' });
  await expect(orphan).toHaveAttribute('data-orphan', 'true');
  await expect(orphan.getByTestId('history-refinement-tag')).toContainText('微调');

  await orphan.getByTestId('history-row-open').click();
  await expect(page.getByTestId('history-lineage-missing-parent')).toContainText('来源记录已删除');
});

test('自定义时间区间:两个日期输入进入查询(含首含尾)', async ({ page }) => {
  await page.getByTestId('history-filter-date').click();
  await page.getByRole('option', { name: '自定义' }).click();
  await expect(page.getByTestId('history-filter-custom-range')).toBeVisible();

  // 按未删种子的本地日历日含首含尾,避免午夜后「近 1 小时」跨自然日。
  const liveTimes = SEEDS.filter((seed) => seed.deletedAt === null).map((seed) =>
    new Date(seed.createdAt).getTime(),
  );
  const fromDay = localDayString(new Date(Math.min(...liveTimes)));
  const toDay = localDayString(new Date(Math.max(...liveTimes)));
  await page.getByTestId('history-filter-custom-from').fill(fromDay);
  await page.getByTestId('history-filter-custom-to').fill(toDay);
  await expect(page.getByTestId('history-row')).toHaveCount(4);

  // 窗口推到明天 → 空窗口,列表落筛选空态。
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextDay = localDayString(tomorrow);
  await page.getByTestId('history-filter-custom-from').fill(nextDay);
  await page.getByTestId('history-filter-custom-to').fill(nextDay);
  await expect(page.getByTestId('history-empty')).toBeVisible();
});

test('批量清理:回收站工具行三项各带确认,清空回收站永久删除', async ({ page }) => {
  await page.getByTestId('history-tab-trash').click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);

  // 软删范围:失败与已取消 → 记录进回收站,文案说清图片文件仍保留。
  await page.getByTestId('history-cleanup-menu').click();
  await page.getByTestId('history-cleanup-failed-and-cancelled').click();
  await expect(page.getByText('图片文件仍保留', { exact: false })).toBeVisible();
  await page.getByTestId('history-cleanup-confirm').click();
  await expect(page.getByTestId('history-row')).toHaveCount(2);

  // 清空回收站:破坏性动作,确认后记录彻底消失。
  await page.getByTestId('history-cleanup-menu').click();
  await page.getByTestId('history-cleanup-empty-trash').click();
  await expect(page.getByText('清空回收站?')).toBeVisible();
  await page.getByTestId('history-cleanup-confirm').click();
  await expect(page.getByTestId('history-empty')).toBeVisible();

  await page.getByTestId('history-tab-all').click();
  await expect(page.getByTestId('history-row')).toHaveCount(3);
});

test('Web 宿主:无磁盘占用 readout,无本机文件动作', async ({ page }) => {
  await page.getByTestId('history-tab-trash').click();
  await expect(page.getByTestId('history-cleanup-menu')).toBeVisible();
  await expect(page.getByTestId('history-disk-usage')).toHaveCount(0);

  await page.getByTestId('history-tab-all').click();
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'castle in clouds v2' })
    .getByTestId('history-row-open')
    .click();
  await expect(page.getByTestId('history-inspector')).toBeVisible();
  await expect(page.getByTestId('history-inspector-reveal-asset')).toHaveCount(0);
  await expect(page.getByTestId('history-inspector-copy-asset')).toHaveCount(0);
});

test('历史屏视觉基线', async ({ page }) => {
  await expect(page.getByTestId('history-row')).toHaveCount(4);
  // 缩略图未完成解码时行内布局会晃,等全部图片就绪再截,基线才可复现。
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[data-testid="history-row"] img')).every(
      (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
    ),
  );
  // 行时间戳随运行时刻变化,mask 掉保证基线稳定。
  await expect(page).toHaveScreenshot('history-list.png', {
    mask: [page.getByTestId('history-row-time')],
  });
});

test('重试交互：列表/详情共享处理中，重复点击仅一个请求，失败可见且下次新授权使用新 key', async ({
  page,
}) => {
  const keys: string[] = [];
  const releases: Array<() => void> = [];
  await page.route('**/api/v1/generations/run-b/retry', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    await new Promise<void>((resolve) => releases.push(resolve));
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'VALIDATION_FAILED',
          message: '原任务费用尚未核对',
          requestId: 'synthetic-retry',
          retryable: false,
        },
      }),
    });
  });
  const row = page.getByTestId('history-row').filter({ hasText: 'broken robot sketch' });
  // Two synchronous UI events exercise admission before a disabled-button render.
  await row.getByTestId('history-row-retry').evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => keys.length).toBe(1);
  await expect(row.getByTestId('history-row-retry')).toBeDisabled();
  await row.getByTestId('history-row-open').click();
  const detail = page.getByTestId('history-inspector-retry');
  await expect(detail).toBeDisabled();
  await detail.evaluate((button) => (button as HTMLButtonElement).click());
  expect(keys).toHaveLength(1);
  releases.shift()?.();
  await expect(page.getByText('重试未完成', { exact: true })).toBeVisible();
  await expect(page.getByText('原任务费用尚未核对', { exact: true })).toBeVisible();
  await expect(detail).toBeEnabled();
  await detail.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).not.toBe(keys[1]);
  releases.shift()?.();
  await expect(detail).toBeEnabled();
});
