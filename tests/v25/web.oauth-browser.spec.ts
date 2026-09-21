import { expect, test } from '@playwright/test';
import { OAuthBrowserProcess } from './oauth-browser-process';

test('first browser OAuth login, two clients, denial, reauthentication and revocation', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires real Better Auth/PG and two independent HTTP OAuth clients',
  );
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(20_000);
  const service = new OAuthBrowserProcess();
  let releaseReauthenticationStatus = () => {};
  try {
    const backend = await service.ready;
    const [a, b] = backend.clients;
    if (!a || !b) throw new Error('Two independent clients required');
    await page.goto(`${a.url}/begin`);
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByTestId('oauth-client-name')).toHaveText('Reader A');
    await expect(page.getByTestId('account-auth-form')).toBeVisible();
    // Do not seed a session or consent: the actual shared credential form creates both.
    await page.getByLabel('用户名', { exact: true }).fill('oauth-browser@example.test');
    await page.getByLabel('密码', { exact: true }).fill('correct-password');
    await page.getByTestId('account-auth-submit').click();
    await page.getByRole('button', { name: '继续核对授权' }).click();
    await expect(page).toHaveURL(/\/consent\?/);
    await expect(page.getByRole('button', { name: '允许只读访问' })).toBeEnabled();
    expect((await service.snapshot()).consents).toEqual([]);
    await page.screenshot({ path: info.outputPath('oauth-consent.png'), fullPage: true });
    const originalViewport = page.viewportSize();
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      const allow = page.getByRole('button', { name: '允许只读访问' });
      await allow.scrollIntoViewIfNeeded();
      await expect(allow).toBeInViewport({ ratio: 1 });
      const cancel = page.getByRole('link', { name: '取消并返回未像' });
      await cancel.scrollIntoViewIfNeeded();
      await expect(cancel).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    if (originalViewport) await page.setViewportSize(originalViewport);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    const deny = page.getByRole('button', { name: '拒绝', exact: true });
    const allow = page.getByRole('button', { name: '允许只读访问' });
    await expect(deny).toBeEnabled();
    await deny.focus();
    await page.keyboard.press('Tab');
    await expect(allow).toBeFocused();
    await expect(allow).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: info.outputPath('oauth-consent-dark-keyboard.png'),
      fullPage: true,
    });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`^${a.url}/callback\\?`));
    await expect(page.locator('body')).toHaveText('reader-a: connected');
    expect((await service.snapshot()).clients[0]).toMatchObject({
      outcome: 'connected',
      exchanges: 1,
      mcpStatus: 200,
      tools: ['get_prompt', 'search_prompts'],
    });

    await page.goto(`${b.url}/begin`);
    await expect(page.getByTestId('oauth-client-name')).toHaveText('Reader B');
    await expect(page).toHaveURL(/\/consent\?/);
    await page.getByRole('button', { name: '拒绝', exact: true }).click();
    await expect(page.locator('body')).toHaveText('reader-b: denied');
    expect((await service.snapshot()).consents).toEqual(['reader-a']);
    expect((await service.snapshot()).clients[1]).toMatchObject({
      outcome: 'denied',
      exchanges: 0,
      mcpStatus: null,
    });

    // Hold only the real status response: a late same-account hydration must
    // recheck OAuth without remounting the form and discarding typed credentials.
    const reauthenticationStatus = new Promise<void>((resolve) => {
      releaseReauthenticationStatus = resolve;
    });
    let statusHeld = false;
    await page.route(`${backend.baseUrl}/api/v1/account/status`, async (route) => {
      if (statusHeld) return route.continue();
      statusHeld = true;
      const response = await route.fetch();
      await reauthenticationStatus;
      await route.fulfill({ response });
    });
    await page.goto(`${b.url}/begin?reauth=1`);
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByTestId('account-auth-form')).toBeVisible();
    await expect.poll(() => statusHeld).toBe(true);
    await page.getByLabel('用户名', { exact: true }).fill('oauth-browser@example.test');
    await page.getByLabel('密码', { exact: true }).fill('correct-password');
    const rechecked = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/auth/musefold/oauth-review') &&
        response.request().method() === 'POST',
    );
    releaseReauthenticationStatus();
    expect((await rechecked).status()).toBe(200);
    await expect(page.getByTestId('oauth-screen')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByLabel('用户名', { exact: true })).toHaveValue(
      'oauth-browser@example.test',
    );
    await expect(page.getByLabel('密码', { exact: true })).toHaveValue('correct-password');
    await page.getByTestId('account-auth-submit').click();
    await page.getByRole('button', { name: '继续核对授权' }).click();
    await expect(page).toHaveURL(/\/consent\?/);
    await page.getByRole('button', { name: '允许只读访问' }).click();
    await expect(page.locator('body')).toHaveText('reader-b: connected');
    expect((await service.snapshot()).clients[1]).toMatchObject({
      outcome: 'connected',
      exchanges: 1,
      mcpStatus: 200,
    });

    // Reauthentication legitimately retires A's old login lineage. Connect A
    // again under the current session so revocation isolation uses two live grants.
    await page.goto(`${a.url}/begin`);
    await expect(page).toHaveURL(/\/consent\?/);
    await page.getByRole('button', { name: '允许只读访问' }).click();
    await expect(page.locator('body')).toHaveText('reader-a: connected');
    expect((await service.snapshot()).clients.map((client) => client.mcpStatus)).toEqual([
      200, 200,
    ]);

    await page.goto(`${backend.baseUrl}/settings`);
    await page.getByTestId('settings-nav-open').click();
    await expect(page.getByTestId('settings-connected-apps-card')).toContainText('Reader A');
    await expect(page.getByTestId('settings-connected-apps-card')).toContainText('Reader B');
    await page
      .getByTestId('settings-connected-apps-row')
      .filter({ hasText: 'Reader B' })
      .getByTestId('settings-connected-apps-revoke')
      .click();
    await page.getByRole('alertdialog').getByRole('button', { name: /撤销/ }).click();
    await expect.poll(async () => (await service.snapshot()).clients[1]?.mcpStatus).toBe(401);
    expect((await service.snapshot()).consents).toEqual(['reader-a']);
    expect((await service.snapshot()).clients.map((client) => client.mcpStatus)).toEqual([
      200, 401,
    ]);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByTestId('settings-connected-apps-card')).not.toContainText('Reader B');
    await page.screenshot({ path: info.outputPath('oauth-revoked.png'), fullPage: true });
  } finally {
    releaseReauthenticationStatus();
    try {
      for (const p of context.pages())
        await p.goto('about:blank', { timeout: 3000 }).catch(() => {});
    } finally {
      await service.dispose();
    }
  }
});
