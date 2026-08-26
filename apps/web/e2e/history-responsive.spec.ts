import { expect, test, type Page } from '@playwright/test';

async function openFixtureHistory(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto('./');
  await expect(page.getByTestId('generation-workbench')).toBeVisible();
  await page.getByTestId('generation-composer-prompt').fill('UI-03 响应式历史详情');
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.generated-asset img')).toBeVisible({ timeout: 8_000 });

  if (width <= 760) {
    await page.getByRole('button', { name: '展开侧栏' }).click();
    await expect(page.getByTestId('product-sidebar')).toBeVisible();
  }
  await page.getByTestId('product-sidebar').getByTestId('nav-history').click();
  await expect(page.getByTestId('history-page')).toBeVisible();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test('1280 keeps the list and occupying inspector layout', async ({ page }) => {
  await openFixtureHistory(page, 1280, 720);
  await page.getByTestId('history-row').getByRole('button', { name: '打开' }).click();

  await expect(page.getByTestId('history-inspector')).toBeVisible();
  await expect(page.getByTestId('history-inspector')).toHaveCSS('width', '320px');
  await expect(page.getByTestId('history-sheet')).toHaveCount(0);
  await expect(page.getByTestId('history-row')).toBeVisible();
  await expect(page.getByTestId('history-detail')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('[data-testid="history-workspace"]')!;
    const list = workspace.querySelector<HTMLElement>('.mf-history-workspace-list')!;
    const inspector = workspace.querySelector<HTMLElement>('[data-testid="history-inspector"]')!;
    return {
      workspaceWidth: workspace.getBoundingClientRect().width,
      listWidth: list.getBoundingClientRect().width,
      inspectorWidth: inspector.getBoundingClientRect().width,
    };
  });
  expect(geometry.listWidth + geometry.inspectorWidth).toBeCloseTo(geometry.workspaceWidth, 0);
  await expectNoHorizontalOverflow(page);
});

test('390 opens a modal bottom sheet and restores the opening row focus', async ({ page }) => {
  await openFixtureHistory(page, 390, 844);
  const openButton = page.getByTestId('history-row').getByRole('button', { name: '打开' });
  await openButton.click();

  const sheet = page.getByTestId('history-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('dialog', { name: '生成历史 · 生成详情' })).toBeVisible();
  await expect(page.getByTestId('history-inspector')).toHaveCount(0);
  await expect(page.locator('.mf-ui-dialog-overlay')).toBeVisible();
  await expect(page.locator('.mf-history-workspace-list')).toHaveAttribute('inert', '');
  await expect(page.getByTestId('history-detail')).toBeVisible();
  await expect(page.locator('.mf-history-inspector-action-bar')).toBeVisible();

  await expect
    .poll(() => sheet.evaluate((element) => element.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(845);
  const sheetGeometry = await sheet.evaluate((element) => {
    const sheetRect = element.getBoundingClientRect();
    const actions = element
      .querySelector('.mf-history-inspector-action-bar')!
      .getBoundingClientRect();
    return {
      top: sheetRect.top,
      bottom: sheetRect.bottom,
      actionTop: actions.top,
      actionBottom: actions.bottom,
      viewportHeight: window.innerHeight,
      bodyOverflow: getComputedStyle(document.body).overflow,
    };
  });
  expect(sheetGeometry.top).toBeGreaterThanOrEqual(44);
  expect(sheetGeometry.actionTop).toBeGreaterThanOrEqual(sheetGeometry.top);
  expect(sheetGeometry.actionBottom).toBeLessThanOrEqual(sheetGeometry.bottom + 1);
  expect(sheetGeometry.bottom).toBeLessThanOrEqual(sheetGeometry.viewportHeight + 1);
  expect(sheetGeometry.bodyOverflow).toBe('hidden');

  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab');
    await expect
      .poll(() => sheet.evaluate((root) => root.contains(document.activeElement)))
      .toBe(true);
  }
  await expectNoHorizontalOverflow(page);

  await page.getByTestId('history-detail-menu').click();
  const download = page.getByTestId('history-detail-download');
  await expect(download).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await download.click();
  await downloadEvent;

  await page.getByTestId('history-detail-close').click();
  await expect(sheet).toHaveCount(0);
  await expect(openButton).toBeFocused();

  await openButton.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(openButton).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
