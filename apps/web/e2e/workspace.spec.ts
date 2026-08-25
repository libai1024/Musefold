import { expect, test, type Page } from '@playwright/test';

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual(
      await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.clientWidth,
      })),
    );
}

async function expectResultActionsAboveComposer(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const actions = document.querySelector('.result-actions');
    const composer = document.querySelector('.composer-dock');
    if (!actions || !composer) return null;
    const actionRect = actions.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return {
      actionBottom: actionRect.bottom,
      composerTop: composerRect.top,
    };
  });
  expect(layout).not.toBeNull();
  expect(layout!.actionBottom).toBeLessThanOrEqual(layout!.composerTop);
}

async function waitForFixtureWorkspace(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('generation-workbench')).toBeVisible();
  await expect(page.getByText('开发预览', { exact: true })).toBeVisible();
}

async function openCompactSidebar(page: Page): Promise<void> {
  const layout = page.getByTestId('product-sidebar-layout');
  const rail = page.getByTestId('product-sidebar-rail');
  await expect(layout).toHaveAttribute('data-compact', 'true');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const toggle = page.getByRole('button', { name: '展开侧栏' });
  if ((await rail.getAttribute('data-open')) !== 'true') {
    await toggle.click();
  }
  await expect(rail).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('product-sidebar')).toBeVisible();
}

