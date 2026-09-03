import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { designSchemeDbPath, desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

// 桌面工作台全链路:features 屏 → IPC 桥 → core SQLite + generate() 编排。
// 生成用「受控失败」链路(provider 无 API key):提交→run 落库→异步失败→
// 时间线呈现失败态与重试。成功出图链路等 M4d 接入连接管理后补 mock provider。

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

interface HangingImageServer {
  baseUrl: string;
  requestReceived: Promise<void>;
  close(): Promise<void>;
}

async function closeServer(server: Server, responses: Set<ServerResponse>): Promise<void> {
  for (const response of responses) response.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startHangingImageServer(): Promise<HangingImageServer> {
  let resolveRequest!: () => void;
  const requestReceived = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  const responses = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url?.endsWith('/images/generations')) {
      responses.add(response);
      response.on('close', () => responses.delete(response));
      request.resume();
      resolveRequest();
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server, responses);
    throw new Error('回环生图服务未取得 TCP 端口');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestReceived,
    close: () => closeServer(server, responses),
  };
}

function seedFormalTextScheme(userData: string): void {
  const schemeDb = new Database(designSchemeDbPath(userData));
  const now = Date.now();
  const document = {
    schemaVersion: 1,
    revisionId: 'revision_e2e_scheme',
    schemeId: 'scheme_e2e_formal',
    name: 'E2E 文本海报方案',
    summary: '用于工作台运行取消测试',
    fidelity: 'adapted',
    sources: [
      {
        id: 'source_brief',
        kind: 'user-brief',
        role: 'context',
        packageId: 'package_e2e_scheme',
        snapshotId: 'snapshot_e2e_scheme',
      },
    ],
    sourceSnapshotIds: ['snapshot_e2e_scheme'],
    inputs: [
      {
        id: 'topic',
        label: '主题',
        kind: 'text',
        required: true,
        description: '输入海报主题',
      },
    ],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'module_1',
        order: 0,
        kind: 'input-template',
        template: 'Create a restrained poster about {{topic}}',
        variables: ['topic'],
        sourceIds: ['source_brief'],
      },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'e2e-fixture', connectionName: 'E2E fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  };
  schemeDb.transaction(() => {
    schemeDb
      .prepare(
        `INSERT INTO source_packages (id, kind, repository_url, license, created_at)
         VALUES ('package_e2e_scheme', 'user-brief', NULL, NULL, ?)`,
      )
      .run(now);
    schemeDb
      .prepare(
        `INSERT INTO source_snapshots
           (id, package_id, ref, commit_hash, content_hash, total_bytes, scan_json, created_at)
         VALUES ('snapshot_e2e_scheme', 'package_e2e_scheme', 'e2e-seed', NULL, NULL, 0, '{}', ?)`,
      )
      .run(now);
    schemeDb
      .prepare(
        `INSERT INTO design_schemes
           (id, name, summary, status, source_presentation, source_label, current_revision_id,
            working_draft_revision_id, cover_asset_id, fidelity, version, created_at, updated_at,
            deleted_at)
         VALUES ('scheme_e2e_formal', 'E2E 文本海报方案', '用于工作台运行取消测试',
           'formal', 'musefold-created', 'E2E 本地种子', 'revision_e2e_scheme', NULL,
           'asset_e2e_cover', 'adapted', 1, ?, ?, NULL)`,
      )
      .run(now, now);
    schemeDb
      .prepare(
        `INSERT INTO design_scheme_revisions
           (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
         VALUES ('revision_e2e_scheme', 'scheme_e2e_formal', 1, ?, 'user', ?)`,
      )
      .run(JSON.stringify(document), now);
    schemeDb
      .prepare(
        `INSERT INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
         VALUES ('revision_e2e_scheme', 'snapshot_e2e_scheme', 'context')`,
      )
      .run();
    schemeDb
      .prepare(
        `INSERT INTO design_scheme_runs
           (run_id, revision_id, mode, status, policy_json, provider_json, created_at, completed_at)
         VALUES ('run_e2e_seed', 'revision_e2e_scheme', 'trial', 'completed', '{}', NULL, ?, ?)`,
      )
      .run(now, now);
    schemeDb
      .prepare(
        `INSERT INTO design_scheme_assets
           (id, revision_id, store_key, role, origin, license, mime_type, width, height,
            byte_size, content_hash, created_at)
         VALUES ('asset_e2e_cover', 'revision_e2e_scheme', 'e2e-fixture-cover', 'cover',
           'local-run', NULL, 'image/png', 1, 1, 0, ?, ?)`,
      )
      .run('0'.repeat(64), now);
  })();
  schemeDb.close();
}

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-workbench-'));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('「新设计」进草稿态:不落未命名行,发送前面板保持空', async () => {
  await page.getByTestId('session-create').click();
  await expect(page.getByTestId('workbench-empty')).toBeVisible();
  // 草稿态不建会话行(发送才入列)。
  await expect(page.getByTestId('session-panel').getByText('未命名创作')).toBeHidden();
  await expect(page.getByTestId('session-panel')).toContainText('还没有对话');
});

