// electron/main/pet/index.ts
// 桌宠控制器 —— 把主题、动画状态机、窗口、IPC 串起来。
//
// 边界：桌宠是生图流程的**观察者**，不参与任何决策。生成的权威状态仍然只有
// Workbench 一套（docs/v0.2/DEVELOPMENT-RULES.md §4）。这里持有的 runningJobs
// 只是一个用于挑动画的计数，任何时候都不该被别处当作业务真相来读。

import { app, ipcMain, Menu, screen } from 'electron';
import { statSync } from 'fs';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type {
  PetComposerAnchor,
  PetFrame,
  PetInteraction,
  PetStateDef,
  PetTheme,
} from '@musefold/desktop-contracts/pet';
import { createLogger } from '../../system/logger';
import { getMainWindow } from '../window';
import { loadTheme } from './theme';
import { PetStateMachine } from './state-machine';
import { PetActivityTracker, stateForJobs } from './activity';
import {
  createPetWindow,
  destroyPetWindow,
  getPetWindow,
  movePetWindowBy,
  PET_HEIGHT,
  revealPetWindow,
  setPetMovementBounds,
  setPetWindowPosition,
} from './window';
import {
  fromRelativePosition,
  petPositionFromCursor,
  petTravelDuration,
  toRelativePosition,
  type PetPoint,
} from './movement';
import { loadPetDesktopPosition, savePetDesktopPosition } from './position-store';
import { canEnterPetPage } from './lifecycle';

const logger = createLogger('pet');

interface PetRuntime {
  theme: PetTheme;
  dir: string;
  machine: PetStateMachine;
}

let runtime: PetRuntime | null = null;
let enabled = false;
let lastFrame: PetFrame | null = null;

const activity = new PetActivityTracker(() => runtime?.machine ?? null);

let desktopHome: PetPoint | null = null;
let composerAnchor: PetComposerAnchor | null = null;
let pageRelativePosition: PetPoint | null = null;
let locationState: 'desktop' | 'entering' | 'page' | 'returning' = 'desktop';
let motionTimer: NodeJS.Timeout | null = null;
let motionResolve: ((completed: boolean) => void) | null = null;
let motionGeneration = 0;
let dragTimer: NodeJS.Timeout | null = null;
let dragOrigin: { cursor: PetPoint; pet: PetPoint } | null = null;
let suppressAppActivationUntil = 0;

/** macOS 单击桌宠也可能发 app.activate；应用层延迟后用它判断是否应忽略。 */
export function isPetActivationSuppressed(): boolean {
  return Date.now() < suppressAppActivationUntil;
}

function persistDesktopPosition(point: PetPoint): void {
  savePetDesktopPosition(app.getPath('userData'), point);
}

function currentPetPosition(): PetPoint | null {
  const pet = getPetWindow();
  if (!pet) return null;
  const [x, y] = pet.getPosition();
  return { x, y };
}

function updatePetDragPosition(): void {
  if (!dragOrigin) return;
  const cursor = screen.getCursorScreenPoint();
  const next = petPositionFromCursor(dragOrigin.pet, dragOrigin.cursor, cursor);
  setPetWindowPosition(next.x, next.y);
  if (locationState !== 'desktop') rememberPageRelativePosition();
}

function beginPetDrag(): void {
  if (dragTimer) clearInterval(dragTimer);
  const pet = currentPetPosition();
  if (!pet) return;
  dragOrigin = { cursor: screen.getCursorScreenPoint(), pet };
  dragTimer = setInterval(updatePetDragPosition, 16);
  updatePetDragPosition();
}

function finishPetDrag(): void {
  updatePetDragPosition();
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  dragOrigin = null;
}

function cancelPetMotion(): void {
  motionGeneration += 1;
  if (motionTimer) clearInterval(motionTimer);
  motionTimer = null;
  const resolve = motionResolve;
  motionResolve = null;
  resolve?.(false);
}

function openMainWindowFromPet(): void {
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    if (process.platform === 'darwin') void app.dock?.show();
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
    void runPetToComposer();
    return;
  }

  // 主窗口已销毁时交给应用生命周期重建；显式双击不受单击抑制影响。
  suppressAppActivationUntil = 0;
  app.emit('activate');
}

