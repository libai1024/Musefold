import { ipcMain, type IpcMain } from "electron";
import { IPC } from "@musefold/desktop-contracts/ipc";
import type { CloudSyncConflictResolution } from "@musefold/desktop-contracts/cloud-sync";
import { updateMcpConnectionSchema } from "@musefold/contracts";
import { getCloudSyncService, type CloudSyncService } from "../../cloud-sync";
import { CloudSyncError } from "../../cloud-sync/errors";

interface CloudSyncIpcTarget {
  handle: IpcMain["handle"];
}

export interface CloudSyncHandlerDependencies {
  target?: CloudSyncIpcTarget;
  service?: CloudSyncService;
}

async function invokeCloudSync<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CloudSyncError) throw error.toIpcError();
    throw error;
  }
}

export function registerCloudSyncHandlers(
  dependencies: CloudSyncHandlerDependencies = {},
): void {
  const target = dependencies.target ?? ipcMain;
  const service = dependencies.service ?? getCloudSyncService();
  target.handle(IPC.CLOUD_SYNC_STATUS, () => service.status());
  target.handle(IPC.CLOUD_SYNC_SET_ENABLED, (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("同步开关参数无效");
    return invokeCloudSync(() => service.setEnabled(enabled));
  });
  target.handle(IPC.CLOUD_SYNC_NOW, () => invokeCloudSync(() => service.syncNow()));
  target.handle(IPC.CLOUD_SYNC_CONFLICTS, () =>
    invokeCloudSync(() => service.listConflicts()),
  );
  target.handle(
    IPC.CLOUD_SYNC_RESOLVE,
    (_event, conflictId: unknown, resolution: unknown) => {
      if (typeof conflictId !== "string" || !conflictId.trim())
        throw new Error("同步冲突标识无效");
      if (!isResolution(resolution)) throw new Error("同步冲突处理方式无效");
      return invokeCloudSync(() => service.resolveConflict(conflictId, resolution));
    },
  );
  target.handle(IPC.CLOUD_CONNECTIONS_LIST, () =>
    invokeCloudSync(() => service.listConnections()),
  );
  target.handle(
    IPC.CLOUD_CONNECTIONS_UPDATE,
    (_event, id: unknown, input: unknown) =>
      invokeCloudSync(() =>
        service.updateConnection(
          requiredConnectionId(id),
          updateMcpConnectionSchema.parse(input),
        ),
      ),
  );
  target.handle(IPC.CLOUD_CONNECTIONS_REVOKE, (_event, id: unknown) =>
    invokeCloudSync(() => service.revokeConnection(requiredConnectionId(id))),
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
