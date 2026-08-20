// preview/mcp-verify-ipc.mjs
// 用 electron-driver 在【真实 Electron 运行时】验证 preload/IPC 修复：
//   - eval_renderer: window.api 及 provider 域是否真的注入（这正是之前崩溃点）
//   - eval_main: 主进程可达、preload 路径是否为 .cjs
// 证明浏览器预览无法覆盖的那一层现在是好的。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'path';

const MAIN = resolve('apps/desktop/out/main/index.js');
const transport = new StdioClientTransport({ command: 'npx', args: ['electron-driver'] });
const client = new Client({ name: 'musefold-ipc', version: '1.0.0' }, { capabilities: {} });
const parse = (r) => JSON.parse(r.content?.[0]?.text ?? '{}');

try {
  await client.connect(transport);
  await client.callTool({ name: 'start_app', arguments: { main: MAIN, cwd: resolve('.'), timeoutMs: 30000 } });

  // 1) 渲染进程：window.api 是否存在、provider 域方法是否可见
  const r = await client.callTool({
    name: 'eval_renderer',
    arguments: {
      js: `
        const api = window.api;
        return {
          hasApi: typeof api,
          isPreviewBridge: window.__PREVIEW_BRIDGE__ === true, // 真实 app 应为 false/undefined
          providerType: api ? typeof api.provider : null,
          providerListIsFn: api && api.provider ? typeof api.provider.list === 'function' : false,
          imageGenerateIsFn: api && api.image ? typeof api.image.generate === 'function' : false,
        };`,
    },
  });
  console.log('[ipc] renderer window.api →', JSON.stringify(parse(r), null, 2));

  // 2) 渲染进程：真的调用一次 provider.list（走真实 IPC → 主进程 → sqlite）
  const list = await client.callTool({
    name: 'eval_renderer',
    arguments: {
      js: `try { const l = await window.api.provider.list(); return { ok:true, count: Array.isArray(l)? l.length : 'not-array' }; }
           catch(e){ return { ok:false, err: e.message }; }`,
    },
  });
  console.log('[ipc] real provider.list() over IPC →', JSON.stringify(parse(list), null, 2));

  // 3) 主进程：确认可达 + preload 配置为 .cjs
  const m = await client.callTool({
    name: 'eval_main',
    arguments: {
      js: `
        const w = electron.BrowserWindow.getAllWindows()[0];
        const pre = w && w.webContents ? w.webContents.getLastWebPreferences?.() : null;
        return {
          appName: electron.app.getName(),
          electronRuntimeVersion: electron.app.getVersion(),
          windowCount: electron.BrowserWindow.getAllWindows().length,
          preloadPath: pre?.preload ?? '(unavailable)',
          sandbox: pre?.sandbox,
          contextIsolation: pre?.contextIsolation,
        };`,
    },
  });
  console.log('[ipc] main process →', JSON.stringify(parse(m), null, 2));

  await client.callTool({ name: 'stop_app', arguments: {} });
} catch (err) {
  console.error('[ipc] FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
