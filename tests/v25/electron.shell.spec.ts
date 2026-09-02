import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';

let app: ElectronApplication;
let page: Page;

async function shellWindowState(): Promise<{
  fullscreen: boolean;
  focused: boolean;
}> {
  return app.evaluate(({ BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('/v25/shell'),
    );
    if (!shell) throw new Error('v25 shell window not found');
    return { fullscreen: shell.isFullScreen(), focused: shell.isFocused() };
  });
}

async function focusShell(): Promise<void> {
  await page.bringToFront();
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('/v25/shell'),
    );
    if (!shell) throw new Error('v25 shell window not found');
    electronApp.dock?.show();
    electronApp.focus({ steal: true });
    shell.show();
    shell.setAlwaysOnTop(true);
    shell.moveTop();
    shell.focus();
    shell.setAlwaysOnTop(false);
    shell.focus();
  });

  await expect
    .poll(shellWindowState, {
      timeout: 15_000,
      message: 'macOS runner must focus the Electron shell before native fullscreen',
    })
    .toMatchObject({ focused: true });
}

async function setShellFullscreen(fullscreen: boolean): Promise<void> {
  await focusShell();

  await app.evaluate(({ BrowserWindow }, nextFullscreen) => {
    const shell = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('/v25/shell'),
    );
    if (!shell) throw new Error('v25 shell window not found');
    if (shell.isFullScreen() === nextFullscreen) return;
    const eventName = nextFullscreen ? 'enter-full-screen' : 'leave-full-screen';
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const state = {
          isFullScreen: shell.isFullScreen(),
          isVisible: shell.isVisible(),
          isFocused: shell.isFocused(),
          isFullScreenable: shell.isFullScreenable(),
        };
        shell.removeListener(eventName, onChanged);
        reject(new Error(`timed out waiting for ${eventName}: ${JSON.stringify(state)}`));
      }, 15_000);
      const onChanged = () => {
        clearTimeout(timeout);
        resolve();
      };
      shell.once(eventName, onChanged);
      shell.setFullScreen(nextFullscreen);
    });
  }, fullscreen);
}

async function brandPadding(): Promise<string> {
  return page
    .getByTestId('app-sidebar')
    .locator(':scope > div')
    .first()
    .evaluate((element) => {
      return getComputedStyle(element).paddingLeft;
    });
}

async function railPadding(): Promise<string> {
  return page.getByTestId('sidebar-expand-rail').evaluate((element) => {
    return getComputedStyle(element).paddingTop;
  });
}

test.beforeEach(async () => {
  test.skip(process.platform !== 'darwin', '原生全屏 inset 仅在 macOS 验收');
  ({ app } = await launchV25App('musefold-v25-fullscreen-'));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('v25-shell')).toBeVisible();
});

test.afterEach(async () => {
  if (app) {
    try {
      await setShellFullscreen(false);
    } catch {
      // 应用关闭或窗口已销毁时无需再次恢复全屏。
    }
    await app.close();
  }
});

test('macOS 原生全屏动态回收 brandInset,收起轨同步变化', async () => {
  // 展开侧栏:brandInset 随原生全屏事件从 78px 回落到 12px,退出后恢复。
  await expect.poll(brandPadding).toBe('78px');
  await setShellFullscreen(true);
  await expect.poll(brandPadding).toBe('12px');
  await setShellFullscreen(false);
  await expect.poll(brandPadding).toBe('78px');

  // 收起侧栏后品牌行卸载,展开轨继续保留交通灯让位;全屏往返不得丢失轨道。
  await page.getByTestId('sidebar-collapse').click();
  await expect.poll(railPadding).toBe('36px');
  await setShellFullscreen(true);
  await expect.poll(railPadding).toBe('36px');
  await setShellFullscreen(false);
  await expect.poll(railPadding).toBe('36px');
});
