import { rmSync } from 'node:fs';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';

// 豆包入口冻结边界证据:只断言共享入口可达,不进扫码/登录内部。

let app: ElectronApplication;
let page: Page;
let userDataDir = '';

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-doubao-entry-'));
  // This is an entry/IPC test, not live Doubao availability or QR-login validation.
  // Only the test-owned isolated Doubao partition receives a fixed signed-out page;
  // the frozen browser service still loads/inspects it and returns its real status DTO.
  await app.evaluate(({ session }) => {
    session.fromPartition('persist:musefold-doubao-web-v1').protocol.handle(
      'https',
      () =>
        new Response('<!doctype html><html><body><button>登录</button></body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    );
  });
  page = await v25ShellPage(app);
});

test.afterAll(async () => {
  await app?.close();
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('设置连接区可见豆包卡与开始登录入口', async () => {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('settings-nav-connections').click();
  await expect(page.getByTestId('settings-section-connections')).toBeVisible();
  await expect(page.getByTestId('settings-doubao-card')).toBeVisible();
  await expect(page.getByTestId('doubao-login-start')).toBeVisible();
});

test('侧栏账号更多连接「豆包 · 去登录」落到连接区豆包卡', async () => {
  await page.getByTestId('nav-workbench').click();
  await expect(page.getByTestId('account-footer-signed-out')).toBeVisible();
  await page.getByTestId('account-footer-signed-out').click();
  const more = page.getByTestId('account-menu-more');
  await expect(more).toBeVisible();
  // Entry routing is the subject here: explicitly activate the real submenu trigger.
  // Native desktop pointer/hover timing is not used as this routing test's prerequisite.
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const doubao = page.getByTestId('account-menu-doubao');
  await expect(doubao).toBeVisible();
  await expect(doubao).toContainText('去登录');
  await doubao.click();
  await expect(page.getByTestId('settings-section-connections')).toBeVisible();
  await expect(page.getByTestId('settings-doubao-card')).toBeVisible();
});
