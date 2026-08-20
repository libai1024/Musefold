// vitest.config.ts
// 单测配置 —— 只为解析路径别名而存在。
//
// apps/desktop/electron.vite.config.ts 里的 alias 只作用于 electron-vite 的三个构建目标，
// vitest 不读它。之前几个 spec 侥幸能跑，是因为它们只 `import type` @shared/*
// （类型在编译期被抹掉，运行时不需要解析）；一旦有模块从 @shared 取**值**
// （如 params.ts 的 RATIO_OPTIONS），没有这份 alias 就会 Cannot find package。

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@renderer': resolve(__dirname, 'apps/desktop/src'),
      '@electron': resolve(__dirname, 'apps/desktop/electron'),
      '@musefold/core': resolve(__dirname, 'packages/core/src'),
      '@musefold/automation-server': resolve(__dirname, 'packages/automation-server/src'),
      '@musefold/client': resolve(__dirname, 'packages/client/src'),
      '@musefold/update-protocol': resolve(__dirname, 'packages/update-protocol/src'),
    },
  },
  test: {
    // 渲染层与 shared 的纯逻辑单测；E2E 交给 tests/e2e 的 pytest + Playwright
    include: [
      // 根任务扫迁入后的桌面源码；各 workspace 包复用本配置时仍按包内 src/ 匹配。
      'apps/desktop/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.tsx',
      'apps/desktop/electron/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'shared/**/*.test.ts',
      'electron/**/*.test.ts',
      'packages/**/*.test.ts',
    ],
  },
});
