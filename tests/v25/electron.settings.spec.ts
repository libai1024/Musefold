import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

function seedArchivedSessions(dbPath: string): void {
  const db = new Database(dbPath);
  const now = Date.now();
  const insertSession = db.prepare(
    `INSERT INTO workbench_sessions
       (id, title, created_at, updated_at, archived_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  );
  insertSession.run('e2e-archive-restore', '待恢复归档', now - 10_000, now - 5_000, now - 5_000);
  insertSession.run('e2e-archive-delete', '待删除归档', now - 20_000, now - 15_000, now - 15_000);

  db.prepare(
    `INSERT INTO generation_runs (
       id, run_kind, workbench_session_id, parent_run_id, provider_id, model,
       user_prompt, base_prompt, final_prompt, negative_prompt,
       params_json, prompt_snapshot_json, status, error_code, error_message,
       created_at, started_at, finished_at, deleted_at
     ) VALUES (
       ?, 'free_generation', ?, NULL, 'e2e-provider', 'e2e-model',
       ?, ?, ?, NULL,
       '{}', '{}', 'success', NULL, NULL,
       ?, ?, ?, NULL
     )`,
  ).run(
    'e2e-archive-retained-run',
    'e2e-archive-delete',
    '归档后仍保留的生成',
    '归档后仍保留的生成',
    '归档后仍保留的生成',
    now - 12_000,
    now - 11_000,
    now - 10_000,
  );
  db.close();
}

/** 进入设置分区(V25-UI-SPEC §6.1):桌面左导航常驻,直接点导航项。 */
async function openSettingsSection(id: string): Promise<void> {
  await page.getByTestId(`settings-nav-${id}`).click();
  await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-e2e-'));
  page = await v25ShellPage(app);
});

test.afterAll(async () => {
  await app?.close();
});

test('v2.5 新渲染壳加载 features 设置屏', async () => {
  await expect(page.getByTestId('v25-shell')).toBeVisible();
  // 默认视图是工作台;经共享壳侧栏切到设置。
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('settings-host-badge')).toHaveText('桌面版');
  // 桌面注册全部五个分区:外观 / 账号 / 云同步 / AI 连接 / 数据;默认停在外观。
  for (const id of ['appearance', 'account', 'sync', 'connections', 'data']) {
    await expect(page.getByTestId(`settings-nav-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('settings-section-appearance')).toBeVisible();
});

test('账号卡经 IPC 桥返回未登录态,展示登录表单与侧栏登录入口', async () => {
  await openSettingsSection('account');
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
  await expect(page.getByTestId('account-auth-form')).toBeVisible();
  await expect(page.getByTestId('account-footer-signed-out')).toBeVisible();
});

