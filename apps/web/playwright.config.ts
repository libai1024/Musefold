import { defineConfig } from "@playwright/test";

const testPort = Number(process.env.MUSEFOLD_WEB_TEST_PORT ?? 4175);
const testOrigin = `http://127.0.0.1:${testPort}`;
const onCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../test-results/web",
  // GitHub hosted runners are several times slower per core than a laptop;
  // CI-scaled budgets keep the same assertions without timing out mid-flow.
  timeout: onCi ? 60_000 : 20_000,
  expect: {
    timeout: onCi ? 15_000 : 8_000,
  },
  fullyParallel: false,
  workers: onCi ? 2 : undefined,
  forbidOnly: onCi,
  retries: onCi ? 2 : 0,
  reporter: onCi
    ? [
        ["list"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/web/report.json" }],
      ]
    : "list",
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
    timeout: 90_000,
  },
});
