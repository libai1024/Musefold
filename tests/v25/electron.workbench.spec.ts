import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

// 桌面工作台全链路:features 屏 → IPC 桥 → core SQLite + generate() 编排。
// 生成用「受控失败」链路(provider 无 API key):提交→run 落库→异步失败→
// 时间线呈现失败态与重试。成功出图链路等 M4d 接入连接管理后补 mock provider。

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-workbench-'));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('新建会话并重命名', async () => {
  await page.getByTestId('session-create').click();
  await expect(page.getByTestId('session-panel').getByText('未命名创作')).toBeVisible();

  // 行动作 hover 渐显(静息态让位给相对时间戳),先悬停会话行。
  await page.getByTestId('session-panel').getByText('未命名创作').hover();
  await page.getByTestId('session-rename').click();
  await page.getByTestId('session-rename-input').fill('霓虹城市习作');
  await page.getByTestId('session-rename-commit').click();
  await expect(page.getByTestId('session-panel').getByText('霓虹城市习作')).toBeVisible();
});

test('草稿输入防抖落盘,重启后仍在', async () => {
  await page.getByTestId('composer-prompt').fill('cyberpunk street, rainy night');
  // 防抖 800ms + 主进程写文件
  await page.waitForTimeout(1_500);

  await app.close();
  ({ app } = await launchV25App('musefold-v25-workbench-', userDataDir));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('composer-prompt')).toHaveValue('cyberpunk street, rainy night');
});

test('无 AI 连接时发送禁用并引导去设置', async () => {
  // V25-UI-SPEC §3.2 无连接态:不再允许提交后报错,而是禁发 + 引导。
  await page.getByTestId('composer-prompt').fill('a lighthouse in fog');
  await expect(page.getByTestId('composer-no-provider')).toBeVisible();
  await expect(page.getByTestId('composer-no-provider')).toContainText('尚未配置可用的 AI 连接');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
});

test('提交生成:run 落库,失败态与重试呈现在时间线', async () => {
  // 直插一个 provider 行(无 API key):generate() 会真实走到取 key 失败,
  // run 状态机 queued → failed,驱动 UI 轮询与失败呈现。
  const db = new Database(desktopDbPath(userDataDir));
  db.prepare(
    `INSERT INTO providers (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
     VALUES ('e2e-provider', 'E2E 连接', 'openai-compatible', 'http://127.0.0.1:9/v1', 'test-model', 0, 1, ?, ?)`,
  ).run(Date.now(), Date.now());
  db.close();

  // 桥无 provider 变更推送,重启应用让渲染层 providers 目录重新加载(解除禁发)。
  await app.close();
  ({ app } = await launchV25App('musefold-v25-workbench-', userDataDir));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();

  await page.getByTestId('composer-prompt').fill('a lighthouse in fog');
  await page.getByTestId('composer-submit').click();

  // 用户气泡立即出现(run 已落库)
  await expect(page.getByTestId('timeline').getByText('a lighthouse in fog')).toBeVisible();
  // 异步失败后,轮询把状态翻成 failed,错误与重试入口可见
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'failed', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('job-error')).toBeVisible();
  await expect(page.getByTestId('job-retry')).toBeVisible();
});

test('重试生成产生新 turn', async () => {
  await page.getByTestId('job-retry').first().click();
  // 两个 turn(原始 + 重试),重试的最终也失败
  await expect(page.getByTestId('job-status')).toHaveCount(2, { timeout: 5_000 });
  await expect(page.getByTestId('job-status').nth(1)).toHaveAttribute('data-status', 'failed', {
    timeout: 15_000,
  });
});

test('桌面工作台视觉基线(浅色)', async () => {
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page).toHaveScreenshot('desktop-workbench-light.png');
});
