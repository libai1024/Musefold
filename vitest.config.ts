// vitest.config.ts
// 单测配置 —— 只为解析路径别名而存在。
//
// 别名指向只维护在 tooling/aliases.mjs；此处按需取名。
// apps/desktop/electron.vite.config.ts 里的 alias 只作用于 electron-vite 的三个构建目标，
// vitest 不读它。运行时取值的包名 import（如 @musefold/domain 的 RATIO_OPTIONS）
// 必须走这份 alias，否则 Cannot find package。

import { defineConfig } from 'vitest/config';
import { pickAliases } from './tooling/aliases.mjs';

export default defineConfig({
  resolve: {
    alias: pickAliases([
      '@renderer',
      '@electron',
      '@musefold/core',
      '@musefold/automation-server',
      '@musefold/client',
      '@musefold/update-protocol',
      '@musefold/desktop-contracts',
      '@musefold/domain',
      '@musefold/contracts',
      '@musefold/new-api-client',
    ]),
  },
  test: {
    // 渲染层、包内与全仓守卫单测；E2E 交给 tests/e2e 的 pytest + Playwright
    include: [
      // 根任务扫迁入后的桌面源码；各 workspace 包复用本配置时仍按包内 src/ 匹配。
      'apps/desktop/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.tsx',
      'apps/desktop/electron/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'electron/**/*.test.ts',
      'packages/**/*.test.ts',
      'tests/repo/**/*.test.ts',
    ],
  },
});
