import { expect, test, type Page } from '@playwright/test';
import { noticeId } from '@musefold/new-api-client';
import { seedOnboardingCompleted } from './onboarding-helpers';
import { NoticesBrowserProcess } from './notices-browser-process';

async function login(page: Page, username: string) {
  await page.getByTestId('account-username').fill(username);
  await page.getByTestId('account-password').fill('fixture-password');
  await page.getByTestId('account-auth-submit').click();
  await expect(page.getByTestId('account-signed-in')).toContainText(username);
}
test('service announcements persist, isolate accounts, recover and never create a charged execution', async ({
  page,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires real API/Better Auth/PostgreSQL and loopback New API',
  );
  test.setTimeout(180_000);
  const service = new NoticesBrowserProcess();
  try {
    const { baseUrl } = await service.ready;
    await seedOnboardingCompleted(page);
    await page.goto(`${baseUrl}/settings`);
    await page.evaluate(
      (id) => localStorage.setItem('musefold:account-notices-read', JSON.stringify([id])),
      noticeId('  旧版已读公告 \n'),
    );
    await page.getByTestId('settings-nav-account').click();
    await login(page, 'notice-alice');
    const card = page.getByTestId('account-notices');
    await expect(card).toContainText('服务维护公告 1');
    await expect(card).not.toContainText('旧版已读公告');
    expect(await card.locator('script').count()).toBe(0);
    const first = await service.command('snapshot');
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath('notices-ready.png'), fullPage: true });
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      const mark = card.getByRole('button', { name: '全部已读' });
      await mark.scrollIntoViewIfNeeded();
      await expect(mark).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      // The shared Button transitions its min-height across the desktop breakpoint.
      // Assert the settled hit area, not an intermediate animation frame.
      await expect.poll(async () => (await mark.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: info.outputPath(`notices-${viewport.width}-viewport.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`notices-${viewport.width}-ready.png`),
        fullPage: true,
      });
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: info.outputPath('notices-dark-ready.png'), fullPage: true });
    await card.getByRole('button', { name: '全部已读' }).focus();
    await page.screenshot({ path: info.outputPath('notices-dark-focused.png') });
    await page.keyboard.press('Enter');
    await expect(card.getByRole('status')).toHaveText('公告已全部标为已读。');
    await expect(card.getByText('服务公告', { exact: true })).toBeFocused();
    expect((await service.command('snapshot')).notices).toBe(first.notices);
    await page.reload();
    await page.getByTestId('settings-nav-account').click();
    await expect(page.getByTestId('account-signed-in')).toBeVisible();
    await expect(card).toHaveCount(0);
    await service.command('update');
    await page.reload();
    await page.getByTestId('settings-nav-account').click();
    await expect(card).toContainText('服务维护公告 2');
    await expect(card).not.toContainText('欢迎使用未像');
    await service.command('fail');
    await card.getByRole('button', { name: '刷新公告' }).click();
    await expect(card).toContainText('公告暂时无法读取');
    await expect(page.getByTestId('account-signed-in')).toContainText('notice-alice');
    await card.getByRole('button', { name: '重新读取公告' }).click();
    await expect(card).toContainText('服务维护公告 2');
    await page.getByTestId('account-logout').click();
    await page.getByTestId('account-logout-confirm').click();
    await login(page, 'notice-bob');
    await expect(card).toContainText('欢迎使用未像');
    expect((await service.command('snapshot')).receipts).toBe(0);
  } finally {
    await page.goto('about:blank').catch(() => {});
    await service.dispose();
  }
});
