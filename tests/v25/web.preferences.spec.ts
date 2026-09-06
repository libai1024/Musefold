import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

// 首启引导夹具(U01-onboarding):既有用例都是未登录环境,不预置完成哨兵会被引导层盖住。
test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

/** 偏好只走本机 localStorage;工作台列表给空结果,避免无 API 时屏空白。 */
async function installMinimalWorkbenchMock(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = route.request().method();

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
    return route.continue();
  });
}

async function openAppearance(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  const back = page.getByTestId('settings-section-back');
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByTestId('settings-nav-appearance').click();
  await expect(page.getByTestId('settings-generation-defaults-card')).toBeVisible();
}

async function openWorkbench(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await page.getByTestId('bottom-nav-workbench').click();
  } else {
    await page.getByTestId('nav-workbench').click();
  }
  await expect(page.getByTestId('workbench')).toBeVisible();
}

async function startNewSession(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await page.getByTestId('session-create-mobile').click();
  } else {
    await page.getByTestId('session-create').click();
  }
}

test('改默认比例后新建会话 Composer 预选一致', async ({ page, isMobile }) => {
  await installMinimalWorkbenchMock(page);
  await openAppearance(page);

  await page.getByTestId('settings-default-ratio-trigger').click();
  await page.getByTestId('settings-default-ratio-16x9').click();
  await expect(page.getByTestId('settings-default-ratio-trigger')).toContainText('16:9');

  await openWorkbench(page, isMobile);
  await startNewSession(page, isMobile);
  await expect(page.getByTestId('composer-ratio')).toContainText('16:9');
});

test('密度切换会更新 html data-density', async ({ page }) => {
  await openAppearance(page);
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');

  await page.getByTestId('settings-density-compact').click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

  await page.getByTestId('settings-density-comfortable').click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
});