test('desktop prompt to generation to history flow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  await page.getByTestId('product-sidebar').getByRole('button', { name: '提示词库' }).click();
  await expect(page.getByTestId('library-page')).toBeVisible();
  await page.getByTestId('library-search').fill('夜色建筑');
  await page.waitForTimeout(500);
  const promptRow = page.getByTestId('prompt-row').filter({
    hasText: '夜色建筑摄影',
  });
  await expect(promptRow).toHaveCount(1);
  await promptRow.getByTestId('prompt-row-use').click();

  await expect(page.getByTestId('refine-source')).toContainText('夜色建筑摄影');
  await expect(page.getByTestId('refine-source')).toContainText('引用提示词');
  await expect(page.getByLabel('生成图片')).toBeEnabled();
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });
  const generatedPrompt = await page
    .getByTestId('generation-user-message')
    .getByTestId('generation-prompt')
    .textContent();
  await page.getByTestId('generation-user-message').click();
  await expect(page.getByTestId('generation-user-message-actions')).toBeVisible();
  await page.getByTestId('generation-user-message-copy').click();
  await page.getByTestId('generation-user-message-edit').click();
  await expect(page.getByTestId('generation-composer-prompt')).toHaveValue(
    generatedPrompt?.trim() ?? '',
  );
  await page
    .getByTestId('generation-composer-prompt')
    .fill('雨后的夜间建筑摄影，加入一束克制的清晨光');
  await expect(page.getByTestId('draft-save-status')).toHaveText('已同步', {
    timeout: 4_000,
  });
  await expectResultActionsAboveComposer(page);
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('generation-save-prompt').click();
  await expect(page.getByTestId('generation-save-prompt')).toHaveText('已存为提示词');

  await page.getByTestId('sidebar-new-design').click();
  await expect(page.getByTestId('generation-composer-prompt')).toHaveValue('');
  await expect(page.locator('.mf-workbench-turn')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '新设计' })).toBeVisible();

  await page.getByTestId('product-sidebar').getByRole('button', { name: '提示词库' }).click();
  await expect(
    page.getByTestId('library-page').locator('.mf-page-heading > div > span'),
  ).toHaveText('4');

  const lifecycleRow = page.locator('[data-prompt-id="prompt-night-architecture"]');
  await lifecycleRow.getByTestId('prompt-row-open').click();
  await expect(page.getByTestId('prompt-detail')).toBeVisible();
  await page.getByTestId('detail-menu').click();
  await page.getByTestId('detail-edit').click();
  await page.getByTestId('prompt-editor-title').fill('夜色建筑摄影（已编辑）');
  await page.getByTestId('prompt-editor-submit').click();
  await expect(page.getByTestId('detail-title')).toHaveText('夜色建筑摄影（已编辑）');

  await page.getByTestId('detail-menu').click();
  await page.getByTestId('detail-delete').click();
  await page.getByTestId('detail-delete-confirm').click();
  await expect(page.getByTestId('library-page')).toBeVisible();
  await expect(
    page.getByTestId('library-page').locator('.mf-page-heading > div > span'),
  ).toHaveText('3');

  await page.getByTestId('library-menu').click();
  await page.getByTestId('library-trash').click();
  const trashRow = page.getByTestId('trash-row').filter({
    hasText: '夜色建筑摄影（已编辑）',
  });
  await expect(trashRow).toHaveCount(1);
  await trashRow.getByTestId('trash-restore').click();
  await expect(trashRow).toHaveCount(0);
  await page.getByTestId('prompt-trash').getByRole('button', { name: '提示词库' }).click();
  await expect(
    page.getByTestId('library-page').locator('.mf-page-heading > div > span'),
  ).toHaveText('4');

  await page.getByTestId('product-sidebar').getByRole('button', { name: '生成历史' }).click();
  await expect(page.getByTestId('history-page')).toBeVisible();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-status-label')).toHaveText('已完成');
  await page.getByTestId('history-row').getByRole('button', { name: '打开' }).click();
  await expect(page.getByTestId('history-detail')).toBeVisible();
  await expect(page.getByTestId('history-workspace')).toHaveAttribute('data-detail-open', 'true');
  await expect(page.getByTestId('history-inspector')).toHaveCSS('width', '320px');
  const historyGeometry = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('[data-testid="history-workspace"]');
    const list = workspace?.querySelector<HTMLElement>('.mf-history-workspace-list');
    const inspector = workspace?.querySelector<HTMLElement>('[data-testid="history-inspector"]');
    if (!workspace || !list || !inspector) return null;
    return {
      workspace: workspace.getBoundingClientRect().width,
      list: list.getBoundingClientRect().width,
      inspector: inspector.getBoundingClientRect().width,
    };
  });
  expect(historyGeometry).not.toBeNull();
  expect(historyGeometry?.inspector).toBeCloseTo(320, 0);
  expect(historyGeometry?.list ?? 0).toBeGreaterThan(historyGeometry?.inspector ?? 0);
  expect((historyGeometry?.list ?? 0) + (historyGeometry?.inspector ?? 0)).toBeCloseTo(
    historyGeometry?.workspace ?? 0,
    0,
  );
  await expect(page.getByTestId('history-detail-prompt')).toContainText('雨后的夜间建筑摄影');
  await expect(page.getByTestId('history-detail-download')).toBeVisible();
  await page.getByTestId('history-detail-save').click();
  await expect(page.getByText('已存入个人提示词库')).toBeVisible();
  await page.getByTestId('history-detail-delete').click();
  await page.getByTestId('history-detail-delete-confirm').click();
  await expect(page.getByTestId('history-page')).toBeVisible();
  await expect(page.getByTestId('history-row')).toHaveCount(0);

  await page.getByRole('button', { name: '回收站' }).click();
  await expect(page.getByTestId('history-trash-row')).toHaveCount(1);
  await page.getByTestId('history-trash-restore').click();
  await expect(page.getByTestId('history-trash-row')).toHaveCount(0);
  await page.getByTestId('history-trash').getByRole('button', { name: '生成历史' }).click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await testInfo.attach('desktop-history', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(browserErrors).toEqual([]);
});

