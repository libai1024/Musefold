import { expect, test, type Page } from '@playwright/test';

async function openFixture(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto('./');
  await expect(page.getByTestId('generation-workbench')).toBeVisible();
  await expect(page.getByText('开发预览', { exact: true })).toBeVisible();
}

async function openCompactSidebar(page: Page): Promise<void> {
  const layout = page.getByTestId('product-sidebar-layout');
  await expect(layout).toHaveAttribute('data-compact', 'true');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const rail = page.getByTestId('product-sidebar-rail');
  const toggle = page.getByRole('button', { name: '展开侧栏' });
  if ((await rail.count()) === 0) await toggle.click();
  await expect(rail).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('product-sidebar')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test('sidebar identity and app menus are mutually exclusive on desktop', async ({ page }) => {
  await openFixture(page, 1280, 720);

  const identityTrigger = page.getByTestId('provider-quick-switch');
  const settingsTrigger = page.getByTestId('sidebar-settings');

  await identityTrigger.click();
  const identityMenu = page.getByTestId('identity-switcher');
  await expect(identityMenu).toBeVisible();
  await expect(identityMenu.getByTestId('account-source-option-cloud')).toHaveAttribute(
    'role',
    'menuitemradio',
  );
  await expect(identityMenu.getByTestId('account-source-option-cloud')).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await settingsTrigger.click();
  await expect(identityMenu).toHaveCount(0);
  const settingsMenu = page.getByTestId('sidebar-settings-menu');
  await expect(settingsMenu).toBeVisible();
  await expect(settingsMenu.getByTestId('sidebar-settings-open')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(settingsMenu).toHaveCount(0);
  await expect(settingsTrigger).toBeFocused();

  await identityTrigger.click();
  await expect(identityMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(identityMenu).toHaveCount(0);
  await expect(identityTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test('sidebar menus remain stable at the 760px compact drawer boundary', async ({ page }) => {
  await openFixture(page, 760, 900);
  await openCompactSidebar(page);

  const sidebar = page.getByTestId('product-sidebar');
  const identityTrigger = sidebar.getByTestId('provider-quick-switch');
  const settingsTrigger = sidebar.getByTestId('sidebar-settings');
  await identityTrigger.click();
  await expect(page.getByTestId('identity-switcher')).toBeVisible();
  await expect(page.getByTestId('identity-switcher')).not.toContainText('豆包');

  await settingsTrigger.click();
  await expect(page.getByTestId('identity-switcher')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-settings-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sidebar-settings-menu')).toHaveCount(0);
  await expect(settingsTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test('sidebar menus keep the phone boundary Cloud-only at 680px', async ({ page }) => {
  await openFixture(page, 680, 844);
  await openCompactSidebar(page);

  const sidebar = page.getByTestId('product-sidebar');
  const identityTrigger = sidebar.getByTestId('provider-quick-switch');
  await identityTrigger.click();
  const identityMenu = page.getByTestId('identity-switcher');
  await expect(identityMenu).toBeVisible();
  await expect(identityMenu.getByTestId('account-source-option-cloud')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(identityMenu.getByTestId('identity-account-settings')).toBeVisible();
  await expect(identityMenu.getByTestId('identity-account-logout')).toBeVisible();
  await expect(identityMenu).not.toContainText('生图中转站');
  await expect(identityMenu).not.toContainText('桌宠');

  await page.keyboard.press('Escape');
  await expect(identityMenu).toHaveCount(0);
  await expect(identityTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
