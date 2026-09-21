import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

const ACCOUNT = {
  id: 'u1',
  username: 'xiaomiao',
  displayName: null,
  quota: 3_140_000,
  quotaUnit: '点',
  canGenerate: true,
};

const LIST = {
  items: [
    {
      clientId: 'cursor-mcp-client',
      name: 'Cursor',
      uri: null,
      scopes: ['account:read', 'prompts:read', 'skills:read'],
      authorizedAt: '2026-08-01T12:00:00.000+00:00',
      lastUsedAt: '2026-09-06T08:30:00.000+00:00',
    },
  ],
};

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function apiError(code: string, message: string, status: number) {
  return json({ error: { code, message, requestId: 'cloud-mcp-e2e', retryable: false } }, status);
}

async function installCloudMcpApiMock(
  page: Page,
  mode: 'signed-out' | 'empty' | 'ready',
): Promise<{ revoked: string[] }> {
  const revoked: string[] = [];
  const signedIn = mode !== 'signed-out';

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/account/status') {
      if (!signedIn) return route.fulfill(apiError('AUTH_REQUIRED', '未登录', 401));
      return route.fulfill(json(ACCOUNT));
    }
    if (path === '/generations/providers' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (path === '/workbench/sessions' && method === 'GET') {
      return route.fulfill(json({ items: [], nextCursor: null }));
    }
    if (path === '/mcp/authorizations' && method === 'GET') {
      return route.fulfill(json(mode === 'empty' ? { items: [] } : LIST));
    }
    const revokeMatch = path.match(/^\/mcp\/authorizations\/([^/]+)$/);
    if (revokeMatch && method === 'DELETE') {
      const clientId = decodeURIComponent(revokeMatch[1] ?? '');
      revoked.push(clientId);
      return route.fulfill(json({ revoked: true, clientId }));
    }

    return route.fulfill(apiError('NOT_FOUND', `mock 未覆盖:${method} ${path}`, 404));
  });

  return { revoked };
}

async function openOpenSection(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  const back = page.getByTestId('settings-section-back');
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByTestId('settings-nav-open').click();
  await expect(page.getByTestId('settings-section-open')).toBeVisible();
}

test('未登录:开放能力分区可见,已连接应用卡显示登录门控', async ({ page }) => {
  await installCloudMcpApiMock(page, 'signed-out');
  await openOpenSection(page);

  await expect(page.getByTestId('settings-connected-apps-card')).toBeVisible();
  await expect(page.getByTestId('settings-connected-apps-signed-out')).toContainText(
    '登录 Musefold 账号后可管理',
  );
  await expect(page.getByTestId('settings-automation-card')).toHaveCount(0);
});

test('已登录空列表:还没有已连接的应用', async ({ page }) => {
  await installCloudMcpApiMock(page, 'empty');
  await openOpenSection(page);
  await expect(page.getByTestId('settings-connected-apps-empty')).toHaveText('还没有已连接的应用');
});

test('已登录列表 + 撤销确认', async ({ page }) => {
  const { revoked } = await installCloudMcpApiMock(page, 'ready');
  await openOpenSection(page);

  await expect(page.getByTestId('settings-connected-apps-list')).toContainText('Cursor');
  await page.getByTestId('settings-connected-apps-revoke').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('撤销授权?');
  await page.getByTestId('settings-connected-apps-revoke-confirm').click();
  await expect.poll(() => revoked).toEqual(['cursor-mcp-client']);
});
