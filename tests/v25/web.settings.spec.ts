import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
});

test('设置页在两种视口渲染同一 features 屏幕', async ({ page, isMobile }) => {
  await expect(page.getByTestId('settings-host-badge')).toHaveText('Web 版');
  await expect(page.getByTestId('settings-appearance-card')).toBeVisible();

  if (isMobile) {
    await expect(page.getByTestId('app-bottom-nav')).toBeVisible();
    await expect(page.getByTestId('app-sidebar')).toBeHidden();
  } else {
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await expect(page.getByTestId('app-bottom-nav')).toBeHidden();
  }
});

test('账号卡在未登录(无 API)时显示登录提示', async ({ page }) => {
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
});

test('主题切换写入偏好并在刷新后保持', async ({ page }) => {
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();

  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.reload();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // 还原浅色,避免污染后续快照用例
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('设置页视觉基线(浅色)', async ({ page }) => {
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
  await expect(page).toHaveScreenshot('settings-light.png', { fullPage: true });
});

test('设置页视觉基线(深色)', async ({ page }) => {
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
  await expect(page).toHaveScreenshot('settings-dark.png', { fullPage: true });

  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
});
