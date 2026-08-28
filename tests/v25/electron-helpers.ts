import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

export async function launchV25App(prefix: string): Promise<ElectronApplication> {
  // electron 包的默认导出是可执行文件路径
  const electronPath = require('electron') as unknown as string;
  return electron.launch({
    executablePath: electronPath,
    args: [join(repoRoot, 'apps/desktop/out/main/index.js')],
    env: {
      ...process.env,
      MUSEFOLD_V25_SHELL: '1',
      MUSEFOLD_E2E: '1',
      MUSEFOLD_E2E_USER_DATA_DIR: mkdtempSync(join(tmpdir(), prefix)),
    },
  });
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