/**
 * 用 ease-out 曲线移动透明窗口：起步快、接近目标时自然收住。
 * 帧动画由状态机同步切到 run-left / run-right，窗口本身只负责位移。
 */
async function animatePetTo(target: PetPoint): Promise<boolean> {
  const win = getPetWindow();
  if (!win) return false;

  cancelPetMotion();
  const generation = motionGeneration;
  const [startX, startY] = win.getPosition();
  const dx = target.x - startX;
  const dy = target.y - startY;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) {
    setPetWindowPosition(target.x, target.y);
    runtime?.machine.setState(stateForJobs(activity.runningJobs), true);
    return true;
  }

  runtime?.machine.noteActivity();
  runtime?.machine.wakeFromSleep();
  runtime?.machine.setState(dx < 0 ? 'run-left' : 'run-right', true);

  const duration = petTravelDuration(distance);
  const startedAt = Date.now();
  const completed = await new Promise<boolean>((resolve) => {
    motionResolve = resolve;
    const finish = (): void => {
      if (motionTimer) clearInterval(motionTimer);
      motionTimer = null;
      motionResolve = null;
      setPetWindowPosition(target.x, target.y);
      resolve(true);
    };
    const tick = (): void => {
      if (generation !== motionGeneration) return;
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setPetWindowPosition(startX + dx * eased, startY + dy * eased);
      if (progress >= 1) finish();
    };
    motionTimer = setInterval(tick, 16);
    tick();
  });

  if (completed && generation === motionGeneration) {
    runtime?.machine.setState(stateForJobs(activity.runningJobs), true);
  }
  return completed;
}

function rememberPageRelativePosition(): void {
  if (!desktopHome) return;
  const main = getMainWindow();
  const pet = getPetWindow();
  if (!main || main.isDestroyed() || !pet) return;
  const content = main.getContentBounds();
  const [x, y] = pet.getPosition();
  pageRelativePosition = toRelativePosition({ x, y }, content);
}

function activatePageMovementBounds(): void {
  const main = getMainWindow();
  const pet = getPetWindow();
  if (!main || main.isDestroyed() || !pet || !desktopHome) return;
  const content = main.getContentBounds();
  setPetMovementBounds(content);
  const [x, y] = pet.getPosition();
  // 重新钳制一次，保证自动停靠点也完整落在页面内。
  setPetWindowPosition(x, y);
  rememberPageRelativePosition();
}

/** 主窗口移动或缩放后，按页面内相对坐标同步桌宠位置。 */
export function syncPetWithMainWindow(): void {
  if (!enabled || locationState !== 'page' || !desktopHome || !pageRelativePosition) return;
  const main = getMainWindow();
  if (!main || main.isDestroyed() || !main.isVisible()) return;
  const content = main.getContentBounds();
  setPetMovementBounds(content);
  const next = fromRelativePosition(pageRelativePosition, content);
  setPetWindowPosition(next.x, next.y);
  // 窗口缩小时可能触发边界钳制，记录钳制后的新相对位置。
  rememberPageRelativePosition();
}

/** 记录主界面 Composer 锚点，并让桌宠从桌面原位跑到其右侧。 */
export async function runPetToComposer(anchor?: PetComposerAnchor): Promise<void> {
  if (anchor) {
    if (!Number.isFinite(anchor.right) || !Number.isFinite(anchor.bottom)) return;
    composerAnchor = { right: anchor.right, bottom: anchor.bottom };
  }
  if (!enabled || !composerAnchor) return;

  const main = getMainWindow();
  const pet = getPetWindow();
  if (!main || !canEnterPetPage(main) || !pet) return;

  // Composer 重新挂载（例如从设置页返回）只刷新锚点，不覆盖用户拖拽的位置。
  if (locationState === 'page' || locationState === 'entering') return;

  if (locationState === 'desktop' || !desktopHome) {
    const [x, y] = pet.getPosition();
    desktopHome = { x, y };
    persistDesktopPosition(desktopHome);
    logger.debug('记录桌面原位', `position=${x},${y}`);
    pageRelativePosition = null;
    setPetMovementBounds(null);
  }
  locationState = 'entering';
  const content = main.getContentBounds();
  const completed = await animatePetTo({
    x: content.x + Math.round(composerAnchor.right) + 12,
    y: content.y + Math.round(composerAnchor.bottom) - PET_HEIGHT,
  });
  if (completed && locationState === 'entering') {
    activatePageMovementBounds();
    locationState = 'page';
  }
}

