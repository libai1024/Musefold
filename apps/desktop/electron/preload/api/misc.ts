// electron/preload/api/misc.ts
// diagnostics / pet 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";
import type { DiagnosticReport } from "@musefold/desktop-contracts/diagnostics";

// 诊断弹窗只接收主进程主动推送的未捕获异常。
// invoke 的拒绝会原样抛给调用方：已处理的错误由调用方呈现（toast/行内），
// 未处理的会落到 window 的 unhandledrejection 全局兜底，不在这里重复上报。
function onDiagnosticError(cb: (report: DiagnosticReport) => void): () => void {
  const listener = (_event: unknown, report: DiagnosticReport) => cb(report);
  ipcRenderer.on(IPC.DIAGNOSTICS_ERROR, listener);
  return () => {
    ipcRenderer.removeListener(IPC.DIAGNOSTICS_ERROR, listener);
  };
}

export const diagnosticsApi = {
  onError: onDiagnosticError,
};

export const petApi = {
  setEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.PET_SET_ENABLED, enabled),
  isEnabled: () => ipcRenderer.invoke(IPC.PET_IS_ENABLED),
  getFrame: () => ipcRenderer.invoke(IPC.PET_GET_FRAME),
  ready: () => ipcRenderer.send(IPC.PET_READY),
  onFrame: (cb: (frame: import("@musefold/desktop-contracts/pet").PetFrame) => void) => {
    const listener = (
      _e: unknown,
      frame: import("@musefold/desktop-contracts/pet").PetFrame,
    ) => cb(frame);
    ipcRenderer.on(IPC.PET_FRAME, listener);
    return () => ipcRenderer.removeListener(IPC.PET_FRAME, listener);
  },
  interact: (interaction: import("@musefold/desktop-contracts/pet").PetInteraction) =>
    ipcRenderer.send(IPC.PET_INTERACT, interaction),
  moveBy: (dx: number, dy: number) => ipcRenderer.send(IPC.PET_MOVE_BY, dx, dy),
  runToComposer: (anchor: import("@musefold/desktop-contracts/pet").PetComposerAnchor) =>
    ipcRenderer.invoke(IPC.PET_RUN_TO_COMPOSER, anchor),
  returnHome: () => ipcRenderer.invoke(IPC.PET_RETURN_HOME),
  openMenu: () => ipcRenderer.send(IPC.PET_MENU),
};
