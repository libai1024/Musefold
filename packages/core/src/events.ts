// 事件集线器：一个 EventSink 入口、多个订阅者出口。
// Electron 宿主用它同时喂 webContents 推送与控制面 SSE（V04-API-02）；
// headless 守护只喂 SSE。core 内部只面向 EventSink 发事件，不感知订阅者。

import type { CoreEvent, EventSink } from './ports';

export type CoreEventListener = (event: CoreEvent) => void;

export interface EventHub {
  sink: EventSink;
  /** 返回退订函数。监听器抛错不会中断其他订阅者。 */
  subscribe(listener: CoreEventListener): () => void;
}

export function createEventHub(): EventHub {
  const listeners = new Set<CoreEventListener>();
  return {
    sink: {
      emit(event) {
        for (const listener of [...listeners]) {
          try {
            listener(event);
          } catch {
            // 单个订阅者的异常不能影响事件分发（如 SSE 连接半关闭时）
          }
        }
      },
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
