import { defineConfig } from "@playwright/test";

const testPort = Number(process.env.MUSEFOLD_WEB_TEST_PORT ?? 4175);
const testOrigin = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../test-results/web",
  timeout: 20_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `${testOrigin}/Musefold/app/`,
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev:fixtures -- --port ${testPort}`,
    url: `${testOrigin}/Musefold/app/`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
