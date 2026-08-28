// electron/preload/index.ts
// 桌宠窗口专用 preload(v2.5 冻结面)。主窗口走 preload/v25.ts 单通道桥;
// 本文件只暴露桌宠所需两域:pet.* 与 updater.notifyContentReady(内容层信标)。
// 旧多域 window.api 桥与 origin 迁移已随 M5c 退役。

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type { PetComposerAnchor, PetFrame, PetInteraction } from '@musefold/desktop-contracts/pet';

const petApi = {
  setEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC.PET_SET_ENABLED, enabled),
  isEnabled: () => ipcRenderer.invoke(IPC.PET_IS_ENABLED),
  getFrame: () => ipcRenderer.invoke(IPC.PET_GET_FRAME),
  ready: () => ipcRenderer.send(IPC.PET_READY),
  onFrame: (cb: (frame: PetFrame) => void) => {
    const listener = (_e: unknown, frame: PetFrame) => cb(frame);
    ipcRenderer.on(IPC.PET_FRAME, listener);
    return () => ipcRenderer.removeListener(IPC.PET_FRAME, listener);
  },
  interact: (interaction: PetInteraction) => ipcRenderer.send(IPC.PET_INTERACT, interaction),
  moveBy: (dx: number, dy: number) => ipcRenderer.send(IPC.PET_MOVE_BY, dx, dy),
  runToComposer: (anchor: PetComposerAnchor) => ipcRenderer.invoke(IPC.PET_RUN_TO_COMPOSER, anchor),
  returnHome: () => ipcRenderer.invoke(IPC.PET_RETURN_HOME),
  openMenu: () => ipcRenderer.send(IPC.PET_MENU),
};

const updaterApi = {
  notifyContentReady: () => ipcRenderer.send(IPC.UPDATER_CONTENT_READY),
};

contextBridge.exposeInMainWorld('api', { pet: petApi, updater: updaterApi });