test('shared empty state and composer popovers match desktop interactions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  await page.getByTestId('web-topbar-search').click();
  await expect(page.getByTestId('library-page')).toBeVisible();
  await expect(page.getByTestId('library-search')).toBeFocused();
  await page.getByTestId('sidebar-new-design').click();
  await expect(page.getByTestId('generation-workbench')).toBeVisible();

  const example = page.getByTestId('generation-example').first();
  const suggestion = await example.textContent();
  await example.click({ force: true });
  const prompt = page.getByTestId('generation-composer-prompt');
  await expect(prompt).toHaveValue(suggestion ?? '');
  await expect(prompt).toBeFocused();

  await page.getByTestId('refine-ratio-trigger').click();
  await expect(page.getByTestId('refine-ratio-menu')).toBeVisible();
  const ratioBox = await page.getByTestId('refine-ratio-menu').boundingBox();
  const composerBox = await page.getByTestId('workbench-composer-surface').boundingBox();
  expect(ratioBox && composerBox).toBeTruthy();
  expect(ratioBox!.y + ratioBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);
  await page.getByTestId('refine-ratio-16:9').click();
  await expect(page.getByTestId('refine-ratio-trigger')).toHaveAttribute('data-value', '16:9');

  await page.getByTestId('workbench-more-settings').click();
  const settings = page.getByRole('dialog', { name: '生成设置' });
  await expect(settings).toBeVisible();
  const settingsLabel = page.getByTestId('workbench-more-settings').locator('span');
  const settingsLabelMetrics = await settingsLabel.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(settingsLabelMetrics.scrollWidth).toBeLessThanOrEqual(
    settingsLabelMetrics.clientWidth + 1,
  );
  const settingsBox = await settings.boundingBox();
  expect(settingsBox && composerBox).toBeTruthy();
  expect(settingsBox!.y + settingsBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);
  await settings.getByRole('radio', { name: '超清' }).click();
  await expect(page.getByTestId('workbench-more-settings')).toContainText('超清');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.getByTestId('workbench-more-settings')).toBeFocused();
  await page.getByTestId('workbench-image-picker').click();
  await expect(page.getByTestId('workbench-context-menu')).toBeVisible();
  await page.getByTestId('workbench-context-ref-prompt').click();
  await expect(page.getByTestId('library-page')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});

test('shared composer auto-resizes and keeps Desktop keyboard semantics', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await waitForFixtureWorkspace(page);

  const prompt = page.getByTestId('generation-composer-prompt');
  const composer = page.getByTestId('workbench-composer-surface');
  const initialHeight = (await composer.boundingBox())?.height ?? 0;
  await prompt.fill(Array.from({ length: 8 }, (_, index) => `第${index + 1}行`).join('\n'));
  await expect
    .poll(async () => (await composer.boundingBox())?.height ?? 0)
    .toBeGreaterThan(initialHeight);

  await prompt.fill('Shift Enter 保留换行');
  await prompt.press('Shift+Enter');
  await expect(prompt).toHaveValue('Shift Enter 保留换行\n');
  await expect(page.locator('.mf-workbench-turn')).toHaveCount(0);

  await prompt.fill('Enter 直接生成');
  await prompt.press('Enter');
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator('.mf-workbench-turn')).toHaveCount(1);
});

test('shared prompt editor keeps discard, collapse and shortcut interactions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  await page.getByTestId('product-sidebar').getByRole('button', { name: '提示词库' }).click();
  await page.getByTestId('library-new').click();
  await expect(page.getByTestId('prompt-editor')).toBeVisible();

  await page.getByTestId('prompt-editor-title').fill('编辑器状态测试');
  await page.getByTestId('prompt-editor-cancel').click();
  await expect(page.getByRole('alert')).toContainText('未保存的改动');
  await page.getByTestId('prompt-editor-discard').click();
  await expect(page.getByTestId('library-page')).toBeVisible();

  await page.getByTestId('library-new').click();
  await page.getByTestId('prompt-editor-title').fill('快捷保存提示词');
  await page.getByTestId('prompt-editor-content').fill('用于验证共享编辑器行为的正文');
  await expect(page.getByTestId('prompt-editor-negative')).toHaveCount(0);
  await page.getByTestId('prompt-editor-negative-toggle').click();
  await expect(page.getByTestId('prompt-editor-negative')).toBeVisible();
  await page.keyboard.press('Control+S');
  await expect(page.getByTestId('detail-title')).toHaveText('快捷保存提示词');
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});

