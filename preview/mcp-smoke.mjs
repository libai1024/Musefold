// preview/mcp-smoke.mjs
// 一次性冒烟测试：直接用 MCP SDK 的 stdio client 连上 electron-driver，
// 完成握手 → 列出工具 → start_app 启动已构建的 Electron 应用 → 读一次标题 → stop_app。
// 仅用于验证工具链可用，不进入任何构建产物。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'path';

const MAIN = resolve('apps/desktop/out/main/index.js');

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['electron-driver'],
});
const client = new Client({ name: 'musefold-smoke', version: '1.0.0' }, { capabilities: {} });

const log = (...a) => console.log('[smoke]', ...a);

try {
  await client.connect(transport);
  log('connected ✓');

  const { tools } = await client.listTools();
  log(`tools exposed: ${tools.length}`);
  log('sample:', tools.slice(0, 8).map((t) => t.name).join(', '), '…');

  log('start_app →', MAIN);
  const started = await client.callTool({
    name: 'start_app',
    arguments: { main: MAIN, cwd: resolve('.'), timeoutMs: 30000 },
  });
  console.log('[smoke] start_app result:', JSON.stringify(started.content?.[0], null, 2));

  const info = await client.callTool({ name: 'info', arguments: {} });
  console.log('[smoke] info:', JSON.stringify(info.content?.[0], null, 2));

  await client.callTool({ name: 'stop_app', arguments: {} });
  log('stop_app ✓');
} catch (err) {
  console.error('[smoke] FAILED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  // electron-driver 是长驻 stdio server；关闭 client 后强制退出，避免挂起
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
