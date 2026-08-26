import { expect, test, type Page } from '@playwright/test';

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openSignedOutAccountScreen(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  await expect(page.getByTestId('generation-workbench')).toBeVisible();
  await page.getByTestId('sidebar-account').click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录个人账户' })).toBeVisible();
}

test('registration validates confirmation and enters the workspace at 390px', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await openSignedOutAccountScreen(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const loginTab = page.getByRole('tab', { name: '登录' });
  const registerTab = page.getByRole('tab', { name: '注册' });
  await expect(loginTab).toHaveAttribute('aria-selected', 'true');
  await registerTab.click();
  await expect(registerTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '注册个人账户' })).toBeVisible();

  const account = page.locator('input[name="username"]');
  const password = page.locator('input[name="password"]');
  const confirmation = page.locator('input[name="passwordConfirmation"]');
  await expect(account).toHaveAttribute('autocomplete', 'username');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(confirmation).toHaveAttribute('autocomplete', 'new-password');

  await account.fill('account-preview');
  await password.fill('password123');
  await confirmation.fill('password456');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page.getByText('两次输入的密码不一致', { exact: true })).toBeVisible();
  await expect(confirmation).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('heading', { name: '注册个人账户' })).toBeVisible();

  const form = page.locator('.login-form');
  const formBox = await form.boundingBox();
  expect(formBox).not.toBeNull();
  expect(formBox!.x).toBeGreaterThanOrEqual(0);
  expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    ),
  ).toBeLessThanOrEqual(390);

  await confirmation.fill('password123');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在注册' })).toBeDisabled();
  await expect(page.getByTestId('generation-workbench')).toBeVisible();
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
