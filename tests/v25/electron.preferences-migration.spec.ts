import { readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';

const oldKeys = {
  'musefold:app-preferences': JSON.stringify({
    state: {
      themeSource: 'dark',
      reducedMotion: 'off',
      density: 'compact',
      defaultProviderId: 'do-not-migrate',
      schemePriorityMode: 'agent_mediated',
    },
    version: 1,
  }),
  'musefold:v0.3.0:workbench-preferences-v2': JSON.stringify({
    ratioId: '16:9',
    quality: 'high',
    n: 4,
    background: 'opaque',
  }),
  'musefold:v0.3.0:pinned-workbench-sessions': JSON.stringify(['legacy-pinned-session']),
  'musefold:account-notices-read': JSON.stringify(['n-oldnotice']),
  'musefold:onboarding': JSON.stringify({ state: { onboarded: true }, version: 1 }),
  'unrelated-private-key': 'synthetic-must-stay-in-old-storage',
};
const preferences = (directory: string) =>
  JSON.parse(readFileSync(join(directory, 'v25-preferences.json'), 'utf8'));

// Seed the exact old serialized storage shapes through actual Chromium, not by
// faking getPreferences or editing the LevelDB database. Only the test's own new
// JSON is removed to establish the pre-v2.5 upgrade condition.
for (const origin of ['app', 'file'] as const) {
  test(`old ${origin} origin preferences migrate before first UI and survive a new PID`, async () => {
    test.setTimeout(60_000);
    let app: ElectronApplication | undefined;
    const first = await launchV25App('musefold-old-preferences-', { onboarding: 'pending' });
    app = first.app;
    const directory = first.userDataDir;
    try {
      const page = await v25ShellPage(app);
      if (origin === 'app') {
        await page.evaluate((values) => {
          for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
        }, oldKeys);
      } else {
        await app.evaluate(
          async ({ BrowserWindow }, { values, url }) => {
            const window = new BrowserWindow({
              show: false,
              webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
            });
            try {
              await window.loadURL(url);
              await window.webContents.executeJavaScript(
                `for (const [key, value] of Object.entries(${JSON.stringify(values)})) localStorage.setItem(key, value)`,
              );
            } finally {
              window.destroy();
            }
          },
          {
            values: oldKeys,
            url: pathToFileURL(resolve('apps/desktop/out/renderer/storage-export.html')).href,
          },
        );
      }
      const oldPid = app.process().pid;
      await app.close();
      app = undefined;
      // The unfixed product may not have created a v2.5 file at all.
      try {
        unlinkSync(join(directory, 'v25-preferences.json'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      ({ app } = await launchV25App('unused-', {
        reuseUserDataDir: directory,
        onboarding: 'pending',
      }));
      expect(app.process().pid).not.toBe(oldPid);
      const migrated = await v25ShellPage(app);
      await expect(migrated.getByTestId('v25-shell')).toBeVisible();
      await expect(migrated.getByTestId('onboarding-flow')).toHaveCount(0);
      await expect(migrated.locator('html')).toHaveClass(/dark/);
      await expect(migrated.locator('html')).toHaveAttribute('data-density', 'compact');
      await expect(migrated.locator('html')).toHaveAttribute('data-motion', 'off');
      expect(preferences(directory)).toMatchObject({
        theme: 'dark',
        reducedMotion: 'off',
        density: 'compact',
        defaultAspectRatio: '16:9',
        defaultQuality: 'high',
        defaultCount: 4,
        pinnedSessionIds: ['legacy-pinned-session'],
        legacyAccountNoticeReadIds: ['n-oldnotice'],
      });
      expect(JSON.stringify(preferences(directory))).not.toContain('synthetic-must-stay');
      expect(JSON.stringify(preferences(directory))).not.toContain('defaultProviderId');
      await migrated.getByTestId('nav-settings').click();
      await migrated.getByTestId('settings-nav-appearance').click();
      await expect(migrated.getByTestId('settings-default-ratio-trigger')).toContainText('16:9');
      await expect(migrated.getByTestId('settings-default-quality-high')).toHaveAttribute(
        'data-state',
        'on',
      );
      await expect(migrated.getByTestId('settings-default-count-4')).toHaveAttribute(
        'data-state',
        'on',
      );
      await migrated.getByTestId('settings-theme-light').click();
      await expect.poll(() => preferences(directory).theme).toBe('light');
      await app.close();
      app = undefined;
      ({ app } = await launchV25App('unused-', {
        reuseUserDataDir: directory,
        onboarding: 'pending',
      }));
      const restarted = await v25ShellPage(app);
      await expect(restarted.locator('html')).not.toHaveClass(/dark/);
      expect(preferences(directory).theme).toBe('light');
      if (origin === 'app') {
        expect(
          await restarted.evaluate(() =>
            Object.fromEntries(
              Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
            ),
          ),
        ).toMatchObject(oldKeys);
      }
    } finally {
      await app?.close();
    }
  });
}
