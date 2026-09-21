import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';

const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
async function uploadOwned(page: Page) {
  const envelope = await page.evaluate(async (bytes) => {
    const bridge = (
      window as unknown as {
        musefoldV25: {
          invoke(
            method: string,
            input: unknown,
          ): Promise<{ ok: boolean; data?: { id: string; url: string }; error?: unknown }>;
        };
      }
    ).musefoldV25;
    return bridge.invoke('generation.uploadReferenceImage', {
      name: 'owned.png',
      bytes: new Uint8Array(bytes),
    });
  }, png);
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  if (!envelope.data) throw new Error('Missing uploaded reference');
  const path = new URL(envelope.data.url).searchParams.get('p');
  if (!path) throw new Error('Missing managed reference path');
  expect(readFileSync(path)).toEqual(Buffer.from(png));
  return { path, id: envelope.data.id };
}
async function upload(page: Page) {
  return (await uploadOwned(page)).path;
}

test('actual Electron windows own separate uploads and closing one window releases only its files', async () => {
  let app: ElectronApplication | undefined;
  let root = '';
  try {
    ({ app, userDataDir: root } = await launchV25App('musefold-upload-windows-'));
    const first = await v25ShellPage(app);
    const a = await upload(first);
    const pageReady = app.waitForEvent('window');
    const id = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const first = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('v25/shell'),
      );
      if (!first) throw new Error('Missing shell');
      const second = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await second.loadURL(first.webContents.getURL());
      return second.id;
    }, resolve('apps/desktop/out/preload/v25.cjs'));
    const second = await pageReady;
    await second.waitForLoadState('domcontentloaded');
    const b = await upload(second);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), id);
    await expect.poll(() => existsSync(b)).toBe(false);
    expect(readFileSync(a)).toEqual(Buffer.from(png));
    await app.close();
    app = undefined;
    expect(existsSync(a)).toBe(false);
  } finally {
    await app?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('actual shell reload releases the previous document uploads and accepts a new upload owner', async () => {
  const { app, userDataDir } = await launchV25App('musefold-upload-reload-');
  try {
    const page = await v25ShellPage(app);
    const before = await upload(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => existsSync(before)).toBe(false);
    const after = await upload(page);
    expect(after).not.toBe(before);
    expect(readFileSync(after)).toEqual(Buffer.from(png));
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

async function releaseReference(page: Page, input: unknown) {
  return page.evaluate(async (input) => {
    const bridge = (
      window as unknown as {
        musefoldV25: {
          invoke(method: string, input: unknown): Promise<{ ok: boolean; error?: unknown }>;
        };
      }
    ).musefoldV25;
    return bridge.invoke('generation.releaseReferenceImage', input);
  }, input);
}

test('actual reference release is sender-owned, strict and idempotent while both windows stay open', async () => {
  const { app, userDataDir } = await launchV25App('musefold-reference-release-');
  try {
    const first = await v25ShellPage(app);
    const a = await uploadOwned(first);
    const pageReady = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }, preload) => {
      const first = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('v25/shell'),
      );
      if (!first) throw new Error('Missing shell');
      const second = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await second.loadURL(first.webContents.getURL());
    }, resolve('apps/desktop/out/preload/v25.cjs'));
    const second = await pageReady;
    await second.waitForLoadState('domcontentloaded');
    const b = await uploadOwned(second);
    expect((await releaseReference(first, { id: b.id })).ok).toBe(true);
    expect(readFileSync(b.path)).toEqual(Buffer.from(png));
    expect((await releaseReference(first, { id: a.id, path: b.path })).ok).toBe(false);
    expect(readFileSync(a.path)).toEqual(Buffer.from(png));
    expect((await releaseReference(first, { id: a.id })).ok).toBe(true);
    await expect.poll(() => existsSync(a.path)).toBe(false);
    expect((await releaseReference(first, { id: a.id })).ok).toBe(true);
    expect(readFileSync(b.path)).toEqual(Buffer.from(png));
    expect((await releaseReference(second, { id: b.id })).ok).toBe(true);
    await expect.poll(() => existsSync(b.path)).toBe(false);
    expect(first.isClosed()).toBe(false);
    expect(second.isClosed()).toBe(false);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('actual Composer removal releases its uploaded file through the desktop gateway without closing the window', async () => {
  const { app, userDataDir } = await launchV25App('musefold-composer-release-');
  try {
    const page = await v25ShellPage(app);
    const baseline = await uploadOwned(page);
    const directory = dirname(baseline.path);
    const before = new Set(readdirSync(directory));
    await page.getByTestId('composer-file-input').setInputFiles({
      name: 'composer-owned.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png),
    });
    await expect(page.getByTestId('composer-reference')).toHaveAttribute('data-status', 'ready');
    const added = readdirSync(directory).filter((name) => !before.has(name));
    expect(added).toHaveLength(1);
    const uploaded = resolve(directory, added[0]!);
    expect(readFileSync(uploaded)).toEqual(Buffer.from(png));
    await page.getByRole('button', { name: '移除参考图 composer-owned.png' }).click();
    await expect(page.getByTestId('composer-reference')).toHaveCount(0);
    await expect.poll(() => existsSync(uploaded)).toBe(false);
    expect(readFileSync(baseline.path)).toEqual(Buffer.from(png));
    expect(page.isClosed()).toBe(false);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
