import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.MUSEFOLD_SITE_TEST_PORT ?? 4175);
const origin = `http://127.0.0.1:${port}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const websiteRoot = path.join(repoRoot, "website");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.mjs",
  outputDir: "../../../test-results/musefold-site",
  timeout: 20_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `${origin}/`,
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `python3 -m http.server ${port} --directory "${websiteRoot}"`,
    url: `${origin}/Musefold/index.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
