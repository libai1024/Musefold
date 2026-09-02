import { expect, test } from '@playwright/test';

const SIDEBAR_WIDTH_KEY = 'musefold:sidebar-width';

test.beforeEach(async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
});

test('desktop sidebar resizes by keyboard and pointer, persists, collapses without covering content', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop sidebar behavior');

  await page.evaluate((key) => localStorage.removeItem(key), SIDEBAR_WIDTH_KEY);
  await page.reload();

  const sidebar = page.getByTestId('app-sidebar');
  const handle = page.getByTestId('sidebar-resize-handle');
  await expect(sidebar).toBeVisible();
  await expect(handle).toHaveAttribute('aria-valuenow', '248');

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '264');
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '220');
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '360');
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '248');

  const box = await handle.boundingBox();
  if (!box) throw new Error('sidebar resize handle has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 36, box.y + 80, { steps: 4 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '284');
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), SIDEBAR_WIDTH_KEY))
    .toBe('284');

  await page.reload();
  await expect(page.getByTestId('sidebar-resize-handle')).toHaveAttribute('aria-valuenow', '284');

  await page.getByTestId('sidebar-collapse').click();
  await expect(page.getByTestId('app-sidebar')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-expand-rail')).toBeVisible();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('sidebar-expand').click();
  await expect(page.getByTestId('app-sidebar')).toBeVisible();
});

test('765px uses the drawer and 768px restores the persistent sidebar', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'explicit desktop-browser boundary coverage');

  await page.setViewportSize({ width: 765, height: 800 });
  await expect(page.getByTestId('sidebar-drawer-open')).toBeVisible();
  await expect(page.getByTestId('app-sidebar')).toHaveCount(0);
  await page.getByTestId('sidebar-drawer-open').click();
  await expect(page.getByRole('dialog', { name: '主导航' })).toBeVisible();

  await page.setViewportSize({ width: 768, height: 800 });
  await expect(page.getByRole('dialog', { name: '主导航' })).toHaveCount(0);
  await expect(page.getByTestId('sidebar-drawer-open')).toHaveCount(0);
  await expect(page.getByTestId('app-sidebar')).toBeVisible();
});

test('mobile drawer traps the shell, closes on Escape, restores focus, and dismisses on navigation', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'mobile drawer behavior');

  const trigger = page.getByTestId('sidebar-drawer-open');
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: '主导航' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('mainview-frame')).toHaveAttribute('inert', '');
  await expect(page.getByTestId('app-bottom-nav')).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))))
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId('mainview-frame')).not.toHaveAttribute('inert', '');

  await trigger.click();
  await page.getByTestId('nav-prompts').click();
  await expect(page).toHaveURL(/\/prompts$/);
  await expect(page.getByRole('dialog', { name: '主导航' })).toHaveCount(0);
});
