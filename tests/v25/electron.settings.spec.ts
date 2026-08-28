import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-e2e-'));
  page = await v25ShellPage(app);
});

test.afterAll(async () => {
  await app?.close();
});

test('v2.5 新渲染壳加载 features 设置屏', async () => {
  await expect(page.getByTestId('v25-shell')).toBeVisible();
  // 默认视图是工作台;经共享壳侧栏切到设置。
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('settings-host-badge')).toHaveText('桌面版');
});

test('账号卡经 IPC 桥返回未登录态,展示登录表单与侧栏登录入口', async () => {
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
  await expect(page.getByTestId('account-auth-form')).toBeVisible();
  await expect(page.getByTestId('account-footer-signed-out')).toBeVisible();
});

test('AI 连接:新建 → 密钥落安全存储 → 设为默认 → 删除,全程落 SQLite', async () => {
  const card = page.getByTestId('settings-ai-connections-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('ai-providers-empty')).toBeVisible();

  // 新建(带密钥)
  await page.getByTestId('ai-provider-new').click();
  await page.getByTestId('ai-provider-name').fill('测试网关');
  await page.getByTestId('ai-provider-base-url').fill('https://relay.example.com/v1');
  await page.getByTestId('ai-provider-model').fill('gemini-2.5-flash-image');
  await page.getByTestId('ai-provider-key').fill('sk-e2e-test-a1b2');
  await page.getByTestId('ai-provider-save').click();

  const list = page.getByTestId('ai-providers-list');
  await expect(list).toBeVisible();
  await expect(list.getByText('测试网关')).toBeVisible();
  // 首个连接自动成为默认;密钥只显示尾号
  await expect(list.getByTestId('ai-provider-active-badge')).toBeVisible();
  await expect(list.getByText(/密钥 …a1b2/)).toBeVisible();

  // SQLite 断言:行存在、has_key 置位、密钥明文不落库
  const db = new Database(desktopDbPath(userDataDir));
  const row = db
    .prepare('SELECT name, base_url, model, has_key, key_suffix, is_active FROM providers')
    .get() as {
    name: string;
    base_url: string;
    model: string;
    has_key: number;
    key_suffix: string | null;
    is_active: number;
  };
  db.close();
  expect(row).toMatchObject({
    name: '测试网关',
    base_url: 'https://relay.example.com/v1',
    model: 'gemini-2.5-flash-image',
    has_key: 1,
    key_suffix: 'a1b2',
    is_active: 1,
  });

  // 第二个连接不带密钥,再设为默认
  await page.getByTestId('ai-provider-new').click();
  await page.getByTestId('ai-provider-name').fill('备用连接');
  await page.getByTestId('ai-provider-base-url').fill('https://backup.example.com');
  await page.getByTestId('ai-provider-model').fill('flux-schnell');
  await page.getByTestId('ai-provider-save').click();
  await expect(list.getByText('备用连接')).toBeVisible();
  await expect(list.getByText('未配置密钥')).toBeVisible();

  await page.getByTestId('ai-provider-set-active').click();
  const backupRow = list.locator('li').filter({ hasText: '备用连接' });
  await expect(backupRow.getByTestId('ai-provider-active-badge')).toBeVisible();

  // 删除默认连接 → AlertDialog 确认 → 另一条自动接管默认
  await backupRow.getByTestId('ai-provider-delete').click();
  await page.getByTestId('ai-provider-delete-confirm').click();
  await expect(list.getByText('备用连接')).toBeHidden();
  await expect(list.getByTestId('ai-provider-active-badge')).toBeVisible();

  const db2 = new Database(desktopDbPath(userDataDir));
  const rows = db2.prepare('SELECT name, is_active FROM providers').all() as Array<{
    name: string;
    is_active: number;
  }>;
  db2.close();
  expect(rows).toEqual([{ name: '测试网关', is_active: 1 }]);
});

test('云同步卡:未登录时开关禁用,经 IPC 桥返回未开启态', async () => {
  const card = page.getByTestId('settings-sync-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(card.getByText('同步未开启')).toBeVisible();
  await expect(page.getByTestId('sync-subtitle')).toHaveText('登录账号后可开启');
  await expect(page.getByTestId('sync-toggle')).toBeDisabled();
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

test('桌面设置页视觉基线(深色)', async () => {
  // 自含导航:不依赖前序用例停在设置屏(允许单跑/过滤跑)。
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('settings-theme-trigger').scrollIntoViewIfNeeded();
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page).toHaveScreenshot('desktop-settings-dark.png');

  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});
