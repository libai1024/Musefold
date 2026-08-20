import { ipcMain, type IpcMain } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";
import type { CloudSyncConflictResolution } from "@musefold/desktop-contracts/cloud-sync";
import { updateMcpConnectionSchema } from "@musefold/contracts";
import { getCloudSyncService, type CloudSyncService } from "../../cloud-sync";

interface CloudSyncIpcTarget {
  handle: IpcMain["handle"];
}

export interface CloudSyncHandlerDependencies {
  target?: CloudSyncIpcTarget;
  service?: CloudSyncService;
}

export function registerCloudSyncHandlers(
  dependencies: CloudSyncHandlerDependencies = {},
): void {
  const target = dependencies.target ?? ipcMain;
  const service = dependencies.service ?? getCloudSyncService();
  target.handle(IPC.CLOUD_SYNC_STATUS, () => service.status());
  target.handle(IPC.CLOUD_SYNC_SET_ENABLED, (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("同步开关参数无效");
    return service.setEnabled(enabled);
  });
  target.handle(IPC.CLOUD_SYNC_NOW, () => service.syncNow());
  target.handle(IPC.CLOUD_SYNC_CONFLICTS, () => service.listConflicts());
  target.handle(
    IPC.CLOUD_SYNC_RESOLVE,
    (_event, conflictId: unknown, resolution: unknown) => {
      if (typeof conflictId !== "string" || !conflictId.trim())
        throw new Error("同步冲突标识无效");
      if (!isResolution(resolution)) throw new Error("同步冲突处理方式无效");
      return service.resolveConflict(conflictId, resolution);
    },
  );
  target.handle(IPC.CLOUD_CONNECTIONS_LIST, () => service.listConnections());
  target.handle(
    IPC.CLOUD_CONNECTIONS_UPDATE,
    (_event, id: unknown, input: unknown) =>
      service.updateConnection(requiredConnectionId(id), updateMcpConnectionSchema.parse(input)),
  );
  target.handle(IPC.CLOUD_CONNECTIONS_REVOKE, (_event, id: unknown) =>
    service.revokeConnection(requiredConnectionId(id)),
  );
}

function isResolution(value: unknown): value is CloudSyncConflictResolution {
  return value === "remote" || value === "local" || value === "duplicate";
}

function requiredConnectionId(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Cloud MCP 连接标识无效");
  return value.trim();
}
