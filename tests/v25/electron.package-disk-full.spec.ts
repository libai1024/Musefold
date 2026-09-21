import { readFile, readdir, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { DESIGN_SCHEME_PACKAGE_LIMITS as limits } from '@musefold/contracts';
import { sha256 } from '@musefold/scheme-package';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { savedCapacityCase } from './package-capacity-helpers';
import { desktopImportSnapshot } from './package-corpus-desktop';
import { desktopScheme, importDesktopTrialPackage } from './scheme-trial-desktop';
import { capacityDiskImage, observeCapacityWrites } from './capacity-disk-image';

test('actual full filesystem during maximum package import removes partial files and preserves SQLite', async ({
  browserName,
}, info) => {
  test.skip(
    process.platform !== 'darwin',
    'Real bounded HFS+ image uses macOS hdiutil; other OS disk-full gates remain separate',
  );
  test.setTimeout(180000);
  const item = await savedCapacityCase(info.outputPath('capacity'), 'archive', 'at');
  let app: ElectronApplication | undefined;
  let userData = '';
  let volume: Awaited<ReturnType<typeof capacityDiskImage>> | undefined;
  const evidence: Record<string, unknown> = { item, playwrightBrowserName: browserName };
  try {
    const env = { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: item.path };
    ({ app, userDataDir: userData } = await launchV25App('musefold-capacity-disk-', { env }));
    let page = await v25ShellPage(app);
    await page.getByTestId('nav-design-schemes').click();
    const before = desktopImportSnapshot(userData, false);
    const mount = join(userData, 'design-scheme-imports');
    volume = await capacityDiskImage(mount);
    const initial = await statfs(mount);
    const free = initial.bavail * initial.bsize;
    expect(free).toBeGreaterThan(limits.entryBytes);
    expect(free).toBeLessThan(limits.entryBytes * 2);
    const marker = info.outputPath('actual-filesystem-writes.json');
    await observeCapacityWrites(app, mount, marker);
    const firstPid = app.process().pid;
    await page.getByTestId('scheme-create').click();
    await page.getByTestId('scheme-create-option-import').click();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: '导入方案失败' }),
    ).toContainText('磁盘空间不足，导入未完成。请释放空间后重试。', { timeout: 60000 });
    const writes = JSON.parse(await readFile(marker, 'utf8')) as Array<{
      status: string;
      error?: string;
      requestedBytes: number;
      actualFileBytes: number;
    }>;
    expect(
      writes.some((row) => row.status === 'written' && row.actualFileBytes === limits.entryBytes),
    ).toBe(true);
    const failure = writes.find((row) => row.error === 'ENOSPC');
    expect(failure?.requestedBytes).toBe(limits.entryBytes);
    // HFS+ can reject allocation before writing any of the failing file. The prior
    // complete 64MiB file proves failure happened partway through the real import.
    expect(failure?.actualFileBytes).toBeGreaterThanOrEqual(0);
    expect(failure?.actualFileBytes).toBeLessThan(limits.entryBytes);
    expect((await readdir(mount)).filter((name) => name.startsWith('dsch_'))).toEqual([]);
    const stageRoot = join(userData, 'staging', 'design-scheme-packages');
    expect(
      (
        await readdir(stageRoot, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        })
      ).filter((name) => name.endsWith('.musefold.design')),
    ).toEqual([]);
    expect(desktopImportSnapshot(userData, false)).toEqual(before);
    evidence.failure = {
      firstPid,
      filesystem: volume.filesystem,
      free,
      writes,
      canonicalUnchanged: true,
      partialImportRoots: 0,
      stagedPackages: 0,
      partialSingleFileWrite: (failure?.actualFileBytes ?? 0) > 0,
    };
    await app.close();
    app = undefined;
    await volume.close();
    evidence.detached = true;
    volume = undefined;
    ({ app } = await launchV25App('musefold-capacity-disk-', { reuseUserDataDir: userData, env }));
    expect(app.process().pid).not.toBe(firstPid);
    page = await v25ShellPage(app);
    await page.getByTestId('nav-design-schemes').click();
    expect(desktopImportSnapshot(userData, false)).toEqual(before);
    const detail = await importDesktopTrialPackage(page, 60000);
    expect(detail.summary.coverAssetId).toBeNull();
    const imported = desktopImportSnapshot(userData, false);
    expect(imported.canonical.design_schemes).toHaveLength(1);
    expect(imported.canonical.design_scheme_runs).toHaveLength(0);
    expect(imported.content.length).toBeGreaterThan(0);
    for (const row of imported.content) expect(row.hash).toBe(row.expectedHash);
    const secondPid = app.process().pid;
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-capacity-disk-', { reuseUserDataDir: userData, env }));
    expect(app.process().pid).not.toBe(secondPid);
    page = await v25ShellPage(app);
    expect(await desktopScheme(page, detail.summary.id)).toEqual(detail);
    expect(desktopImportSnapshot(userData, false)).toEqual(imported);
    expect(sha256(await readFile(item.path))).toBe(item.sha256);
    evidence.recovery = {
      secondPid,
      thirdPid: app.process().pid,
      summary: detail.summary,
      sources: imported.content,
      inputUnchanged: true,
    };
    evidence.scope =
      'Real Electron UI/IPC, SQLite, filesystem writes and ENOSPC. Injected picker path and observation-only fs wrapper. No mocked write failure, fabricated qualification or SQL mutation. HFS+ on macOS only.';
  } finally {
    try {
      if (app) await app.close();
    } finally {
      // Never recursively delete the test userData while its image is still mounted.
      if (volume) await volume.close();
      if (userData) await rm(userData, { recursive: true, force: true });
      await info.attach('capacity-disk-full-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(evidence),
      });
    }
  }
});
