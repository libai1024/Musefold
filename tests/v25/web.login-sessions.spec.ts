import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';
import { loginSessionsFixture } from './login-sessions-fixture';

async function openLogin(page: Page, total = 2) {
  const fixture = loginSessionsFixture(total);
  await seedOnboardingCompleted(page);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const result = fixture.respond(
      new URL(request.url()).pathname,
      request.postData() ? request.postDataJSON() : undefined,
    );
    await route.fulfill({
      status: result.status,
      contentType: 'application/json',
      body: JSON.stringify(result.body),
    });
  });
  await page.goto('/settings');
  await page.getByTestId('settings-nav-account').click();
  await page.getByTestId('account-username').fill('session-creator');
  await page.getByTestId('account-password').fill('synthetic-session-password');
  await page.getByTestId('account-auth-submit').click();
  await expect(page.getByTestId('account-login-capacity')).toBeVisible();
  await expect(page.getByTestId('account-login-session-select-device-0')).toBeVisible();
  return fixture;
}

test('满额自动弹窗，取消恢复焦点，选择确认后继续登录', async ({ page }) => {
  const fixture = await openLogin(page);
  await expect(page.getByTestId('account-password')).toHaveValue('');
  await expect(page.getByTestId('account-login-capacity-submit')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('account-login-capacity')).toHaveCount(0);
  await expect(page.getByTestId('account-password')).toBeFocused();
  expect(fixture.state.cancelled).toBe(1);
  expect(fixture.state.completes).toHaveLength(0);
  await page.getByTestId('account-password').fill('synthetic-session-password');
  await page.getByTestId('account-auth-submit').click();
  await page.getByTestId('account-login-session-select-device-1').click();
  await page.getByTestId('account-login-capacity-submit').click();
  await expect(page.getByRole('alertdialog')).toContainText('Safari');
  expect(fixture.state.completes).toHaveLength(0);
  await page.getByRole('button', { name: '确认释放并登录', exact: true }).click();
  await expect(page.getByTestId('account-signed-in')).toBeVisible();
  expect(fixture.state.completes).toHaveLength(1);
  expect(fixture.state.completes[0]?.selected).toEqual([{ sessionRef: 'device-1', version: 1 }]);
  await expect(page.getByTestId('account-login-sessions')).toBeVisible();
  await expect(page.getByTestId('account-login-session-select-device-0')).toBeDisabled();
});

test('容量竞争再次提示并重选，不静默追加释放', async ({ page }) => {
  const fixture = await openLogin(page);
  fixture.state.conflictOnce = true;
  await page.getByTestId('account-login-session-select-device-0').click();
  await page.getByTestId('account-login-capacity-submit').click();
  await page.getByRole('button', { name: '确认释放并登录', exact: true }).click();
  await expect(page.getByTestId('account-login-capacity')).toContainText('设备名额或选择已变化');
  await expect(page.getByTestId('account-login-capacity-submit')).toBeDisabled();
  await expect(page.getByTestId('account-login-session-select-device-0')).not.toBeChecked();
  expect(fixture.state.completes).toHaveLength(1);
  await page.getByTestId('account-login-session-select-device-1').click();
  await page.getByTestId('account-login-capacity-submit').click();
  await page.getByRole('button', { name: '确认释放并登录', exact: true }).click();
  await expect(page.getByTestId('account-signed-in')).toBeVisible();
  expect(fixture.state.completes).toHaveLength(2);
  expect(fixture.state.completes[1]?.operationId).not.toBe(fixture.state.completes[0]?.operationId);
});

test('50设备列表在小屏横屏、暗色和大文字下可滚动到末项且确认可达', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await openLogin(page, 50);
  await page.addStyleTag({ content: 'html { font-size: 20px !important; }' });
  const last = page.getByTestId('account-login-session-select-device-49');
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.getByTestId('account-login-capacity-submit')).toBeInViewport();
  const rowLabel = last.locator('..');
  const bounds = await rowLabel.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('login-sessions-landscape-dark.png') });
  await page.getByTestId('account-login-capacity-submit').click();
  await expect(page.getByRole('button', { name: '确认释放并登录', exact: true })).toBeInViewport();
});
