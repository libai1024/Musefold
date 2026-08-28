import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await launchV25App('musefold-v25-e2e-');
  page = await v25ShellPage(app);
});

test.afterAll(async () => {
  await app?.close();
});

test('v2.5 新渲染壳加载 features 设置屏', async () => {
  await expect(page.getByTestId('v25-shell')).toBeVisible();
  // 默认视图是提示词库;经共享壳侧栏切到设置。
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('settings-host-badge')).toHaveText('桌面版');
});

test('账号卡经 IPC 桥返回未登录态', async () => {
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
});

test('主题切换经主进程持久化并生效', async () => {
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('减弱动效开关往返主进程', async () => {
  const toggle = page.getByTestId('settings-reduced-motion');
  await expect(toggle).toHaveAttribute('data-state', 'unchecked');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', 'checked');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', 'unchecked');
});

test('桌面设置页视觉基线(浅色)', async () => {
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
  await expect(page).toHaveScreenshot('desktop-settings-light.png');
});
