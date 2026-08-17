// Main application lifecycle. Loaded dynamically by index.ts so early module
// failures can be written to a diagnostic log instead of becoming opaque.

import { app, BrowserWindow, dialog, session } from 'electron';
import { createWindow, registerWindowHandlers } from './window';
import { initDb, closeDb } from '@musefold/core/db';
import { registerAllHandlers } from './ipc';
import { registerMediaProtocolHandler } from './media-protocol';
import {
  flushQueuedShareImports,
  handleShareArgv,
  registerShareProtocolClient,
  registerShareProtocolListeners,
} from './share-protocol';
import type { AcquireResult } from '@musefold/automation-server';
import { reportMainDiagnostic } from './diagnostics';
import { clearStaleSingletonLock } from './singleton-lock';
import { disposeMusefoldCore, initMusefoldCore } from './core-instance';
import { startAutomationIfEnabled, stopAutomationServer } from './automation';
import {
  disablePet,
  isPetEnabled,
  returnPetHome,
  runPetToComposer,
  isPetActivationSuppressed,
  syncPetWithMainWindow,
} from './pet';
import { getPetWindow } from './pet/window';
import { attachPetWindowLifecycle } from './pet/lifecycle';
import { acquireDesktopOwnerLockWithHeadlessTakeover } from './headless-takeover';
import { createAppTray, destroyAppTray } from './tray';
import { initializeUpdater } from '../update';
import { disposeDoubaoWebBrowser } from '../doubao-web/browser-service';
import { ensureCliInstalledAtStartup } from './integration';

function isPetWindow(win: BrowserWindow): boolean {
  return getPetWindow() === win;
}

registerShareProtocolListeners();

// 强杀/崩溃后立刻重开：先清掉指向死进程的陈旧单实例锁，
// 否则约一秒内的重启会被拒绝并静默退出（用户点图标「没反应」）。
clearStaleSingletonLock(app.getPath('userData'));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// 单写者所有权（V04-ARCHITECTURE §3.3）：与 headless 守护互斥。
// 桌面启动时若发现 musefold serve 持锁，先尝试停掉守护再接管；
// 拿不到锁时不继续启动数据库，避免双写损坏 SQLite。
let ownerLockRelease: (() => void) | null = null;
let isQuitting = false;
let cleanupComplete = false;
let updateInstallRequested = false;
let cleanupPromise: Promise<void> | null = null;

app.on('second-instance', (_event, argv) => {
  // 优先聚焦主窗口，别把焦点给了桌宠的小窗
  openMainWindow();
  handleShareArgv(argv);
});

app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return;
  reportMainDiagnostic(new Error(`Electron 子进程已退出：${details.type}/${details.reason}`), {
    source: 'main-process',
    operation: 'app.child-process-gone',
    context: { ...details },
  });
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;

  const ownership = await acquireDesktopOwnerLockWithHeadlessTakeover(app.getPath('userData'));
  if (!ownership.acquired) {
    showOwnerLockError(ownership);
    app.quit();
    return;
  }
  ownerLockRelease = ownership.release ?? null;

  denyAllPermissions();

  initMusefoldCore();
  initDb();
  void startAutomationIfEnabled();
  registerMediaProtocolHandler();
  registerAllHandlers();
  registerWindowHandlers();
  await ensureCliInstalledAtStartup();
  createMainWindow();
  initializeUpdater({ beforeInstall: prepareForUpdateInstall });
  // 桌宠默认关闭，只能由用户通过显式开关开启。应用生命周期不能替用户改开关。
  createAppTray(openMainWindow);
  registerShareProtocolClient();
  handleShareArgv(process.argv);
  flushQueuedShareImports(900);

  app.on('activate', () => {
    // macOS 会先激活应用、再把 pointerdown 送给桌宠。稍后判定，避免单击或
    // 拖拽桌宠时误开主窗口；Dock 点击等普通激活仍保持系统预期行为。
    setTimeout(() => {
      if (isPetActivationSuppressed()) return;
      openMainWindow();
    }, 180);
  });
});

