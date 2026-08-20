// electron/preload/api/prompt.ts
// prompt / searchHistory 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。只做转发，无业务逻辑。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const promptApi = {
  list: (
    q?: Parameters<import("@musefold/desktop-contracts/ipc").Api["prompt"]["list"]>[0],
  ) => ipcRenderer.invoke(IPC.PROMPTS_LIST, q),
  get: (id: string) => ipcRenderer.invoke(IPC.PROMPTS_GET, id),
  create: (p: import("@musefold/desktop-contracts/models").NewPrompt) =>
    ipcRenderer.invoke(IPC.PROMPTS_CREATE, p),
  update: (
    id: string,
    patch: import("@musefold/desktop-contracts/ipc").UpdatePromptPatch,
  ) => ipcRenderer.invoke(IPC.PROMPTS_UPDATE, id, patch),
  delete: (id: string) => ipcRenderer.invoke(IPC.PROMPTS_DELETE, id),
  togglePin: (id: string, pinned: boolean) =>
    ipcRenderer.invoke(IPC.PROMPTS_TOGGLE_PIN, id, pinned),
  reorderPins: (ids: string[]) =>
    ipcRenderer.invoke(IPC.PROMPTS_REORDER_PINS, ids),
  incrementUsage: (
    id: string,
    action?: 'copy' | 'apply' | 'generate',
  ) => ipcRenderer.invoke(IPC.PROMPTS_INCREMENT_USAGE, id, action),
  listDeleted: () => ipcRenderer.invoke(IPC.PROMPTS_LIST_DELETED),
  restore: (id: string) => ipcRenderer.invoke(IPC.PROMPTS_RESTORE, id),
  purge: (id: string) => ipcRenderer.invoke(IPC.PROMPTS_PURGE, id),
  purgeAll: () => ipcRenderer.invoke(IPC.PROMPTS_PURGE_ALL),
  stats: () => ipcRenderer.invoke(IPC.PROMPTS_STATS),
};

export const searchHistoryApi = {
  list: (limit?: number) => ipcRenderer.invoke(IPC.SEARCH_HISTORY_LIST, limit),
  add: (term: string) => ipcRenderer.invoke(IPC.SEARCH_HISTORY_ADD, term),
  clear: () => ipcRenderer.invoke(IPC.SEARCH_HISTORY_CLEAR),
};