/** 主界面隐藏时解除页面限制，跑回页面打开前记录的桌面位置。 */
export async function returnPetHome(): Promise<void> {
  const home = desktopHome;
  if (!enabled || !home || locationState === 'desktop' || locationState === 'returning') return;
  const current = currentPetPosition();
  logger.debug(
    '返回桌面原位',
    `from=${current?.x ?? '?'},${current?.y ?? '?'}`,
    `to=${home.x},${home.y}`,
  );
  locationState = 'returning';
  pageRelativePosition = null;
  setPetMovementBounds(null);
  const completed = await animatePetTo(home);
  if (completed && locationState === 'returning' && desktopHome === home) {
    persistDesktopPosition(home);
    desktopHome = null;
    locationState = 'desktop';
    const current = currentPetPosition();
    logger.debug('已返回桌面原位', `position=${current?.x ?? '?'},${current?.y ?? '?'}`);
  }
}

function toFrame(state: string, spec: PetStateDef, dir: string): PetFrame {
  // 复用既有的 media:// 协议读盘，dev 和打包后行为一致。
  // media:// 带一年期 immutable 缓存，素材文件原地替换后同一 URL 会一直命中
  // 旧图，所以把 mtime 拼进 URL 当版本号 —— 文件一换 URL 就换。
  const toSrc = (file: string): string => {
    const abs = `${dir}/${file}`;
    let version = 0;
    try {
      version = statSync(abs).mtimeMs;
    } catch {
      // 文件缺失时仍然发帧，让渲染层的 onerror 兜底显示，而不是整只宠物卡住
    }
    return `media://local/?p=${encodeURIComponent(abs)}&v=${version}`;
  };

  const files = spec.files?.length ? spec.files : [spec.file];
  return {
    state,
    srcs: files.map(toSrc),
    frameMs: spec.frameMs ?? 650,
    loop: spec.loop,
  };
}

function pushFrame(frame: PetFrame): void {
  lastFrame = frame;
  const win = getPetWindow();
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send(IPC.PET_FRAME, frame);
  }
}

/** 打开桌宠。主题读不到就保持关闭，不让它把应用启动带崩。 */
export function enablePet(): boolean {
  if (enabled) return true;

  try {
    const { theme, dir } = loadTheme();
    const machine = new PetStateMachine({
      theme,
      onChange: (state, spec) => {
        logger.debug('状态切换', state, `jobs=${activity.runningJobs}`);
        pushFrame(toFrame(state, spec, dir));
      },
      // 有任务在跑就别睡 —— 用户正等着出图，宠物先睡着了很出戏
      canSleep: () => activity.runningJobs === 0,
    });
    runtime = { theme, dir, machine };
    enabled = true;

    const idle = theme.states.idle;
    if (idle) lastFrame = toFrame('idle', idle, dir);
    if (activity.runningJobs > 0) {
      machine.setState(stateForJobs(activity.runningJobs), true);
    }

    const savedDesktopPosition = loadPetDesktopPosition(app.getPath('userData'));
    const pet = createPetWindow(savedDesktopPosition);
    const [desktopX, desktopY] = pet.getPosition();
    persistDesktopPosition({ x: desktopX, y: desktopY });
    if (composerAnchor) void runPetToComposer();
    logger.info('桌宠已启动', `theme=${theme.name}`, `states=${Object.keys(theme.states).length}`);
    return true;
  } catch (error) {
    logger.error('桌宠启动失败', error instanceof Error ? error.message : String(error));
    runtime = null;
    enabled = false;
    return false;
  }
}

export function disablePet(): void {
  cancelPetMotion();
  finishPetDrag();
  desktopHome = null;
  pageRelativePosition = null;
  locationState = 'desktop';
  setPetMovementBounds(null);
  runtime?.machine.dispose();
  runtime = null;
  enabled = false;
  lastFrame = null;
  destroyPetWindow();
}

export function isPetEnabled(): boolean {
  return enabled;
}

/** 生图任务开始。返回一个在任务落地时调用的收尾函数。 */
export function notifyGenerationStart(): (outcome: 'success' | 'failed' | 'cancelled') => void {
  return activity.start();
}

