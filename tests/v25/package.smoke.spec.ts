// 打包产物冒烟(M5-b,接替旧 tests/package Python 冒烟):
// 启动 electron-builder 产出的 Musefold.app,验证 v2.5 壳能在 app:// 协议下
// 加载、SQLite 受管迁移在真实打包环境(asar + 内联迁移)可用。
// 前置:`pnpm run package:mac:adhoc`(release/mac-arm64/);产物缺失时跳过,
// 发布矩阵(release.yml)打包后必跑。

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { v25ShellPage } from './electron-helpers';

const repoRoot = resolve(import.meta.dirname, '../..');

const PACKAGED_BINARIES = [
  // macOS arm64(本机演练与发布矩阵)与 x64;Windows 冒烟在 win runner 上走
  // release/win-unpacked/Musefold.exe(同一份 spec,路径见下)。
  'release/mac-arm64/Musefold.app/Contents/MacOS/Musefold',
  'release/mac/Musefold.app/Contents/MacOS/Musefold',
  'release/win-unpacked/Musefold.exe',
].map((rel) => join(repoRoot, rel));

const executablePath = PACKAGED_BINARIES.find((abs) => existsSync(abs));

test.skip(!executablePath, '未找到打包产物;先跑 pnpm run package:mac:adhoc(或 win 矩阵产物)');

test('打包 App 启动并加载 v2.5 壳(app:// 协议 + asar)', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'musefold-package-smoke-'));
  const app = await electron.launch({
    executablePath: executablePath as string,
    env: {
      ...process.env,
      MUSEFOLD_E2E: '1',
      MUSEFOLD_E2E_USER_DATA_DIR: userDataDir,
    },
  });
  try {
    const page = await v25ShellPage(app);
    // 壳可见 = 渲染层 bundle、preload 桥、app:// 协议链路全通
    await expect(page.getByTestId('v25-shell')).toBeVisible({ timeout: 15_000 });

    // 主进程侧:desktop-db 接管(含内联迁移)在打包环境完成 —— 库文件已建
    expect(existsSync(join(userDataDir, 'musefold-data-v0.3.0.db'))).toBe(true);

    // 走一次真实 IPC:切设置屏读偏好(经 v25 preload → 主进程 → 落盘)
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
  } finally {
    await app.close();
  }
});
