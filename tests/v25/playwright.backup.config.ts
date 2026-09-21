import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Real user data never belongs in screenshots, traces, video, or failure DOM snapshots.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  ...base,
  webServer: undefined,
  retries: 0,
  projects: [{ name: 'package-real-backup', testMatch: /package\.real-backup\.spec\.ts/ }],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  outputDir: './.results/real-backup/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(import.meta.dirname, '.results/real-backup/report.json') }],
  ],
});
