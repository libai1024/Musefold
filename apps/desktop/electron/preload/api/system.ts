// electron/preload/api/system.ts
// system / updater / log / window 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const systemApi = {
  getPaths: () => ipcRenderer.invoke(IPC.SYSTEM_GET_PATHS),
  getVersion: () => ipcRenderer.invoke(IPC.SYSTEM_GET_VERSION),
  openAboutResource: (
    resource: import("@musefold/desktop-contracts/ipc").AboutResourceId,
  ) => ipcRenderer.invoke(IPC.SYSTEM_OPEN_ABOUT_RESOURCE, resource),
  openInFolder: (path: string) => ipcRenderer.invoke(IPC.SYSTEM_OPEN_IN_FOLDER, path),
  saveImage: (sourcePath: string, targetPath?: string) =>
    ipcRenderer.invoke(IPC.SYSTEM_SAVE_IMAGE, sourcePath, targetPath),
  saveImages: (sourcePaths: string[], targetDirectory?: string) =>
    ipcRenderer.invoke(IPC.SYSTEM_SAVE_IMAGES, sourcePaths, targetDirectory),
  copyImage: (sourcePath: string) =>
    ipcRenderer.invoke(IPC.SYSTEM_COPY_IMAGE, sourcePath),
  readClipboardText: () => ipcRenderer.invoke(IPC.SYSTEM_READ_CLIPBOARD_TEXT),
  readClipboardImage: () => ipcRenderer.invoke(IPC.SYSTEM_READ_CLIPBOARD_IMAGE),
  diskUsage: () => ipcRenderer.invoke(IPC.SYSTEM_DISK_USAGE),
  export: (req?: import("@musefold/desktop-contracts/ipc").ExportRequest) =>
    ipcRenderer.invoke(IPC.SYSTEM_EXPORT, req ?? {}),
  import: (req?: import("@musefold/desktop-contracts/ipc").ImportRequest) =>
    ipcRenderer.invoke(IPC.SYSTEM_IMPORT, req ?? {}),
  listBackups: () => ipcRenderer.invoke(IPC.SYSTEM_LIST_BACKUPS),
  backupNow: () => ipcRenderer.invoke(IPC.SYSTEM_BACKUP_NOW),
  restoreBackup: (req: import("@musefold/desktop-contracts/ipc").RestoreBackupRequest) =>
    ipcRenderer.invoke(IPC.SYSTEM_RESTORE_BACKUP, req),
  relaunch: () => ipcRenderer.invoke(IPC.SYSTEM_RELAUNCH),
  resetData: (req: import("@musefold/desktop-contracts/ipc").ResetDataRequest) =>
    ipcRenderer.invoke(IPC.SYSTEM_RESET_DATA, req),
};

export const updaterApi = {
  getState: () => ipcRenderer.invoke(IPC.UPDATER_GET_STATE),
  check: () => ipcRenderer.invoke(IPC.UPDATER_CHECK),
  download: () => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
  install: () => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
  getChannel: () => ipcRenderer.invoke(IPC.UPDATER_GET_CHANNEL),
  setChannel: (channel: import("@musefold/desktop-contracts/updater").Channel) =>
    ipcRenderer.invoke(IPC.UPDATER_SET_CHANNEL, channel),
  onStateChanged: (
    cb: (status: import("@musefold/desktop-contracts/updater").UpdateStatus) => void,
  ) => {
    const listener = (
      _e: unknown,
      status: import("@musefold/desktop-contracts/updater").UpdateStatus,
    ) => cb(status);
    ipcRenderer.on(IPC.UPDATER_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATER_STATE_CHANGED, listener);
  },
  notifyContentReady: () => ipcRenderer.send(IPC.UPDATER_CONTENT_READY),
  getContentState: () => ipcRenderer.invoke(IPC.UPDATER_GET_CONTENT_STATE),
  checkContentNow: () => ipcRenderer.invoke(IPC.UPDATER_CHECK_CONTENT_NOW),
};

export const logApi = {
  tail: (maxLines?: number) => ipcRenderer.invoke(IPC.LOG_TAIL, maxLines),
  openDir: () => ipcRenderer.invoke(IPC.LOG_OPEN_DIR),
};

export const windowApi = {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximizeToggle: () => ipcRenderer.send("window:maximizeToggle"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
  platform: () => ipcRenderer.invoke("window:platform") as Promise<NodeJS.Platform>,
  onMaximizeChange: (cb: (isMax: boolean) => void) => {
    const listener = (_e: unknown, isMax: boolean) => cb(isMax);
    ipcRenderer.on("window:maximizeChanged", listener);
    return () => ipcRenderer.removeListener("window:maximizeChanged", listener);
  },
  onFullscreenChange: (cb: (isFs: boolean) => void) => {
    const listener = (_e: unknown, isFs: boolean) => cb(isFs);
    ipcRenderer.on("window:fullscreenChanged", listener);
    return () => ipcRenderer.removeListener("window:fullscreenChanged", listener);
  },
};
