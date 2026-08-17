#!/usr/bin/env node
// 构建 musefold CLI 单文件产物（V04-CLI-SPEC §5）：
// esbuild（vite 自带依赖）→ packages/cli/dist/musefold.mjs，ESM + shebang。

import { build } from 'esbuild';
import { chmodSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  alias: {
    '@musefold/client': resolve(root, 'packages/client/src'),
    '@musefold/core': resolve(root, 'packages/core/src'),
    '@musefold/automation-server': resolve(root, 'packages/automation-server/src'),
    '@shared': resolve(root, 'shared'),
  },
  external: ['better-sqlite3'],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = globalThis.require ?? createRequire(import.meta.url);',
  },
  logLevel: 'warning',
};

const cliDist = resolve(root, 'packages/cli/dist');
rmSync(cliDist, { recursive: true, force: true });
await build({
  ...shared,
  entryPoints: [resolve(root, 'packages/cli/src/bin.ts')],
  outdir: cliDist,
  entryNames: 'musefold',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  splitting: true,
});
chmodSync(resolve(root, 'packages/cli/dist/musefold.mjs'), 0o755);
console.log('built packages/cli/dist/musefold.mjs and lazy runtime chunks');

// MCP：SDK + zod 一并打包成单文件（ESM 里 CJS 依赖需要 createRequire 垫片）
await build({
  ...shared,
  entryPoints: [resolve(root, 'packages/mcp/src/bin.ts')],
  outfile: resolve(root, 'packages/mcp/dist/musefold-mcp.mjs'),
});
chmodSync(resolve(root, 'packages/mcp/dist/musefold-mcp.mjs'), 0o755);
console.log('built packages/mcp/dist/musefold-mcp.mjs');
