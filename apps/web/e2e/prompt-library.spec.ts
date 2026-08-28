import { expect, test, type Page } from '@playwright/test';

async function openPromptLibrary(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('generation-workbench')).toBeVisible();

  const sidebar = page.getByTestId('product-sidebar');
  if (!(await sidebar.isVisible())) {
    await page.getByRole('button', { name: '展开侧栏' }).click();
  }
  await sidebar.getByRole('button', { name: '提示词库' }).click();
  await expect(page.getByTestId('prompt-library-workspace')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test('Prompt Library keeps list and Inspector together on wide screens', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPromptLibrary(page);

  const row = page.locator(
    '[data-testid="prompt-row"][data-prompt-id="prompt-night-architecture"]',
  );
  const open = row.getByTestId('prompt-row-open');
  await open.click();

  const workspace = page.getByTestId('prompt-library-workspace');
  const list = page.getByTestId('prompt-list');
  const inspector = page.getByTestId('prompt-inspector');
  await expect(workspace).toHaveAttribute('data-detail-open', 'true');
  await expect(inspector).toHaveAttribute('aria-hidden', 'false');
  await expect(inspector).toHaveAccessibleName('提示词详情');
  await expect(list).toBeVisible();
  await expect(page.getByTestId('library-search')).toBeVisible();
  await expect(row).toHaveAttribute('aria-current', 'true');

  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>(
      '[data-testid="prompt-library-workspace"]',
    );
    const list = document.querySelector<HTMLElement>('[data-testid="prompt-list"]');
    const inspector = document.querySelector<HTMLElement>('[data-testid="prompt-inspector"]');
    if (!workspace || !list || !inspector) return null;
    const workspaceRect = workspace.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const inspectorRect = inspector.getBoundingClientRect();
    return {
      workspaceWidth: workspaceRect.width,
      listWidth: listRect.width,
      inspectorWidth: inspectorRect.width,
      listRight: listRect.right,
      inspectorLeft: inspectorRect.left,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.inspectorWidth).toBeCloseTo(404, 0);
  expect(geometry!.listRight).toBeLessThanOrEqual(geometry!.inspectorLeft + 1);
  expect(geometry!.listWidth + geometry!.inspectorWidth).toBeCloseTo(geometry!.workspaceWidth, 0);
  await testInfo.attach('prompt-library-wide-inspector', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  await page.getByTestId('detail-back').click();
  await expect(workspace).toHaveAttribute('data-detail-open', 'false');
  await expect(inspector).toHaveAttribute('aria-hidden', 'true');
  await expect(open).toBeFocused();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expectNoHorizontalOverflow(page);
});

test('Prompt Library compact width uses a single detail page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 720, height: 800 });
  await openPromptLibrary(page);

  const row = page.locator(
    '[data-testid="prompt-row"][data-prompt-id="prompt-night-architecture"]',
  );
  await row.getByTestId('prompt-row-open').click();

  const list = page.getByTestId('prompt-list');
  const inspector = page.getByTestId('prompt-inspector');
  await expect(list).toBeHidden();
  await expect(inspector).toBeVisible();
  const workspaceBox = await page.getByTestId('prompt-library-workspace').boundingBox();
  const inspectorBox = await inspector.boundingBox();
  expect(workspaceBox && inspectorBox).toBeTruthy();
  expect(inspectorBox!.width).toBeCloseTo(workspaceBox!.width, 0);
  await expect(page.getByTestId('detail-back')).toContainText('提示词库');
  await testInfo.attach('prompt-library-compact-detail', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  await page.getByTestId('detail-back').click();
  await expect(list).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('wide screens open the editor and trash as stable modals', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPromptLibrary(page);

  // 编辑器：大屏为稳定几何弹窗（与 Desktop PromptEditor 同基线），非整页形态。
  await page.getByTestId('library-new').click();
  const editorDialog = page.getByTestId('web-prompt-editor-dialog');
  await expect(editorDialog).toBeVisible();
  await expect(page.getByTestId('prompt-library-workspace')).toBeVisible();
  // 入场动画结束后的稳定几何：宽 576、水平居中。
  await expect
    .poll(() => editorDialog.evaluate((element) => element.getBoundingClientRect().width))
    .toBeCloseTo(576, 1);
  const editorCenter = await editorDialog.evaluate(
    (element) => element.getBoundingClientRect().x + element.getBoundingClientRect().width / 2,
  );
  expect(editorCenter).toBeCloseTo(640, 1);
  await testInfo.attach('prompt-library-wide-editor-modal', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  // Esc 不直接关弹窗，走共享表单的放弃确认流。
  await page.getByTestId('prompt-editor-title').fill('大屏弹窗草稿');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alert')).toContainText('未保存的改动');
  await page.getByTestId('prompt-editor-discard').click();
  await expect(page.getByTestId('web-prompt-editor-dialog')).toHaveCount(0);
  await expect(page.getByTestId('library-page')).toBeVisible();

  // 回收站：同一档位用 Desktop 风格 modal（共享 PromptTrashScreen 保留 testid）。
  await page.getByTestId('library-menu').click();
  await page.getByTestId('library-trash').click();
  const trashDialog = page.getByTestId('web-prompt-trash-dialog');
  await expect(trashDialog).toBeVisible();
  await expect(page.getByTestId('prompt-trash')).toBeVisible();
  await expect
    .poll(() => trashDialog.evaluate((element) => element.getBoundingClientRect().width))
    .toBeCloseTo(512, 1);
  const trashCenter = await trashDialog.evaluate(
    (element) => element.getBoundingClientRect().x + element.getBoundingClientRect().width / 2,
  );
  expect(trashCenter).toBeCloseTo(640, 1);
  await testInfo.attach('prompt-library-wide-trash-modal', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  await page.getByTestId('prompt-trash').getByRole('button', { name: '提示词库' }).click();
  await expect(page.getByTestId('web-prompt-trash-dialog')).toHaveCount(0);
  await expect(page.getByTestId('library-page')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('Prompt Library phone view and editor remain full-page substates', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPromptLibrary(page);

  const row = page.locator(
    '[data-testid="prompt-row"][data-prompt-id="prompt-night-architecture"]',
  );
  await row.getByTestId('prompt-row-open').click();
  await expect(page.getByTestId('prompt-list')).toBeHidden();
  await expect(page.getByTestId('prompt-detail')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByTestId('detail-menu').click();
  await page.getByTestId('detail-edit').click();
  await expect(page.getByTestId('prompt-editor')).toBeVisible();
  await expect(page.getByTestId('prompt-library-workspace')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await testInfo.attach('prompt-library-phone-editor', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  await page.getByTestId('prompt-editor-cancel').click();
  await expect(page.getByTestId('prompt-detail')).toBeVisible();
  await expect(page.getByTestId('prompt-list')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});
