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

test('account actions refresh the query-backed quota without horizontal overflow at 390px', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.getByTestId('generation-workbench')).toBeVisible();
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect(page.getByTestId('product-sidebar')).toBeVisible();
  await page.getByTestId('sidebar-account').click();
  await page
    .getByRole('navigation', { name: '设置分区' })
    .getByRole('button', { name: 'Musefold 账号' })
    .click();

  const screen = page.getByTestId('account-screen');
  const summary = page.getByTestId('account-summary-panel');
  const redeemInput = page.getByLabel('兑换码');
  const refreshButton = page.getByRole('button', { name: '刷新账户' });
  const redeemButton = page.getByRole('button', { name: '兑换', exact: true });

  await expect(screen).toBeVisible();
  await expect(summary).toContainText('186 积分');
  await expect(redeemInput).toHaveAttribute('autocomplete', 'off');
  await expect(redeemInput).toHaveAttribute('name', 'redeemCode');

  const touchTargets = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[name="redeemCode"]');
    const refresh = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('刷新账户'),
    );
    const redeem = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '兑换',
    );
    return {
      input: input?.getBoundingClientRect().height ?? 0,
      refresh: refresh?.getBoundingClientRect().height ?? 0,
      redeem: redeem?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(touchTargets.input).toBeGreaterThanOrEqual(44);
  expect(touchTargets.refresh).toBeGreaterThanOrEqual(44);
  expect(touchTargets.redeem).toBeGreaterThanOrEqual(44);

  await refreshButton.click();
  await expect(page.getByText('账户信息已刷新', { exact: true })).toBeVisible();

  await redeemInput.fill('ACC-04-FIXTURE');
  await redeemButton.click();
  await expect(page.getByText('兑换成功，10 积分已到账', { exact: true })).toBeVisible();
  await expect(summary).toContainText('196 积分');

  expect(
    await page.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    ),
  ).toBeLessThanOrEqual(390);
  expect(browserErrors).toEqual([]);
});

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
