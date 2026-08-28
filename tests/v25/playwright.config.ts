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
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      // 视觉基线在本机(darwin)生成;CI 跨 OS 基线策略随 M5a 上线。
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
  ],
  webServer: {
    // standalone 输出不支持 next start;E2E 走 dev(devIndicators 已关,不入快照)。
    // M5a 切 CI 时改为 node .next/standalone 部署形态。
    command: 'pnpm --filter @musefold/web-next exec next dev -p 3399',
    url: 'http://127.0.0.1:3399/settings',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
