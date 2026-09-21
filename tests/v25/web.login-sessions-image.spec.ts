import { expect, test } from '@playwright/test';
import { startLoginSessionImageApp } from '../../apps/api/src/__tests__/fixtures/login-session-image-app';
import { seedOnboardingCompleted } from './onboarding-helpers';

test('real image → production API → shared UI: capacity cleanup continues login and logout releases its slot', async ({
  page,
}) => {
  const imageUrl = process.env.MUSEFOLD_SESSION_IMAGE_URL;
  test.skip(
    !imageUrl,
    'Requires isolated New API image with active limit 2; never a production account',
  );
  test.setTimeout(120_000);
  if (!imageUrl) throw new Error('Missing local image URL');
  const service = await startLoginSessionImageApp(imageUrl, 'http://127.0.0.1:3399');
  try {
    await seedOnboardingCompleted(page);
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      return route.continue({ url: `${service.url}${url.pathname}${url.search}` });
    });
    await page.goto('/settings');
    await page.getByTestId('settings-nav-account').click();
    await page.getByTestId('account-username').fill('sessionroot');
    await page.getByTestId('account-password').fill('synthetic-session-password');
    await page.getByTestId('account-auth-submit').click();
    const capacity = page.getByTestId('account-login-capacity');
    await expect(capacity).toBeVisible();
    await expect(capacity.getByRole('checkbox')).toHaveCount(2);
    await capacity.getByRole('checkbox').first().click();
    await page.getByTestId('account-login-capacity-submit').click();
    await page.getByRole('button', { name: '确认释放并登录', exact: true }).click();
    await expect(page.getByTestId('account-signed-in')).toBeVisible();
    await expect(page.getByTestId('account-login-sessions')).toContainText('2 / 2');
    expect(await service.activeCount()).toBe(2);
    await page.getByRole('button', { name: '退出此设备', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '退出登录', exact: true })
      .click();
    await expect(page.getByTestId('account-auth-form')).toBeVisible();
    await service.sweep();
    expect(await service.activeCount()).toBe(1);
  } finally {
    await service.close();
  }
});
