import { expect, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

// Web 不伪造豆包轨:无连接分区、无豆包卡、账号菜单无「更多连接」。

test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

test('Web 设置与账号菜单不出现豆包入口', async ({ page, isMobile }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('settings-nav-connections')).toHaveCount(0);
  await expect(page.getByTestId('settings-doubao-card')).toHaveCount(0);

  if (isMobile) {
    await page.getByTestId('sidebar-drawer-open').click();
    await expect(page.getByRole('dialog', { name: '主导航' })).toBeVisible();
  }
  await page.getByTestId('account-footer-signed-out').click();
  await expect(page.getByTestId('account-menu-login')).toBeVisible();
  await expect(page.getByTestId('account-menu-more')).toHaveCount(0);
});
