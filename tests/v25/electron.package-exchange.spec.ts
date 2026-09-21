import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { designSchemeDetailSchema, designSchemePageSchema } from '@musefold/contracts';
import { readValidatedDesignSchemePackage } from '@musefold/scheme-package';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchV25App, v25ShellPage, designSchemeDbPath } from './electron-helpers';
import { localInvoke } from './local-execution-fixture';
import { PackageExchangeProcess } from './package-exchange-process';
import { packageMeaning } from './package-exchange-meaning';
import {
  connectExchangeBrowser,
  loginExchangeBrowser,
  importExchangeBrowser,
  qualifyExchangeBrowser,
  exportExchangeBrowser,
} from './package-exchange-browser';

async function importDesktop(page: Page) {
  const before = designSchemePageSchema.parse(await localInvoke(page, 'designSchemes.list', {}));
  await page.getByTestId('nav-design-schemes').click();
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-import').click();
  await expect(page.getByText('已导入为草稿')).toBeVisible();
  const after = designSchemePageSchema.parse(await localInvoke(page, 'designSchemes.list', {}));
  const added = after.items.filter((item) => !before.items.some((old) => old.id === item.id));
  expect(added).toHaveLength(1);
  const detail = designSchemeDetailSchema.parse(
    await localInvoke(page, 'designSchemes.get', { id: added[0].id }),
  );
  expect(detail.summary.status).toBe('draft');
  expect(detail.summary.hasSuccessfulTrial).toBe(false);
  expect(detail.document).toMatchObject({ createdBy: 'import', parentRevisionId: null });
  return detail;
}

