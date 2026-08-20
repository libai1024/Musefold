// electron/preload/api/workbench.ts
// workbenchSession 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const workbenchSessionApi = {
  ensure: (
    command: import("@musefold/desktop-contracts/workbench").EnsureWorkbenchSessionCommand,
  ) => ipcRenderer.invoke(IPC.WORKBENCH_SESSION_ENSURE, command),
  list: (
    query?: import("@musefold/desktop-contracts/workbench").WorkbenchSessionListQuery,
  ) => ipcRenderer.invoke(IPC.WORKBENCH_SESSION_LIST, query),
  get: (id: string) => ipcRenderer.invoke(IPC.WORKBENCH_SESSION_GET, id),
  rename: (id: string, title: string) =>
    ipcRenderer.invoke(IPC.WORKBENCH_SESSION_RENAME, id, title),
  archive: (id: string, archived = true) =>
    ipcRenderer.invoke(IPC.WORKBENCH_SESSION_ARCHIVE, id, archived),
  delete: (id: string) => ipcRenderer.invoke(IPC.WORKBENCH_SESSION_DELETE, id),
};
