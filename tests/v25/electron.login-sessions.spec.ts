import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { loginSessionHttpFixture } from './login-sessions-fixture';

test('满额清理通过真实IPC继续登录；离线退出加密持久化并在新进程释放', async () => {
  test.setTimeout(60_000);
  const fixture = await loginSessionHttpFixture();
  let app: ElectronApplication | undefined;
  let directory: string | undefined;
  try {
    const first = await launchV25App('musefold-login-sessions-', {
      env: { MUSEFOLD_API_URL: fixture.baseUrl },
    });
    app = first.app;
    directory = first.userDataDir;
    let page = await v25ShellPage(app);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-account').click();
    await page.getByTestId('account-username').fill('session-creator');
    await page.getByTestId('account-password').fill('synthetic-session-password');
    await page.getByTestId('account-auth-submit').click();
    await expect(page.getByTestId('account-login-capacity')).toBeVisible();
    await page.getByTestId('account-login-session-select-device-1').click();
    await page.getByTestId('account-login-capacity-submit').click();
    await page.getByRole('button', { name: '确认释放并登录', exact: true }).click();
    await expect(page.getByTestId('account-signed-in')).toBeVisible();
    expect(fixture.state.completes).toHaveLength(1);
    expect(readFileSync(join(directory, 'v25-account-session.json'), 'utf8')).not.toContain(
      'synthetic-main-process-session-bearer',
    );
    fixture.state.offline = true;
    await page.getByRole('button', { name: '退出此设备', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '退出登录', exact: true })
      .click();
    await expect(page.getByTestId('account-auth-form')).toBeVisible();
    await expect(page.getByTestId('account-pending-login-releases')).toContainText('待联网确认');
    expect(fixture.state.releases).toBe(0);
    expect(
      readFileSync(join(directory, 'v25-account-pending-releases.json'), 'utf8'),
    ).not.toContain('synthetic-main-process-session-bearer');
    await app.close();
    app = undefined;
    fixture.state.offline = false;
    ({ app } = await launchV25App('musefold-login-sessions-', {
      reuseUserDataDir: directory,
      env: { MUSEFOLD_API_URL: fixture.baseUrl },
    }));
    page = await v25ShellPage(app);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-account').click();
    await expect(page.getByTestId('account-auth-form')).toBeVisible();
    await expect.poll(() => fixture.state.releases, { timeout: 20_000 }).toBe(1);
    expect(fixture.state.completes).toHaveLength(1);
  } finally {
    await app?.close();
    await fixture.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});
