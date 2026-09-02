// v2.5 preload:纯转发,不做任何业务逻辑(V25-ARCHITECTURE §5)。
// 单通道 invoke;校验与路由都在主进程 ipc-v25/gateway-bridge.ts。

import { contextBridge, ipcRenderer } from 'electron';

const v25Bridge = {
  invoke(method: string, payload?: unknown): Promise<unknown> {
    return ipcRenderer.invoke('musefold:invoke', method, payload);
  },
  prepareDesignSchemeImportPackage(payload: unknown): Promise<unknown> {
    return ipcRenderer.invoke('designSchemes:prepareImportPackage', payload);
  },
  onDesignSchemeEvent(callback: (payload: unknown) => void): () => void {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('designSchemes:event', listener);
    return () => ipcRenderer.removeListener('designSchemes:event', listener);
  },
  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void {
    const listener = (_event: unknown, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on('window:fullscreenChanged', listener);
    return () => ipcRenderer.removeListener('window:fullscreenChanged', listener);
  },
  isFullscreen(): Promise<boolean> {
    return ipcRenderer.invoke('window:isFullscreen') as Promise<boolean>;
  },
  // 窗口生命周期 chrome(Win/Linux 自绘控件,V25-UI-SPEC §2.3):
  // 动作用 send(主进程 ipcMain.on 无返回),查询/事件与 fullscreen 通道同构。
  minimize(): void {
    ipcRenderer.send('window:minimize');
  },
  maximizeToggle(): void {
    ipcRenderer.send('window:maximizeToggle');
  },
  close(): void {
    ipcRenderer.send('window:close');
  },
  isMaximized(): Promise<boolean> {
    return ipcRenderer.invoke('window:isMaximized') as Promise<boolean>;
  },
  onMaximizeChange(callback: (isMaximized: boolean) => void): () => void {
    const listener = (_event: unknown, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window:maximizeChanged', listener);
    return () => ipcRenderer.removeListener('window:maximizeChanged', listener);
  },
};

contextBridge.exposeInMainWorld('musefoldV25', v25Bridge);

export type MusefoldV25Bridge = typeof v25Bridge;
