import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { clickRowAction, createPrompt } from './prompt-helpers';

// 桌面提示词库全链路:features 屏 → IPC 桥 → core SQLite(临时 userData,真实数据链)。

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app } = await launchV25App('musefold-v25-prompts-'));
  page = await v25ShellPage(app);
  // 壳默认视图是工作台,先切到提示词库
  await page.getByTestId('nav-prompts').click();
  await expect(page.getByTestId('prompt-library')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('新建提示词落库并出现在列表', async () => {
  await page.getByTestId('prompt-create').click();
  await page.getByTestId('prompt-editor-title').fill('胶片质感人像');
  await page.getByTestId('prompt-editor-content').fill('film grain portrait, kodak gold 200');
  await page.getByTestId('prompt-editor-negative').fill('lowres, watermark');
  await page.getByTestId('prompt-editor-submit').click();

  await expect(page.getByTestId('prompt-editor')).toBeHidden();
  await expect(page.getByText('胶片质感人像')).toBeVisible();
});

test('编辑修改标题', async () => {
  await clickRowAction(page, '胶片质感人像', 'prompt-row-edit');
  await page.getByTestId('prompt-editor-title').fill('胶片质感人像 v2');
  await page.getByTestId('prompt-editor-submit').click();
  await expect(page.getByTestId('prompt-editor')).toBeHidden();

  await expect(page.getByText('胶片质感人像 v2')).toBeVisible();
});

test('编辑器脏表单在 Escape 后要求确认,放弃不会更新已保存提示词', async () => {
  const originalTitle = '可保留的原始标题';
  const updatedTitle = '不应保存的标题';
  await createPrompt(page, originalTitle, 'original content');

  await clickRowAction(page, originalTitle, 'prompt-row-edit');
  await page.getByTestId('prompt-editor-title').fill(updatedTitle);
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('prompt-editor')).toBeVisible();
  await expect(page.getByTestId('prompt-editor-discard-dialog')).toBeVisible();
  await page.getByTestId('prompt-editor-continue').click();
  await expect(page.getByTestId('prompt-editor-discard-dialog')).toBeHidden();
  await expect(page.getByTestId('prompt-editor-title')).toHaveValue(updatedTitle);

  await page.getByTestId('prompt-editor-cancel').click();
  await page.getByTestId('prompt-editor-discard').click();
  await expect(page.getByTestId('prompt-editor')).toBeHidden();
  await expect(page.getByText(originalTitle)).toBeVisible();
  await expect(page.getByText(updatedTitle)).toBeHidden();
});

test('置顶经主进程 togglePin 持久化并进置顶节', async () => {
  await clickRowAction(page, '胶片质感人像 v2', 'prompt-row-pin');

  await expect(page.getByLabel('已置顶').first()).toBeVisible();
  await expect(page.getByText('置顶', { exact: false }).first()).toBeVisible();
});

test('搜索命中 FTS', async () => {
  await createPrompt(page, '水墨山水', 'chinese ink painting, mountains');

  await page.getByTestId('prompt-search').fill('水墨');
  await expect(page.getByText('水墨山水')).toBeVisible();
  await expect(page.getByText('胶片质感人像 v2')).toBeHidden();
  await page.getByTestId('prompt-search').fill('');
  await expect(page.getByText('胶片质感人像 v2')).toBeVisible();
});

test('软删进回收站,恢复回列表', async () => {
  await clickRowAction(page, '水墨山水', 'prompt-row-remove');
  await expect(page.getByText('水墨山水')).toBeHidden();

  await page.getByTestId('prompt-tab-trash').click();
  await expect(page.getByText('水墨山水')).toBeVisible();

  await clickRowAction(page, '水墨山水', 'prompt-row-restore');
  await expect(page.getByTestId('prompt-empty')).toBeVisible();

  await page.getByTestId('prompt-tab-all').click();
  await expect(page.getByText('水墨山水')).toBeVisible();
});

test('文件夹与标签目录管理', async () => {
  await page.getByTestId('taxonomy-open').click();
  await page.getByTestId('taxonomy-folder-name').fill('人像合集');
  await page.getByTestId('taxonomy-folder-create').click();
  await expect(page.getByTestId('taxonomy-panel').getByText('人像合集')).toBeVisible();

  await page.getByTestId('taxonomy-tag-name').fill('胶片');
  await page.getByTestId('taxonomy-tag-create').click();
  await expect(page.getByTestId('taxonomy-panel').getByText('胶片')).toBeVisible();
  await page.keyboard.press('Escape');

  // 新标签进筛选行
  await expect(page.getByTestId('prompt-tag-filter').getByText('胶片')).toBeVisible();
});

test('桌面提示词库视觉基线(浅色)', async () => {
  await expect(page.getByTestId('prompt-grid')).toBeVisible();
  await expect(page).toHaveScreenshot('desktop-prompts-light.png');
});

test('桌面提示词库视觉基线(深色)', async () => {
  // 数据屏的暗色基线:与设置屏一起守护 token 在明暗两套下的映射。
  // 走真实主题切换路径(设置屏),不直接改 class(会被 ThemeProvider 覆写)。
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByTestId('nav-prompts').click();
  await expect(page.getByTestId('prompt-grid')).toBeVisible();
  await expect(page).toHaveScreenshot('desktop-prompts-dark.png');

  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});
