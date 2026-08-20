import type { BrowserWindow } from 'electron';

interface PetWindowLifecycleActions {
  enterPage: () => void;
  leavePage: () => void;
  syncWithPage: () => void;
}

/** 只有真正可见且未最小化的主窗口才允许桌宠进入页面；失焦不代表页面关闭。 */
export function canEnterPetPage(win: BrowserWindow): boolean {
  return !win.isDestroyed()
    && win.isVisible()
    && !win.isMinimized();
}

/** 把主窗口的可见性和几何变化统一映射为桌宠页面会话事件。 */
export function attachPetWindowLifecycle(
  win: BrowserWindow,
  actions: PetWindowLifecycleActions,
): void {
  win.on('move', actions.syncWithPage);
  win.on('resize', actions.syncWithPage);

  win.on('show', actions.enterPage);
  win.on('restore', actions.enterPage);

  win.on('minimize', actions.leavePage);
  win.on('hide', actions.leavePage);
}
