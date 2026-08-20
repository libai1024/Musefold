// electron/preload/api/account.ts
// account / cloudSync / cloudConnections 域的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";
import type { AccountErrorPayload } from "@musefold/desktop-contracts/account";

const ACCOUNT_ERROR_PREFIX = "ACCOUNT_ERR::";

/** Electron invoke 只保留 Error.message；把主进程结构化前缀还原成渲染层可判定的 code/stage。 */
async function invokeAccount<T>(
  channel: string,
  ...args: unknown[]
): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const index = raw.indexOf(ACCOUNT_ERROR_PREFIX);
    if (index !== -1) {
      try {
        const payload = JSON.parse(
          raw.slice(index + ACCOUNT_ERROR_PREFIX.length),
        ) as AccountErrorPayload;
        const restored = new Error(payload.message) as Error & AccountErrorPayload;
        restored.code = payload.code;
        restored.stage = payload.stage;
        throw restored;
      } catch (parsed) {
        if (parsed instanceof Error && "code" in parsed) throw parsed;
      }
    }
    throw error;
  }
}

export const accountApi = {
  status: () =>
    invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
      IPC.ACCOUNT_STATUS,
    ),
  register: (
    input: import("@musefold/desktop-contracts/account").AccountCredentialsInput,
  ) =>
    invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
      IPC.ACCOUNT_REGISTER,
      input,
    ),
  login: (input: import("@musefold/desktop-contracts/account").AccountCredentialsInput) =>
    invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
      IPC.ACCOUNT_LOGIN,
      input,
    ),
  logout: () =>
    invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
      IPC.ACCOUNT_LOGOUT,
    ),
  redeem: (code: string) =>
    invokeAccount<import("@musefold/desktop-contracts/account").AccountRedeemResult>(
      IPC.ACCOUNT_REDEEM,
      code,
    ),
  refreshQuota: () =>
    invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
      IPC.ACCOUNT_REFRESH_QUOTA,
    ),
  setServerUrl: (url: string) =>
    invokeAccount<import("@musefold/desktop-contracts/account").AccountStatus>(
      IPC.ACCOUNT_SET_SERVER_URL,
      url,
    ),
  onChanged: (
    cb: (status: import("@musefold/desktop-contracts/account").AccountStatus) => void,
  ) => {
    const listener = (
      _event: unknown,
      status: import("@musefold/desktop-contracts/account").AccountStatus,
    ) => cb(status);
    ipcRenderer.on(IPC.ACCOUNT_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.ACCOUNT_CHANGED, listener);
  },
};

export const cloudSyncApi = {
  status: () => ipcRenderer.invoke(IPC.CLOUD_SYNC_STATUS),
  setEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.CLOUD_SYNC_SET_ENABLED, enabled),
  syncNow: () => ipcRenderer.invoke(IPC.CLOUD_SYNC_NOW),
  conflicts: () => ipcRenderer.invoke(IPC.CLOUD_SYNC_CONFLICTS),
  resolve: (
    conflictId: string,
    resolution: import("@musefold/desktop-contracts/cloud-sync").CloudSyncConflictResolution,
  ) => ipcRenderer.invoke(IPC.CLOUD_SYNC_RESOLVE, conflictId, resolution),
  onChanged: (
    cb: (status: import("@musefold/desktop-contracts/cloud-sync").CloudSyncSummary) => void,
  ) => {
    const listener = (
      _event: unknown,
      status: import("@musefold/desktop-contracts/cloud-sync").CloudSyncSummary,
    ) => cb(status);
    ipcRenderer.on(IPC.CLOUD_SYNC_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CLOUD_SYNC_CHANGED, listener);
  },
};

export const cloudConnectionsApi = {
  list: () => ipcRenderer.invoke(IPC.CLOUD_CONNECTIONS_LIST),
  update: (
    id: string,
    input: import("@musefold/contracts").UpdateMcpConnection,
  ) => ipcRenderer.invoke(IPC.CLOUD_CONNECTIONS_UPDATE, id, input),
  revoke: (id: string) => ipcRenderer.invoke(IPC.CLOUD_CONNECTIONS_REVOKE, id),
};
