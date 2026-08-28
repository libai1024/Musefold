import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@musefold/desktop-contracts/ipc';

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

vi.mock('electron', () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
}));

interface PetWindowApi {
  pet: {
    setEnabled(enabled: boolean): unknown;
    isEnabled(): unknown;
    getFrame(): unknown;
    ready(): void;
    onFrame(cb: (frame: unknown) => void): () => void;
    interact(interaction: unknown): void;
    moveBy(dx: number, dy: number): void;
    runToComposer(anchor: unknown): unknown;
    returnHome(): unknown;
    openMenu(): void;
  };
  updater: { notifyContentReady(): void };
}

async function loadPreloadApi(): Promise<PetWindowApi> {
  await import('../index');
  return electronMock.exposed.api as PetWindowApi;
}

describe('pet window preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of Object.keys(electronMock.exposed)) delete electronMock.exposed[key];
  });

  it('只暴露 pet 与 updater 两域(主窗口数据域一律走 v25 单通道桥)', async () => {
    const api = await loadPreloadApi();
    expect(electronMock.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('api', api);
    expect(Object.keys(api).sort()).toEqual(['pet', 'updater']);
    expect(api.updater).toEqual({ notifyContentReady: expect.any(Function) });
  });

  it('pet 域按契约通道转发 invoke/send', async () => {
    const api = await loadPreloadApi();

    api.pet.setEnabled(true);
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.PET_SET_ENABLED, true);

    api.pet.moveBy(3, -4);
    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith(IPC.PET_MOVE_BY, 3, -4);

    api.pet.ready();
    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith(IPC.PET_READY);
  });

  it('onFrame 返回的取消函数会移除监听', async () => {
    const api = await loadPreloadApi();
    const off = api.pet.onFrame(() => undefined);
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(IPC.PET_FRAME, expect.any(Function));
    off();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.PET_FRAME,
      expect.any(Function),
    );
  });

  it('updater.notifyContentReady 发送内容层信标', async () => {
    const api = await loadPreloadApi();
    api.updater.notifyContentReady();
    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith(IPC.UPDATER_CONTENT_READY);
  });
});
