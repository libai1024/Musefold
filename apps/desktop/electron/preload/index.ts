// electron/preload/index.ts
// contextBridge 暴露 window.api —— 类型来自 @musefold/desktop-contracts/ipc。
// V13-GOV-04 起按域组装在 ./api/ 目录，本文件只做 origin 迁移、组合与单次暴露。
// 只做转发，无业务逻辑。详见 docs/01-architecture.md §2、docs/07-ipc-contracts.md §4

import { contextBridge, ipcRenderer } from "electron";
import {
  runPreloadOriginMigration,
  type LocalStorageLike,
} from "../main/prefs-origin-migration-logic";
import { promptApi, searchHistoryApi } from "./api/prompt";
import { skillRuntimeApi } from "./api/skill-runtime";
import { designSchemeApi } from "./api/design-scheme";
import {
  aiConnectionApi,
  providerApi,
  imageApi,
} from "./api/generation";
import { workbenchSessionApi } from "./api/workbench";
import { historyApi } from "./api/history";
import { shareApi } from "./api/share";
import {
  systemApi,
  updaterApi,
  logApi,
  windowApi,
} from "./api/system";
import { automationApi } from "./api/automation";
import {
  accountApi,
  cloudSyncApi,
  cloudConnectionsApi,
} from "./api/account";
import { diagnosticsApi, petApi } from "./api/misc";

try {
  const storage = (globalThis as unknown as { localStorage?: LocalStorageLike })
    .localStorage;
  runPreloadOriginMigration({
    argv: process.argv,
    sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args),
    storage,
  });
} catch {
  // Preload must never throw: an exception here makes the whole app unusable.
}

const api = {
  diagnostics: diagnosticsApi,
  prompt: promptApi,
  searchHistory: searchHistoryApi,
  skillRuntime: skillRuntimeApi,
  designScheme: designSchemeApi,
  aiConnection: aiConnectionApi,
  provider: providerApi,
  image: imageApi,
  workbenchSession: workbenchSessionApi,
  history: historyApi,
  share: shareApi,
  system: systemApi,
  updater: updaterApi,
  log: logApi,
  automation: automationApi,
  account: accountApi,
  cloudSync: cloudSyncApi,
  cloudConnections: cloudConnectionsApi,
  pet: petApi,
  window: windowApi,
};

contextBridge.exposeInMainWorld("api", api);
