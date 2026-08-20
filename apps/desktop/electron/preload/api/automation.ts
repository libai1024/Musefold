// electron/preload/api/automation.ts
// automation 域（本地控制面）的 window.api 组装（V13-GOV-04 自 preload/index.ts 分域拆出）。

import { ipcRenderer } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";

export const automationApi = {
  status: () => ipcRenderer.invoke(IPC.AUTOMATION_STATUS),
  setEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.AUTOMATION_SET_ENABLED, enabled),
  rotateToken: () => ipcRenderer.invoke(IPC.AUTOMATION_ROTATE_TOKEN),
  auditList: (limit?: number) => ipcRenderer.invoke(IPC.AUTOMATION_AUDIT_LIST, limit),
  confirm: (confirmationId: string, approved: boolean) =>
    ipcRenderer.invoke(IPC.AUTOMATION_CONFIRM, confirmationId, approved),
  budget: {
    get: () => ipcRenderer.invoke(IPC.AUTOMATION_BUDGET_GET),
    set: (monthlyLimitPoints: number) =>
      ipcRenderer.invoke(IPC.AUTOMATION_BUDGET_SET, monthlyLimitPoints),
  },
  onConfirmationRequired: (
    cb: (
      summary: import("@musefold/desktop-contracts/ipc").AutomationConfirmationSummary,
    ) => void,
  ) => {
    const listener = (
      _event: unknown,
      summary: import("@musefold/desktop-contracts/ipc").AutomationConfirmationSummary,
    ) => cb(summary);
    ipcRenderer.on(IPC.AUTOMATION_CONFIRMATION_REQUIRED, listener);
    return () =>
      ipcRenderer.removeListener(IPC.AUTOMATION_CONFIRMATION_REQUIRED, listener);
  },
  onConfirmationResolved: (
    cb: (payload: {
      confirmationId: string;
      outcome: "approved" | "denied" | "timeout";
    }) => void,
  ) => {
    const listener = (
      _event: unknown,
      payload: {
        confirmationId: string;
        outcome: "approved" | "denied" | "timeout";
      },
    ) => cb(payload);
    ipcRenderer.on(IPC.AUTOMATION_CONFIRMATION_RESOLVED, listener);
    return () =>
      ipcRenderer.removeListener(IPC.AUTOMATION_CONFIRMATION_RESOLVED, listener);
  },
  onActivity: (
    cb: (payload: { jobId: string; running: boolean }) => void,
  ) => {
    const listener = (
      _event: unknown,
      payload: { jobId: string; running: boolean },
    ) => cb(payload);
    ipcRenderer.on(IPC.AUTOMATION_ACTIVITY, listener);
    return () => ipcRenderer.removeListener(IPC.AUTOMATION_ACTIVITY, listener);
  },
  onSetupRequested: (
    cb: (request: import("@musefold/desktop-contracts/ipc").AutomationSetupRequest) => void,
  ) => {
    const listener = (
      _event: unknown,
      request: import("@musefold/desktop-contracts/ipc").AutomationSetupRequest,
    ) => cb(request);
    ipcRenderer.on(IPC.AUTOMATION_SETUP_REQUESTED, listener);
    return () =>
      ipcRenderer.removeListener(IPC.AUTOMATION_SETUP_REQUESTED, listener);
  },
  onProviderChanged: (cb: (payload: { providerId: string }) => void) => {
    const listener = (_event: unknown, payload: { providerId: string }) =>
      cb(payload);
    ipcRenderer.on(IPC.AUTOMATION_PROVIDER_CHANGED, listener);
    return () =>
      ipcRenderer.removeListener(IPC.AUTOMATION_PROVIDER_CHANGED, listener);
  },
  integrationInfo: () => ipcRenderer.invoke(IPC.AUTOMATION_INTEGRATION_INFO),
  integrationAction: (
    action: import("@musefold/desktop-contracts/ipc").IntegrationAction,
  ) => ipcRenderer.invoke(IPC.AUTOMATION_INTEGRATION_ACTION, action),
};
