// 运行时原生模块解析垫片(必须作为 main/index.ts 的第一个 import,先于所有业务 chunk 求值)。
//
// electron-builder 26 的 pnpm 依赖收集器在本仓 hoisted node_modules 布局上会静默丢弃
// 全部依赖(2026-09-25 实测:Windows 2.5.0 的 asar 中 node_modules 为空,启动即
// Cannot find module 'better-sqlite3')。extraResources 每次都会把带全平台 prebuilds 的
// better-sqlite3 复制到 resources/integration/node_modules,这里在打包态把对该包的
// require 解析重定向到该目录,使运行不再依赖收集器结果;开发态与 E2E 不改变行为。

import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type Module from 'node:module';

/** 包名 → 是否由本垫片重定向(extraResources 的 integration/node_modules 提供)。 */
const PACKAGED_REDIRECTS = new Set(['better-sqlite3']);

type ResolveFilename = (
  this: unknown,
  request: string,
  parent?: unknown,
  isMain?: boolean,
  options?: { paths?: string[] } | undefined,
) => string;

export function patchModuleResolution(
  moduleRef: Pick<typeof Module, '_resolveFilename'>,
  extraNodeModules: string,
): ResolveFilename | null {
  const target = moduleRef._resolveFilename as ResolveFilename;
  if (
    typeof target !== 'function' ||
    (target as { __musefoldNativeResolver?: boolean }).__musefoldNativeResolver
  ) {
    return null;
  }
  if (!existsSync(extraNodeModules)) return null;
  const patched: ResolveFilename = function (request, parent, isMain, options) {
    if (PACKAGED_REDIRECTS.has(request)) {
      return target.call(this, request, parent, isMain, {
        ...options,
        paths: [extraNodeModules, ...(options?.paths ?? [])],
      });
    }
    return target.call(this, request, parent, isMain, options);
  };
  (patched as { __musefoldNativeResolver?: boolean }).__musefoldNativeResolver = true;
  moduleRef._resolveFilename = patched as typeof Module._resolveFilename;
  return target;
}

if (app.isPackaged) {
  // 侧效安装:被 import 即生效,不依赖任何调用方在应用链之前显式调用。
  const nodeModule = require('node:module') as typeof Module;
  patchModuleResolution(nodeModule, join(process.resourcesPath, 'integration', 'node_modules'));
}