test('Desktop→Web→Desktop actual UI files preserve mixed sources and create new drafts across auth/PG/SQLite', async ({
  browser,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires disposable PG and actual Better Auth with controlled upstream',
  );
  test.setTimeout(240000);
  const service = new PackageExchangeProcess();
  const temp = mkdtempSync(join(tmpdir(), 'musefold-cross-host-package-'));
  const input = join(temp, 'picked.musefold.design');
  const desktopFile = info.outputPath('desktop-export.musefold.design');
  const webFile = info.outputPath('web-export.musefold.design');
  const env = {
    MUSEFOLD_E2E_DESIGN_IMPORT_PATH: input,
    MUSEFOLD_E2E_DESIGN_EXPORT_PATH: desktopFile,
  };
  let app: ElectronApplication | undefined;
  let userDataDir = '';
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3399' });
  try {
    const backend = await service.ready;
    writeFileSync(input, Buffer.from(backend.bytes, 'base64'));
    const launched = await launchV25App('musefold-cross-host-', { env });
    app = launched.app;
    userDataDir = launched.userDataDir;
    let page = await v25ShellPage(app);
    const initial = await importDesktop(page);
    expect(new Set(initial.assets.map((asset) => asset.contentHash)).size).toBe(3);
    expect(initial.document.name).toBe('跨端 Café 山水 ✨');
    const firstPid = app.process().pid;
    await app.close();
    app = undefined;
    // Explicit local trial qualification fixture; no Provider/worker execution is claimed.
    const db = new Database(designSchemeDbPath(userDataDir));
    try {
      const repo = new DesignSchemeRepository(db);
      const cover = join(userDataDir, 'fixture-trial.png');
      const original = await readValidatedDesignSchemePackage(input, [2]);
      if (original.formatVersion !== 2) throw new Error('Expected v2 input');
      const image = original.manifest.content.entries.find((entry) => entry.kind === 'asset');
      if (!image) throw new Error('Missing actual image');
      const imageBytes = original.entries.get(image.relativePath);
      if (!imageBytes) throw new Error('Missing validated image bytes');
      writeFileSync(cover, imageBytes);
      repo.insertRun({
        runId: 'cross-host-trial',
        revisionId: initial.document.revisionId,
        mode: 'trial',
        policy: {},
      });
      repo.updateRunStatus('cross-host-trial', 'completed');
      const assetId = repo.insertLocalRunAsset(initial.document.revisionId, cover);
      repo.selectCover(initial.summary.id, assetId);
      repo.formalize(initial.summary.id);
    } finally {
      db.close();
    }
    ({ app } = await launchV25App('musefold-cross-host-', { reuseUserDataDir: userDataDir, env }));
    expect(app.process().pid).not.toBe(firstPid);
    page = await v25ShellPage(app);
    await page.getByTestId('nav-design-schemes').click();
    await page.getByTestId(`runtime-scheme-open-${initial.summary.id}`).click();
    await page.getByTestId('scheme-inspector-open-detail').click();
    await page.getByTestId('runtime-scheme-menu').click();
    await page.getByTestId('runtime-scheme-menu-export').click();
    await expect(page.getByText('分享包已导出')).toBeVisible();
    expect(existsSync(desktopFile)).toBe(true);
    const desktopArchive = await readValidatedDesignSchemePackage(desktopFile, [2]);
    if (desktopArchive.formatVersion !== 2) throw new Error('Expected v2 Desktop export');
    await app.close();
    app = undefined;

    await connectExchangeBrowser(context, backend.baseUrl);
    const web = await context.newPage();
    await loginExchangeBrowser(web, 'desktop-web-exchange@example.test');
    const imported = await importExchangeBrowser(web, desktopFile);
    expect(packageMeaning(imported)).toEqual(packageMeaning(desktopArchive.manifest));
    expect(imported.summary.id).not.toBe(initial.summary.id);
    await qualifyExchangeBrowser(web, service, imported.summary.id);
    const exported = await exportExchangeBrowser(web, webFile);
    await web.close();

    writeFileSync(input, readFileSync(webFile));
    ({ app } = await launchV25App('musefold-cross-host-', { reuseUserDataDir: userDataDir, env }));
    page = await v25ShellPage(app);
    const received = await importDesktop(page);
    expect(packageMeaning(received)).toEqual(packageMeaning(exported.archive.manifest));
    expect(received.summary.id).not.toBe(initial.summary.id);
    expect(received.summary.id).not.toBe(imported.summary.id);
    expect(received.document.assetIds.some((id) => initial.document.assetIds.includes(id))).toBe(
      false,
    );
    const originalStill = designSchemeDetailSchema.parse(
      await localInvoke(page, 'designSchemes.get', { id: initial.summary.id }),
    );
    expect(originalStill.summary.status).toBe('formal');
    const importedAgain = new Database(designSchemeDbPath(userDataDir), { readonly: true });
    try {
      const rows = importedAgain
        .prepare('SELECT content_hash,store_key FROM design_scheme_assets WHERE revision_id=?')
        .all(received.document.revisionId) as Array<{ content_hash: string; store_key: string }>;
      expect(rows).toHaveLength(received.assets.length);
      for (const row of rows) {
        const path = join(userDataDir, row.store_key);
        expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(
          row.content_hash,
        );
      }
    } finally {
      importedAgain.close();
    }
    await page.screenshot({ path: info.outputPath('desktop-received-draft.png') });
    const desktopBytes = readFileSync(desktopFile);
    await info.attach('package-exchange-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        directions: ['Desktop→Web', 'Web→Desktop'],
        files: [
          {
            name: 'desktop-export.musefold.design',
            bytes: desktopBytes.length,
            hash: createHash('sha256').update(desktopBytes).digest('hex'),
          },
          { name: 'web-export.musefold.design', bytes: exported.bytes, hash: exported.hash },
        ],
        ids: [initial.summary.id, imported.summary.id, received.summary.id],
        meaning: packageMeaning(received),
        state: await service.snapshot(),
        real: 'Electron UI/preload/IPC/native package services/file IO/SQLite/new PID; Web UI/Better Auth/production API/PG/AWS SDK',
        controlled:
          'native dialog path injection, New API/S3 upstream, trial qualification fixtures; not actual worker trial or OS picker interaction',
      }),
    });
  } finally {
    await app?.close();
    await context.close();
    await service.dispose();
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
});
