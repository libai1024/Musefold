import { randomUUID } from 'node:crypto';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { emptyWorkspace, enable, invoke, localFacts } from './desktop-sync-helpers';
import { seedOnboardingCompleted } from './onboarding-helpers';
import { clickRowAction, createPrompt } from './prompt-helpers';
import { logoutLiveWeb, submitLiveLogin } from './live-account-helpers';

const username = process.env.MUSEFOLD_E2E_USERNAME ?? '';
const password = process.env.MUSEFOLD_E2E_PASSWORD ?? '';
test.skip(
  process.env.MUSEFOLD_LIVE_E2E !== '1' || !username || !password,
  'Requires explicit live-account opt-in; no generation or paid calls',
);

async function signIn(page: Page, desktop: boolean) {
  if (desktop) await page.getByTestId('nav-settings').click();
  else await page.goto('http://127.0.0.1:3399/settings');
  await page.getByTestId('settings-nav-account').click();
  await submitLiveLogin(page);
}

async function syncFromUi(page: Page) {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-nav-sync').click();
  // Startup already triggers a real sync; the status query polls every five seconds.
  // Match the existing first-sync deadline rather than racing one poll interval.
  await expect(page.getByTestId('sync-now')).toBeEnabled({ timeout: 15000 });
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('sync-now')).toBeEnabled({ timeout: 15000 });
  await expect(page.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
  await page.getByTestId('nav-prompts').click();
}

