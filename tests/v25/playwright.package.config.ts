import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Explicit package verification is fail-closed and never needs a Web dev/runtime server.
process.env.MUSEFOLD_PACKAGE_REQUIRED = '1';
export default defineConfig({
  ...base,
  webServer: undefined,
  projects: [{ name: 'package-smoke', testMatch: /package\.smoke\.spec\.ts/ }],
  outputDir: './.results/package/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(import.meta.dirname, '.results/package/report.json') }],
    [
      'html',
      { outputFolder: resolve(import.meta.dirname, '.results/package/html'), open: 'never' },
    ],
  ],
});
