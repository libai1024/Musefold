import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC, type Api } from "@shared/types/ipc";

const electronMock = vi.hoisted(() => {
  const exposed: Record<string, unknown> = {};
  const ipcRenderer = {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const contextBridge = {
    exposeInMainWorld: vi.fn((name: string, value: unknown) => {
      exposed[name] = value;
    }),
  };
  return { exposed, ipcRenderer, contextBridge };
});

vi.mock("electron", () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
}));

async function loadPreloadApi(): Promise<Api> {
  await import("../index");
  return electronMock.exposed.api as Api;
}

function clearExposedApi(): void {
  for (const key of Object.keys(electronMock.exposed))
    delete electronMock.exposed[key];
}

describe("electron preload api bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    clearExposedApi();
  });

  it("exposes design scheme, Skill runtime, image and system APIs through contextBridge", async () => {
    electronMock.ipcRenderer.invoke.mockResolvedValue({
      ok: true,
      data: { ok: true },
    });
    const api = await loadPreloadApi();

    expect(electronMock.contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      "api",
      api,
    );
    expect(typeof api.designScheme.startCreation).toBe("function");
    expect(typeof api.designScheme.startRun).toBe("function");
    expect(typeof api.skillRuntime.prepareGithub).toBe("function");
    expect(typeof api.skillRuntime.execute).toBe("function");
    expect(typeof api.image.pickLocal).toBe("function");
    expect(typeof api.image.stageLocal).toBe("function");
    expect(typeof api.system.readClipboardText).toBe("function");
    expect(typeof api.cloudSync.syncNow).toBe("function");
    expect(typeof api.cloudConnections.list).toBe("function");
    expect(typeof api.cloudConnections.update).toBe("function");
    expect(typeof api.cloudConnections.revoke).toBe("function");

    await api.skillRuntime.cancel("skill-op-1");
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC.SKILL_RUNTIME_CANCEL,
      "skill-op-1",
    );
    await api.image.pickLocal();
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC.IMAGE_PICK_LOCAL,
    );
    const staged = {
      bytes: Uint8Array.from([1, 2, 3]),
      name: "pasted.png",
      mimeType: "image/png",
    };
    await api.image.stageLocal(staged);
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC.IMAGE_STAGE_LOCAL,
      staged,
    );
    await api.system.readClipboardText();
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC.SYSTEM_READ_CLIPBOARD_TEXT,
    );
    await api.cloudSync.setEnabled(true);
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC.CLOUD_SYNC_SET_ENABLED,
      true,
    );
    const connectionPatch = {
      mode: "ask_each_time" as const,
      maxPointsPerGeneration: 80,
    };
    await api.cloudConnections.update("grant-1", connectionPatch);
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC.CLOUD_CONNECTIONS_UPDATE,
      "grant-1",
      connectionPatch,
    );
    await api.cloudConnections.revoke("grant-1");
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC.CLOUD_CONNECTIONS_REVOKE,
      "grant-1",
    );
  });

  it("returns cleanup functions for all event subscriptions", async () => {
    const api = await loadPreloadApi();

    const skillCb = vi.fn();
    const stopSkill = api.skillRuntime.onEvent(skillCb);
    const skillListener = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === IPC.SKILL_RUNTIME_EVENT,
    )?.[1] as (event: unknown, payload: unknown) => void;
    const skillEvent = {
      executionId: "skill-op-1",
      kind: "state",
      state: "preparing",
    };
    skillListener({}, skillEvent);
    expect(skillCb).toHaveBeenCalledWith(skillEvent);
    stopSkill();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.SKILL_RUNTIME_EVENT,
      skillListener,
    );

    const imageCb = vi.fn();
    const stopImage = api.image.onProgress(imageCb);
    const imageListener = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === IPC.IMAGE_PROGRESS,
    )?.[1] as (event: unknown, payload: unknown) => void;
    stopImage();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.IMAGE_PROGRESS,
      imageListener,
    );

    const shareCb = vi.fn();
    const stopShare = api.share.onIncoming(shareCb);
    const shareListener = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === IPC.SHARE_INCOMING,
    )?.[1] as (event: unknown, payload: unknown) => void;
    stopShare();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.SHARE_INCOMING,
      shareListener,
    );

    const stopMaximize = api.window.onMaximizeChange(vi.fn());
    const maximizeListener = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === "window:maximizeChanged",
    )?.[1] as (event: unknown, payload: unknown) => void;
    stopMaximize();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      "window:maximizeChanged",
      maximizeListener,
    );

    const stopFullscreen = api.window.onFullscreenChange(vi.fn());
    const fullscreenListener = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === "window:fullscreenChanged",
    )?.[1] as (event: unknown, payload: unknown) => void;
    stopFullscreen();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      "window:fullscreenChanged",
      fullscreenListener,
    );

    const stopCloudSync = api.cloudSync.onChanged(vi.fn());
    const cloudSyncListener = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === IPC.CLOUD_SYNC_CHANGED,
    )?.[1] as (event: unknown, payload: unknown) => void;
    stopCloudSync();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.CLOUD_SYNC_CHANGED,
      cloudSyncListener,
    );
  });

  it("propagates IPC rejections to callers without opening a global diagnostic", async () => {
    // 已处理的 IPC 失败由调用方呈现（toast/行内），不得再触发全局错误弹窗；
    // 真正未处理的拒绝由 window unhandledrejection 兜底。
    const failure = new Error("provider connection failed");
    electronMock.ipcRenderer.invoke.mockRejectedValueOnce(failure);
    const api = await loadPreloadApi();
    const onError = vi.fn();
    const stop = api.diagnostics.onError(onError);

    await expect(api.provider.validate("provider-1")).rejects.toBe(failure);
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it("delivers main-process diagnostics pushed over the dedicated channel", async () => {
    const api = await loadPreloadApi();
    const onError = vi.fn();
    const stop = api.diagnostics.onError(onError);

    const listener = electronMock.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === IPC.DIAGNOSTICS_ERROR,
    )?.[1] as (event: unknown, report: unknown) => void;
    expect(listener).toBeTypeOf("function");
    const report = {
      id: "diag-1",
      process: "main",
      source: "main-process",
      error: { message: "boom" },
    };
    listener({}, report);
    expect(onError).toHaveBeenCalledWith(report);

    stop();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.DIAGNOSTICS_ERROR,
      listener,
    );
  });
});
