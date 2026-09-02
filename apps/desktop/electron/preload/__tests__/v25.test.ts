import { beforeEach, describe, expect, it, vi } from 'vitest';

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

interface V25Api {
  invoke(method: string, payload?: unknown): Promise<unknown>;
  prepareDesignSchemeImportPackage(payload: unknown): Promise<unknown>;
  onDesignSchemeEvent(callback: (payload: unknown) => void): () => void;
  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
  isFullscreen(): Promise<boolean>;
  minimize(): void;
  maximizeToggle(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizeChange(callback: (isMaximized: boolean) => void): () => void;
}

async function loadPreloadApi(): Promise<V25Api> {
  await import('../v25');
  return electronMock.exposed.musefoldV25 as V25Api;
}

describe('v25 preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of Object.keys(electronMock.exposed)) delete electronMock.exposed[key];
  });

  it('exposes only musefoldV25 and forwards method plus payload unchanged', async () => {
    const api = await loadPreloadApi();
    const payload = { id: 'prompt-1', patch: { title: 'updated' } };
    electronMock.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true, data: 'passed-through' });

    await expect(api.invoke('prompts.update', payload)).resolves.toEqual({
      ok: true,
      data: 'passed-through',
    });
    expect(Object.keys(electronMock.exposed)).toEqual(['musefoldV25']);
    expect(electronMock.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('musefoldV25', api);
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'musefold:invoke',
      'prompts.update',
      payload,
    );
  });

  it('forwards package selection through the dedicated host channel', async () => {
    const api = await loadPreloadApi();
    const payload = { acceptedFormatVersions: [1, 2] };
    electronMock.ipcRenderer.invoke.mockResolvedValueOnce({
      ok: true,
      data: { status: 'cancelled' },
    });

    await expect(api.prepareDesignSchemeImportPackage(payload)).resolves.toEqual({
      ok: true,
      data: { status: 'cancelled' },
    });
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'designSchemes:prepareImportPackage',
      payload,
    );
    expect(electronMock.ipcRenderer.invoke).not.toHaveBeenCalledWith(
      'musefold:invoke',
      expect.anything(),
      payload,
    );
  });

  it('forwards design scheme events and unsubscribes with the exact listener identity', async () => {
    const api = await loadPreloadApi();
    const callback = vi.fn();

    const unsubscribe = api.onDesignSchemeEvent(callback);
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      'designSchemes:event',
      expect.any(Function),
    );
    const listener = electronMock.ipcRenderer.on.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown,
    ) => void;
    const payload = {
      kind: 'failed',
      executionId: 'exec_1',
      error: { code: 'FAILED', message: 'failed' },
    };
    listener({ sender: 'ignored-by-preload' }, payload);
    expect(callback).toHaveBeenCalledWith(payload);

    unsubscribe();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'designSchemes:event',
      listener,
    );
    expect(electronMock.ipcRenderer.removeListener.mock.calls[0]?.[1]).toBe(listener);
  });

  it('forwards fullscreen changes and unsubscribes with the same listener', async () => {
    const api = await loadPreloadApi();
    const callback = vi.fn();

    const unsubscribe = api.onFullscreenChange(callback);
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      'window:fullscreenChanged',
      expect.any(Function),
    );

    const listener = electronMock.ipcRenderer.on.mock.calls[0]?.[1] as (
      event: unknown,
      isFullscreen: boolean,
    ) => void;
    listener({ sender: 'ignored-by-preload' }, true);
    expect(callback).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'window:fullscreenChanged',
      listener,
    );
  });

  it('forwards the initial fullscreen query to the window IPC handler', async () => {
    const api = await loadPreloadApi();
    electronMock.ipcRenderer.invoke.mockResolvedValueOnce(true);

    await expect(api.isFullscreen()).resolves.toBe(true);
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('window:isFullscreen');
  });

  it('sends window chrome actions as fire-and-forget on the dedicated channels', async () => {
    const api = await loadPreloadApi();

    api.minimize();
    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('window:minimize');

    api.maximizeToggle();
    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('window:maximizeToggle');

    api.close();
    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith('window:close');
    // 动作通道不占用 invoke(主进程侧为 ipcMain.on,无返回值语义)。
    expect(electronMock.ipcRenderer.invoke).not.toHaveBeenCalledWith(
      'window:minimize',
      expect.anything(),
    );
  });

  it('forwards the maximize state query to the window IPC handler', async () => {
    const api = await loadPreloadApi();
    electronMock.ipcRenderer.invoke.mockResolvedValueOnce(false);

    await expect(api.isMaximized()).resolves.toBe(false);
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('window:isMaximized');
  });

  it('forwards maximize changes and unsubscribes with the exact listener identity', async () => {
    const api = await loadPreloadApi();
    const callback = vi.fn();

    const unsubscribe = api.onMaximizeChange(callback);
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      'window:maximizeChanged',
      expect.any(Function),
    );

    const listener = electronMock.ipcRenderer.on.mock.calls[0]?.[1] as (
      event: unknown,
      isMaximized: boolean,
    ) => void;
    listener({ sender: 'ignored-by-preload' }, true);
    expect(callback).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'window:maximizeChanged',
      listener,
    );
    expect(electronMock.ipcRenderer.removeListener.mock.calls[0]?.[1]).toBe(listener);
  });

  it('forwards an explicit undefined payload without adding business behavior', async () => {
    const api = await loadPreloadApi();
    electronMock.ipcRenderer.invoke.mockResolvedValueOnce(undefined);

    await expect(api.invoke('generation.listProviders', undefined)).resolves.toBeUndefined();
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      'musefold:invoke',
      'generation.listProviders',
      undefined,
    );
  });
});
