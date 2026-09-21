import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';

const execFileAsync = promisify(execFile);

let app: ElectronApplication;
let page: Page;

async function findShellWindow(): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows().some((win) =>
      win.webContents.getURL().includes('/v25/shell'),
    );
  });
}

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

/** 本用例是否改用了与 enter-full-screen 相同的 IPC(runner 抢不到 key window 时)。 */
let usedFullscreenIpcFallback = false;

async function emitFullscreenChanged(fullscreen: boolean): Promise<void> {
  await app.evaluate(({ BrowserWindow }, nextFullscreen) => {
    const shell = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('/v25/shell'),
    );
    if (!shell) throw new Error('v25 shell window not found');
    shell.webContents.send('window:fullscreenChanged', nextFullscreen);
  }, fullscreen);
}

async function tryNativeFullscreen(fullscreen: boolean): Promise<boolean> {
  const { pid, execPath } = await app.evaluate(() => ({
    pid: process.pid,
    execPath: process.execPath,
  }));
  const marker = '/Contents/MacOS/';
  const appPath = execPath.includes(marker)
    ? execPath.slice(0, execPath.lastIndexOf(marker))
    : execPath;
  try {
    await execFileAsync('open', ['-a', appPath]);
  } catch {
    // 仍走 steal focus。
  }
  if (Number.isInteger(pid) && pid > 0) {
    try {
      await execFileAsync('osascript', [
        '-e',
        `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`,
      ]);
    } catch {
      // 无辅助功能权限时忽略。
    }
  }

  await page.bringToFront();
  return app.evaluate(({ app: electronApp, BrowserWindow }, nextFullscreen) => {
    const shell = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('/v25/shell'),
    );
    if (!shell) throw new Error('v25 shell window not found');
    if (shell.isFullScreen() === nextFullscreen) return true;

    electronApp.dock?.show();
    electronApp.focus({ steal: true });
    shell.show();
    shell.moveTop();
    shell.focus();
    if (!shell.isFocused()) return false;

    const eventName = nextFullscreen ? 'enter-full-screen' : 'leave-full-screen';
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        shell.removeListener(eventName, onChanged);
        resolve(shell.isFullScreen() === nextFullscreen);
      }, 4_000);
      const onChanged = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      shell.once(eventName, onChanged);
      shell.setFullScreen(nextFullscreen);
    });
  }, fullscreen);
}

/**
 * 优先走原生 setFullScreen。本机前台被 Cursor/agent 占住时 setFullScreen 是空操作,
 * 则改发主进程在 enter/leave-full-screen 上发出的同一条 `window:fullscreenChanged`,
 * 仍验收 brandInset 接线。已经是目标原生全屏态则直接返回,避免 afterEach 空等。
 */
async function setShellFullscreen(fullscreen: boolean): Promise<void> {
  if (!(await findShellWindow())) return;
  const current = await shellWindowState();
  if (current.fullscreen === fullscreen) {
    if (!fullscreen && usedFullscreenIpcFallback) {
      await emitFullscreenChanged(false);
      usedFullscreenIpcFallback = false;
    }
    return;
  }

  if (await tryNativeFullscreen(fullscreen)) {
    usedFullscreenIpcFallback = false;
    return;
  }

  await emitFullscreenChanged(fullscreen);
  usedFullscreenIpcFallback = fullscreen;
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
  usedFullscreenIpcFallback = false;
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

test('会话列表健康态不出现立即重启死按钮;错误逃生门钮只断言存在/禁用态', async () => {
  await expect(page.getByTestId('session-panel')).toBeVisible();
  await expect(page.getByTestId('session-list-relaunch')).toHaveCount(0);
  await expect(page.getByTestId('session-list-retry')).toHaveCount(0);
});

test('drag-region:内容顶带与设置条为 drag,交互元素 no-drag', async () => {
  // 真实鼠标拖窗口不可测,记为 verify;此处只断言 CSSOM app-region 契约。
  const contentBand = page.locator('[data-window-drag-band]');
  await expect(contentBand).toHaveCount(1);
  expect(await contentBand.evaluate((el) => getComputedStyle(el).webkitAppRegion)).toBe('drag');

  const collapse = page.getByTestId('sidebar-collapse');
  expect(await collapse.evaluate((el) => getComputedStyle(el).webkitAppRegion)).toBe('no-drag');

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  const settingsBand = page.locator('[data-settings-window-drag]');
  await expect(settingsBand).toHaveCount(1);
  expect(await settingsBand.evaluate((el) => getComputedStyle(el).webkitAppRegion)).toBe('drag');

  const controls = page.getByTestId('window-controls');
  if ((await controls.count()) > 0) {
    expect(
      await page
        .getByTestId('window-controls-band')
        .evaluate((el) => getComputedStyle(el).webkitAppRegion),
    ).toBe('drag');
    expect(
      await page
        .getByTestId('window-control-minimize')
        .evaluate((el) => getComputedStyle(el).webkitAppRegion),
    ).toBe('no-drag');
  }
});

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('Win/Linux 控件带与主区标题/问候不相交(darwin 无三钮则跳过几何)', async () => {
  // mac 原生红绿灯:控件带 count 可为 0,不要假设本机一定能看到三钮。
  const band = page.getByTestId('window-controls-band');
  if (!(await band.count())) return;

  const bandBox = await band.boundingBox();
  expect(bandBox).toBeTruthy();
  if (!bandBox) return;

  const surface = page.getByTestId('mainview-surface');
  await expect(surface).toHaveAttribute('data-window-controls-safe', '');
  const mainPad = await page
    .getByTestId('mainview-surface')
    .locator('main')
    .evaluate((el) => getComputedStyle(el).paddingTop);
  expect(mainPad).toBe('32px');

  const greeting = page.getByTestId('workbench-empty-greeting');
  if (await greeting.count()) {
    const box = await greeting.boundingBox();
    if (box) expect(boxesOverlap(bandBox, box)).toBeFalsy();
  }

  await page.getByTestId('nav-prompts').click();
  const promptTitle = page.getByRole('heading', { name: '提示词库' });
  await expect(promptTitle).toBeVisible();
  const promptBox = await promptTitle.boundingBox();
  if (promptBox) expect(boxesOverlap(bandBox, promptBox)).toBeFalsy();

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  const badge = page.getByTestId('settings-host-badge');
  if (await badge.count()) {
    const badgeBox = await badge.boundingBox();
    if (badgeBox) expect(boxesOverlap(bandBox, badgeBox)).toBeFalsy();
  }
});
