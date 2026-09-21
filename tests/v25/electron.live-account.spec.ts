import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { clickRowAction } from './prompt-helpers';
import { submitLiveLogin } from './live-account-helpers';
import { invoke } from './desktop-sync-helpers';

/**
 * 对本地 API 的活体 Electron 登录。默认 skip,避免 CI 依赖 New API / 本地 8787。
 * 开启:`MUSEFOLD_LIVE_E2E=1` 且 `MUSEFOLD_E2E_PASSWORD` 非空(+ 可选 `MUSEFOLD_E2E_USERNAME`)。
 * 密码只走环境变量,不写进仓库。
 * 桌面登录走主进程账号域,不是 Web cookie;API 基址经 launch env 注入 `MUSEFOLD_API_URL`。
 */
const liveEnabled = process.env.MUSEFOLD_LIVE_E2E === '1';
const username = process.env.MUSEFOLD_E2E_USERNAME ?? 'xiaomiao';
const password = process.env.MUSEFOLD_E2E_PASSWORD ?? '';
const liveApiUrl = 'http://127.0.0.1:8787';

test.skip(
  !liveEnabled || password.length === 0,
  '需要 MUSEFOLD_LIVE_E2E=1 与 MUSEFOLD_E2E_PASSWORD',
);

async function openAccountSection(page: Page): Promise<void> {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('settings-nav-account').click();
  await expect(page.getByTestId('settings-section-account')).toBeVisible();
}

test('活体登录 → 提示词 CRUD', async () => {
  let app: ElectronApplication | undefined;
  let page: Page | undefined;
  try {
    ({ app } = await launchV25App('musefold-v25-live-account-', {
      env: { MUSEFOLD_API_URL: liveApiUrl },
    }));
    page = await v25ShellPage(app);

    await openAccountSection(page);
    await expect(page.getByTestId('account-auth-form')).toBeVisible();
    await submitLiveLogin(page);
    await expect(page.getByTestId('account-signed-in')).toContainText(username);

    await page.getByTestId('nav-prompts').click();
    await expect(page.getByTestId('prompt-library')).toBeVisible();

    const title = `B8 live ${Date.now()}`;
    await page.getByTestId('prompt-create').click();
    await expect(page.getByTestId('prompt-editor-title')).toBeVisible();
    // 等编辑器对齐后再填,避免 Strict / 重挂载把输入清掉。
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
  } finally {
    try {
      if (page && !page.isClosed()) await invoke(page, 'account.logout');
    } finally {
      await app?.close();
    }
  }
});
