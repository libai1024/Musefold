// src/lib/ipc.ts
// window.api 类型安全封装（透传 preload 暴露的 API）
// 详见 docs/07-ipc-contracts.md
//
// 正常运行（Electron 桌面 app）时 preload 通过 contextBridge 暴露 window.api。
// 两种情况 window.api 会缺失：
//   1) 纯浏览器 UI 预览（vite.preview.config.ts）——此时 dev-only 预览桥会先注入
//      一个 HTTP 版 window.api（见 src/preview/install-bridge.ts），所以这里能拿到。
//   2) 预加载脚本未加载（打包/路径/格式错误）——此时给出清晰报错，而不是
//      让 `undefined.provider` 抛出难以定位的 "Cannot read properties of undefined"。

import type { Api } from '@shared/types/ipc';

/** 缺桥时的兜底：任何 api.<域>.<方法>() 调用都抛出可定位的错误 */
function createMissingApiProxy(): Api {
  const message =
    'IPC 桥不可用：window.api 未注入。' +
    '若在桌面 app 中出现，通常是预加载脚本未加载（检查 apps/desktop/out/preload/index.cjs 与窗口 preload 路径）；' +
    '若在浏览器预览中出现，请通过 vite.preview.config.ts 启动（会注入预览桥）。';
  const domainProxy = new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error(message);
        };
      },
    }
  );
  return new Proxy({} as Api, {
    get() {
      return domainProxy;
    },
  });
}

export const api: Api =
  (typeof window !== 'undefined' && (window as { api?: Api }).api) || createMissingApiProxy();
export default api;
