// src/preview/install-bridge.ts
// DEV-ONLY 预览桥（前端）——仅在浏览器预览下由 vite.preview.config.ts 注入，
// 绝不进入 electron 打包（生产走 preload contextBridge 暴露的真实 window.api）。
//
// 作用：把 window.api 装成一个 HTTP 客户端，转发到预览桥后端
// （preview/bridge-plugin.mjs 挂载的 POST /__preview_api__），从而让浏览器 UI
// 能跑通「新建服务商 → 保存密钥 → 测试连接 → 生成图片」全流程。
//
// 必须在任何读取 window.api 的模块（src/lib/ipc.ts）求值之前执行 —— 因此本文件
// 由 index.html <head> 首个 module 脚本加载，且在此顶层同步安装 window.api。

import type { Api } from '@musefold/desktop-contracts/ipc';

const ENDPOINT = '/__preview_api__';

// 与真实 preload 对齐：桥调用失败原样抛给调用方，不重复上报诊断弹窗；
// 预览环境没有主进程，onError 只注册空订阅。
async function invoke(channel: string, args: unknown[]): Promise<unknown> {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args }),
  });
  const payload = (await resp.json()) as
    | { ok: true; result: unknown }
    | { ok: false; error: { code: string; message: string } };
  if (payload.ok) return payload.result;
  // 抛出带 code 的错误，契合 store 里 (err as {code}).code 的读取方式
  const err = new Error(payload.error?.message ?? '预览桥调用失败');
  (err as Error & { code?: string }).code = payload.error?.code ?? 'BRIDGE_ERROR';
  throw err;
}

const diagnosticsApi: Api['diagnostics'] = {
  onError: () => () => undefined,
};

/** 为某个域构造代理：domain.method(...args) → invoke(`${domain}:${method}`, args) */
function domainProxy(domain: string) {
  return new Proxy(
    {},
    {
      get(_t, method: string) {
        return (...args: unknown[]) => invoke(`${domain}:${method}`, args);
      },
    },
  );
}

// window 域方法的签名特殊（同步 void / 返回取消订阅函数），单独给具体桩，
// 不能走通用 Promise 代理，否则标题栏按钮/订阅逻辑类型与行为都不对。
const windowApi: Api['window'] = {
  minimize: () => {},
  maximizeToggle: () => {},
  close: () => {},
  isMaximized: async () => false,
  platform: async () => 'darwin' as NodeJS.Platform,
  onMaximizeChange: () => () => {},
  onFullscreenChange: () => () => {},
};

const imageApi: Api['image'] = {
  pickLocal: () => invoke('image:pickLocal', []) as Promise<Awaited<ReturnType<Api['image']['pickLocal']>>>,
  stageLocal: (input) => invoke('image:stageLocal', [input]) as Promise<Awaited<ReturnType<Api['image']['stageLocal']>>>,
  generate: (req) => invoke('image:generate', [req]) as Promise<Awaited<ReturnType<Api['image']['generate']>>>,
  cancel: (jobId) => invoke('image:cancel', [jobId]) as Promise<Awaited<ReturnType<Api['image']['cancel']>>>,
  retry: (historyId, jobId) => invoke('image:retry', [historyId, jobId]) as Promise<Awaited<ReturnType<Api['image']['retry']>>>,
  onProgress: () => () => {},
};

const shareApi: Api['share'] = {
  renderCard: (req) => invoke('share:renderCard', [req]) as Promise<Awaited<ReturnType<Api['share']['renderCard']>>>,
  buildDeeplink: (req) => invoke('share:buildDeeplink', [req]) as Promise<Awaited<ReturnType<Api['share']['buildDeeplink']>>>,
  parseDeeplink: (req) => invoke('share:parseDeeplink', [req]) as Promise<Awaited<ReturnType<Api['share']['parseDeeplink']>>>,
  import: (req) => invoke('share:import', [req]) as Promise<Awaited<ReturnType<Api['share']['import']>>>,
  consumePending: () =>
    Promise.resolve({ payloads: [] }) as Promise<Awaited<ReturnType<Api['share']['consumePending']>>>,
  onIncoming: () => () => {},
};

const updaterApi: Api['updater'] = {
  getState: async () => ({ state: 'disabled', currentVersion: '0.5.0-dev', reason: 'development' }),
  check: async () => ({ state: 'disabled', currentVersion: '0.5.0-dev', reason: 'development' }),
  download: async () => ({ state: 'disabled', currentVersion: '0.5.0-dev', reason: 'development' }),
  install: async () => ({ state: 'disabled', currentVersion: '0.5.0-dev', reason: 'development' }),
  getChannel: async () => ({ channel: 'stable', lockedByEnv: false }),
  setChannel: async (channel) => ({ ok: true, channel, lockedByEnv: false }),
  onStateChanged: () => () => {},
  notifyContentReady: () => {},
  getContentState: async () => ({
    activeSource: 'builtin',
    activeBundleVersion: null,
    pendingVersion: null,
    knownGoodVersion: null,
    lastCheck: null,
  }),
  checkContentNow: async () => ({ status: 'trust_anchor_missing', at: Date.now() }),
};

// 顶层用 Proxy 兜底所有域：已知域走 domainProxy，window 域用具体桩。
const api = new Proxy({} as Api, {
  get(_t, domain: string) {
    if (domain === 'window') return windowApi;
    if (domain === 'diagnostics') return diagnosticsApi;
    if (domain === 'image') return imageApi;
    if (domain === 'share') return shareApi;
    if (domain === 'updater') return updaterApi;
    return domainProxy(domain);
  },
}) as Api;

// 同步安装到全局，供 src/lib/ipc.ts 读取。
(window as unknown as { api: Api }).api = api;

// 标记，便于在 console 里确认预览桥已安装。
(window as unknown as { __PREVIEW_BRIDGE__?: boolean }).__PREVIEW_BRIDGE__ = true;
// eslint-disable-next-line no-console
console.info('[preview-bridge] window.api installed (dev preview only)');

export {};
