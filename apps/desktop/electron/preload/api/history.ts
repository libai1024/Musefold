// electron/preload/api/history.ts
// history 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const historyApi = {
  list: (q?: {
    status?: string;
    providerId?: string;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  }) => ipcRenderer.invoke(IPC.HISTORY_LIST, q),
  related: (q: import("@musefold/desktop-contracts/ipc").RelatedHistoryQuery) =>
    ipcRenderer.invoke(IPC.HISTORY_RELATED, q),
  linkPrompt: (req: import("@musefold/desktop-contracts/ipc").HistoryLinkPromptRequest) =>
    ipcRenderer.invoke(IPC.HISTORY_LINK_PROMPT, req),
  get: (id: string) => ipcRenderer.invoke(IPC.HISTORY_GET, id),
  delete: (req: string | import("@musefold/desktop-contracts/ipc").HistoryDeleteRequest) =>
    ipcRenderer.invoke(IPC.HISTORY_DELETE, req),
  clear: (req?: number | import("@musefold/desktop-contracts/ipc").HistoryClearRequest) =>
    ipcRenderer.invoke(IPC.HISTORY_CLEAR, req),
  stats: (q: import("@musefold/desktop-contracts/models").HistoryStatsQuery) =>
    ipcRenderer.invoke(IPC.HISTORY_STATS, q),
};
