import { expect, type Page, type Response, test } from '@playwright/test';

/** Keep live secrets out of automatic failure accessibility snapshots, not only traces. */
export async function submitLiveLogin(page: Page) {
  const username = process.env.MUSEFOLD_E2E_USERNAME ?? '';
  const password = process.env.MUSEFOLD_E2E_PASSWORD ?? '';
  if (!username || !password) throw new Error('Live credentials are required');
  const started = Date.now();
  const responses: Array<{ path: string; status: number; elapsedMs: number }> = [];
  const observe = (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (
      [
        '/api/auth/sign-in/new-api',
        '/api/v1/account/login-sessions/touch',
        '/api/v1/account/status',
      ].includes(path)
    )
      responses.push({ path, status: response.status(), elapsedMs: Date.now() - started });
  };
  page.on('response', observe);
  try {
    await page.getByTestId('account-username').fill(username);
    const input = page.getByTestId('account-password');
    try {
      await input.fill(password);
      await page.getByTestId('account-auth-submit').click();
    } finally {
      // Submit captured the controlled form value synchronously. A failed login must
      // require re-entry in this harness instead of retaining a secret in error-context.md.
      if (await input.isVisible()) await input.fill('');
    }
    // This UI includes sequential managed login, acknowledgement and account reads.
    // Preserve the product's per-request deadlines; only the live harness waits for
    // their combined result. Submit once, never automatically retry authentication.
    await expect(page.getByTestId('account-signed-in')).toBeVisible({ timeout: 60000 });
  } finally {
    page.off('response', observe);
    await test.info().attach('live-login-timing', {
      body: JSON.stringify({ elapsedMs: Date.now() - started, responses }),
      contentType: 'application/json',
    });
  }
}

/** Release only this browser context's session; closing a tab is not logout. */
export async function logoutLiveWeb(page: Page) {
  const response = await page.request.post('http://127.0.0.1:3399/api/auth/sign-out', {
    headers: { Origin: 'http://127.0.0.1:3399' },
    data: {},
  });
  expect(response.status(), 'Live browser session cleanup').toBe(200);
}
