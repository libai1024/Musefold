import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { validateLiveVerification } from '../../scripts/v25-live-verification.mjs';
import base from './playwright.config';

const { generation } = validateLiveVerification(process.env);
const results = resolve(import.meta.dirname, '.results/live');

export default defineConfig({
  ...base,
  retries: 0,
  outputDir: resolve(results, 'artifacts'),
  // Never collect password/key inputs, network credentials or videos in live reports.
  use: { trace: 'off', video: 'off', screenshot: 'off' },
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(results, 'report.json') }],
    ['html', { outputFolder: resolve(results, 'html'), open: 'never' }],
  ],
  projects: base.projects?.map((project) => ({
    ...project,
    testMatch:
      project.name === 'electron'
        ? generation
          ? /electron\.live-(account|provider|sync)\.spec\.ts/
          : /electron\.live-(account|sync)\.spec\.ts/
        : /web\.live-(account|journey)\.spec\.ts/,
  })),
});
