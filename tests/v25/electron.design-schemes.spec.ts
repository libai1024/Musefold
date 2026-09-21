import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { designSchemeDbPath, launchV25App, v25ShellPage } from './electron-helpers';

/** 1×1 合法 PNG:导出 collectAssets 必须读到真实受管图片。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function seedFormalTextScheme(userData: string): void {
  writeFileSync(join(userData, 'e2e-cover.png'), TINY_PNG);
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
         VALUES ('asset_e2e_cover', 'revision_e2e_scheme', 'e2e-cover.png', 'cover',
           'local-run', NULL, 'image/png', 1, 1, 67, ?, ?)`,
      )
      .run('0'.repeat(64), now);
  })();
  schemeDb.close();
}

async function openFormalDetail(page: Page): Promise<void> {
  await page.getByTestId('nav-design-schemes').click();
  await expect(page.getByTestId('scheme-list-workspace')).toBeVisible();
  await page.getByTestId('runtime-scheme-open-scheme_e2e_formal').click();
  await page.getByTestId('scheme-inspector-open-detail').click();
  await expect(page.getByTestId('runtime-scheme-menu')).toBeVisible();
}

test.describe('方案中心入口与往返', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;
  let packagePath: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'musefold-v25-design-schemes-'));
    packagePath = join(userDataDir, 'e2e-export.musefold.design');
    const env = {
      MUSEFOLD_E2E_DESIGN_EXPORT_PATH: packagePath,
      MUSEFOLD_E2E_DESIGN_IMPORT_PATH: packagePath,
    };
    ({ app } = await launchV25App('musefold-v25-design-schemes-', {
      reuseUserDataDir: userDataDir,
      env,
    }));
    page = await v25ShellPage(app);
    await expect(page.getByTestId('v25-shell')).toBeVisible();
    await app.close();
    seedFormalTextScheme(userDataDir);
    ({ app } = await launchV25App('musefold-v25-design-schemes-', {
      reuseUserDataDir: userDataDir,
      env,
    }));
    page = await v25ShellPage(app);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('导航可见,新建菜单含导入分享包', async () => {
    await page.getByTestId('nav-design-schemes').click();
    await expect(page.getByTestId('scheme-list-workspace')).toBeVisible();
    await page.getByTestId('scheme-create').click();
    await expect(page.getByTestId('scheme-create-option-import')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('正式方案导出后可再导入为草稿,toast 不含绝对路径', async () => {
    await openFormalDetail(page);
    await page.getByTestId('runtime-scheme-menu').click();
    await page.getByTestId('runtime-scheme-menu-export').click();
    await expect.poll(() => existsSync(packagePath)).toBe(true);
    expect(packagePath.endsWith('.musefold.design')).toBe(true);

    const toast = page.getByText('分享包已导出');
    await expect(toast).toBeVisible();
    await expect(page.locator('body')).not.toContainText(userDataDir);

    await page.getByTestId('runtime-scheme-detail-back').click();
    await expect(page.getByTestId('scheme-list-workspace')).toBeVisible();
    await page.getByTestId('scheme-create').click();
    await page.getByTestId('scheme-create-option-import').click();
    await expect(page.getByText('已导入为草稿')).toBeVisible();
    await expect(page.locator('[data-runtime-scheme="true"][data-status="draft"]')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(packagePath);
  });

  test('导入草稿可重命名并删除', async () => {
    const draft = page.locator('[data-runtime-scheme="true"][data-status="draft"]').first();
    await expect(draft).toBeVisible();
    await draft.locator('[data-testid^="runtime-scheme-open-"]').click();
    await page.getByTestId('scheme-inspector-open-detail').click();
    await expect(page.getByTestId('runtime-scheme-menu')).toBeVisible();

    await page.getByTestId('runtime-scheme-menu').click();
    await page.getByTestId('runtime-scheme-menu-rename').click();
    await page.getByTestId('scheme-rename-input').fill('B7 重命名草稿');
    await page.getByTestId('scheme-rename-confirm').click();
    await expect(page.getByRole('heading', { name: 'B7 重命名草稿' })).toBeVisible();

    await page.getByTestId('runtime-scheme-menu').click();
    await page.getByTestId('runtime-scheme-menu-remove').click();
    await page.getByTestId('scheme-list-remove-confirm').click();
    await expect(page.getByTestId('scheme-list-workspace')).toBeVisible();
    await expect(page.getByText('B7 重命名草稿')).toHaveCount(0);
  });
});

test.describe('导出取消', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;
  let packagePath: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'musefold-v25-design-export-cancel-'));
    packagePath = join(userDataDir, 'should-not-export.musefold.design');
    const env = {
      MUSEFOLD_E2E_DESIGN_EXPORT_CANCEL: '1',
      MUSEFOLD_E2E_DESIGN_EXPORT_PATH: packagePath,
    };
    ({ app } = await launchV25App('musefold-v25-design-export-cancel-', {
      reuseUserDataDir: userDataDir,
      env,
    }));
    page = await v25ShellPage(app);
    await expect(page.getByTestId('v25-shell')).toBeVisible();
    await app.close();
    seedFormalTextScheme(userDataDir);
    ({ app } = await launchV25App('musefold-v25-design-export-cancel-', {
      reuseUserDataDir: userDataDir,
      env,
    }));
    page = await v25ShellPage(app);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('取消导出不落文件', async () => {
    await openFormalDetail(page);
    await page.getByTestId('runtime-scheme-menu').click();
    await page.getByTestId('runtime-scheme-menu-export').click();
    await expect(page.getByText('分享包已导出')).toHaveCount(0);
    await expect(page.getByText('导出失败')).toHaveCount(0);
    expect(existsSync(packagePath)).toBe(false);
  });
});
