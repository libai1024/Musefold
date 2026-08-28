// v2.5 preload:纯转发,不做任何业务逻辑(V25-ARCHITECTURE §5)。
// 单通道 invoke;校验与路由都在主进程 ipc-v25/gateway-bridge.ts。

import { contextBridge, ipcRenderer } from 'electron';

const v25Bridge = {
  invoke(method: string, payload?: unknown): Promise<unknown> {
    return ipcRenderer.invoke('musefold:invoke', method, payload);
  },
};

contextBridge.exposeInMainWorld('musefoldV25', v25Bridge);

export type MusefoldV25Bridge = typeof v25Bridge;
