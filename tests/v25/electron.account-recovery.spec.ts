import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';

/** Real Electron IPC, encrypted session files and HTTP; the local fixture never sends upstream. */
async function accountServer() {
  let baseUrl = '';
  let recovered = false;
  const requests: Array<{ path: string; authorization: string | undefined; body: unknown }> = [];
  const snapshot = () => ({
    id: 'upstream-owner',
    username: 'legacy-creator',
    displayName: null,
    quota: 500_000,
    quotaUnit: '点',
    canGenerate: recovered,
    identity: {
      apiIssuer: baseUrl,
      principalId: recovered ? 'independent-principal' : 'legacy-principal',
      status: recovered ? 'active' : 'recovery_required',
      identityVersion: recovered ? 1 : 0,
    },
    recovery: recovered
      ? null
      : {
          requestId: 'e2e-recovery-request',
          reason: 'legacy_evidence_missing',
          expiresAt: '2030-01-01T00:00:00Z',
          actions: ['retry', 'verify_original_session', 'create_independent_workspace'],
        },
  });
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : null;
    const path = request.url ?? '/';
    requests.push({ path, authorization: request.headers.authorization, body });
    response.setHeader('content-type', 'application/json');
    if (path === '/api/auth/sign-in/new-api')
      return response.end(JSON.stringify({ token: 'fixture-recovery-bearer' }));
    if (path === '/api/auth/sign-out') return response.end(JSON.stringify({ success: true }));
    if (path === '/api/v1/account/recovery/independent-workspace') {
      recovered = true;
      return response.end(JSON.stringify(snapshot()));
    }
    if (path === '/api/v1/account/status' || path === '/api/v1/account/recovery/retry')
      return response.end(JSON.stringify(snapshot()));
    response.statusCode = 404;
    return response.end(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: 'fixture route unavailable' } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
async function openAccount(page: Page) {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-nav-account').click();
}
async function signIn(page: Page) {
  await page.getByTestId('account-username').fill('legacy-creator');
  await page.getByTestId('account-password').fill('fixture-password');
  await page.getByTestId('account-auth-submit').click();
  await expect(page.getByTestId('account-recovery')).toBeVisible();
}

test('受限会话重启后仍可恢复，独立空间由主进程保存且不自动开启同步', async () => {
  const api = await accountServer();
  let app: ElectronApplication | undefined;
  let directory: string | undefined;
  try {
    const first = await launchV25App('musefold-account-recovery-', {
      env: { MUSEFOLD_API_URL: api.baseUrl },
    });
    app = first.app;
    directory = first.userDataDir;
    let page = await v25ShellPage(app);
    await openAccount(page);
    await signIn(page);
    await expect(page.getByTestId('account-redeem-input')).toHaveCount(0);
    const stored = readFileSync(join(directory, 'v25-account-session.json'), 'utf8');
    expect(Object.keys(JSON.parse(stored))).toEqual(['encrypted']);
    expect(stored).not.toContain('fixture-recovery-bearer');
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-account-recovery-', {
      reuseUserDataDir: directory,
      env: { MUSEFOLD_API_URL: api.baseUrl },
    }));
    page = await v25ShellPage(app);
    await openAccount(page);
    await expect(page.getByTestId('account-recovery')).toBeVisible();
    await page.getByTestId('account-recovery-independent').click();
    await expect(page.getByRole('alertdialog')).toContainText('旧工作区及其历史保持保留');
    expect(
      api.requests.filter((request) => request.path.endsWith('/independent-workspace')),
    ).toHaveLength(0);
    await page.getByTestId('account-recovery-independent-confirm').click();
    await expect(page.getByTestId('account-recovery')).toHaveCount(0);
    await expect(page.getByTestId('account-points')).toBeVisible();
    expect(
      api.requests.filter((request) => request.path.endsWith('/independent-workspace')),
    ).toEqual([
      {
        path: '/api/v1/account/recovery/independent-workspace',
        authorization: 'Bearer fixture-recovery-bearer',
        body: { requestId: 'e2e-recovery-request' },
      },
    ]);
    expect(api.requests.some((request) => request.path.startsWith('/api/v1/sync'))).toBe(false);
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-account-recovery-', {
      reuseUserDataDir: directory,
      env: { MUSEFOLD_API_URL: api.baseUrl },
    }));
    page = await v25ShellPage(app);
    await openAccount(page);
    await expect(page.getByTestId('account-points')).toBeVisible();
    await expect(page.getByTestId('account-recovery')).toHaveCount(0);
    expect(
      api.requests.filter((request) => request.path.endsWith('/independent-workspace')),
    ).toHaveLength(1);
  } finally {
    await app?.close();
    await api.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

test('更换账号服务器后保留原会话文件，旧 bearer 不发送到新服务', async () => {
  const firstApi = await accountServer();
  const secondApi = await accountServer();
  let app: ElectronApplication | undefined;
  let directory: string | undefined;
  try {
    const first = await launchV25App('musefold-account-issuer-', {
      env: { MUSEFOLD_API_URL: firstApi.baseUrl },
    });
    app = first.app;
    directory = first.userDataDir;
    let page = await v25ShellPage(app);
    await openAccount(page);
    await signIn(page);
    const previous = readFileSync(join(directory, 'v25-account-session.json'), 'utf8');
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-account-issuer-', {
      reuseUserDataDir: directory,
      env: { MUSEFOLD_API_URL: secondApi.baseUrl },
    }));
    page = await v25ShellPage(app);
    await openAccount(page);
    await expect(page.getByTestId('account-auth-form')).toBeVisible();
    expect(secondApi.requests).toHaveLength(0);
    expect(readFileSync(join(directory, 'v25-account-session.json'), 'utf8')).toBe(previous);
    await signIn(page);
    expect(
      secondApi.requests.find((request) => request.path === '/api/auth/sign-in/new-api')
        ?.authorization,
    ).toBeUndefined();
  } finally {
    await app?.close();
    await firstApi.close();
    await secondApi.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});
