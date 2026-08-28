import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

// 桌面历史屏全链路:features/history → IPC 桥 generation.list/remove/restore → core SQLite。
// 直插 runs(成功 1 + 其重试子行 1 + 失败 1),覆盖列表/线程缩进/筛选/回收站闭环。

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

function seedRuns(dbPath: string): void {
  const db = new Database(dbPath);
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO generation_runs (
       id, run_kind, workbench_session_id, parent_run_id, provider_id, model,
       user_prompt, base_prompt, final_prompt, negative_prompt,
       params_json, prompt_snapshot_json, status, error_code, error_message,
       created_at, started_at, finished_at, deleted_at
     ) VALUES (
       @id, @run_kind, NULL, @parent_run_id, 'e2e-provider', 'test-model',
       @prompt, @prompt, @prompt, NULL,
       '{}', '{}', @status, @error_code, @error_message,
       @created_at, @created_at, @finished_at, NULL
     )`,
  );
  insert.run({
    id: 'run-e2e-a',
    run_kind: 'free_generation',
    parent_run_id: null,
    prompt: 'castle in clouds',
    status: 'success',
    error_code: null,
    error_message: null,
    created_at: now - 30 * 60_000,
    finished_at: now - 30 * 60_000 + 8_000,
  });
  insert.run({
    id: 'run-e2e-a2',
    run_kind: 'retry',
    parent_run_id: 'run-e2e-a',
    prompt: 'castle in clouds v2',
    status: 'success',
    error_code: null,
    error_message: null,
    created_at: now - 20 * 60_000,
    finished_at: now - 20 * 60_000 + 9_000,
  });
  insert.run({
    id: 'run-e2e-b',
    run_kind: 'free_generation',
    parent_run_id: null,
    prompt: 'broken robot sketch',
    status: 'failed',
    error_code: 'PROVIDER_REJECTED',
    error_message: '上游拒绝了请求',
    created_at: now - 10 * 60_000,
    finished_at: now - 10 * 60_000 + 2_000,
  });
  db.close();
}

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-history-'));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();
  seedRuns(desktopDbPath(userDataDir));
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId('history')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('列表读库:三行 + 重试线程缩进', async () => {
  await expect(page.getByTestId('history-row')).toHaveCount(3);
  await expect(page.getByTestId('history-thread-connector')).toHaveCount(1);
});

test('状态筛选走 SQL 条件', async () => {
  await page.getByTestId('history-filter-status').click();
  await page.getByRole('option', { name: '失败' }).click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-row')).toHaveAttribute('data-status', 'failed');
  await page.getByTestId('history-filter-clear').click();
  await expect(page.getByTestId('history-row')).toHaveCount(3);
});

test('详情面板呈现错误信息', async () => {
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'broken robot sketch' })
    .getByTestId('history-row-open')
    .click();
  await expect(page.getByTestId('history-inspector')).toBeVisible();
  await expect(page.getByTestId('history-inspector-error')).toContainText('上游拒绝了请求');
  await page.getByTestId('history-inspector-close').click();
});

test('回收站闭环:软删落库,恢复回列表', async () => {
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'broken robot sketch' })
    .getByTestId('history-row-remove')
    .click();
  await expect(page.getByTestId('history-row')).toHaveCount(2);

  // 软删确实写库
  const db = new Database(desktopDbPath(userDataDir));
  const deletedAt = (
    db.prepare('SELECT deleted_at FROM generation_runs WHERE id = ?').get('run-e2e-b') as {
      deleted_at: number | null;
    }
  ).deleted_at;
  db.close();
  expect(deletedAt).not.toBeNull();

  await page.getByTestId('history-tab-trash').click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await page.getByTestId('history-row-restore').click();
  await expect(page.getByTestId('history-empty')).toBeVisible();

  await page.getByTestId('history-tab-all').click();
  await expect(page.getByTestId('history-row')).toHaveCount(3);
});

test('桌面历史屏视觉基线(浅色)', async () => {
  await expect(page.getByTestId('history-row')).toHaveCount(3);
  // 行时间戳随运行时刻变化,mask 掉保证基线稳定。
  await expect(page).toHaveScreenshot('desktop-history-light.png', {
    mask: [page.getByTestId('history-row-time')],
  });
});