test('mobile generation flow remains usable without overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  const prompt = page.getByTestId('generation-composer-prompt');
  await prompt.fill('清晨窗边的玻璃花瓶，安静自然光');
  await page.getByTestId('refine-ratio-trigger').click();
  await expect(page.getByTestId('refine-ratio-menu')).toBeVisible();
  // v1.1.1: на мобильном меню открывается как bottom sheet во всю ширину.
  const ratioBox = await page.getByTestId('refine-ratio-menu').boundingBox();
  const viewport = page.viewportSize();
  expect(ratioBox && viewport).toBeTruthy();
  expect(ratioBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(ratioBox!.y + ratioBox!.height).toBeGreaterThanOrEqual(viewport!.height - 1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('refine-ratio-menu')).toHaveCount(0);
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });
  await expectResultActionsAboveComposer(page);

  await openCompactSidebar(page);
  await page.getByTestId('product-sidebar').getByTestId('nav-history').click();
  await expect(page.getByTestId('history-page')).toBeVisible();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await page.getByTestId('history-row').getByRole('button', { name: '打开' }).click();
  await expect(page.getByTestId('history-detail')).toBeVisible();
  await expect(page.getByTestId('history-detail-content')).toBeVisible();
  await expect(page.getByTestId('history-detail-back')).toBeVisible();
  await expect(page.getByTestId('history-workspace')).toHaveAttribute('data-detail-open', 'true');
  await expectNoHorizontalOverflow(page);
  await testInfo.attach('mobile-history-detail', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByTestId('history-detail-back').click();
  await expect(page.getByTestId('history-workspace')).toHaveAttribute('data-detail-open', 'false');
  await expect(page.getByTestId('history-row')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await testInfo.attach('mobile-history-list', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(browserErrors).toEqual([]);
});

test('cancelled workbench results can be retried in place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  await page.getByTestId('generation-composer-prompt').fill('取消后重试的结果卡测试');
  await page.getByLabel('生成图片').click();
  await page.getByLabel('取消生成').click();
  await expect(
    page.locator('.mf-generation-result-surface[data-status="cancelled"]'),
  ).toBeVisible();
  const resultSurface = page.getByTestId('generation-result-surface');
  await expect(resultSurface.getByRole('button', { name: '重试' })).toBeVisible();

  await resultSurface.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator('.mf-generation-result-surface[data-status="success"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});

test('recent conversations restore and archive from the shared sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  const promptText = '用于恢复和归档的会话';
  const prompt = page.getByTestId('generation-composer-prompt');
  await prompt.fill(promptText);
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });
  const secondPromptText = '同一会话中的第二次生成';
  await prompt.fill(secondPromptText);
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.mf-workbench-turn')).toHaveCount(2);
  await expect(page.locator('.generated-asset img')).toHaveCount(2, {
    timeout: 8_000,
  });
  const sessionRow = page.locator(`[data-session-id]`).filter({
    hasText: promptText,
  });
  await expect(sessionRow).toHaveCount(1);

  await page.getByTestId('sidebar-new-design').click();
  await expect(prompt).toHaveValue('');
  await sessionRow.getByRole('button', { name: promptText, exact: true }).click();
  await expect(prompt).toHaveValue(secondPromptText);
  await expect(page.locator('.mf-workbench-turn')).toHaveCount(2);
  await expect(page.locator('.generated-asset img')).toHaveCount(2);
  await expect(page.locator('.mf-workbench-user-prompt')).toHaveText([
    promptText,
    secondPromptText,
  ]);

  await sessionRow.hover();
  await sessionRow.getByRole('button', { name: `归档聊天：${promptText}` }).click();
  await expect(sessionRow).toHaveCount(0);
  await expect(prompt).toHaveValue('');
  await expect(page.getByRole('heading', { name: '新设计' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});

test('background generation remains tracked when switching workbench sessions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  const prompt = page.getByTestId('generation-composer-prompt');
  const backgroundPrompt = '后台会话恢复测试';
  await prompt.fill(backgroundPrompt);
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.mf-workbench-turn')).toHaveCount(1);

  await page.getByTestId('sidebar-new-design').click();
  await expect(prompt).toHaveValue('');
  const backgroundSession = page.locator('[data-session-id]').filter({
    hasText: backgroundPrompt,
  });
  await expect(backgroundSession).toHaveCount(1);
  await expect(backgroundSession).toHaveAttribute('data-status', 'running');

  await backgroundSession.locator('.mf-workbench-session-open').click();
  await expect(prompt).toHaveValue(backgroundPrompt);
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator('.mf-generation-result-surface[data-status="success"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});

test('shared account and Cloud MCP connection policies keep their actions deterministic', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  await page.getByTestId('sidebar-account').click();
  await expect(page.getByTestId('account-screen')).toBeVisible();
  await expect(page.getByTestId('account-summary-panel')).toContainText('186 积分');
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录个人账户' })).toBeVisible();

  await page.locator('input[autocomplete="username"]').fill('musefold');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(page.getByTestId('generation-workbench')).toBeVisible();

  await page.getByTestId('nav-settings').click();
  await page
    .getByRole('navigation', { name: '设置分区' })
    .getByRole('button', { name: '已连接应用' })
    .click();
  await expect(page.getByTestId('connected-apps-screen')).toBeVisible();
  const connection = page.getByTestId('connection-row');
  await expect(connection).toContainText('Musefold Preview Client');

  const modeControl = connection.getByRole('radiogroup', { name: '生图模式' });
  const automaticMode = modeControl.getByRole('radio', { name: '预算内自动' });
  await automaticMode.click();
  const reauth = page.getByRole('dialog', { name: '确认自动化权限' });
  await expect(reauth).toBeVisible();
  await reauth.locator('input[type="password"]').fill('password123');
  await reauth.getByRole('button', { name: '确认修改' }).click();
  await expect(automaticMode).toBeChecked();

  await connection.getByRole('button', { name: '暂停连接' }).click();
  await expect(connection.getByRole('button', { name: '恢复连接' })).toBeVisible();
  await connection.getByRole('button', { name: '撤销授权' }).click();
  const revoke = connection.getByRole('group', { name: '确认撤销授权' });
  await expect(revoke).toBeVisible();
  await revoke.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(connection).toContainText('已撤销');
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});

test('recent conversation actions stay shared with Desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await waitForFixtureWorkspace(page);

  await page.getByTestId('generation-composer-prompt').fill('一张留白纸感的明信片');
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });

  const row = page.locator('[data-conversation-row]').first();
  const topbarMenu = page.getByTestId('web-topbar-session-menu-trigger');
  await expect(topbarMenu).toBeVisible();
  await topbarMenu.click();
  await expect(page.getByTestId('conversation-context-pin')).toBeVisible();
  await page.getByTestId('conversation-context-pin').click();
  await expect(page.getByRole('heading', { name: '置顶' })).toBeVisible();

  await topbarMenu.click();
  await page.getByTestId('conversation-context-rename').click();
  const titleInput = page.getByRole('textbox', { name: '对话标题' });
  await titleInput.fill('明信片工作台');
  await titleInput.press('Enter');
  await expect(row).toContainText('明信片工作台');
  await expect(page.getByTestId('titlebar-title')).toHaveText('明信片工作台');

  await row.click({ button: 'right' });
  await page.getByTestId('conversation-context-unread').click();
  await expect(row.getByTestId('conversation-status-dot')).toHaveAttribute('data-status', 'unread');

  await topbarMenu.click();
  await page.getByTestId('conversation-context-delete').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '删除对话' }).click();
  await expect(page.locator('[data-conversation-row]')).toHaveCount(0);
});

test('shared sidebar resizes, collapses, and becomes a compact drawer', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('musefold:sidebar-width');
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  const rail = page.getByTestId('product-sidebar-rail');
  const resizeHandle = page.getByTestId('sidebar-resize-handle');
  // v2.0 Phase B(10 §4.2):默认 248px,键盘 ArrowLeft 步进 16px,双击回默认。
  await expect(rail).toHaveCSS('width', '248px');
  await resizeHandle.press('ArrowLeft');
  await expect(rail).toHaveCSS('width', '232px');
  await resizeHandle.dblclick();
  await expect(rail).toHaveCSS('width', '248px');

  await page.getByTestId('sidebar-collapse').click();
  await expect(rail).toHaveCSS('width', '0px');
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible();

  await page.setViewportSize({ width: 640, height: 760 });
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect(rail).toHaveCSS('width', '320px');
  await expect(page.getByTestId('sidebar-scrim')).toBeVisible();
  await page.getByTestId('sidebar-scrim').click({ position: { x: 500, y: 30 } });
  await expect(rail).toHaveCSS('width', '0px');
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});