test('live account: PC Web → explicit desktop sync → mobile Web → new Electron PID → logout/relogin', async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const web = await context.newPage();
  await seedOnboardingCompleted(web);
  let app: ElectronApplication | undefined;
  let desktop: Page | undefined;
  let userData = '';
  const title = `Live sync ${randomUUID()}`;
  let created = false;
  let promptId = '';
  let primaryFailed = false;
  const stages: string[] = [];
  const stage = (value: string) => {
    stages.push(value);
    console.log(`Live sync stage: ${value}`);
  };
  const responses: Array<{ path: string; status: number }> = [];
  web.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/') && response.status() >= 400)
      responses.push({ path, status: response.status() });
  });
  try {
    await signIn(web, false);
    stage('web-login');
    await web.goto('http://127.0.0.1:3399/prompts');
    const creation = web.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/prompts',
    );
    await createPrompt(web, title, 'Synthetic verification content: created on PC Web');
    const createdResponse = await creation;
    expect(createdResponse.ok()).toBe(true);
    promptId = (await createdResponse.json()).id;
    expect(typeof promptId).toBe('string');
    created = true;
    ({ app, userDataDir: userData } = await launchV25App('musefold-live-sync-', {
      env: { MUSEFOLD_API_URL: 'http://127.0.0.1:8787' },
    }));
    desktop = await v25ShellPage(app);
    await signIn(desktop, true);
    stage('desktop-login');
    // Login is not consent. A fresh, empty local workspace must be explicitly selected.
    const before = localFacts(userData);
    expect(before.accounts.every((row) => row.consent === 'unset')).toBe(true);
    expect(before.prompts.some((row) => row.title === title)).toBe(false);
    await emptyWorkspace(desktop);
    await enable(desktop);
    await desktop.getByTestId('nav-prompts').click();
    await expect(desktop.getByText(title, { exact: true })).toBeVisible();
    await clickRowAction(desktop, title, 'prompt-row-edit');
    await desktop
      .getByTestId('prompt-editor-content')
      .fill('Synthetic verification: edited on macOS');
    await desktop.getByTestId('prompt-editor-submit').click();
    await expect(desktop.getByTestId('prompt-editor')).toBeHidden();
    await syncFromUi(desktop);
    stage('desktop-edit-synced');
    // Same real browser session, mobile viewport; no route/API/identity mocks.
    await web.setViewportSize({ width: 390, height: 844 });
    await web.reload();
    await clickRowAction(web, title, 'prompt-row-edit');
    await expect(web.getByTestId('prompt-editor-content')).toHaveValue(
      'Synthetic verification: edited on macOS',
    );
    await web
      .getByTestId('prompt-editor-content')
      .fill('Synthetic verification: edited on mobile Web');
    await web.getByTestId('prompt-editor-submit').click();
    await expect(web.getByTestId('prompt-editor')).toBeHidden();
    stage('mobile-edit-saved');
    const oldPid = app.process().pid;
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-live-sync-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: 'http://127.0.0.1:8787' },
    }));
    expect(app.process().pid).not.toBe(oldPid);
    desktop = await v25ShellPage(app);
    await syncFromUi(desktop);
    stage('restarted-desktop-synced');
    await desktop.getByTestId('nav-prompts').click();
    await clickRowAction(desktop, title, 'prompt-row-edit');
    await expect(desktop.getByTestId('prompt-editor-content')).toHaveValue(
      'Synthetic verification: edited on mobile Web',
    );
    await desktop.keyboard.press('Escape');
    const identityBeforeLogout = localFacts(userData).accounts.map(
      ({ ownerId, deviceId, consent }) => ({ ownerId, deviceId, consent }),
    );
    await desktop.getByTestId('nav-settings').click();
    await desktop.getByTestId('settings-nav-account').click();
    await desktop.getByTestId('account-logout').click();
    await desktop.getByTestId('account-logout-confirm').click();
    await expect(desktop.getByTestId('account-auth-form')).toBeVisible();
    expect(localFacts(userData).prompts.some((row) => row.title === title)).toBe(true);
    await logoutLiveWeb(web);
    stage('both-logged-out');
    await signIn(web, false);
    stage('web-relogin');
    await signIn(desktop, true);
    stage('desktop-relogin');
    await syncFromUi(desktop);
    expect(
      localFacts(userData).accounts.map(({ ownerId, deviceId, consent }) => ({
        ownerId,
        deviceId,
        consent,
      })),
    ).toEqual(identityBeforeLogout);
    await desktop.getByTestId('nav-prompts').click();
    await clickRowAction(desktop, title, 'prompt-row-edit');
    await expect(desktop.getByTestId('prompt-editor-content')).toHaveValue(
      'Synthetic verification: edited on mobile Web',
    );
    await desktop.keyboard.press('Escape');
    await web.goto('http://127.0.0.1:3399/prompts');
    const deletion = web.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /^\/api\/v1\/prompts\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await clickRowAction(web, title, 'prompt-row-remove');
    expect((await deletion).ok()).toBe(true);
    created = false;
    await syncFromUi(desktop);
    await expect(desktop.getByText(title, { exact: true })).toHaveCount(0);
    stage('deletion-synced');
    const final = localFacts(userData);
    expect(final.integrity).toBe('ok');
    expect(final.foreignKeys).toEqual([]);
    expect(final.outbox).toEqual([]);
    await info.attach('live-sync-summary', {
      contentType: 'application/json',
      body: JSON.stringify({
        oldPid,
        newPid: app.process().pid,
        directions: ['PC Web → macOS', 'macOS → mobile Web', 'mobile Web → restarted macOS'],
        explicitConsent: true,
        logoutReloginPreservesIdentityConsentAndContent: true,
        ownedPromptRemoved: true,
        integrity: final.integrity,
        paidCalls: 0,
      }),
    });
  } catch (error) {
    primaryFailed = true;
    await info.attach('live-sync-primary-failure', {
      contentType: 'application/json',
      body: JSON.stringify({ stages, responses, promptId }),
    });
    throw error;
  } finally {
    const cleanup: Array<{ action: string; status: number | string }> = [];
    try {
      // Never mask a primary failure by navigating a logged-out page for cleanup.
      // Only the exact prompt created by this test is eligible for deletion.
      if (created && promptId) {
        try {
          const response = await web.request.delete(
            `http://127.0.0.1:3399/api/v1/prompts/${encodeURIComponent(promptId)}`,
            { headers: { Origin: 'http://127.0.0.1:3399' }, timeout: 15000 },
          );
          cleanup.push({ action: 'owned-prompt', status: response.status() });
        } catch {
          cleanup.push({ action: 'owned-prompt', status: 'failed' });
        }
      }
      if (desktop && !desktop.isClosed()) {
        try {
          await invoke(desktop, 'account.logout');
          cleanup.push({ action: 'desktop-logout', status: 200 });
        } catch {
          cleanup.push({ action: 'desktop-logout', status: 'failed' });
        }
      }
      try {
        await logoutLiveWeb(web);
        cleanup.push({ action: 'web-logout', status: 200 });
      } catch {
        cleanup.push({ action: 'web-logout', status: 'failed' });
      }
    } finally {
      await app?.close();
      await context.close();
      await info.attach('live-sync-cleanup', {
        contentType: 'application/json',
        body: JSON.stringify({ cleanup, stages, promptId }),
      });
      if (!primaryFailed) expect(cleanup.every((item) => item.status === 200)).toBe(true);
    }
  }
});
