import { expect, type Page, test } from '@playwright/test';

// Web 账号域 E2E:features/account + api-client 真代码,Better Auth 端点网络层 mock。
// 覆盖:登录 → 已登录视图/侧栏账号区 → 兑换 → 退出;登录失败的表单内错误。

const ACCOUNT = {
  id: 'u1',
  username: 'xiaomiao',
  displayName: null,
  quota: 3_140_000,
  quotaUnit: '点',
  canGenerate: true,
};

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function apiError(code: string, message: string, status: number) {
  return json({ error: { code, message, requestId: 'req-e2e', retryable: false } }, status);
}

/** 安装账号域 mock;返回可变会话状态供用例断言/推进。 */
async function installAccountApiMock(page: Page): Promise<{ state: { signedIn: boolean } }> {
  const state = { signedIn: false };
  let quota = ACCOUNT.quota;

  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-in/new-api') {
      const body = route.request().postDataJSON() as { email: string; password: string };
      if (body.password !== '12345678') {
        return route.fulfill(
          json({ code: 'AUTH_CREDENTIALS_INVALID', message: '用户名或密码不正确' }, 401),
        );
      }
      state.signedIn = true;
      return route.fulfill(json({ token: 'e2e-session-token', user: { id: 'u1' } }));
    }
    if (path === '/api/auth/sign-out') {
      state.signedIn = false;
      return route.fulfill(json({ success: true }));
    }
    return route.fulfill(json({ message: `mock 未覆盖:${path}` }, 404));
  });

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, '');
    if (path === '/account/status') {
      if (!state.signedIn) return route.fulfill(apiError('AUTH_REQUIRED', '未登录', 401));
      return route.fulfill(json({ ...ACCOUNT, quota }));
    }
    if (path === '/account/redeem') {
      quota += 500_000;
      return route.fulfill(json({ account: { ...ACCOUNT, quota }, creditedQuota: 500_000 }));
    }
    if (path === '/workbench/sessions') return route.fulfill(json({ items: [], nextCursor: null }));
    if (path === '/generations/providers') return route.fulfill(json([]));
    return route.fulfill(apiError('NOT_FOUND', `mock 未覆盖:${path}`, 404));
  });

  return { state };
}

test('账密登录 → 已登录视图与侧栏账号区 → 兑换 → 退出', async ({ page, isMobile }) => {
  await installAccountApiMock(page);
  await page.goto('/settings');

  // 未登录:表单可见;桌面视口侧栏展示登录入口
  await expect(page.getByTestId('account-auth-form')).toBeVisible();
  if (!isMobile) {
    await expect(page.getByTestId('account-footer-signed-out')).toBeVisible();
  }

  await page.getByTestId('account-username').fill('xiaomiao');
  await page.getByTestId('account-password').fill('12345678');
  await page.getByTestId('account-auth-submit').click();

  // 已登录:身份/积分(3_140_000 quota = 62.8 积分),侧栏账号区同步
  await expect(page.getByTestId('account-signed-in')).toBeVisible();
  await expect(page.getByTestId('account-points')).toHaveText('62.8 积分');
  if (!isMobile) {
    await expect(page.getByTestId('account-footer')).toContainText('xiaomiao');
  }

  // 兑换码 → 余额即时刷新
  await page.getByTestId('account-redeem-input').fill('CODE-E2E');
  await page.getByTestId('account-redeem-submit').click();
  await expect(page.getByTestId('account-points')).toHaveText('72.8 积分');

  // 退出(AlertDialog 确认)→ 回到未登录表单
  await page.getByTestId('account-logout').click();
  await page.getByTestId('account-logout-confirm').click();
  await expect(page.getByTestId('account-auth-form')).toBeVisible();
});

test('登录失败在表单内展示服务端错误', async ({ page }) => {
  await installAccountApiMock(page);
  await page.goto('/settings');

  await page.getByTestId('account-username').fill('xiaomiao');
  await page.getByTestId('account-password').fill('wrong-pass');
  await page.getByTestId('account-auth-submit').click();

  await expect(page.getByTestId('account-auth-error')).toContainText('用户名或密码不正确');
  await expect(page.getByTestId('account-auth-form')).toBeVisible();
});

test('已登录设置页视觉基线', async ({ page }) => {
  await installAccountApiMock(page);
  await page.goto('/settings');
  await page.getByTestId('account-username').fill('xiaomiao');
  await page.getByTestId('account-password').fill('12345678');
  await page.getByTestId('account-auth-submit').click();
  await expect(page.getByTestId('account-signed-in')).toBeVisible();
  await expect(page).toHaveScreenshot('settings-signed-in.png', { fullPage: true });
});
