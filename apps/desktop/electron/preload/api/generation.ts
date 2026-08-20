// electron/preload/api/generation.ts
// aiConnection / provider / settings(pricing) / image 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const aiConnectionApi = {
  listPresets: () => ipcRenderer.invoke(IPC.AI_CONNECTION_LIST_PRESETS),
  list: () => ipcRenderer.invoke(IPC.AI_CONNECTION_LIST),
  create: (input: import("@musefold/desktop-contracts/ai").CreateAiConnectionInput) =>
    ipcRenderer.invoke(IPC.AI_CONNECTION_CREATE, input),
  update: (
    id: string,
    patch: import("@musefold/desktop-contracts/ai").UpdateAiConnectionInput,
  ) => ipcRenderer.invoke(IPC.AI_CONNECTION_UPDATE, id, patch),
  delete: (id: string) => ipcRenderer.invoke(IPC.AI_CONNECTION_DELETE, id),
  saveKey: (id: string, apiKey: string) =>
    ipcRenderer.invoke(IPC.AI_CONNECTION_SAVE_KEY, id, apiKey),
  deleteKey: (id: string) => ipcRenderer.invoke(IPC.AI_CONNECTION_DELETE_KEY, id),
  hasKey: (id: string) => ipcRenderer.invoke(IPC.AI_CONNECTION_HAS_KEY, id),
  setActive: (id: string) => ipcRenderer.invoke(IPC.AI_CONNECTION_SET_ACTIVE, id),
  listModels: (id: string) => ipcRenderer.invoke(IPC.AI_CONNECTION_LIST_MODELS, id),
  validate: (id: string) => ipcRenderer.invoke(IPC.AI_CONNECTION_VALIDATE, id),
};

export const providerApi = {
  list: () => ipcRenderer.invoke(IPC.PROVIDER_LIST),
  create: (p: import("@musefold/desktop-contracts/models").NewProviderConfig) =>
    ipcRenderer.invoke(IPC.PROVIDER_CREATE, p),
  update: (
    id: string,
    patch: Partial<import("@musefold/desktop-contracts/models").NewProviderConfig>,
  ) => ipcRenderer.invoke(IPC.PROVIDER_UPDATE, id, patch),
  delete: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_DELETE, id),
  saveKey: (id: string, apiKey: string) =>
    ipcRenderer.invoke(IPC.PROVIDER_SAVE_KEY, id, apiKey),
  hasKey: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_HAS_KEY, id),
  openWebLogin: () => ipcRenderer.invoke(IPC.PROVIDER_OPEN_WEB_LOGIN),
  webLoginStart: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_LOGIN_START),
  webLoginRefresh: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_LOGIN_REFRESH),
  webLogout: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_LOGOUT),
  webLoginState: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_LOGIN_STATE),
  setWebDeveloperVisible: (visible: boolean) =>
    ipcRenderer.invoke(IPC.PROVIDER_WEB_DEVELOPER_VISIBLE, visible),
  onWebLoginChanged: (
    cb: (
      status: import("@musefold/desktop-contracts/providers").DoubaoWebAccountStatus,
    ) => void,
  ) => {
    const listener = (
      _event: unknown,
      status: import("@musefold/desktop-contracts/providers").DoubaoWebAccountStatus,
    ) => cb(status);
    ipcRenderer.on(IPC.PROVIDER_WEB_LOGIN_CHANGED, listener);
    return () =>
      ipcRenderer.removeListener(IPC.PROVIDER_WEB_LOGIN_CHANGED, listener);
  },
  webUsage: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_USAGE),
  webStatus: () => ipcRenderer.invoke(IPC.PROVIDER_WEB_STATUS),
  validate: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_VALIDATE, id),
  listModels: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_LIST_MODELS, id),
  setActive: (id: string) => ipcRenderer.invoke(IPC.PROVIDER_SET_ACTIVE, id),
};

export const settingsApi = {
  pricing: {
    get: (providerId: string) =>
      ipcRenderer.invoke(IPC.SETTINGS_PRICING_GET, providerId),
    set: (req: import("@musefold/desktop-contracts/models").ProviderPricingSetRequest) =>
      ipcRenderer.invoke(IPC.SETTINGS_PRICING_SET, req),
    delete: (providerId: string) =>
      ipcRenderer.invoke(IPC.SETTINGS_PRICING_DELETE, providerId),
  },
};

export const imageApi = {
  pickLocal: () => ipcRenderer.invoke(IPC.IMAGE_PICK_LOCAL),
  stageLocal: (
    input: import("@musefold/desktop-contracts/providers").StageLocalImageInput,
  ) => ipcRenderer.invoke(IPC.IMAGE_STAGE_LOCAL, input),
  generate: (req: import("@musefold/desktop-contracts/providers").GenerateImageRequest) =>
    ipcRenderer.invoke(IPC.IMAGE_GENERATE, req),
  cancel: (jobId: string) => ipcRenderer.invoke(IPC.IMAGE_CANCEL, jobId),
  retry: (historyId: string, jobId?: string) =>
    ipcRenderer.invoke(IPC.IMAGE_RETRY, historyId, jobId),
  onProgress: (
    cb: (
      progress: import("@musefold/desktop-contracts/providers").ImageGenerationProgress,
    ) => void,
  ) => {
    const listener = (
      _event: unknown,
      progress: import("@musefold/desktop-contracts/providers").ImageGenerationProgress,
    ) => cb(progress);
    ipcRenderer.on(IPC.IMAGE_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.IMAGE_PROGRESS, listener);
  },
};