test('无 AI 连接时发送禁用并引导去设置', async () => {
  // V25-UI-SPEC §3.2 无连接态:不再允许提交后报错,而是禁发 + 引导。
  await page.getByTestId('composer-prompt').fill('a lighthouse in fog');
  await expect(page.getByTestId('composer-no-provider')).toBeVisible();
  await expect(page.getByTestId('composer-no-provider')).toContainText('尚未配置可用的 AI 连接');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
});

test('提交生成:run 落库,失败态与重试呈现在时间线', async () => {
  // 直插一个 provider 行(无 API key):generate() 会真实走到取 key 失败,
  // run 状态机 queued → failed,驱动 UI 轮询与失败呈现。
  const db = new Database(desktopDbPath(userDataDir));
  db.prepare(
    `INSERT INTO providers (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
     VALUES ('e2e-provider', 'E2E 连接', 'openai-compatible', 'http://127.0.0.1:9/v1', 'test-model', 0, 1, ?, ?)`,
  ).run(Date.now(), Date.now());
  db.close();

  // 桥无 provider 变更推送,重启应用让渲染层 providers 目录重新加载(解除禁发)。
  await app.close();
  ({ app } = await launchV25App('musefold-v25-workbench-', userDataDir));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();

  await page.getByTestId('composer-prompt').fill('a lighthouse in fog');
  await page.getByTestId('composer-submit').click();

  // 发送才建会话:行入列且标题由首句派生(草稿态语义)。
  await expect(page.getByTestId('session-panel').getByText('a lighthouse in fog')).toBeVisible();
  // 用户气泡立即出现(run 已落库)
  await expect(page.getByTestId('timeline').getByText('a lighthouse in fog')).toBeVisible();
  // 异步失败后,轮询把状态翻成 failed,错误与重试入口可见
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'failed', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('job-error')).toBeVisible();
  await expect(page.getByTestId('job-retry')).toBeVisible();
});

test('行内重命名会话(发送创建的行)', async () => {
  // 行动作 hover 渐显(静息态让位给相对时间戳),先悬停会话行。
  await page.getByTestId('session-panel').getByText('a lighthouse in fog').hover();
  await page.getByTestId('session-rename').click();
  await page.getByTestId('session-rename-input').fill('霓虹城市习作');
  await page.getByTestId('session-rename-commit').click();
  await expect(page.getByTestId('session-panel').getByText('霓虹城市习作')).toBeVisible();
});

test('重试生成产生新 turn', async () => {
  await page.getByTestId('job-retry').first().click();
  // 两个 turn(原始 + 重试),重试的最终也失败
  await expect(page.getByTestId('job-status')).toHaveCount(2, { timeout: 5_000 });
  await expect(page.getByTestId('job-status').nth(1)).toHaveAttribute('data-status', 'failed', {
    timeout: 15_000,
  });
});

test('桌面工作台视觉基线(浅色)', async () => {
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page).toHaveScreenshot('desktop-workbench-light.png');
});

