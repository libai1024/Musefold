import { expect, type Page, test } from '@playwright/test';
import { accountModelCatalogSchema } from '@musefold/contracts';
import { seedOnboardingCompleted } from './onboarding-helpers';
import { clickRowAction } from './prompt-helpers';
import { logoutLiveWeb, submitLiveLogin } from './live-account-helpers';
import { browserJson } from './package-exchange-browser';

/**
 * 对本地 API 的活体 Web 登录(xiaomiao)。默认 skip,避免 CI 依赖 New API / 本地 8787。
 * 开启:`MUSEFOLD_LIVE_E2E=1 MUSEFOLD_E2E_PASSWORD=…`(+ 可选 `MUSEFOLD_E2E_USERNAME`)。
 * 密码只走环境变量,不写进仓库。
 */
const liveEnabled = process.env.MUSEFOLD_LIVE_E2E === '1';
const username = process.env.MUSEFOLD_E2E_USERNAME ?? 'xiaomiao';
const password = process.env.MUSEFOLD_E2E_PASSWORD ?? '';

test.skip(
  !liveEnabled || password.length === 0,
  '需要 MUSEFOLD_LIVE_E2E=1 与 MUSEFOLD_E2E_PASSWORD',
);

test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

test.afterEach(async ({ page }) => {
  await logoutLiveWeb(page);
});

async function openAccountSection(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.getByTestId('settings-nav-account').click();
  await expect(page.getByTestId('settings-section-account')).toBeVisible();
}

test('活体登录 → 提示词 CRUD → 方案列表可达', async ({ page, isMobile }, info) => {
  await openAccountSection(page);
  await expect(page.getByTestId('account-auth-form')).toBeVisible();
  await submitLiveLogin(page);
  await expect(page.getByTestId('account-signed-in')).toContainText(username);
  if (!isMobile) {
    await expect(page.getByTestId('account-footer')).toContainText(username);
  }
  const catalog = accountModelCatalogSchema.parse(
    await browserJson(page, '/api/v1/account/models'),
  );
  await info.attach('real-account-model-catalog', {
    contentType: 'application/json',
    body: JSON.stringify({
      models: catalog.models.map(({ model, imageGeneration, pricing }) => ({
        model,
        imageGeneration,
        pricing,
      })),
      paidCalls: 0,
    }),
  });

  await page.goto('/prompts');
  await expect(page.getByTestId('prompt-library')).toBeVisible();

  const title = `B7 live ${Date.now()}`;
  await page.getByTestId('prompt-create').click();
  await expect(page.getByTestId('prompt-editor-title')).toBeVisible();
  // Next dev Strict Mode 会二次挂载编辑器;等对齐完成后再填,避免被空快照清掉。
  await page.waitForTimeout(200);
  await page.getByTestId('prompt-editor-title').fill(title);
  await page.getByTestId('prompt-editor-content').fill('xiaomiao live prompt');
  await expect(page.getByTestId('prompt-editor-title')).toHaveValue(title);
  await expect(page.getByTestId('prompt-editor-content')).toHaveValue('xiaomiao live prompt');
  await expect(page.getByTestId('prompt-editor-submit')).toBeEnabled();
  await page.getByTestId('prompt-editor-submit').click();
  await expect(page.getByTestId('prompt-editor')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(title)).toBeVisible();
  await clickRowAction(page, title, 'prompt-row-remove');
  await expect(page.getByText(title)).toHaveCount(0);

  await page.goto('/design-schemes');
  await expect(page.getByTestId('scheme-list-workspace')).toBeVisible();
});
