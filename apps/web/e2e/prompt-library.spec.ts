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
