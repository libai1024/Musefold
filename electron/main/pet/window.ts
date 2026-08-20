// electron/main/pet/window.ts
// 桌宠窗口 —— 无边框、透明、全workspace 置顶的小窗。
//
// 这类窗口在 macOS 上有三个反复踩到的坑，实现里都做了规避：
//
// 1. macOS 使用非激活 panel。桌宠没有文本输入，panel 不获取应用焦点正合适：
//    单击和拖拽不会顺带唤起主窗口，双击再通过显式 IPC 打开主界面。
//
// 2. 不用 setIgnoreMouseEvents(true) 做"透明区域点击穿透"。那套做法要靠渲染层
//    高频轮询鼠标位置来回切换忽略状态，鼠标快速划过时经常切换不及时，点击就丢了。
//    这里改成把窗口尺寸收紧到差不多正好包住角色，窗口外自然就是穿透的。
//
// 3. alwaysOnTop 会在系统睡眠唤醒、切换 Space、App Nap 之后悄悄失效。
//    单次设置不管用，需要在这些时机重新应用一遍。

import { app, BrowserWindow, powerMonitor, screen, shell } from 'electron';
import type { Rectangle } from 'electron';
import { join } from 'path';
import { resolveAppRoot } from '../app-paths';
import { isAppOriginUrl, resolvePetWindowLoadUrl } from '../app-protocol';
import { isAllowedExternalUrl } from '../external-links';
import { clampPetPosition, type PetPoint } from './movement';

/** 128px 角色窗口尺寸，顶部预留气泡空间，外圈保持透明 */
export const PET_WIDTH = 160;
export const PET_HEIGHT = 184;
/** 距屏幕右下角的留白 */
const SCREEN_MARGIN = 24;

let petWindow: BrowserWindow | null = null;
let movementBounds: Rectangle | null = null;
let revealFallback: NodeJS.Timeout | null = null;

export function getPetWindow(): BrowserWindow | null {
  return petWindow && !petWindow.isDestroyed() ? petWindow : null;
}

/** 只在渲染层确认首帧已提交后显示，避免透明窗口先于角色内容露出白闪。 */
export function revealPetWindow(): void {
  const win = getPetWindow();
  if (!win || win.isVisible()) return;
  if (revealFallback) clearTimeout(revealFallback);
  revealFallback = null;
  win.showInactive();
}

/** macOS 上重新应用置顶与跨 Space 可见，用于对抗坑 3。 */
function reapplyMacVisibility(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;
  if (win.isDestroyed()) return;
  // 'screen-saver' 层级足够高，能盖住普通窗口又不至于压住系统弹窗
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

export function createPetWindow(savedDesktopPosition?: PetPoint | null): BrowserWindow {
  const existing = getPetWindow();
  if (existing) return existing;

  const appRoot = resolveAppRoot();
  const { workArea } = screen.getPrimaryDisplay();
  const defaultDesktopPosition = {
    // 首次运行停在左下角，避免与默认靠右的 Composer 停靠点视觉重合。
    x: workArea.x + SCREEN_MARGIN,
    y: workArea.y + workArea.height - PET_HEIGHT - SCREEN_MARGIN,
  };
  const requestedPosition = savedDesktopPosition ?? defaultDesktopPosition;
  const initialWorkArea = screen.getDisplayNearestPoint(requestedPosition).workArea;
  const initialPosition = clampPetPosition(
    requestedPosition,
    initialWorkArea,
    { width: PET_WIDTH, height: PET_HEIGHT },
  );

  const win = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: initialPosition.x,
    y: initialPosition.y,
    show: false,
    frame: false,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // 所有平台都不让桌宠窗口抢走主界面焦点。
    focusable: false,
    acceptFirstMouse: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(appRoot, 'out/preload/index.cjs'),
      backgroundThrottling: false,
    },
  });

  petWindow = win;

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  applyPetWebSecurity(win);
  installVisibilityWatchdog(win);

  // `ready-to-show` 只代表 BrowserWindow 可以显示，不代表透明角色已经解码。
  // 首帧由 PetApp 在 DOM 提交后通过 PET_READY 握手；超时兜底防止坏资源让桌宠永久隐身。
  win.on('ready-to-show', () => {
    if (win.isVisible()) return;
    if (revealFallback) clearTimeout(revealFallback);
    revealFallback = setTimeout(() => revealPetWindow(), 5000);
  });

  win.on('closed', () => {
    if (revealFallback) clearTimeout(revealFallback);
    revealFallback = null;
    petWindow = null;
  });

  win.loadURL(resolvePetWindowLoadUrl(process.env['ELECTRON_RENDERER_URL']));

  return win;
}

export function destroyPetWindow(): void {
  const win = getPetWindow();
  if (!win) return;
  win.destroy();
  petWindow = null;
  movementBounds = null;
}

/** 主界面显示时限制在内容区；传 null 恢复为整个桌面工作区。 */
export function setPetMovementBounds(bounds: Rectangle | null): void {
  movementBounds = bounds ? { ...bounds } : null;
}

/**
 * 按增量移动窗口，并把结果钳制在当前屏幕工作区内。
 * 渲染层只上报鼠标位移，位置计算留在主进程，免得两边各算一套导致跑偏。
 */
export function movePetWindowBy(dx: number, dy: number): void {
  const win = getPetWindow();
  if (!win) return;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

  const [x, y] = win.getPosition();
  setPetWindowPosition(x + dx, y + dy);
}

/** 绝对移动并钳制到当前允许区域，自动跑动与拖拽共用同一套边界规则。 */
export function setPetWindowPosition(x: number, y: number): void {
  const win = getPetWindow();
  if (!win) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const nextX = Math.round(x);
  const nextY = Math.round(y);
  // 主界面打开后锁在内容区；否则使用目标点所在显示器，支持跨屏拖拽。
  const bounds = movementBounds
    ?? screen.getDisplayNearestPoint({ x: nextX, y: nextY }).workArea;
  const position = clampPetPosition(
    { x: nextX, y: nextY },
    bounds,
    { width: PET_WIDTH, height: PET_HEIGHT },
  );
  win.setPosition(position.x, position.y);
}

/** 坑 3 的对策：在会让置顶失效的时机重新应用一遍。 */
function installVisibilityWatchdog(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;

  const reapply = (): void => reapplyMacVisibility(win);

  app.on('browser-window-focus', reapply);
  powerMonitor.on('resume', reapply);
  powerMonitor.on('unlock-screen', reapply);
  // 兜底轮询：上面的事件覆盖不到 App Nap 之类的静默失效
  const poll = setInterval(reapply, 30_000);

  win.on('closed', () => {
    clearInterval(poll);
    app.off('browser-window-focus', reapply);
    powerMonitor.off('resume', reapply);
    powerMonitor.off('unlock-screen', reapply);
  });
}

/** 与主窗口同样的外链策略：宠物窗口永不导航到站外。 */
function applyPetWebSecurity(win: BrowserWindow): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    const sameApp = devUrl ? url.startsWith(devUrl) : isAppOriginUrl(url);
    if (sameApp) return;
    e.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });
}