test('AI 连接:新建 → 密钥落安全存储 → 设为默认 → 删除,全程落 SQLite', async () => {
  await openSettingsSection('connections');
  const card = page.getByTestId('settings-ai-connections-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('ai-providers-empty')).toBeVisible();

  // 新建(带密钥)
  await page.getByTestId('ai-provider-new').click();
  await page.getByTestId('ai-provider-name').fill('测试网关');
  await page.getByTestId('ai-provider-base-url').fill('https://relay.example.com/v1');
  await page.getByTestId('ai-provider-model').fill('gemini-2.5-flash-image');
  await page.getByTestId('ai-provider-key').fill('sk-e2e-test-a1b2');
  await page.getByTestId('ai-provider-save').click();

  const list = page.getByTestId('ai-providers-list');
  await expect(list).toBeVisible();
  await expect(list.getByText('测试网关')).toBeVisible();
  // 首个连接自动成为默认;密钥只显示尾号
  await expect(list.getByTestId('ai-provider-active-badge')).toBeVisible();
  await expect(list.getByText(/密钥 …a1b2/)).toBeVisible();

  // SQLite 断言:行存在、has_key 置位、密钥明文不落库
  const db = new Database(desktopDbPath(userDataDir));
  const row = db
    .prepare('SELECT name, base_url, model, has_key, key_suffix, is_active FROM providers')
    .get() as {
    name: string;
    base_url: string;
    model: string;
    has_key: number;
    key_suffix: string | null;
    is_active: number;
  };
  db.close();
  expect(row).toMatchObject({
    name: '测试网关',
    base_url: 'https://relay.example.com/v1',
    model: 'gemini-2.5-flash-image',
    has_key: 1,
    key_suffix: 'a1b2',
    is_active: 1,
  });

  // 第二个连接不带密钥,再设为默认
  await page.getByTestId('ai-provider-new').click();
  await page.getByTestId('ai-provider-name').fill('备用连接');
  await page.getByTestId('ai-provider-base-url').fill('https://backup.example.com');
  await page.getByTestId('ai-provider-model').fill('flux-schnell');
  await page.getByTestId('ai-provider-save').click();
  await expect(list.getByText('备用连接')).toBeVisible();
  await expect(list.getByText('未配置密钥')).toBeVisible();

  await page.getByTestId('ai-provider-set-active').click();
  const backupRow = list.locator('li').filter({ hasText: '备用连接' });
  await expect(backupRow.getByTestId('ai-provider-active-badge')).toBeVisible();

  // 删除默认连接 → AlertDialog 确认 → 另一条自动接管默认
  await backupRow.getByTestId('ai-provider-delete').click();
  await page.getByTestId('ai-provider-delete-confirm').click();
  await expect(list.getByText('备用连接')).toBeHidden();
  await expect(list.getByTestId('ai-provider-active-badge')).toBeVisible();

  const db2 = new Database(desktopDbPath(userDataDir));
  const rows = db2.prepare('SELECT name, is_active FROM providers').all() as Array<{
    name: string;
    is_active: number;
  }>;
  db2.close();
  expect(rows).toEqual([{ name: '测试网关', is_active: 1 }]);
});

test('Agent 连接:新建 → 密钥落安全存储 → 设为默认 → 删除,经 IPC 落主进程 AiConnectionStore 且与生图连接隔离', async () => {
  await openSettingsSection('connections');
  const card = page.getByTestId('settings-agent-connections-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(page.getByTestId('agent-connections-empty')).toBeVisible();

  // 新建(带密钥)
  await page.getByTestId('agent-connection-new').click();
  await page.getByTestId('agent-connection-name').fill('文本网关');
  await page.getByTestId('agent-connection-base-url').fill('https://text.example.com/v1/');
  await page.getByTestId('agent-connection-model').fill('gpt-5.4-mini');
  await page.getByTestId('agent-connection-key').fill('sk-e2e-agent-c3d4');
  await page.getByTestId('agent-connection-save').click();

  const list = page.getByTestId('agent-connections-list');
  await expect(list).toBeVisible();
  await expect(list.getByText('文本网关')).toBeVisible();
  await expect(list.getByTestId('agent-connection-active-badge')).toBeVisible();
  await expect(list.getByText(/密钥 …c3d4/)).toBeVisible();

  // 主进程事实源:经 IPC 读回(Base URL 已归一化去尾斜杠),密钥明文不回渲染层;生图 providers 表不受影响。
  const listed = await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        musefoldV25: { invoke(method: string, payload?: unknown): Promise<unknown> };
      }
    ).musefoldV25;
    return bridge.invoke('agentConnections.list');
  });
  expect(listed).toMatchObject({
    ok: true,
    data: [
      {
        name: '文本网关',
        type: 'openai-compatible',
        baseUrl: 'https://text.example.com/v1',
        model: 'gpt-5.4-mini',
        hasKey: true,
        keySuffix: 'c3d4',
        isActive: true,
      },
    ],
  });
  expect(JSON.stringify(listed)).not.toContain('sk-e2e-agent');
  const db = new Database(desktopDbPath(userDataDir));
  const imageRows = db.prepare('SELECT name FROM providers').all() as Array<{ name: string }>;
  db.close();
  expect(imageRows.map((row) => row.name)).not.toContain('文本网关');

  // 第二个连接不带密钥 → 设为默认 → 删除默认 → 另一条接管
  await page.getByTestId('agent-connection-new').click();
  await page.getByTestId('agent-connection-name').fill('备用文本');
  await page.getByTestId('agent-connection-base-url').fill('https://api.deepseek.com/v1');
  await page.getByTestId('agent-connection-model').fill('deepseek-chat');
  await page.getByTestId('agent-connection-save').click();
  await expect(list.getByText('备用文本')).toBeVisible();
  await expect(list.getByText('未配置密钥')).toBeVisible();

  await list.getByTestId('agent-connection-set-active').click();
  const backupRow = list.locator('li').filter({ hasText: '备用文本' });
  await expect(backupRow.getByTestId('agent-connection-active-badge')).toBeVisible();

  await backupRow.getByTestId('agent-connection-delete').click();
  await page.getByTestId('agent-connection-delete-confirm').click();
  await expect(list.getByText('备用文本')).toBeHidden();
  await expect(list.getByTestId('agent-connection-active-badge')).toBeVisible();
  await expect(list.getByText('文本网关')).toBeVisible();
});

