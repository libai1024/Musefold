import { expect, test, type ElectronApplication } from '@playwright/test';
import { noticeId } from '@musefold/new-api-client';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { NoticesBrowserProcess } from './notices-browser-process';

test('desktop service announcements remain read after an actual new PID', async () => {
  const info = test.info();
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires real API/Better Auth/PostgreSQL and loopback New API',
  );
  test.setTimeout(180_000);
  const service = new NoticesBrowserProcess();
  let app: ElectronApplication | undefined;
  try {
    const { baseUrl } = await service.ready;
    const options = { env: { MUSEFOLD_API_URL: baseUrl } };
    const first = await launchV25App('musefold-notices-', options);
    app = first.app;
    let page = await v25ShellPage(app);
    await page.evaluate(
      (id) => localStorage.setItem('musefold:account-notices-read', JSON.stringify([id])),
      noticeId('  旧版已读公告 \n'),
    );
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-account').click();
    await page.getByTestId('account-username').fill('notice-alice');
    await page.getByTestId('account-password').fill('fixture-password');
    await page.getByTestId('account-auth-submit').click();
    const card = page.getByTestId('account-notices');
    await expect(card).toContainText('服务维护公告 1');
    await expect(card).not.toContainText('旧版已读公告');
    expect(await card.locator('script').count()).toBe(0);
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath('notices-desktop-ready.png'), fullPage: true });
    await card.getByRole('button', { name: '全部已读' }).click();
    await expect(card.getByRole('status')).toHaveText('公告已全部标为已读。');
    const pid = app.process().pid;
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('unused-', { ...options, reuseUserDataDir: first.userDataDir }));
    expect(app.process().pid).not.toBe(pid);
    page = await v25ShellPage(app);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-account').click();
    await expect(page.getByTestId('account-signed-in')).toContainText('notice-alice');
    await expect(page.getByTestId('account-notices')).toHaveCount(0);
    expect((await service.command('snapshot')).receipts).toBe(0);
  } finally {
    try {
      await app?.close();
    } finally {
      await service.dispose();
    }
  }
});
