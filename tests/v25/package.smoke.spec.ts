// 打包产物冒烟(M5-b,接替旧 tests/package Python 冒烟):
// 启动 electron-builder 产出的 Musefold.app,验证 v2.5 壳能在 app:// 协议下
// 加载、SQLite 受管迁移在真实打包环境(asar + 内联迁移)可用。
// 前置:`pnpm run package:mac:adhoc`(release/mac-arm64/);产物缺失时跳过,
// 发布矩阵(release.yml)打包后必跑。

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import {
  designSchemeDetailSchema,
  designSchemePageSchema,
  workbenchSessionSchema,
} from '@musefold/contracts';
import { packageFixture } from '../../apps/api/src/modules/design-scheme-packages/__tests__/fixture';
import { localInvoke } from './local-execution-fixture';
import {
  seedSessionPackagePrefix,
  sessionPackageFacts,
  sessionPackageId,
} from './package-session-upgrade-fixture';
import { DESKTOP_MIGRATIONS } from '../../packages/desktop-db/src/migrations.generated';
import { v25ShellPage } from './electron-helpers';
import { seedOnboardingCompletedFile } from './onboarding-helpers';
import { resolvePackageArtifact } from '../../scripts/v25-package-artifact.mjs';
import { nativePackageIdentity } from './native-package-identity';
import { expectCurrentPackage } from './package-build-identity';
import { verifyCliCleanup } from './cli-cleanup-process';
import { verifyCliWriteCrash } from './cli-write-crash-process';
import { verifyCliDiscoveryStop } from './cli-discovery-stop-process';

const repoRoot = resolve(import.meta.dirname, '../..');

const expectedArch = process.env.MUSEFOLD_PACKAGE_ARCH || process.arch;
const executablePath = resolvePackageArtifact({
  repoRoot,
  platform: process.platform,
  arch: expectedArch,
  required: process.env.MUSEFOLD_PACKAGE_REQUIRED === '1',
  explicitPath: process.env.MUSEFOLD_PACKAGE_PATH,
});

test.skip(!executablePath, '未找到打包产物;先跑 pnpm run package:mac:adhoc(或 win 矩阵产物)');

