// electron/preload/api/share.ts
// share / deeplink 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const shareApi = {
  renderCard: (req: import("@musefold/desktop-contracts/ipc").ShareRenderCardRequest) =>
    ipcRenderer.invoke(IPC.SHARE_RENDER_CARD, req),
  buildDeeplink: (
    req: import("@musefold/desktop-contracts/ipc").ShareBuildDeeplinkRequest,
  ) => ipcRenderer.invoke(IPC.SHARE_BUILD_DEEPLINK, req),
  parseDeeplink: (
    req: import("@musefold/desktop-contracts/ipc").ShareParseDeeplinkRequest,
  ) => ipcRenderer.invoke(IPC.SHARE_PARSE_DEEPLINK, req),
  import: (req: import("@musefold/desktop-contracts/ipc").ShareImportRequest) =>
    ipcRenderer.invoke(IPC.SHARE_IMPORT, req),
  consumePending: () => ipcRenderer.invoke(IPC.SHARE_CONSUME_PENDING),
  onIncoming: (
    cb: (payload: import("@musefold/desktop-contracts/share").SharePayload) => void,
  ) => {
    const listener = (
      _event: unknown,
      payload: import("@musefold/desktop-contracts/share").SharePayload,
    ) => cb(payload);
    ipcRenderer.on(IPC.SHARE_INCOMING, listener);
    return () => ipcRenderer.removeListener(IPC.SHARE_INCOMING, listener);
  },
};
