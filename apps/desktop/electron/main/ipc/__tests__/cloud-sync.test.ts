import { describe, expect, it, vi } from "vitest";
import { IPC } from "@shared/types/ipc";

vi.mock("../../../cloud-sync", () => ({
  getCloudSyncService: () => {
    throw new Error("测试必须注入 service");
  },
}));

import { registerCloudSyncHandlers } from "../cloud-sync";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness() {
  const handlers = new Map<string, Handler>();
  const summary = {
    available: true,
    unavailableReason: null,
    status: "idle" as const,
    account: {
      ownerId: "7",
      username: "libai",
      deviceName: "test",
      enabled: true,
      lastSyncAt: null,
      lastError: null,
    },
    pendingMutations: 0,
    conflicts: 0,
  };
  const service = {
    status: vi.fn(() => summary),
    setEnabled: vi.fn(async () => summary),
    syncNow: vi.fn(async () => summary),
    listConflicts: vi.fn(() => []),
    resolveConflict: vi.fn(async () => summary),
    listConnections: vi.fn(async () => ({ items: [] })),
    updateConnection: vi.fn(async () => ({ items: [] })),
    revokeConnection: vi.fn(async () => undefined),
  };
  registerCloudSyncHandlers({
    target: {
      handle: ((channel: string, listener: Handler) => {
        handlers.set(channel, listener);
      }) as never,
    },
    service: service as never,
  });
  return { handlers, service };
}

describe("cloud sync IPC handlers", () => {
  it("registers the complete sync surface", () => {
    const { handlers } = harness();
    expect([...handlers.keys()].sort()).toEqual(
      [
        IPC.CLOUD_SYNC_STATUS,
        IPC.CLOUD_SYNC_SET_ENABLED,
        IPC.CLOUD_SYNC_NOW,
        IPC.CLOUD_SYNC_CONFLICTS,
        IPC.CLOUD_SYNC_RESOLVE,
        IPC.CLOUD_CONNECTIONS_LIST,
        IPC.CLOUD_CONNECTIONS_UPDATE,
        IPC.CLOUD_CONNECTIONS_REVOKE,
      ].sort(),
    );
  });

  it("validates switches and conflict resolutions", async () => {
    const { handlers, service } = harness();
    await handlers.get(IPC.CLOUD_SYNC_SET_ENABLED)?.({}, true);
    expect(service.setEnabled).toHaveBeenCalledWith(true);
    await handlers.get(IPC.CLOUD_SYNC_RESOLVE)?.({}, "conflict-1", "local");
    expect(service.resolveConflict).toHaveBeenCalledWith("conflict-1", "local");

    expect(() => handlers.get(IPC.CLOUD_SYNC_SET_ENABLED)?.({}, "yes")).toThrow(
      "同步开关参数无效",
    );
    expect(() =>
      handlers.get(IPC.CLOUD_SYNC_RESOLVE)?.({}, "conflict-1", "merge"),
    ).toThrow("同步冲突处理方式无效");
  });

  it("validates and forwards Cloud MCP connection policy requests", async () => {
    const { handlers, service } = harness();
    await handlers.get(IPC.CLOUD_CONNECTIONS_LIST)?.({});
    expect(service.listConnections).toHaveBeenCalledOnce();

    const patch = {
      mode: "auto_with_limits",
      maxPointsPerGeneration: 80,
      maxPointsPerDay: 500,
      reauthPassword: "current-password",
    };
    await handlers.get(IPC.CLOUD_CONNECTIONS_UPDATE)?.({}, " grant-1 ", patch);
    expect(service.updateConnection).toHaveBeenCalledWith("grant-1", patch);

    await handlers.get(IPC.CLOUD_CONNECTIONS_REVOKE)?.({}, "grant-1");
    expect(service.revokeConnection).toHaveBeenCalledWith("grant-1");

    expect(() =>
      handlers.get(IPC.CLOUD_CONNECTIONS_UPDATE)?.({}, "", patch),
    ).toThrow("Cloud MCP 连接标识无效");
    expect(() =>
      handlers
        .get(IPC.CLOUD_CONNECTIONS_UPDATE)
        ?.({}, "grant-1", { maxPointsPerDay: -1 }),
    ).toThrow();
  });
});
