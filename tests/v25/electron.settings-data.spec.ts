import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { createPrompt } from './prompt-helpers';

/**
 * 设置「数据存储」+「关于」的桌面闭环(07-settings-06 / 07-settings-07)。
 *
 * 全程用一次性 userData:备份写进该目录下的备份目录、清空数据只动这份库,
 * 不碰开发机真实数据(危险区用例会真的清库,所以本文件必须独占 userData)。
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

/**
 * 危险区边界断言的种子。
 * - 提示词经 UI 建(prompts 表带 workspace_id 与 FTS 触发器,走真实路径最稳);
 * - 工作台对话与 Provider 直接落库:草稿态不建会话行、建连接是另一张卡的长流程,
 *   这里只需要「清空前存在」这一事实。
 */
function seedSessionAndProvider(dbPath: string): void {
  const db = new Database(dbPath);
  const now = Date.now();
  db.prepare(
    `INSERT INTO workbench_sessions (id, title, created_at, updated_at, archived_at, deleted_at)
     VALUES ('e2e-data-session', '待清空对话', ?, ?, NULL, NULL)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO providers (
       id, name, type, base_url, model, has_key, key_suffix, is_active, created_at, updated_at
     ) VALUES (
       'e2e-data-provider', '保留的连接', 'openai-compatible',
       'https://relay.example.com/v1', 'gemini-2.5-flash-image', 0, NULL, 1, ?, ?
     )`,
  ).run(now, now);
  db.close();
}

function countRows(dbPath: string, table: string): number {
  const db = new Database(dbPath);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  db.close();
  return row.n;
}

/**
 * 备份目录名带数据命名空间版本(core constants `musefold-backups-<ns>`);
 * E2E 不 import 工作区包(Playwright 走 Node 解析),按前缀在一次性 userData 里找。
 */
const BACKUPS_DIR_PREFIX = 'musefold-backups-';

function backupsDir(): string | null {
  try {
    const entry = readdirSync(userDataDir).find((name) => name.startsWith(BACKUPS_DIR_PREFIX));
    return entry ? join(userDataDir, entry) : null;
  } catch {
    return null;
  }
}

function listBackupFiles(): string[] {
  const dir = backupsDir();
  if (!dir) return [];
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.db'));
  } catch {
    return [];
  }
}