test('提示词引用经真实 IPC/SQLite 生成,源编辑后历史快照不漂移', async () => {
  const dbPath = desktopDbPath(userDataDir);
  const db = new Database(dbPath);
  const now = Date.now();
  db.prepare(
    `INSERT INTO prompts
       (workspace_id, id, title, content, rating, is_pinned, usage_count, source, created_at, updated_at)
     VALUES ('local-only-legacy', 'prompt-reference-e2e', '桌面晨雾参考',
       'foreground mist, centered lighthouse, quiet negative space', 0, 0, 0, 'manual', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT OR IGNORE INTO providers
       (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
     VALUES ('e2e-provider', 'E2E 连接', 'openai-compatible',
       'http://127.0.0.1:9/v1', 'test-model', 0, 1, ?, ?)`,
  ).run(now, now);
  db.close();

  // 定向运行本用例时也必须自给 provider 前置条件;重启让目录查询重新装载。
  await app.close();
  ({ app } = await launchV25App('musefold-v25-workbench-', userDataDir));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();

  await page.getByTestId('session-create').click();
  await page.getByTestId('composer-attach').click();
  await page.getByTestId('workbench-context-ref-prompt').click();
  const sourceRow = page.getByTestId('workbench-reference-row').filter({ hasText: '桌面晨雾参考' });
  await sourceRow.getByTestId('workbench-reference-expand').click();
  await sourceRow.getByTestId('workbench-reference-full').click();
  await expect(page.getByTestId('prompt-reference-card')).toContainText('桌面晨雾参考');
  await page.getByTestId('workbench-materials-close').click();

  await expect(page.getByTestId('composer-prompt')).toHaveValue('');
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('job-status').last()).toHaveAttribute('data-status', 'failed', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('job-prompt-reference')).toContainText('桌面晨雾参考');
  await expect(page.getByTestId('job-prompt-reference')).toContainText(
    'foreground mist, centered lighthouse, quiet negative space',
  );

  const updatedDb = new Database(dbPath);
  updatedDb
    .prepare(
      'UPDATE prompts SET title = ?, content = ?, updated_at = ? WHERE workspace_id = ? AND id = ?',
    )
    .run(
      '桌面晨雾参考已更新',
      'new desktop source content that must not rewrite history',
      Date.now(),
      'local-only-legacy',
      'prompt-reference-e2e',
    );
  updatedDb.close();

  await app.close();
  ({ app } = await launchV25App('musefold-v25-workbench-', userDataDir));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('job-prompt-reference')).toContainText('桌面晨雾参考');
  await expect(page.getByTestId('job-prompt-reference')).toContainText(
    'foreground mist, centered lighthouse, quiet negative space',
  );
  await expect(page.getByTestId('job-prompt-reference')).not.toContainText('桌面晨雾参考已更新');

  await page.getByTestId('composer-attach').click();
  await page.getByTestId('workbench-context-ref-prompt').click();
  await expect(page.getByTestId('workbench-reference-sidebar')).toContainText('桌面晨雾参考已更新');
  await expect(page.getByTestId('workbench-reference-sidebar')).toContainText(
    'new desktop source content that must not rewrite history',
  );
  await page.getByTestId('workbench-materials-close').click();
});