/** 提交后、真正开跑前的等待。 */
export function notifyGenerationPending(): void {
  activity.pending();
}

/**
 * 给一次生成套上桌宠追踪。
 *
 * 包在**调用 core 的 Electron 侧门面**上，而不是包在 core 里 —— core 不该知道
 * 桌宠存在。生成结果原样透传，桌宠出问题也不影响出图。
 */
export async function trackPetGeneration<
  T extends { status: 'success' | 'failed' | 'cancelled' },
>(run: () => Promise<T>): Promise<T> {
  const settle = notifyGenerationStart();
  try {
    const result = await run();
    settle(result.status);
    return result;
  } catch (error) {
    settle('failed');
    throw error;
  }
}

export function registerPetHandlers(): void {
  ipcMain.handle(IPC.PET_SET_ENABLED, (_event, next: boolean) => {
    if (next) enablePet();
    else disablePet();
    return { enabled };
  });

  ipcMain.handle(IPC.PET_IS_ENABLED, () => ({ enabled }));

  ipcMain.handle(IPC.PET_GET_FRAME, () => lastFrame);

  ipcMain.on(IPC.PET_READY, (event) => {
    const pet = getPetWindow();
    if (!pet || event.sender !== pet.webContents) return;
    revealPetWindow();
  });

  ipcMain.on(IPC.PET_INTERACT, (_event, interaction: PetInteraction) => {
    if (interaction === 'pointer-down') {
      suppressAppActivationUntil = Date.now() + 500;
      return;
    }
    if (interaction === 'open-main') {
      openMainWindowFromPet();
      return;
    }

    const machine = runtime?.machine;
    if (!machine) return;

    machine.noteActivity();
    machine.wakeFromSleep();

    if (interaction === 'poke') machine.setState('react-poke');
    else if (interaction === 'drag-start') {
      cancelPetMotion();
      if (locationState === 'returning') {
        // 用户在回程中抓住桌宠，拖拽接管为新的桌面停留位置。
        desktopHome = null;
        pageRelativePosition = null;
        locationState = 'desktop';
        setPetMovementBounds(null);
      }
      // 跑入页面途中被用户抓住时，立即接管为页面内拖拽并完整钳制角色。
      const main = getMainWindow();
      if ((locationState === 'entering' || locationState === 'page') && main?.isVisible()) {
        activatePageMovementBounds();
        locationState = 'page';
      }
      beginPetDrag();
      machine.setState('react-drag', true);
    }
    else if (interaction === 'drag-end' && machine.getState() === 'react-drag') {
      finishPetDrag();
      if (locationState === 'desktop') {
        const point = currentPetPosition();
        if (point) persistDesktopPosition(point);
      }
      machine.setState(stateForJobs(activity.runningJobs), true);
    }
  });

  ipcMain.on(IPC.PET_MOVE_BY, (_event, dx: number, dy: number) => {
    // 兼容热更新前仍发送增量的旧渲染层；新拖拽由主进程原生鼠标轮询接管。
    if (dragOrigin) return;
    movePetWindowBy(dx, dy);
    if (locationState !== 'desktop') rememberPageRelativePosition();
  });

  ipcMain.handle(IPC.PET_RUN_TO_COMPOSER, async (_event, anchor: PetComposerAnchor) => {
    await runPetToComposer(anchor);
  });

  ipcMain.handle(IPC.PET_RETURN_HOME, async () => {
    await returnPetHome();
  });

  ipcMain.on(IPC.PET_MENU, () => {
    const petWin = getPetWindow();
    if (!petWin) return;
    runtime?.machine.noteActivity();

    // 原生菜单而不是 HTML 菜单：宠物窗口只有 160px 宽，HTML 菜单会被窗口
    // 边界裁掉；原生菜单浮在窗口之外，观感也和系统一致
    Menu.buildFromTemplate([
      {
        label: '打开 Musefold',
        click: openMainWindowFromPet,
      },
      { type: 'separator' },
      {
        label: '隐藏桌宠',
        click: () => disablePet(),
      },
      { type: 'separator' },
      {
        label: '退出 Musefold',
        click: () => app.quit(),
      },
    ]).popup({ window: petWin });
  });
}