test('打包 CLI 写盘中断后由新进程自动清理残留且不重发生图', async () => {
  test.setTimeout(60000);
  const executable = executablePath as string;
  const resources =
    process.platform === 'darwin'
      ? join(dirname(executable), '..', 'Resources')
      : join(dirname(executable), 'resources');
  const evidence = await verifyCliWriteCrash(
    executable,
    join(resources, 'integration', 'musefold-cli.mjs'),
    true,
  );
  await test.info().attach('packaged-cli-partial-write-recovery', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});

test('打包 CLI 使用随包原生资源恢复持久清理并完成退出清理', async () => {
  test.setTimeout(60000);
  const executable = executablePath as string;
  const resources =
    process.platform === 'darwin'
      ? join(dirname(executable), '..', 'Resources')
      : join(dirname(executable), 'resources');
  expect(nativePackageIdentity(join(resources, 'native', 'managed_fs.node'))).toBe(
    nativePackageIdentity(join(repoRoot, 'packages/managed-fs/build/Release/managed_fs.node')),
  );
  const evidence = await verifyCliCleanup(
    executable,
    join(resources, 'integration', 'musefold-cli.mjs'),
    true,
  );
  await test.info().attach('packaged-cli-cleanup', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});

test('打包 App 使用随包原生文件句柄导入方案并清理暂存副本', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'musefold-package-native-'));
  const picked = test.info().outputPath('picked.musefold.design');
  const bytes = await packageFixture();
  writeFileSync(picked, bytes);
  seedOnboardingCompletedFile(userDataDir);
  const app = await electron.launch({
    executablePath: executablePath as string,
    env: {
      ...process.env,
      MUSEFOLD_E2E: '1',
      MUSEFOLD_E2E_USER_DATA_DIR: userDataDir,
      MUSEFOLD_E2E_DESIGN_IMPORT_PATH: picked,
    },
  });
  try {
    const page = await v25ShellPage(app);
    await expectCurrentPackage(app, userDataDir);
    const expectedIdentity = nativePackageIdentity(
      join(repoRoot, 'packages/managed-fs/build/Release/managed_fs.node'),
    );
    const nativePath = await app.evaluate(() =>
      process.getBuiltinModule('path').join(process.resourcesPath, 'native', 'managed_fs.node'),
    );
    const nativeHash = await app.evaluate(() => {
      const fs = process.getBuiltinModule('fs');
      const path = process.getBuiltinModule('path');
      return process
        .getBuiltinModule('crypto')
        .createHash('sha256')
        .update(fs.readFileSync(path.join(process.resourcesPath, 'native', 'managed_fs.node')))
        .digest('hex');
    });
    expect(nativePackageIdentity(nativePath)).toBe(expectedIdentity);
    await page.getByTestId('nav-design-schemes').click();
    await page.getByTestId('scheme-create').click();
    await page.getByTestId('scheme-create-option-import').click();
    await expect(page.getByText('已导入为草稿')).toBeVisible();
    const list = designSchemePageSchema.parse(await localInvoke(page, 'designSchemes.list', {}));
    expect(list.items).toHaveLength(1);
    const detail = designSchemeDetailSchema.parse(
      await localInvoke(page, 'designSchemes.get', { id: list.items[0].id }),
    );
    expect(detail.summary.status).toBe('draft');
    expect(detail.document.createdBy).toBe('import');
    expect(readFileSync(picked)).toEqual(bytes);
    const stageRoot = join(userDataDir, 'staging', 'design-scheme-packages');
    expect(existsSync(stageRoot) ? readdirSync(stageRoot, { recursive: true }) : []).toEqual([]);
    await test.info().attach('native-package-evidence', {
      body: JSON.stringify({
        nativeHash,
        arch: expectedArch,
        importedScheme: detail.summary.id,
        inputPreserved: true,
        stagingEmpty: true,
        scope:
          'Actual packaged Electron UI/IPC and native binary; fixture package, disposable userData, no Provider call.',
      }),
      contentType: 'application/json',
    });
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('打包 App 验证真实产物、受管迁移与重启持久化', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'musefold-package-smoke-'));
  seedOnboardingCompletedFile(userDataDir);
  const launch = () =>
    electron.launch({
      executablePath: executablePath as string,
      env: {
        ...process.env,
        MUSEFOLD_E2E: '1',
        MUSEFOLD_E2E_USER_DATA_DIR: userDataDir,
      },
    });
  let app = await launch();
  try {
    const page = await v25ShellPage(app);
    await expectCurrentPackage(app, userDataDir);
    expect(page.url()).toMatch(/^app:\/\//);

    // 壳可见 = 渲染层 bundle、preload 桥、app:// 协议链路全通
    await expect(page.getByTestId('v25-shell')).toBeVisible({ timeout: 15_000 });

    // 主进程侧:desktop-db 接管(含内联迁移)在打包环境完成 —— 库文件已建
    expect(existsSync(join(userDataDir, 'musefold-data-v0.3.0.db'))).toBe(true);

    // 走一次真实 IPC:切设置屏读偏好(经 v25 preload → 主进程 → 落盘)
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.getByTestId('settings-theme-trigger').click();
    await page.getByTestId('settings-theme-dark').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await app.close();

    const db = new Database(join(userDataDir, 'musefold-data-v0.3.0.db'), { readonly: true });
    try {
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
        n: DESKTOP_MIGRATIONS.length,
      });
      for (const table of [
        'prompts',
        'workbench_sessions',
        'generation_runs',
        'generated_assets',
        'automation_spend_policies',
        'automation_budget_periods',
        'automation_spend_requests',
        'automation_spend_calls',
      ]) {
        expect(
          db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
        ).toEqual({ name: table });
      }
    } finally {
      db.close();
    }
    app = await launch();
    const restarted = await v25ShellPage(app);
    await expect(restarted.getByTestId('v25-shell')).toBeVisible();
    await expect(restarted.locator('html')).toHaveClass(/dark/);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

for (const prefix of [10, 11] as const) {
  test(`打包 App 从受管前缀 ${prefix} 升级会话并保留作品、费用与永久删除身份`, async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), 'musefold-package-session-upgrade-'));
    seedOnboardingCompletedFile(userDataDir);
    const seeded = seedSessionPackagePrefix(userDataDir, prefix);
    const launch = () =>
      electron.launch({
        executablePath: executablePath as string,
        env: { ...process.env, MUSEFOLD_E2E: '1', MUSEFOLD_E2E_USER_DATA_DIR: userDataDir },
      });
    let app: ElectronApplication | undefined;
    try {
      app = await launch();
      await expectCurrentPackage(app, userDataDir);
      let page = await v25ShellPage(app);
      await expect(page.getByTestId('v25-shell')).toBeVisible();
      const migrated = sessionPackageFacts(seeded.path);
      expect(migrated).toEqual({
        ...seeded.before,
        sessions: seeded.before.sessions.map((row) => ({
          ...row,
          version: seeded.expectedVersion,
        })),
        journal: DESKTOP_MIGRATIONS.map((migration) => ({
          hash: migration.hash,
          created_at: migration.folderMillis,
        })),
      });
      expect(migrated.integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(migrated.foreignKeys).toEqual([]);
      const initial = workbenchSessionSchema.parse(
        await localInvoke(page, 'workbench.getSession', sessionPackageId),
      );
      expect(initial.version).toBe(seeded.expectedVersion);
      expect(initial.draft.prompt).toBe('旧'.repeat(12_000));
      expect(initial.draft.params.aspectRatio).toBe('7:3');
      expect(initial.archivedAt).not.toBeNull();
      expect(initial.deletedAt).not.toBeNull();
      const restored = workbenchSessionSchema.parse(
        await localInvoke(page, 'workbench.restoreSession', sessionPackageId),
      );
      expect(restored.version).toBe(initial.version + 1);
      expect(restored.archivedAt).toBe(initial.archivedAt);
      expect(restored.deletedAt).toBeNull();
      await expect(localInvoke(page, 'workbench.purgeSession', sessionPackageId)).rejects.toThrow(
        'VALIDATION_FAILED',
      );
      await localInvoke(page, 'workbench.removeSession', sessionPackageId);
      expect(await localInvoke(page, 'workbench.purgeSession', sessionPackageId)).toEqual({
        purged: 1,
      });
      const detached = {
        ...migrated,
        sessions: [],
        drafts: [],
        runs: migrated.runs.map((run) => ({ ...run, workbench_session_id: null })),
      };
      expect(sessionPackageFacts(seeded.path)).toEqual(detached);
      const oldPid = app.process().pid;
      await app.close();
      app = undefined;
      // The packaged bundle migrates the same database again in a fresh OS process.
      app = await launch();
      expect(app.process().pid).not.toBe(oldPid);
      await expectCurrentPackage(app, userDataDir);
      page = await v25ShellPage(app);
      await expect(localInvoke(page, 'workbench.restoreSession', sessionPackageId)).rejects.toThrow(
        'WORKBENCH_SESSION_NOT_FOUND',
      );
      expect(await localInvoke(page, 'workbench.purgeSession', sessionPackageId)).toEqual({
        purged: 0,
      });
      expect(sessionPackageFacts(seeded.path)).toEqual(detached);
      const newPid = app.process().pid;
      await app.close();
      app = undefined;
      const db = new Database(seeded.path);
      try {
        expect(
          db.prepare('SELECT id FROM workbench_session_deletions WHERE id=?').get(sessionPackageId),
        ).toEqual({ id: sessionPackageId });
        expect(() =>
          db
            .prepare(
              'INSERT INTO workbench_sessions(id,title,created_at,updated_at) VALUES (?, ?, 1, 1)',
            )
            .run(sessionPackageId, '旧写者试图复活'),
        ).toThrow('permanently deleted');
      } finally {
        db.close();
      }
      await test.info().attach('packaged-session-migration', {
        contentType: 'application/json',
        body: JSON.stringify({
          prefix,
          oldPid,
          newPid,
          versionBefore: prefix === 10 ? null : 7,
          versionAfter: initial.version,
          imageHashes: migrated.imageHashes,
          preservedRunCost: migrated.runs[0].actual_cost,
          scope:
            'Actual packaged app and synthetic managed SQLite prefix; no real user database, paid upstream, installer UI or other OS/architecture.',
        }),
      });
    } finally {
      await app?.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
}

test('打包 CLI 发现文件删除失败时仍关闭端口并释放上传副本', async () => {
  test.setTimeout(60000);
  const executable = executablePath as string;
  const resources =
    process.platform === 'darwin'
      ? join(dirname(executable), '..', 'Resources')
      : join(dirname(executable), 'resources');
  const evidence = await verifyCliDiscoveryStop(
    executable,
    join(resources, 'integration', 'musefold-cli.mjs'),
    true,
  );
  await test.info().attach('packaged-cli-discovery-stop', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});
