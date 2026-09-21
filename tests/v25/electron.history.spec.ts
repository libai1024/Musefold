import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

/** 1×1 PNG:nativeImage 能解出非空位图(复制到剪贴板链路要求)。 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// 桌面历史屏全链路:features/history → IPC 桥 generation.list/remove/restore → core SQLite。
// 直插 runs(成功 1 + 其重试子行 1 + 失败 1),覆盖列表/线程缩进/筛选/回收站闭环。

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

function seedRuns(dbPath: string): void {
  const db = new Database(dbPath);
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const seedTime = (offsetMinutes: number) => {
    const raw = now - offsetMinutes * 60_000;
    return raw >= todayStart ? raw : todayStart + (70 - offsetMinutes) * 1000;
  };
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
    created_at: seedTime(30),
    finished_at: seedTime(30) + 8_000,
  });
  insert.run({
    id: 'run-e2e-a2',
    run_kind: 'retry',
    parent_run_id: 'run-e2e-a',
    prompt: 'castle in clouds v2',
    status: 'success',
    error_code: null,
    error_message: null,
    created_at: seedTime(20),
    finished_at: seedTime(20) + 9_000,
  });
  insert.run({
    id: 'run-e2e-b',
    run_kind: 'free_generation',
    parent_run_id: null,
    prompt: 'broken robot sketch',
    status: 'failed',
    error_code: 'PROVIDER_REJECTED',
    error_message: '上游拒绝了请求',
    created_at: seedTime(10),
    finished_at: seedTime(10) + 2_000,
  });
  // 种子写进参数快照(runSeed 从 params_json 读),用时用 duration_ms 列的权威口径。
  db.prepare(
    `UPDATE generation_runs
       SET params_json = ?, duration_ms = 8000, actual_cost = 2
     WHERE id = 'run-e2e-a'`,
  ).run(JSON.stringify({ schemaVersion: 1, size: '1024x1024', quality: 'high', seed: 987654 }));
  db.close();
}

/** 受管资产:写一张真实 PNG 到隔离 userData 的 Pictures,并登记 available 资产行。 */
function seedAsset(userData: string, dbPath: string): string {
  const picturesDir = join(userData, 'Pictures');
  mkdirSync(picturesDir, { recursive: true });
  const mediaPath = join(picturesDir, 'run-e2e-a.png');
  writeFileSync(mediaPath, Buffer.from(TINY_PNG_BASE64, 'base64'));
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO generated_assets (id, run_id, position, status, media_path, created_at)
     VALUES ('asset-e2e-a', 'run-e2e-a', 0, 'available', ?, ?)`,
  ).run(mediaPath, Date.now());
  db.close();
  return mediaPath;
}

function runRow(dbPath: string, id: string): { deleted_at: number | null } | undefined {
  const db = new Database(dbPath);
  const row = db.prepare('SELECT deleted_at FROM generation_runs WHERE id = ?').get(id) as
    | { deleted_at: number | null }
    | undefined;
  db.close();
  return row;
}

let assetPath: string;

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-history-'));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();
  seedRuns(desktopDbPath(userDataDir));
  assetPath = seedAsset(userDataDir, desktopDbPath(userDataDir));
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

test('元信息读库:成功行给「x 积分 · ys」,检视参数区带种子与尺寸', async () => {
  const row = page.getByTestId('history-row').filter({ hasText: 'castle in clouds' }).first();
  await expect(row).toContainText('2 积分');
  await expect(row).toContainText('8.0s');

  await row.getByTestId('history-row-open').click();
  const params = page.getByTestId('history-inspector-params');
  await expect(params).toContainText('test-model');
  await expect(params).toContainText('987654');
  await expect(params).toContainText('8.0s');
  // 用时能从 started/finished 差值兜底:重试子行没写 duration_ms 列。
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'castle in clouds v2' })
    .getByTestId('history-row-open')
    .click();
  await expect(page.getByTestId('history-inspector-params')).toContainText('9.0s');
  await page.getByTestId('history-inspector-close').click();
});

test('自定义时间区间走 SQL 条件', async () => {
  await page.getByTestId('history-filter-date').click();
  await page.getByRole('option', { name: '自定义' }).click();
  await expect(page.getByTestId('history-filter-custom-range')).toBeVisible();

  const day = (offsetDays: number) => {
    const date = new Date(Date.now() + offsetDays * 86_400_000);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  };

  // 今天整天:三条种子都在近 1 小时内。
  await page.getByTestId('history-filter-custom-from').fill(day(0));
  await page.getByTestId('history-filter-custom-to').fill(day(0));
  await expect(page.getByTestId('history-row')).toHaveCount(3);

  // 窗口推到明天 → 空集(证明 from/to 真进了 SQL,而不是前端过滤)。
  await page.getByTestId('history-filter-custom-from').fill(day(1));
  await page.getByTestId('history-filter-custom-to').fill(day(1));
  await expect(page.getByTestId('history-empty')).toBeVisible();

  await page.getByTestId('history-filter-clear').click();
  await expect(page.getByTestId('history-row')).toHaveCount(3);
});

test('桌面文件操作:检视与 Lightbox 给「在文件夹中显示」/「复制图片」', async () => {
  const row = page.getByTestId('history-row').filter({ hasText: 'castle in clouds' }).first();
  await row.getByTestId('history-row-open').click();
  await expect(page.getByTestId('history-inspector-reveal-asset')).toBeVisible();

  // 复制图片走主进程 nativeImage + clipboard,成功后 toast 提示。
  await page.getByTestId('history-inspector-copy-asset').click();
  await expect(page.getByText('图片已复制到剪贴板')).toBeVisible();
  expect(existsSync(assetPath)).toBe(true);

  // Lightbox 内同样有这两个动作(canRevealLocalFile 门控注入)。
  await page.getByTestId('history-inspector-image-open').click();
  await expect(page.getByTestId('history-lightbox')).toBeVisible();
  await expect(page.getByTestId('lightbox-reveal-asset')).toBeVisible();
  await expect(page.getByTestId('lightbox-copy-asset')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('history-lightbox')).toBeHidden();
  await page.getByTestId('history-inspector-close').click();
});

test('磁盘用量:回收站工具行给 HardDrive readout 与刷新钮', async () => {
  await page.getByTestId('history-tab-trash').click();
  await expect(page.getByTestId('history-disk-usage')).toBeVisible();
  // 已落盘一张 PNG:字节数与文件数都不为空(不外露目录路径)。
  await expect(page.getByTestId('history-disk-usage')).toContainText('个文件');
  await page.getByTestId('history-disk-usage-refresh').click();
  await expect(page.getByTestId('history-disk-usage')).toContainText('个文件');
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

test('批量清理落库:失败行软删入回收站,清空回收站连磁盘资产一起删', async () => {
  const dbPath = desktopDbPath(userDataDir);
  await page.getByTestId('history-tab-trash').click();
  await expect(page.getByTestId('history-empty')).toBeVisible();

  // 软删范围:失败与已取消 → run 行留下但 deleted_at 落库,图片文件不动。
  await page.getByTestId('history-cleanup-menu').click();
  await page.getByTestId('history-cleanup-failed-and-cancelled').click();
  await expect(page.getByText('图片文件仍保留', { exact: false })).toBeVisible();
  await page.getByTestId('history-cleanup-confirm').click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  expect(runRow(dbPath, 'run-e2e-b')?.deleted_at).not.toBeNull();
  expect(existsSync(assetPath)).toBe(true);

  // 先把带资产的成功行也送进回收站,再清空:资产文件应随之消失。
  await page.getByTestId('history-tab-all').click();
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'castle in clouds' })
    .first()
    .getByTestId('history-row-remove')
    .click();
  await page.getByTestId('history-tab-trash').click();
  await expect(page.getByTestId('history-row')).toHaveCount(2);

  await page.getByTestId('history-cleanup-menu').click();
  await page.getByTestId('history-cleanup-empty-trash').click();
  await expect(page.getByText('清空回收站?')).toBeVisible();
  await page.getByTestId('history-cleanup-confirm').click();
  await expect(page.getByTestId('history-empty')).toBeVisible();

  expect(runRow(dbPath, 'run-e2e-b')).toBeUndefined();
  expect(runRow(dbPath, 'run-e2e-a')).toBeUndefined();
  expect(existsSync(assetPath)).toBe(false);

  // 未删的重试子行仍在(父行外键 SET NULL,不级联删记录)。
  await page.getByTestId('history-tab-all').click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-row')).toContainText('castle in clouds v2');
});
