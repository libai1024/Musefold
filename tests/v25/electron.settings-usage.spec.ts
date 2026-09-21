import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

/**
 * 设置「使用统计」桌面闭环(07-settings-05 P2)。
 * 本文件只写不跑:主代理批次末统一跑 Electron E2E。
 *
 * 流程:干净 userData 先看全 0 空态 → 直插 generation_runs / generated_assets → 刷新看数字。
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

function seedUsageRuns(dbPath: string): void {
  const db = new Database(dbPath);
  const now = Date.now();
  db.prepare(
    `INSERT INTO providers (
       id, name, type, base_url, model, has_key, key_suffix, is_active, created_at, updated_at
     ) VALUES (
       'e2e-usage-provider', 'E2E 渠道', 'openai-compatible',
       'https://relay.example.com/v1', 'e2e-model', 0, NULL, 1, ?, ?
     )`,
  ).run(now, now);

  const insertRun = db.prepare(
    `INSERT INTO generation_runs (
       id, run_kind, workbench_session_id, parent_run_id, provider_id, model,
       user_prompt, base_prompt, final_prompt, negative_prompt,
       params_json, prompt_snapshot_json, status, error_code, error_message,
       actual_cost, created_at, started_at, finished_at, deleted_at
     ) VALUES (
       ?, 'free_generation', NULL, NULL, 'e2e-usage-provider', 'e2e-model',
       ?, ?, ?, NULL,
       '{}', '{}', ?, NULL, NULL,
       ?, ?, ?, ?, NULL
     )`,
  );
  insertRun.run(
    'e2e-usage-success',
    '使用统计成功',
    '使用统计成功',
    '使用统计成功',
    'success',
    3,
    now - 3_600_000,
    now - 3_000_000,
    now - 2_400_000,
  );
  insertRun.run(
    'e2e-usage-failed',
    '使用统计失败',
    '使用统计失败',
    '使用统计失败',
    'failed',
    null,
    now - 7_200_000,
    now - 6_600_000,
    now - 6_000_000,
  );

  db.prepare(
    `INSERT INTO generated_assets (id, run_id, position, status, media_path, created_at)
     VALUES ('e2e-usage-asset', 'e2e-usage-success', 0, 'available', NULL, ?)`,
  ).run(now);
  db.close();
}

async function openSettingsSection(id: string): Promise<void> {
  await page.getByTestId(`settings-nav-${id}`).click();
  await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-e2e-usage-'));
  page = await v25ShellPage(app);
});

test.afterAll(async () => {
  await app?.close();
});

test('干净库先空态,插入 runs 后刷新看到生成次数 / 成功率 / 成图 / 积分', async () => {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await openSettingsSection('usage');

  await expect(page.getByTestId('settings-usage-card')).toBeVisible();
  await expect(page.getByTestId('settings-usage-empty')).toHaveText('这段时间还没有生成记录');
  await expect(page.getByTestId('settings-usage-charts')).toContainText('该时段没有生成记录');

  seedUsageRuns(desktopDbPath(userDataDir));
  await page.getByTestId('settings-usage-refresh').click();

  await expect(page.getByTestId('settings-usage-generation-count')).toHaveText('2');
  await expect(page.getByTestId('settings-usage-success-rate')).toHaveText('50%');
  await expect(page.getByTestId('settings-usage-image-count')).toHaveText('1');
  await expect(page.getByTestId('settings-usage-cost')).toHaveText('3');
  await expect(page.getByTestId('settings-usage-charts')).toBeVisible();
  await expect(page.getByTestId('settings-usage-chart-trend')).toBeVisible();
  await expect(page.getByTestId('settings-usage-chart-provider')).toBeVisible();
  await expect(page.getByTestId('settings-usage-chart-model')).toBeVisible();
  await expect(page.getByTestId('settings-usage-chart-success')).toBeVisible();
});