test('正式纯文本方案经真实 IPC 运行后可取消,双账本收敛且 Composer 输入保留', async () => {
  const imageServer = await startHangingImageServer();
  const userPrompt = '保留安静留白与清晰标题';
  const topic = '夜间城市书展';
  try {
    const apiKey = `e2e-${randomUUID()}`;
    await page.evaluate(
      async ({ baseUrl, apiKey: key }) => {
        const bridge = (
          window as unknown as {
            musefoldV25: {
              invoke(method: string, payload?: unknown): Promise<unknown>;
            };
          }
        ).musefoldV25;
        const envelope = (await bridge.invoke('aiProviders.create', {
          name: 'E2E 回环连接',
          baseUrl,
          model: 'e2e-image-model',
          apiKey: key,
          activate: true,
        })) as { ok?: boolean; error?: { message?: string } };
        if (!envelope.ok) throw new Error(envelope.error?.message ?? 'E2E Provider 创建失败');
      },
      { baseUrl: imageServer.baseUrl, apiKey },
    );

    await app.close();
    seedFormalTextScheme(userDataDir);
    ({ app } = await launchV25App('musefold-v25-workbench-', userDataDir));
    page = await v25ShellPage(app);
    await expect(page.getByTestId('workbench')).toBeVisible();

    await page.getByTestId('session-create').click();
    await page.getByTestId('composer-attach').click();
    await page.getByTestId('workbench-context-ref-scheme').click();
    await expect(page.getByTestId('scheme-run-picker')).toBeVisible();
    await page.getByTestId('scheme-run-pick-scheme_e2e_formal').click();
    await expect(page.getByTestId('scheme-run-chip')).toContainText('E2E 文本海报方案');
    await page.getByTestId('scheme-run-variable-topic').fill(topic);
    await page.getByTestId('composer-prompt').fill(userPrompt);
    await expect(page.getByTestId('composer-submit')).toBeEnabled();
    await page.getByTestId('composer-submit').click();

    await imageServer.requestReceived;
    const stop = page.getByTestId('composer-cancel');
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(page.getByTestId('job-status').last()).toHaveAttribute(
      'data-status',
      'cancelled',
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('scheme-submit-error')).toHaveCount(0);
    await expect(page.getByTestId('scheme-run-attachment')).toBeVisible();
    await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue(topic);
    await expect(page.getByTestId('composer-prompt')).toHaveValue(userPrompt);

    const coreDb = new Database(desktopDbPath(userDataDir), { readonly: true });
    const generation = coreDb
      .prepare(
        `SELECT status, workbench_session_id, user_prompt, provider_id
           FROM generation_runs ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as {
      status: string;
      workbench_session_id: string | null;
      user_prompt: string;
      provider_id: string;
    };
    coreDb.close();
    expect(generation).toMatchObject({
      status: 'cancelled',
      user_prompt: userPrompt,
    });
    expect(generation.workbench_session_id).toBeTruthy();

    const schemeDb = new Database(designSchemeDbPath(userDataDir), { readonly: true });
    const schemeRun = schemeDb
      .prepare(
        `SELECT status, mode FROM design_scheme_runs
          WHERE run_id <> 'run_e2e_seed' ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as { status: string; mode: string };
    const generatedAssetCount = schemeDb
      .prepare(
        `SELECT COUNT(*) AS count FROM design_scheme_assets
          WHERE id <> 'asset_e2e_cover'`,
      )
      .get() as { count: number };
    schemeDb.close();
    expect(schemeRun).toEqual({ status: 'cancelled', mode: 'formal' });
    expect(generatedAssetCount.count).toBe(0);
  } finally {
    await imageServer.close();
  }
});

test('草稿输入防抖落盘,重启后仍在(置尾:输入会改变视觉基线)', async () => {
  const dbPath = desktopDbPath(userDataDir);
  const sessionId = 'draft-e2e-session';

  // This test owns its persisted session so it remains valid when run alone.
  await app.close();
  const db = new Database(dbPath);
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO workbench_sessions
       (id, title, created_at, updated_at, archived_at, deleted_at)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  ).run(sessionId, '草稿持久化测试', now, now);
  db.close();

  ({ app } = await launchV25App('musefold-v25-workbench-', userDataDir));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId(`session-${sessionId}`)).toBeVisible();
  await page.getByTestId(`session-${sessionId}`).click();

  await page.getByTestId('composer-prompt').fill('cyberpunk street, rainy night');
  await expect
    .poll(() => {
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare('SELECT draft_json FROM workbench_drafts WHERE session_id = ?')
        .get(sessionId) as { draft_json: string } | undefined;
      db.close();
      return row ? (JSON.parse(row.draft_json) as { prompt?: string }).prompt : undefined;
    })
    .toBe('cyberpunk street, rainy night');

  await app.close();
  ({ app } = await launchV25App('musefold-v25-workbench-', userDataDir));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('composer-prompt')).toHaveValue('cyberpunk street, rainy night');
});
