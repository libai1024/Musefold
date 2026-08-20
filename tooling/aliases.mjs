// 运行时路径别名的单一来源（electron-vite / vitest / vite.preview / esbuild）。
//
// tsconfig 的 compilerOptions.paths 无法从 JS 导入，因此 tooling/tsconfig.base.json
// 仍须声明式维护一份 paths。本表与那份 paths 必须同步——
// tests/repo/alias-consistency.test.ts 会比对指向。
//
// 分组：
//   SHARED  — 全仓 workspace 包别名
//   DESKTOP — 仅桌面内部（@renderer / @electron）。架构文档里的 @main 尚未落地，
//             现网别名是 @electron，本卡不改名。

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLING_DIR = dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（tooling/ 的上一级）。 */
export const REPO_ROOT = resolve(TOOLING_DIR, '..');

/** 桌面内部别名，相对仓库根。 */
export const DESKTOP_ALIAS_RELATIVE = Object.freeze({
  '@renderer': 'apps/desktop/src',
  '@electron': 'apps/desktop/electron',
});

/** 全仓共享别名，相对仓库根。 */
export const SHARED_ALIAS_RELATIVE = Object.freeze({
  '@musefold/core': 'packages/core/src',
  '@musefold/automation-server': 'packages/automation-server/src',
  '@musefold/client': 'packages/client/src',
  '@musefold/cli': 'packages/cli/src',
  '@musefold/mcp': 'packages/mcp/src',
  '@musefold/contracts': 'packages/contracts/src',
  '@musefold/desktop-contracts': 'packages/desktop-contracts/src',
  '@musefold/domain': 'packages/domain/src',
  '@musefold/ui': 'packages/ui/src',
  '@musefold/product-ui': 'packages/product-ui/src',
  '@musefold/cloud-client': 'packages/cloud-client/src',
  '@musefold/new-api-client': 'packages/new-api-client/src',
  '@musefold/server-crypto': 'packages/server-crypto/src',
  '@musefold/update-protocol': 'packages/update-protocol/src',
});

/** 全量别名表（定义只在这一处）。 */
export const ALIAS_RELATIVE = Object.freeze({
  ...SHARED_ALIAS_RELATIVE,
  ...DESKTOP_ALIAS_RELATIVE,
});

/**
 * 按需取出绝对路径别名，供 vite / vitest / esbuild 的 `resolve.alias` 使用。
 * 消费方只列名字、不写指向；未知名字直接抛错，避免静默漂移。
 *
 * @param {readonly string[]} names
 * @param {string} [root]
 * @returns {Record<string, string>}
 */
export function pickAliases(names, root = REPO_ROOT) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of names) {
    const rel = ALIAS_RELATIVE[/** @type {keyof typeof ALIAS_RELATIVE} */ (name)];
    if (!rel) {
      throw new Error(`未知别名 ${name}，请加入 tooling/aliases.mjs`);
    }
    out[name] = resolve(root, rel);
  }
  return out;
}
