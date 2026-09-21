import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

type UsageMode = 'ready' | 'empty' | 'error';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function datesEnding(end: string, count: number): string[] {
  const [year, month, day] = end.split('-').map(Number);
  const cursor = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1));
  cursor.setUTCDate(cursor.getUTCDate() - (count - 1));
  return Array.from({ length: count }, () => {
    const date = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return date;
  });
}

function chartFields(range: '7d' | '30d' | '90d', generationCount: number) {
  const dayCount = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const dates = datesEnding('2026-09-06', dayCount);
  return {
    byDay: dates.map((date, index) => {
      const last = index === dates.length - 1;
      return {
        date,
        generationCount: last ? generationCount : 0,
        succeededCount: last ? generationCount : 0,
        failedCount: 0,
        cancelledCount: 0,
        costPoints: last ? generationCount * 2 : null,
        successRate: last ? 1 : null,
      };
    }),
    byModel: generationCount
      ? [{ model: 'musefold-image-pro', generationCount, costPoints: generationCount * 2 }]
      : [],
  };
}

function summaryForRange(range: '7d' | '30d' | '90d') {
  const counts = { '7d': 1, '30d': 4, '90d': 9 } as const;
  const generationCount = counts[range];
  return {
    range,
    from: '2026-08-08T12:00:00.000+00:00',
    to: '2026-09-06T12:00:00.000+00:00',
    generationCount,
    succeededCount: generationCount,
    failedCount: 0,
    cancelledCount: 0,
    imageCount: generationCount,
    costPoints: generationCount * 2,
    successRate: 1,
    byProvider: [
      {
        providerId: null,
        label: 'Musefold 云生图',
        generationCount,
        costPoints: generationCount * 2,
      },
    ],
    ...chartFields(range, generationCount),
  };
}

const EMPTY = {
  range: '30d' as const,
  from: '2026-08-08T12:00:00.000+00:00',
  to: '2026-09-06T12:00:00.000+00:00',
  generationCount: 0,
  succeededCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  imageCount: 0,
  costPoints: null,
  successRate: null,
  byProvider: [],
  ...chartFields('30d', 0),
};

async function installUsageApiMock(page: Page, mode: UsageMode): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/account/status') {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'AUTH_REQUIRED', message: '未登录' }),
      });
    }
    if (path === '/generations/providers' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (path === '/workbench/sessions' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
    }
    if (path === '/usage/summary' && method === 'GET') {
      if (mode === 'error') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: '使用统计加载失败',
              requestId: 'usage-e2e',
              retryable: true,
            },
          }),
        });
      }
      if (mode === 'empty') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(EMPTY),
        });
      }
      const rangeParam = url.searchParams.get('range');
      const range = rangeParam === '7d' || rangeParam === '90d' ? rangeParam : '30d';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(summaryForRange(range)),
      });
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: `mock 未覆盖:${method} ${path}`,
          requestId: 'usage-e2e',
          retryable: false,
        },
      }),
    });
  });
}

async function openUsageSection(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  const back = page.getByTestId('settings-section-back');
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByTestId('settings-nav-usage').click();
  await expect(page.getByTestId('settings-section-usage')).toBeVisible();
}

test('使用统计:三种范围切换数字,空态与错误可重试', async ({ page }) => {
  await installUsageApiMock(page, 'ready');
  await openUsageSection(page);

  await expect(page.getByTestId('settings-usage-card')).toBeVisible();
  await expect(page.getByTestId('settings-usage-generation-count')).toHaveText('4');
  await expect(page.getByTestId('settings-usage-success-rate')).toHaveText('100%');
  await expect(page.getByTestId('settings-usage-image-count')).toHaveText('4');
  await expect(page.getByTestId('settings-usage-cost')).toHaveText('8');
  await expect(page.getByTestId('settings-usage-charts')).toBeVisible();
  await expect(page.getByTestId('settings-usage-chart-trend')).toBeVisible();
  await expect(page.getByTestId('settings-usage-chart-provider')).toBeVisible();
  await expect(page.getByTestId('settings-usage-chart-model')).toBeVisible();
  await expect(page.getByTestId('settings-usage-chart-success')).toBeVisible();
  await expect(page.locator('[data-testid="settings-usage-chart-trend"] table')).toHaveCount(1);

  await page.getByTestId('settings-usage-range-7d').click();
  await expect(page.getByTestId('settings-usage-generation-count')).toHaveText('1');
  await expect(page.getByTestId('settings-usage-cost')).toHaveText('2');

  await page.getByTestId('settings-usage-range-90d').click();
  await expect(page.getByTestId('settings-usage-generation-count')).toHaveText('9');
  await expect(page.getByTestId('settings-usage-cost')).toHaveText('18');
});

test('使用统计空态:范围内无记录', async ({ page }) => {
  await installUsageApiMock(page, 'empty');
  await openUsageSection(page);
  await expect(page.getByTestId('settings-usage-empty')).toHaveText('这段时间还没有生成记录');
  await expect(page.getByTestId('settings-usage-summary')).toHaveCount(0);
  await expect(page.getByTestId('settings-usage-charts')).toContainText('该时段没有生成记录');
  await expect(page.getByTestId('settings-usage-chart-trend')).toHaveCount(0);
});

test('使用统计错误态:就地错误卡 + 重试', async ({ page }) => {
  await installUsageApiMock(page, 'error');
  await openUsageSection(page);
  await expect(page.getByTestId('settings-usage-error')).toBeVisible();
  await expect(page.getByTestId('settings-usage-retry')).toBeVisible();
});
