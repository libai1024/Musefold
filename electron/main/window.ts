// electron/main/window.ts
// 跨平台窗口配置 —— 原生系统风（毛玻璃 + 平台自适应标题栏）
// · mac: hiddenInset + vibrancy，红黄绿交通灯在左（原生保留）
// · win: hidden（无原生按钮），Mica 材质，右上角由渲染层绘制自定义控件
// · linux: hidden（无边框），右上角自定义控件
// 详见 docs/06-ui-design-system.md §2、docs/01-architecture.md §3.2

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { isAppOriginUrl, resolveMainWindowLoadUrl } from './app-protocol';
import { originMigrationImportArgv } from './prefs-origin-migration';
import { buildContentSecurityPolicy } from './csp';
import { isAllowedExternalUrl } from './external-links';
import { APP_VERSION } from '../system/app-version';
import { APP_NAME } from '@shared/constants';
import { reportMainDiagnostic, showNativeDiagnostic } from './diagnostics';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const windowIcon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(appRoot, 'resources/icon.png');
  const importArgv = originMigrationImportArgv();

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#00000000',
    title: `${APP_NAME} v${APP_VERSION}`,
    // mac 保留原生交通灯（内缩）；win/linux 完全无边框，控件自绘
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 15 } : undefined,
    frame: isMac, // 非 mac 用无边框，自绘控件
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'followWindow' : undefined,
    backgroundMaterial: isWin ? 'mica' : undefined,
    roundedCorners: true,
    icon: isMac ? undefined : windowIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(appRoot, 'out/preload/index.cjs'),
      // 只传布尔标记，不把偏好 value 放进进程参数列表。
      ...(importArgv.length > 0 ? { additionalArguments: importArgv } : {}),
    },
  });

  mainWindow = win;

  applyWebSecurity(win);

  win.on('ready-to-show', () => {
    win.show();
  });

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    const report = reportMainDiagnostic(error, {
      source: 'preload',
      operation: 'webContents.preload-error',
      context: { preloadPath },
      forceNative: true,
    });
    void showNativeDiagnostic(report);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    const report = reportMainDiagnostic(
      new Error(`渲染进程已退出：${details.reason} (exitCode=${details.exitCode})`),
      {
        source: 'renderer-crash',
        operation: 'webContents.render-process-gone',
        context: { reason: details.reason, exitCode: details.exitCode },
        forceNative: true,
      },
    );
    void showNativeDiagnostic(report);
  });

  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      const report = reportMainDiagnostic(new Error(errorDescription), {
        source: 'page-load',
        operation: 'webContents.did-fail-load',
        context: { errorCode, validatedURL },
        forceNative: true,
      });
      void showNativeDiagnostic(report);
    },
  );

  win.on('closed', () => {
    mainWindow = null;
  });

  // 最大化状态变化 → 通知渲染层切换"还原/最大化"图标
  const emitMaxState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:maximizeChanged', win.isMaximized());
    }
  };
  win.on('maximize', emitMaxState);
  win.on('unmaximize', emitMaxState);
  win.on('enter-full-screen', () =>
    win.webContents.send('window:fullscreenChanged', true)
  );
  win.on('leave-full-screen', () =>
    win.webContents.send('window:fullscreenChanged', false)
  );

  // 开发环境加载 dev server，生产环境加载固定 origin 下的构建产物。
  // MUSEFOLD_E2E=1 时附加 ?musefold_e2e=1 —— 渲染层据此安装 window.__musefold_test 测试钩子
  // （见 src/lib/test-hook.ts）。仅 E2E 启动链路会带此环境变量。
  const e2e = process.env['MUSEFOLD_E2E'] === '1';
  win.loadURL(resolveMainWindowLoadUrl(process.env['ELECTRON_RENDERER_URL'], e2e));

  return win;
}

/**
 * 渲染层安全策略（TASK-GEN-14）
 *
 * 1) CSP 由主进程按响应头注入，而不是写在 index.html 的 meta 里 —— 响应头版本
 *    连 app:// 产物一起覆盖，且渲染层改不了。
 * 2) `media:` 必须放进 img-src：生成的图片走自定义 media:// 协议，
 *    不是 file://（Chromium 从 http dev 源加载 file:// 会被拦）。
 * 3) 不放开 webSecurity、不加本地 HTTP 端点 —— 宁可让某个便利功能麻烦一点。
 * 4) 一切外链都交给系统浏览器：应用窗口本身永不导航到站外，
 *    避免"应用壳里跑第三方页面"这种拿着 preload 桥的处境。
 */
function applyWebSecurity(win: BrowserWindow): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];

  // dev 需要给 Vite 放行 HMR websocket/eval；生产 renderer 不出网，Provider 请求只走 IPC。
  const csp = buildContentSecurityPolicy(devUrl);

  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // window.open / target=_blank → 系统浏览器；绝不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 站外导航同样外送 —— 只允许留在 dev server / 固定 app:// origin 内
  win.webContents.on('will-navigate', (e, url) => {
    const sameApp = devUrl ? url.startsWith(devUrl) : isAppOriginUrl(url);
    if (sameApp) return;
    e.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });
}

// 窗口控制 IPC —— 供渲染层自绘控件（Windows/Linux）与命令面板调用
export function registerWindowHandlers(): void {
  const withWin = (fn: (w: BrowserWindow) => void) => () => {
    const w = mainWindow;
    if (w && !w.isDestroyed()) fn(w);
  };

  ipcMain.on('window:minimize', withWin((w) => w.minimize()));
  ipcMain.on(
    'window:maximizeToggle',
    withWin((w) => (w.isMaximized() ? w.unmaximize() : w.maximize()))
  );
  ipcMain.on('window:close', withWin((w) => w.close()));
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('window:platform', () => process.platform);
}
