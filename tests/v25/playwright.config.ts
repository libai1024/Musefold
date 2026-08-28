import { defineConfig, devices } from '@playwright/test';

/**
 * v2.5 双端 E2E(M3 起步,M5a 全量替代 Python 栈)。
 * 前置:`pnpm --filter @musefold/web-next build` 与 `pnpm run build`(桌面 out/)。
 * 根脚本 `pnpm run test:e2e:v25` 已串联。
 */
export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  fullyParallel: false,
  // 单 worker 串行:Electron 是真窗口(headed),多实例并行会互抢 macOS
  // 焦点,Radix 浮层(菜单/弹窗)一失焦即 dismiss,菜单类用例必然抖动。
  workers: 1,
  // 本机 0 次重试暴露问题;CI 重试 2 次过滤偶发渲染帧抖动(视觉快照高负载下偶发)。
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      // 视觉基线在 darwin 生成;CI 的 e2e job 跑 macos runner 直接复用同一套
      // 基线(M5a 定稿),不维护第二套 linux 基线。
      maxDiffPixelRatio: 0.02,
    },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  projects: [
    {
      name: 'web-desktop',
      testMatch: /web\..*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:3399',
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'web-mobile',
      testMatch: /web\..*\.spec\.ts/,
      use: {
        // iPhone 13 视口/UA,但统一 Chromium 内核:少装一套浏览器,快照跨机更稳。
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        browserName: 'chromium',
        baseURL: 'http://127.0.0.1:3399',
      },
    },
    {
      name: 'electron',
      testMatch: /electron\..*\.spec\.ts/,
    },
    {
      // 打包产物冒烟(M5-b):产物缺失时自动 skip,发布矩阵打包后必跑。
      name: 'package-smoke',
      testMatch: /package\.smoke\.spec\.ts/,
    },
  ],
  webServer: {
    // standalone 输出不支持 next start;E2E 走 dev(devIndicators 已关,不入快照)。
    // 本机与 CI 同用 dev server,与视觉基线渲染路径一致;standalone 部署形态
    // 的运行验证属发布链(M5b)。
    command: 'pnpm --filter @musefold/web-next exec next dev -p 3399',
    url: 'http://127.0.0.1:3399/settings',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
