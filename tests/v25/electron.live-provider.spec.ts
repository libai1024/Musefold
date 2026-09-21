import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { validateLiveVerification } from '../../scripts/v25-live-verification.mjs';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

// Exactly one explicitly authorized image. Never repeat a potentially paid request on failure.
test.describe.configure({ retries: 0, timeout: 420_000 });
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const enabled = process.env.MUSEFOLD_LIVE_GENERATION === '1';
test.skip(!enabled, '真实生图需单独设置 MUSEFOLD_LIVE_GENERATION=1');

async function expectImage(page: Page): Promise<void> {
  const image = page.getByTestId('job-asset').locator('img').first();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
    .toBe(true);
}

function inspectRun(userDataDir: string) {
  const db = new Database(desktopDbPath(userDataDir), { readonly: true });
  try {
    const runs = db.prepare('SELECT id, status FROM generation_runs').all() as {
      id: string;
      status: string;
    }[];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    const assets = db
      .prepare('SELECT status, media_path FROM generated_assets WHERE run_id = ?')
      .all(runs[0].id) as { status: string; media_path: string }[];
    expect(assets).toHaveLength(1);
    expect(assets[0].status).toBe('available');
    const bytes = readFileSync(assets[0].media_path);
    expect(bytes.length).toBeGreaterThan(1024);
    return {
      runId: runs[0].id,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    db.close();
  }
}

function assertNoPlaintextKey(root: string, key: string): number {
  let files = 0;
  for (const name of readdirSync(root)) {
    const file = join(root, name);
    const stat = lstatSync(file);
    if (stat.isDirectory()) files += assertNoPlaintextKey(file, key);
    else if (stat.isFile()) {
      files++;
      // Assert only the boolean: a failing matcher must not print the file's bytes or key.
      expect(
        readFileSync(file).includes(Buffer.from(key)),
        'plaintext key in private userData',
      ).toBe(false);
    }
  }
  return files;
}

test('真实中转站：连接 → 单张生图 → 图片读取 → 新进程保留', async ({
  browserName: _browserName,
}, testInfo) => {
  validateLiveVerification(process.env);
  const key = process.env.MUSEFOLD_E2E_IMAGE_API_KEY ?? '';
  const baseUrl = process.env.MUSEFOLD_E2E_IMAGE_BASE_URL ?? '';
  const model = process.env.MUSEFOLD_E2E_IMAGE_MODEL ?? '';
  let app: ElectronApplication | undefined;
  let userDataDir = '';
  try {
    ({ app, userDataDir } = await launchV25App('musefold-v25-live-provider-'));
    let page = await v25ShellPage(app);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-connections').click();
    await page.getByTestId('ai-provider-new').click();
    await page.getByTestId('ai-provider-name').fill('Live verification relay');
    await page.getByTestId('ai-provider-base-url').fill(baseUrl);
    await page.getByTestId('ai-provider-model').fill(model);
    await page.getByTestId('ai-provider-key').fill(key);
    await page.getByTestId('ai-provider-save').click();
    const row = page
      .getByTestId('ai-providers-list')
      .getByRole('listitem')
      .filter({ hasText: 'Live verification relay' });
    await expect(row).toBeVisible();
    expect((await row.textContent())?.includes(key)).toBe(false);
    await row.getByTestId('ai-provider-test').click();
    await expect(row.getByTestId('ai-provider-test-result')).toContainText('连接正常', {
      timeout: 20_000,
    });

    await page.getByTestId('nav-workbench').click();
    await page
      .getByTestId('composer-prompt')
      .fill('A single red ceramic cup on a plain cream background, soft studio light, no text.');
    await page.getByTestId('composer-settings').click();
    await page.getByTestId('composer-count-1').click();
    await page.getByTestId('composer-quality-low').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('composer-submit').click();
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
      timeout: 300_000,
    });
    await expectImage(page);
    const before = inspectRun(userDataDir);
    const firstPid = app.process().pid;
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-v25-live-provider-', userDataDir));
    expect(app.process().pid).not.toBe(firstPid);
    page = await v25ShellPage(app);
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded');
    await expectImage(page);
    expect(inspectRun(userDataDir)).toEqual(before);
    await page.getByTestId('workbench').screenshot({ path: testInfo.outputPath('real-image.png') });
    await app.close();
    app = undefined;
    const scannedFiles = assertNoPlaintextKey(userDataDir, key);
    await testInfo.attach('live-generation-evidence', {
      body: JSON.stringify({
        model,
        origin: new URL(baseUrl).origin,
        images: 1,
        ...before,
        restarted: true,
        scannedFiles,
      }),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    if (userDataDir) assertNoPlaintextKey(userDataDir, key);
  }
});
