import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { clickRowAction, createPrompt, openPromptDetail } from './prompt-helpers';

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

test('行点击开详情 Inspector:正文/元数据/相关作品齐全,菜单可编辑', async () => {
  const detail = await openPromptDetail(page, '水墨山水');
  await expect(detail.getByTestId('prompt-detail-content')).toHaveText(
    'chinese ink painting, mountains',
  );
  await expect(detail.getByTestId('prompt-detail-meta')).toContainText('本机创建');
  await expect(detail.getByTestId('prompt-detail-facts')).toContainText('使用次数');
  // 主进程 generation.list 走真实 SQLite:该提示词没生成过图,面板给空态。
  await expect(detail.getByTestId('prompt-detail-works-empty')).toBeVisible();

  await detail.getByTestId('prompt-detail-menu').click();
  await page.getByTestId('prompt-detail-edit').click();
  await expect(page.getByTestId('prompt-editor')).toBeVisible();
  await page.getByTestId('prompt-editor-cancel').click();

  await detail.getByTestId('prompt-detail-close').click();
  await expect(detail).toBeHidden();
});

test('清空回收站经 prompts.emptyTrash 一次性硬删(双重确认)', async () => {
  await createPrompt(page, '待清一', 'purge me a');
  await createPrompt(page, '待清二', 'purge me b');
  await clickRowAction(page, '待清一', 'prompt-row-remove');
  await clickRowAction(page, '待清二', 'prompt-row-remove');

  await page.getByTestId('prompt-tab-trash').click();
  await expect(page.getByText('待清一')).toBeVisible();

  await page.getByTestId('prompt-empty-trash').click();
  const dialog = page.getByTestId('prompt-empty-trash-dialog');
  await expect(dialog).toContainText('2 条');
  await dialog.getByTestId('prompt-empty-trash-confirm').click();

  await expect(page.getByTestId('prompt-empty')).toBeVisible();
  await page.getByTestId('prompt-tab-all').click();
  await expect(page.getByText('待清一')).toBeHidden();
});

test('快捷键:⌘/Ctrl+K 从别的屏跳库并聚焦搜索,「/」屏内聚焦', async () => {
  await page.getByTestId('nav-workbench').click();
  await expect(page.getByTestId('prompt-library')).toBeHidden();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('prompt-library')).toBeVisible();
  await expect(page.getByTestId('prompt-search')).toBeFocused();

  await page.getByTestId('prompt-search').blur();
  await page.keyboard.press('/');
  await expect(page.getByTestId('prompt-search')).toBeFocused();
  await expect(page.getByTestId('prompt-search')).toHaveValue('');
});

test('编辑器 ⌘/Ctrl+S 走提交路径落库', async () => {
  await page.getByTestId('prompt-create').click();
  await page.getByTestId('prompt-editor-title').fill('快捷保存');
  await page.getByTestId('prompt-editor-content').fill('saved with cmd+s');
  await page.keyboard.press('ControlOrMeta+s');

  await expect(page.getByTestId('prompt-editor')).toBeHidden();
  await expect(page.getByText('快捷保存')).toBeVisible();

  // 收尾:不给后面的视觉基线留额外行。
  await clickRowAction(page, '快捷保存', 'prompt-row-remove');
  await page.getByTestId('prompt-tab-trash').click();
  await page.getByTestId('prompt-empty-trash').click();
  await page.getByTestId('prompt-empty-trash-confirm').click();
  await expect(page.getByTestId('prompt-empty')).toBeVisible();
  await page.getByTestId('prompt-tab-all').click();
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
  // 前序用例(清空回收站等)的 toast 会晚几秒才消失,进快照就是伪差异。
  await expect(page.locator('[data-sonner-toast][data-visible="true"]')).toHaveCount(0, {
    timeout: 10_000,
  });
  await page.mouse.move(0, 0);
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
