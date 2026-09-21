import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Playwright's automatic failure DOM snapshot includes password input values.
// Live credentials must never enter error-context.md or the HTML report archive.
if (process.env.MUSEFOLD_LIVE_E2E === '1' || process.env.MUSEFOLD_E2E_IMAGE_API_KEY) {
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
}

/**
 * v2.5 双端 E2E(M3 起步,M5a 全量替代 Python 栈)。
 * 前置:`pnpm --filter @musefold/web-next build` 与 `pnpm run build`(桌面 out/)。
 * 根脚本 `pnpm run test:e2e` 已串联。默认验证 standalone 生产产物。
 */
export default defineConfig({
  testDir: '.',
  outputDir: './.results/artifacts',
  fullyParallel: false,
  // 单 worker 串行:Electron 是真窗口(headed),多实例并行会互抢 macOS
  // 焦点,Radix 浮层(菜单/弹窗)一失焦即 dismiss,菜单类用例必然抖动。
  workers: 1,
  // 本机 0 次重试暴露问题;CI 重试 2 次过滤偶发渲染帧抖动(视觉快照高负载下偶发)。
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(import.meta.dirname, '.results/report.json') }],
    ['html', { outputFolder: resolve(import.meta.dirname, '.results/html'), open: 'never' }],
  ],
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
  ],
  webServer: {
    // 独立进程验证本次生产构建,端口被占用时失败,不能误连本地旧 dev server。
    command: 'node scripts/start-v25-web.mjs',
    cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:3399/settings',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
