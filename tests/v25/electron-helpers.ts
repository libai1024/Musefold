import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

export interface V25App {
  app: ElectronApplication;
  /** 本次启动的独立 userData 目录(SQLite 库、偏好文件都在这)。 */
  userDataDir: string;
}

export interface LaunchV25AppOptions {
  reuseUserDataDir?: string;
  /** 单个 E2E 可注入回环服务地址等测试环境;隔离开关与 userData 仍由 helper 强制设置。 */
  env?: Record<string, string | undefined>;
}

/** 启动 v2.5 壳。传 reuseUserDataDir 可复用上次目录(重启持久化类用例)。 */
export async function launchV25App(
  prefix: string,
  reuseOrOptions?: string | LaunchV25AppOptions,
): Promise<V25App> {
  const options =
    typeof reuseOrOptions === 'string'
      ? { reuseUserDataDir: reuseOrOptions }
      : (reuseOrOptions ?? {});
  // electron 包的默认导出是可执行文件路径
  const electronPath = require('electron') as unknown as string;
  const userDataDir = options.reuseUserDataDir ?? mkdtempSync(join(tmpdir(), prefix));
  const app = await electron.launch({
    executablePath: electronPath,
    args: [join(repoRoot, 'apps/desktop/out/main/index.js')],
    env: {
      ...process.env,
      ...options.env,
      MUSEFOLD_E2E: '1',
      MUSEFOLD_E2E_USER_DATA_DIR: userDataDir,
    },
  });
  return { app, userDataDir };
}

/** 桌面本地库文件(system/paths.ts:userData + core DB_NAME)。 */
export function desktopDbPath(userDataDir: string): string {
  return join(userDataDir, 'musefold-data-v0.3.0.db');
}

/** 设计方案独立本地库(electron/main/design-scheme runtime)。 */
export function designSchemeDbPath(userDataDir: string): string {
  return join(userDataDir, 'musefold-design-scheme-v0.3.2.db');
}

/**
 * 等待 v2.5 壳窗口。不能用 firstWindow():主进程启动时可能先开
 * prefs-origin-migration 的一次性 storage-export.html 窗口,它自关后
 * 对其持有的 page 断言会得到 "session closed"。
 */
export async function v25ShellPage(app: ElectronApplication): Promise<Page> {
  const isShell = (page: Page) => page.url().includes('v25/shell');
  const existing = app.windows().find(isShell);
  const page = existing ?? (await app.waitForEvent('window', { predicate: isShell }));
  await page.waitForLoadState('domcontentloaded');
  return page;
}