function createMainWindow(): BrowserWindow {
  const win = createWindow();
  let closePromptOpen = false;

  attachPetWindowLifecycle(win, {
    enterPage: () => void runPetToComposer(),
    leavePage: () => void returnPetHome(),
    syncWithPage: syncPetWithMainWindow,
  });

  win.on('close', (event) => {
    if (isQuitting) return;

    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;

    void promptForMainWindowClose(win).finally(() => {
      closePromptOpen = false;
    });
  });
  return win;
}

async function promptForMainWindowClose(win: BrowserWindow): Promise<void> {
  // 自动化环境不保留托盘实例，避免测试退出被原生对话框阻塞。
  if (process.env['MUSEFOLD_E2E'] === '1') {
    app.quit();
    return;
  }

  const petDetail = isPetEnabled()
    ? '桌宠当前已开启，最小化到托盘后会回到桌面并继续显示。'
    : '桌宠当前已关闭，最小化到托盘后会保持隐藏。';
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: '关闭 Musefold',
    message: '要让 Musefold 在后台继续运行吗？',
    detail: `${petDetail}退出将停止后台服务。`,
    buttons: ['最小化到托盘', '退出 Musefold', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (result.response === 0) {
    await returnPetHome();
    win.hide();
    if (process.platform === 'darwin') app.dock?.hide();
  } else if (result.response === 1) {
    app.quit();
  }
}

function openMainWindow(): void {
  const main = BrowserWindow.getAllWindows().find((win) => !isPetWindow(win));
  showMainWindow(main ?? createMainWindow());
}

function showMainWindow(win: BrowserWindow): void {
  if (process.platform === 'darwin') void app.dock?.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function showOwnerLockError(ownership: AcquireResult): void {
  const holder = ownership.holder;
  const ownerName = holder?.owner === 'headless-daemon'
    ? 'Musefold headless 守护'
    : holder?.owner === 'desktop-app'
      ? 'Musefold 桌面应用'
      : '另一个进程';
  const takeoverHint = holder?.owner === 'headless-daemon'
    ? '已尝试自动停止 musefold serve，但它仍在运行。请手动停止后再启动桌面应用。'
    : '请先退出正在运行的 Musefold，再启动桌面应用。';
  dialog.showErrorBox(
    '数据目录已被占用',
    `检测到 ${ownerName}（pid ${holder?.pid ?? '?'}）正在使用数据目录。\n${takeoverHint}`,
  );
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (cleanupComplete) {
    isQuitting = true;
    return;
  }

  // electron-updater calls quitAndInstall after the update is downloaded. The
  // updater has already prepared the app, so do not open the tray close prompt.
  if (updateInstallRequested) {
    event.preventDefault();
    if (!cleanupPromise) cleanupPromise = shutdownApplication();
    void cleanupPromise.finally(() => {
      cleanupComplete = true;
      app.quit();
    });
    return;
  }

  event.preventDefault();
  if (isQuitting) return;
  isQuitting = true;

  cleanupPromise = shutdownApplication();
  void cleanupPromise.finally(() => {
    cleanupComplete = true;
    app.quit();
  });
});

async function prepareForUpdateInstall(): Promise<void> {
  updateInstallRequested = true;
  isQuitting = true;
  if (cleanupComplete) return;
  cleanupPromise ??= shutdownApplication();
  await cleanupPromise;
  cleanupComplete = true;
}

async function shutdownApplication(): Promise<void> {
  await stopAutomationServer();
  disposeDoubaoWebBrowser();
  destroyAppTray();
  disablePet();
  closeDb();
  disposeMusefoldCore();
  ownerLockRelease?.();
  ownerLockRelease = null;
}

/**
 * Permission gate: clipboard writes support the product's copy actions. Reads
 * and every unrelated device/system permission remain denied by default.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

function denyAllPermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  );
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}
