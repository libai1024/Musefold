import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

// Actual Electron/main/SQLite retry refusal, synthetic loopback account redemption.
// The historical failed fixture intentionally has a missing provider; no paid upstream runs.
test('兑换已到账但本机原连接缺失：显示续发失败并返回原任务', async () => {
  let issuer = '';
  let credited = false;
  let redeemed = 0;
  const calls: string[] = [];
  const account = () => ({
    id: 'redeem-local-owner',
    username: 'creator',
    displayName: null,
    quota: credited ? 500000 : 0,
    quotaUnit: '点',
    canGenerate: credited,
    identity: {
      apiIssuer: issuer,
      principalId: 'redeem-local-principal',
      status: 'active',
      identityVersion: 1,
    },
    recovery: null,
  });
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain the synthetic request. */
    }
    const path = request.url ?? '/';
    calls.push(`${request.method} ${path}`);
    response.setHeader('content-type', 'application/json');
    const send = (value: unknown) => response.end(JSON.stringify(value));
    if (path === '/api/auth/sign-in/new-api') return send({ token: 'synthetic-redeem-bearer' });
    if (request.headers.authorization !== 'Bearer synthetic-redeem-bearer') {
      response.statusCode = 401;
      return send({});
    }
    if (path === '/api/v1/account/status') return send(account());
    if (path === '/api/v1/account/redeem') {
      credited = true;
      redeemed++;
      return send({ account: account(), creditedQuota: 500000 });
    }
    response.statusCode = 404;
    return send({});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  issuer = `http://127.0.0.1:${address.port}`;
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const launched = await launchV25App('musefold-redeem-recovery-', {
      env: { MUSEFOLD_API_URL: issuer },
    });
    app = launched.app;
    userData = launched.userDataDir;
    const page = await v25ShellPage(app);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-account').click();
    await page.getByTestId('account-username').fill('creator');
    await page.getByTestId('account-password').fill('synthetic-password');
    await page.getByTestId('account-auth-submit').click();
    await expect(page.getByTestId('account-points')).toHaveText('0 积分');
    const db = new Database(desktopDbPath(userData));
    try {
      const now = Date.now();
      db.prepare(`INSERT INTO generation_runs (
        id, run_kind, provider_id, model, user_prompt, base_prompt, final_prompt,
        params_json, prompt_snapshot_json, status, error_code, error_message,
        created_at, started_at, finished_at
      ) VALUES ('redeem-original', 'free_generation', 'missing-original-provider', 'test-model',
        '本机额度恢复猫咪', '本机额度恢复猫咪', '本机额度恢复猫咪', '{}', '{}', 'failed',
        'ACCOUNT/QUOTA', '额度不足', ?, ?, ?)`).run(now, now, now);
    } finally {
      db.close();
    }
    await page.getByTestId('nav-history').click();
    await page.getByTestId('history-row-open').click();
    await page.getByTestId('history-detail-error-action').click();
    await expect(page.getByTestId('settings-section-account')).toBeVisible();
    await page.getByTestId('account-redeem-input').fill('SYNTHETIC-CODE');
    await page.getByTestId('account-redeem-submit').click();
    await expect(page.getByTestId('account-points')).toHaveText('10 积分');
    await expect(page.getByTestId('account-redeem-recovery')).toHaveAttribute(
      'data-status',
      'failed',
    );
    await expect(page.getByTestId('account-redeem-recovery')).toContainText('额度已到账');
    await expect(page.getByTestId('account-redeem-input')).toHaveValue('');
    await page.getByTestId('account-redeem-history').click();
    await expect(page.getByTestId('history-inspector-prompt')).toContainText('本机额度恢复猫咪');
    expect(redeemed).toBe(1);
    expect(calls.filter((call) => call.includes('/generations'))).toEqual([]);
  } finally {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
