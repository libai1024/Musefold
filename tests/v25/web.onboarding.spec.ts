import { expect, type Page, test } from '@playwright/test';
import {
  seedOnboardingCompleted,
  seedOnboardingPending,
  WEB_PREFERENCES_STORAGE_KEY,
} from './onboarding-helpers';

// Web 首启引导 E2E(U01-onboarding):features/onboarding + web 宿主真代码,网络层内存 mock。
// Web 只有官方账号一条通道(无本地 Provider、无豆包网页登录),gate = 未登录 + 无哨兵。
// 覆盖:未完成 → 弹引导(只给账号轨);跳过写哨兵、刷新不重放;已登录 → 静默补哨兵不弹;
//       登录 → validate → first-image 把提示词送进工作台 Composer(不自动发起生成)。

const ACCOUNT = {
  id: 'u1',
  username: 'xiaomiao',
  displayName: null,
  quota: 1_000_000,
  quotaUnit: '点',
  canGenerate: true,
};

const PROMPT = 'a cozy cabin in snowy forest, cinematic';

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/**
 * 账号态可控的最小 mock:gate 只读 `/account/status`,登录走 Better Auth 端点。
 * 其余数据面给空集合,避免无后端时屏空白干扰引导层断言。
 */
async function installMock(
  page: Page,
  options: { signedIn: boolean },
): Promise<{ generateCalls: number }> {
  const state = { signedIn: options.signedIn };
  const calls = { generateCalls: 0 };

  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-in/new-api') {
      state.signedIn = true;
      return route.fulfill(json({ token: 'e2e-session-token', user: { id: ACCOUNT.id } }));
    }
    return route.fulfill(json({ message: `mock 未覆盖:${path}` }, 404));
  });

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = route.request().method();

    if (path === '/account/status') {
      return state.signedIn
        ? route.fulfill(json(ACCOUNT))
        : route.fulfill(json({ code: 'AUTH_REQUIRED', message: '未登录' }, 401));
    }
    if (path === '/generations/providers' && method === 'GET') {
      return route.fulfill(json([]));
    }
    if (path === '/workbench/sessions' && method === 'GET') {
      return route.fulfill(json({ items: [], nextCursor: null }));
    }
    if (path === '/generations' && method === 'GET') {
      return route.fulfill(json({ items: [], nextCursor: null }));
    }
    // 引导不得代替用户发起生成:这条计数在用例末尾断言为 0。
    if (path === '/generations' && method === 'POST') {
      calls.generateCalls += 1;
      return route.fulfill(
        json({ code: 'E2E_UNEXPECTED_GENERATE', message: '引导不应发起生成' }, 500),
      );
    }
    return route.continue();
  });

  return calls;
}

async function readSentinel(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { onboardingCompletedAt?: string | null };
    return parsed.onboardingCompletedAt ?? null;
  }, WEB_PREFERENCES_STORAGE_KEY);
}

test('未完成引导 + 未登录:引导层弹出,Web 只给官方账号轨', async ({ page }) => {
  await seedOnboardingPending(page);
  await installMock(page, { signedIn: false });
  await page.goto('/workbench');

  const flow = page.getByTestId('onboarding-flow');
  await expect(flow).toBeVisible();
  await expect(flow).toHaveAttribute('role', 'dialog');
  await expect(flow).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible();
  // 步骤指示器当前项可读(a11y)。
  await expect(page.getByTestId('onboarding-progress-welcome')).toHaveAttribute(
    'aria-current',
    'step',
  );

  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-connect')).toBeVisible();
  await expect(page.getByTestId('onboarding-track-account')).toBeVisible();
  // 无本地 Provider / 豆包能力的宿主不伪造这两轨。
  await expect(page.getByTestId('onboarding-track-byok')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-track-doubao')).toHaveCount(0);

  await page.getByTestId('onboarding-back').click();
  await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible();
});

test('跳过引导:确认后写哨兵,刷新不再重放', async ({ page }) => {
  await seedOnboardingPending(page);
  await installMock(page, { signedIn: false });
  await page.goto('/workbench');
  await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible();

  // 先取消一次:跳过是破坏性选择,确认框可撤。
  await page.getByTestId('onboarding-skip').click();
  await expect(page.getByTestId('onboarding-skip-dialog')).toBeVisible();
  await page.getByTestId('onboarding-skip-cancel').click();
  await expect(page.getByTestId('onboarding-flow')).toBeVisible();

  await page.getByTestId('onboarding-skip').click();
  await page.getByTestId('onboarding-skip-confirm').click();
  await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
  await expect.poll(() => readSentinel(page)).not.toBeNull();

  await page.reload();
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
});

test('已登录(通道可用):不弹引导并静默补写哨兵', async ({ page }) => {
  await seedOnboardingPending(page);
  await installMock(page, { signedIn: true });
  await page.goto('/workbench');

  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
  // 存量用户不该被引导拦一次:gate 静默落哨兵。
  await expect.poll(() => readSentinel(page)).not.toBeNull();
});

test('哨兵已写 + 未登录:仍不弹引导(不重放)', async ({ page }) => {
  await seedOnboardingCompleted(page);
  await installMock(page, { signedIn: false });
  await page.goto('/workbench');

  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
});

test('账号轨走完:登录 → 确认连接 → 首图提示词进工作台 Composer(不自动生成)', async ({ page }) => {
  await seedOnboardingPending(page);
  const calls = await installMock(page, { signedIn: false });
  await page.goto('/workbench');

  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-track-account').click();
  await page.getByTestId('onboarding-account-username').fill(ACCOUNT.username);
  await page.getByTestId('onboarding-account-password').fill('12345678');
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-step-validate')).toBeVisible();
  await expect(page.getByTestId('onboarding-validate-result')).toContainText('已登录 xiaomiao');
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-step-first-image')).toBeVisible();
  await page.getByTestId('onboarding-example-0').click();
  await expect(page.getByTestId('onboarding-prompt')).toHaveValue(PROMPT);
  await page.getByTestId('onboarding-next').click();

  // 引导收尾:哨兵落地、引导层撤走、提示词进 Composer,但不代替用户点发送。
  await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
  await expect.poll(() => readSentinel(page)).not.toBeNull();
  await expect(page.getByTestId('composer-prompt')).toHaveValue(PROMPT);
  expect(calls.generateCalls).toBe(0);
});