async function openSettingsSection(id: string): Promise<void> {
  await page.getByTestId(`settings-nav-${id}`).click();
  await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-e2e-data-'));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('v25-shell')).toBeVisible();
  seedSessionAndProvider(desktopDbPath(userDataDir));
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('数据分区:桌面注册本机数据面四块(回收站/备份/存储位置/危险区)', async () => {
  await openSettingsSection('data');
  await expect(page.getByTestId('settings-data-card')).toBeVisible();
  await expect(page.getByTestId('settings-backup-card')).toBeVisible();
  await expect(page.getByTestId('settings-storage-card')).toBeVisible();
  await expect(page.getByTestId('settings-danger-card')).toBeVisible();
  // 备份状态行不空白:读取中 / 暂无备份 / 「共 n 份」(首启 desktop-db 接管会先落一份快照)。
  await expect(page.getByTestId('settings-backup-status')).toContainText(
    /正在读取备份|暂无备份|共 \d+ 份/,
  );
});

test('立即备份:落一份手动快照,列表自动展开且状态行计数 +1', async () => {
  await openSettingsSection('data');
  // 首启会留一份 desktop-db 接管快照(db-v25-takeover-*.db),所以基线从磁盘读而不写死 0。
  const before = listBackupFiles();
  await expect(page.getByTestId('settings-backup-status')).toContainText(
    before.length === 0 ? '暂无备份' : `共 ${before.length} 份`,
  );

  await page.getByTestId('settings-backup-create').click();
  await expect(page.getByTestId('settings-backup-status')).toContainText(
    `共 ${before.length + 1} 份`,
  );
  await expect(page.getByTestId('settings-backup-list')).toBeVisible();

  const created = listBackupFiles().filter((name) => !before.includes(name));
  expect(created).toHaveLength(1);
  const file = created[0] ?? '';
  expect(file).toMatch(/-manual\.db$/);
  // 行文案:文件名 · 大小 · 时间;恢复入口逐份可见。
  const row = page.getByTestId(`settings-backup-row-${file}`);
  await expect(row).toContainText(file);
  await expect(row).toContainText(/KB|MB/);
  await expect(page.getByTestId(`settings-backup-restore-${file}`)).toBeVisible();
});

test('恢复备份:确认对话框说明覆盖与重启语义,取消不动数据库', async () => {
  await openSettingsSection('data');
  const file = listBackupFiles().find((name) => name.endsWith('-manual.db')) ?? '';
  expect(file).not.toBe('');
  if (!(await page.getByTestId('settings-backup-list').isVisible())) {
    await page.getByTestId('settings-backup-toggle').click();
  }

  await page.getByTestId(`settings-backup-restore-${file}`).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('恢复此备份?');
  await expect(dialog).toContainText('当前数据将被该备份覆盖,应用将重启');

  // 取消:不执行恢复(应用不重启,库里种子数据仍在)。
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  expect(countRows(desktopDbPath(userDataDir), 'workbench_sessions')).toBe(1);
});

test('存储位置与诊断日志:路径行指向本次一次性 userData,日志按需读取', async () => {
  await openSettingsSection('data');
  await expect(page.getByTestId('settings-storage-row-database')).toBeVisible();
  await expect(page.getByTestId('settings-storage-path-userData')).toContainText(userDataDir);
  await expect(page.getByTestId('settings-storage-path-backups')).toContainText(BACKUPS_DIR_PREFIX);
  await expect(page.getByTestId('settings-storage-copy-database')).toBeVisible();
  await expect(page.getByTestId('settings-storage-open-backups')).toBeVisible();

  // 日志:点「查看」才读;有内容给只读文本区,无内容给空态文案。
  await page.getByTestId('settings-log-toggle').click();
  await expect(page.getByTestId('settings-log-body')).toBeVisible();
  const logText = page.getByTestId('settings-log-text');
  const logEmpty = page.getByTestId('settings-log-empty');
  await expect(logText.or(logEmpty)).toBeVisible();
  if (await logText.isVisible()) {
    await expect(logText).toHaveAttribute('readonly', '');
  }
});

test('关于卡:版本行含真实版本与库结构版本,快捷键表逐条渲染', async () => {
  await openSettingsSection('about');
  const version = page.getByTestId('settings-about-version');
  await expect(version).toContainText(/版本 \d+\.\d+\.\d+/);
  await expect(version).toContainText(/库结构 v\d+/);
  await expect(page.getByTestId('settings-about-shortcut-new-session')).toBeVisible();
  await expect(page.getByTestId('settings-about-docs')).toBeVisible();

  await page.getByTestId('settings-about-notices').click();
  await expect(page.getByTestId('settings-about-notices-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('危险区:短语不匹配不可执行;执行后业务表清空、Provider 与清空前快照保留', async () => {
  const dbPath = desktopDbPath(userDataDir);
  const promptsBefore = countRows(dbPath, 'prompts');

  // 业务内容经真实路径落库(提示词库新建),清空后才有可断言的「前后差」。
  await page.getByTestId('nav-prompts').click();
  await createPrompt(page, '待清空提示词', '霓虹雨夜的城市街角');
  await page.getByTestId('nav-settings').click();
  await openSettingsSection('data');

  expect(countRows(dbPath, 'prompts')).toBe(promptsBefore + 1);
  expect(countRows(dbPath, 'workbench_sessions')).toBe(1);

  const button = page.getByTestId('settings-danger-clear');
  await expect(button).toBeDisabled();
  await page.getByTestId('settings-danger-confirm-input').fill('清空数据');
  await expect(button).toBeDisabled();

  await page.getByTestId('settings-danger-confirm-input').fill('清空全部数据');
  await expect(button).toBeEnabled();
  const backupsBefore = listBackupFiles().length;
  await button.click();

  // 成功后短语框清空,并回显清空前的自动快照文件名。
  await expect(page.getByTestId('settings-danger-backup')).toContainText('pre-reset');
  await expect(page.getByTestId('settings-danger-confirm-input')).toHaveValue('');

  // 边界:业务内容与对话清空,Provider 保留(密钥语义不受影响)。
  expect(countRows(dbPath, 'prompts')).toBe(0);
  expect(countRows(dbPath, 'workbench_sessions')).toBe(0);
  expect(countRows(dbPath, 'providers')).toBe(1);
  expect(listBackupFiles().length).toBe(backupsBefore + 1);
});
