import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { prepareDesignSchemeImportPackageResultSchema } from '@musefold/contracts';
import { packageFixture } from '../../apps/api/src/modules/design-scheme-packages/__tests__/fixture';
import { launchV25App, v25ShellPage } from './electron-helpers';

async function prepare(page: Page) {
  const envelope = await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        musefoldV25: {
          prepareDesignSchemeImportPackage(
            input: unknown,
          ): Promise<{ ok: boolean; data?: unknown; code?: string }>;
        };
      }
    ).musefoldV25;
    return bridge.prepareDesignSchemeImportPackage({ acceptedFormatVersions: [2] });
  });
  if (!envelope.ok) throw new Error(envelope.code ?? 'Package preparation rejected');
  const staged = prepareDesignSchemeImportPackageResultSchema.parse(envelope.data);
  if (staged.status !== 'staged') throw new Error('Expected staged package');
  return staged;
}
function findStage(root: string, id: string) {
  const base = join(root, 'staging', 'design-scheme-packages');
  const owner = readdirSync(base).find((name) => existsSync(join(base, name, id)));
  if (!owner) throw new Error('Stage not found in owned userData');
  return join(base, owner, id);
}

// Every file, userData and process here is owned by this test. No real account or Provider.
test('actual Electron SIGKILL leaves a package stage that a new owner PID collects before opening a window', async ({
  browserName: _browserName,
}, info) => {
  const root = mkdtempSync(join(tmpdir(), 'musefold-staging-kill-'));
  const picked = info.outputPath('picked.musefold.design');
  const bytes = await packageFixture();
  writeFileSync(picked, bytes);
  let app: ElectronApplication | undefined;
  try {
    app = (
      await launchV25App('musefold-staging-kill-', {
        reuseUserDataDir: root,
        env: { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: picked },
      })
    ).app;
    const page = await v25ShellPage(app);
    const staged = await prepare(page);
    const path = findStage(root, staged.stagedPackageId);
    expect(readFileSync(join(path, 'package.musefold.design'))).toEqual(bytes);
    const child = app.process();
    const oldPid = child.pid;
    const exited = once(child, 'exit');
    expect(child.kill('SIGKILL')).toBe(true);
    const [code, signal] = await exited;
    app = undefined;
    expect(signal).toBe('SIGKILL');
    expect(existsSync(path)).toBe(true);
    app = (await launchV25App('musefold-staging-kill-', { reuseUserDataDir: root })).app;
    await v25ShellPage(app);
    expect(app.process().pid).not.toBe(oldPid);
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(picked)).toEqual(bytes);
    await info.attach('staging-crash-evidence', {
      body: JSON.stringify({
        oldPid,
        newPid: app.process().pid,
        code,
        signal,
        leftoverBeforeRestart: true,
        removedOnStartup: true,
        originalPreserved: true,
      }),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('actual two Electron windows retain independent stages and destroyed sender cleanup preserves the other window', async ({
  browserName: _browserName,
}, info) => {
  const picked = info.outputPath('picked.musefold.design');
  writeFileSync(picked, await packageFixture());
  let app: ElectronApplication | undefined;
  let root = '';
  try {
    ({ app, userDataDir: root } = await launchV25App('musefold-staging-windows-', {
      env: { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: picked },
    }));
    const first = await v25ShellPage(app);
    const firstStage = await prepare(first);
    const firstPath = findStage(root, firstStage.stagedPackageId);
    const newPage = app.waitForEvent('window');
    const secondId = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const original = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('v25/shell'),
      );
      if (!original) throw new Error('Shell missing');
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      await window.loadURL(original.webContents.getURL());
      return window.id;
    }, resolve('apps/desktop/out/preload/v25.cjs'));
    const second = await newPage;
    await second.waitForLoadState('domcontentloaded');
    const secondStage = await prepare(second);
    const secondPath = findStage(root, secondStage.stagedPackageId);
    expect(existsSync(firstPath)).toBe(true);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), secondId);
    await expect.poll(() => existsSync(secondPath)).toBe(false);
    expect(existsSync(firstPath)).toBe(true);
    expect(existsSync(picked)).toBe(true);
    await app.close();
    app = undefined;
    expect(existsSync(firstPath)).toBe(false);
  } finally {
    await app?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('actual startup refuses a linked staging root and preserves every target original', async ({
  browserName: _browserName,
}, info) => {
  const root = mkdtempSync(join(tmpdir(), 'musefold-staging-symlink-'));
  const picked = info.outputPath('picked.musefold.design');
  const bytes = await packageFixture();
  writeFileSync(picked, bytes);
  const external = join(root, 'owned-originals');
  const victim = join(external, '11', `stage_${'a'.repeat(32)}`);
  mkdirSync(victim, { recursive: true });
  writeFileSync(join(victim, 'package.musefold.design'), bytes);
  mkdirSync(join(root, 'staging'));
  symlinkSync(external, join(root, 'staging', 'design-scheme-packages'), 'junction');
  let app: ElectronApplication | undefined;
  try {
    app = (
      await launchV25App('musefold-staging-symlink-', {
        reuseUserDataDir: root,
        env: { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: picked },
      })
    ).app;
    const page = await v25ShellPage(app);
    await expect(prepare(page)).rejects.toThrow('DESIGN_SCHEME_PACKAGE_INVALID');
    expect(readFileSync(join(victim, 'package.musefold.design'))).toEqual(bytes);
    await app.close();
    app = undefined;
    expect(readFileSync(join(victim, 'package.musefold.design'))).toEqual(bytes);
    expect(readFileSync(picked)).toEqual(bytes);
  } finally {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('actual permission failure leaves a staging orphan for a later process to recover', async ({
  browserName: _browserName,
}, info) => {
  test.skip(
    process.platform === 'win32',
    'POSIX permissions; Windows requires its native ACL fixture.',
  );
  const root = mkdtempSync(join(tmpdir(), 'musefold-staging-permissions-'));
  const path = join(root, 'staging', 'design-scheme-packages', '11', `stage_${'f'.repeat(32)}`);
  mkdirSync(path, { recursive: true });
  const file = join(path, 'package.musefold.design');
  const bytes = await packageFixture();
  writeFileSync(file, bytes);
  chmodSync(path, 0o500);
  let app: ElectronApplication | undefined;
  try {
    app = (await launchV25App('musefold-staging-permissions-', { reuseUserDataDir: root })).app;
    await v25ShellPage(app);
    expect(readFileSync(file)).toEqual(bytes);
    const oldPid = app.process().pid;
    await app.close();
    app = undefined;
    expect(existsSync(file)).toBe(true);
    chmodSync(path, 0o700);
    app = (await launchV25App('musefold-staging-permissions-', { reuseUserDataDir: root })).app;
    await v25ShellPage(app);
    expect(app.process().pid).not.toBe(oldPid);
    expect(existsSync(path)).toBe(false);
    await info.attach('staging-permission-evidence', {
      body: JSON.stringify({
        oldPid,
        newPid: app.process().pid,
        originalFailureRetained: true,
        recoveredAfterPermissionRepair: true,
      }),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    if (existsSync(path)) chmodSync(path, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});