test('云同步卡:未登录时仅提示登录,不提供同步动作', async () => {
  await openSettingsSection('sync');
  const card = page.getByTestId('settings-sync-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(card.getByText('同步未开启')).toBeVisible();
  await expect(page.getByTestId('sync-subtitle')).toHaveText('登录账号后可开启云同步');
  await expect(card.getByRole('button')).toHaveCount(0);
});

test('主题切换经主进程持久化并生效', async () => {
  await openSettingsSection('appearance');
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('动效三档经主进程持久化并真实作用到根节点', async () => {
  await openSettingsSection('appearance');
  const trigger = page.getByTestId('settings-motion-trigger');
  await expect(trigger).toHaveText(/跟随系统/);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'system');

  // on:挂 reduce-motion class(压制规则生效锚点)
  await trigger.click();
  await page.getByTestId('settings-motion-on').click();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');

  // off:摘 class,显式完整动效档
  await trigger.click();
  await page.getByTestId('settings-motion-off').click();
  await expect(page.locator('html')).not.toHaveClass(/reduce-motion/);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');

  // 回 system,保持视觉基线用例的前置状态
  await trigger.click();
  await page.getByTestId('settings-motion-system').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'system');
});

test('桌面设置页视觉基线(浅色)', async () => {
  // 自含导航:不依赖前序用例停在设置屏(允许单跑/过滤跑);基线固定为「外观」分区。
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await openSettingsSection('appearance');
  await expect(page.getByTestId('settings-theme-trigger')).toBeVisible();
  await expect(page).toHaveScreenshot('desktop-settings-light.png');
});

test('归档闭环:恢复清 archived_at,删除写 deleted_at 且 generation run 保留', async () => {
  seedArchivedSessions(desktopDbPath(userDataDir));
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await openSettingsSection('data');

  await page.getByTestId('archived-toggle').click();
  await expect(page.getByTestId('archived-session-e2e-archive-restore')).toBeVisible();
  await expect(page.getByTestId('archived-session-e2e-archive-delete')).toBeVisible();

  await page.getByTestId('archived-restore-e2e-archive-restore').click();
  await expect(page.getByTestId('archived-session-e2e-archive-restore')).toBeHidden();

  const db = new Database(desktopDbPath(userDataDir));
  const restored = db
    .prepare('SELECT archived_at, deleted_at FROM workbench_sessions WHERE id = ?')
    .get('e2e-archive-restore') as { archived_at: number | null; deleted_at: number | null };
  db.close();
  expect(restored).toEqual({ archived_at: null, deleted_at: null });
  await expect(page.getByTestId('session-panel').getByText('待恢复归档')).toBeVisible();

  await page.getByTestId('archived-remove-e2e-archive-delete').click();
  await expect(page.getByTestId('archived-remove-confirm')).toBeVisible();
  await page.getByTestId('archived-remove-confirm').click();
  await expect(page.getByTestId('archived-session-e2e-archive-delete')).toBeHidden();

  const dbAfterDelete = new Database(desktopDbPath(userDataDir));
  const deleted = dbAfterDelete
    .prepare('SELECT archived_at, deleted_at FROM workbench_sessions WHERE id = ?')
    .get('e2e-archive-delete') as { archived_at: number | null; deleted_at: number | null };
  const retainedRun = dbAfterDelete
    .prepare('SELECT workbench_session_id, deleted_at FROM generation_runs WHERE id = ?')
    .get('e2e-archive-retained-run') as {
    workbench_session_id: string | null;
    deleted_at: number | null;
  };
  dbAfterDelete.close();
  expect(deleted.archived_at).not.toBeNull();
  expect(deleted.deleted_at).not.toBeNull();
  expect(retainedRun).toEqual({ workbench_session_id: 'e2e-archive-delete', deleted_at: null });

  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId('history')).toBeVisible();
  await expect(page.getByTestId('history-row')).toContainText('归档后仍保留的生成');
});

test('桌面设置页视觉基线(深色)', async () => {
  // 自含导航:不依赖前序用例停在设置屏(允许单跑/过滤跑)。
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await openSettingsSection('appearance');
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page).toHaveScreenshot('desktop-settings-dark.png');

  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});
