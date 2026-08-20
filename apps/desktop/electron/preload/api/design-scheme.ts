// electron/preload/api/design-scheme.ts
// designScheme 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const designSchemeApi = {
  startCreation: (
    request: import("@musefold/desktop-contracts/design-scheme").StartDesignSchemeCreationRequest,
  ) => ipcRenderer.invoke(IPC.DESIGN_SCHEME_CREATE_START, request),
  confirmInstall: (executionId: string, accept: boolean) =>
    ipcRenderer.invoke(
      IPC.DESIGN_SCHEME_CREATE_CONFIRM_INSTALL,
      executionId,
      accept,
    ),
  cancelCreation: (executionId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_CREATE_CANCEL, executionId),
  list: () => ipcRenderer.invoke(IPC.DESIGN_SCHEME_LIST),
  getRevision: (revisionId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_GET_REVISION, revisionId),
  listAssets: (schemeId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_LIST_ASSETS, schemeId),
  updateInputs: (
    schemeId: string,
    baseRevisionId: string,
    inputs: Array<{ id: string; required: boolean }>,
  ) =>
    ipcRenderer.invoke(
      IPC.DESIGN_SCHEME_UPDATE_INPUTS,
      schemeId,
      baseRevisionId,
      inputs,
    ),
  startRun: (
    request: import("@musefold/desktop-contracts/design-scheme").StartDesignSchemeRunRequest,
  ) => ipcRenderer.invoke(IPC.DESIGN_SCHEME_RUN_START, request),
  cancelRun: (executionId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_RUN_CANCEL, executionId),
  selectCover: (schemeId: string, assetId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_SELECT_COVER, schemeId, assetId),
  formalize: (schemeId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_FORMALIZE, schemeId),
  rename: (schemeId: string, name: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_RENAME, schemeId, name),
  remove: (schemeId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_REMOVE, schemeId),
  listSourceFiles: (schemeId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_LIST_SOURCE_FILES, schemeId),
  startModify: (
    request: import("@musefold/desktop-contracts/design-scheme").StartDesignSchemeModifyRequest,
  ) => ipcRenderer.invoke(IPC.DESIGN_SCHEME_MODIFY_START, request),
  cancelModify: (executionId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_MODIFY_CANCEL, executionId),
  promoteWorkingDraft: (schemeId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_PROMOTE_DRAFT, schemeId),
  checkUpdate: (schemeId: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_CHECK_UPDATE, schemeId),
  marketSearch: (query: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_MARKET_SEARCH, query),
  exportScheme: (schemeId: string, targetPath?: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_EXPORT, schemeId, targetPath),
  importScheme: (sourcePath?: string) =>
    ipcRenderer.invoke(IPC.DESIGN_SCHEME_IMPORT, sourcePath),
  onEvent: (
    cb: (
      event: import("@musefold/desktop-contracts/design-scheme").DesignSchemeCreationEvent,
    ) => void,
  ) => {
    const listener = (
      _event: unknown,
      payload: import("@musefold/desktop-contracts/design-scheme").DesignSchemeCreationEvent,
    ) => cb(payload);
    ipcRenderer.on(IPC.DESIGN_SCHEME_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC.DESIGN_SCHEME_EVENT, listener);
  },
};
