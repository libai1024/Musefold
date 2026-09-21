import { copyFile, readFile, rm } from 'node:fs/promises';
import { test, expect, type ElectronApplication, type BrowserContext } from '@playwright/test';
import { designSchemeDetailSchema, type DesignSchemeDetail } from '@musefold/contracts';
import {
  readValidatedDesignSchemePackage,
  readValidatedDesignSchemePackageBytes,
  sha256,
} from '@musefold/scheme-package';
import { savePackageImportCorpus } from '../../apps/api/src/__tests__/fixtures/package-import-corpus';
import { FULL_PROMPT } from '../../apps/api/src/modules/design-scheme-packages/__tests__/import-fixture';
import { PackageExchangeProcess } from './package-exchange-process';
import {
  browserJson,
  connectExchangeBrowser,
  importExchangeBrowser,
  loginExchangeBrowser,
} from './package-exchange-browser';
import { launchV25App, v25ShellPage } from './electron-helpers';
import {
  desktopScheme,
  importDesktopTrialPackage,
  inspectDesktopTrial,
} from './scheme-trial-desktop';
import { desktopImportSnapshot } from './package-corpus-desktop';
import { packageMeaning } from './package-exchange-meaning';

function assertSourceContent(
  snapshot: ReturnType<typeof desktopImportSnapshot>,
  detail: DesignSchemeDetail,
) {
  const content = snapshot.content.filter((row) =>
    detail.document.sourceSnapshotIds.includes(row.snapshotId),
  );
  expect(content.some((row) => row.text === FULL_PROMPT)).toBe(true);
  expect(content.length).toBeGreaterThan(0);
  for (const row of content) expect(row.hash).toBe(row.expectedHash);
  expect(snapshot.canonical.design_scheme_runs).toHaveLength(0);
}

test('the same 12 saved packages agree across readers and actual PC Web, Mobile Web and Electron imports', async ({
  browser,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires isolated actual BA/API/PG and desktop SQLite',
  );
  test.setTimeout(360000);
  const corpus = await savePackageImportCorpus(info.outputPath('corpus'));
  const service = new PackageExchangeProcess();
  const contexts: BrowserContext[] = [];
  let app: ElectronApplication | undefined;
  let userData = '';
  const picked = info.outputPath('picked.musefold.design');
  const env = { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: picked };
  const evidence: unknown[] = [];
  try {
    const { baseUrl } = await service.ready;
    const webSurfaces = [];
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        baseURL: 'http://127.0.0.1:3399',
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      contexts.push(context);
      await connectExchangeBrowser(context, baseUrl);
      const page = await context.newPage();
      await loginExchangeBrowser(page, `corpus-${mobile ? 'mobile' : 'desktop'}@example.test`);
      webSurfaces.push({
        page,
        host: mobile ? 'mobile-web' : 'pc-web',
        imports: new Map<string, DesignSchemeDetail>(),
      });
    }
    ({ app, userDataDir: userData } = await launchV25App('musefold-package-corpus-', { env }));
    let desktop = await v25ShellPage(app);
    await desktop.getByTestId('nav-design-schemes').click();
    await expect(desktop.getByTestId('scheme-create')).toBeVisible();
    const importedDesktop = new Map<string, DesignSchemeDetail>();
    for (const item of corpus) {
      await test.step(item.id, async () => {
        const bytes = await readFile(item.path);
        expect(sha256(bytes)).toBe(item.sha256);
        const original = item.accepted ? await readValidatedDesignSchemePackage(item.path) : null;
        if (original) expect(await readValidatedDesignSchemePackageBytes(bytes)).toEqual(original);
        else {
          const error = new RegExp(item.expectedError ?? '^$');
          await expect(readValidatedDesignSchemePackage(item.path)).rejects.toThrow(error);
          await expect(readValidatedDesignSchemePackageBytes(bytes)).rejects.toThrow(error);
        }
        for (const surface of webSurfaces) {
          const before = await service.importSnapshot();
          let detail: DesignSchemeDetail | undefined;
          let rejection: string | null = null;
          if (item.accepted) {
            detail = await importExchangeBrowser(
              surface.page,
              item.path,
              original?.formatVersion ?? 2,
            );
            if (original?.formatVersion === 2)
              expect(packageMeaning(detail)).toEqual(packageMeaning(original.manifest));
            surface.imports.set(item.id, detail);
          } else {
            await surface.page.goto('/design-schemes');
            await surface.page.getByTestId('scheme-create').click();
            await surface.page.getByTestId('scheme-create-option-import').click();
            await surface.page.getByTestId('scheme-package-file').setInputFiles(item.path);
            await surface.page.getByTestId('scheme-package-upload').click();
            const dialog = surface.page.getByTestId('scheme-package-import');
            await expect(dialog.getByRole('alert')).toBeVisible();
            rejection = await dialog.getByRole('alert').innerText();
            expect(rejection).toContain('方案包字节、大小、摘要或内容无效');
            await expect(surface.page.getByTestId('scheme-package-confirm')).toHaveCount(0);
            await dialog.getByRole('button', { name: '关闭', exact: true }).click();
          }
          const after = await service.importSnapshot();
          if (detail) {
            assertSourceContent(after, detail);
            expect(after.canonical.design_schemes).toHaveLength(
              before.canonical.design_schemes.length + 1,
            );
          } else expect(after.canonical).toEqual(before.canonical);
          evidence.push({
            case: item.id,
            host: surface.host,
            file: item.path,
            sha256: item.sha256,
            accepted: !!detail,
            rejection,
            detail,
            canonicalUnchanged: !detail,
            snapshot: after,
          });
        }
        await copyFile(item.path, picked);
        expect(sha256(await readFile(picked))).toBe(item.sha256);
        const before = desktopImportSnapshot(userData);
        // Clear old notifications through their natural lifecycle before observing this attempt.
        await desktop.mouse.move(0, 0);
        await expect(desktop.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
        let local: DesignSchemeDetail | undefined;
        let rejection: string | null = null;
        if (item.accepted) {
          local = await importDesktopTrialPackage(desktop);
          const web = webSurfaces[0].imports.get(item.id);
          if (!web) throw new Error('Missing earlier Web import');
          expect(packageMeaning(local)).toEqual(packageMeaning(web));
          expect(local.summary.id).not.toBe(web.summary.id);
          expect(local.document.revisionId).not.toBe(web.document.revisionId);
          expect(inspectDesktopTrial(userData, local).runs).toHaveLength(0);
          importedDesktop.set(item.id, local);
        } else {
          await desktop.getByTestId('scheme-create').click();
          await desktop.getByTestId('scheme-create-option-import').click();
          const toast = desktop.locator('[data-sonner-toast]').filter({ hasText: '导入方案失败' });
          await expect(toast).toBeVisible();
          rejection = await toast.innerText();
          expect(rejection).toContain('所选文件不是可安全导入的 Musefold 设计方案包');
          // Error notifications persist; dismiss through the real close control.
          const close = toast.getByRole('button', { name: /关闭|Close/i });
          if (await close.count()) await close.click();
        }
        const after = desktopImportSnapshot(userData);
        if (local) {
          assertSourceContent(after, local);
          expect(after.canonical.design_schemes).toHaveLength(
            before.canonical.design_schemes.length + 1,
          );
        } else expect(after.canonical).toEqual(before.canonical);
        evidence.push({
          case: item.id,
          host: 'electron',
          file: picked,
          sha256: item.sha256,
          accepted: !!local,
          rejection,
          detail: local,
          canonicalUnchanged: !local,
          snapshot: after,
        });
      });
    }
    const pid = app.process().pid;
    const beforeRestart = desktopImportSnapshot(userData);
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-package-corpus-', { reuseUserDataDir: userData, env }));
    expect(app.process().pid).not.toBe(pid);
    desktop = await v25ShellPage(app);
    for (const [id, value] of importedDesktop) {
      const restored = await desktopScheme(desktop, value.summary.id);
      expect(restored).toEqual(value);
      const previousWeb = webSurfaces[0].imports.get(id);
      if (!previousWeb) throw new Error('Missing Web import before restart');
      expect(packageMeaning(restored)).toEqual(packageMeaning(previousWeb));
    }
    expect(desktopImportSnapshot(userData)).toEqual(beforeRestart);
    for (const surface of webSurfaces) {
      await surface.page.reload();
      for (const value of surface.imports.values()) {
        const restored = designSchemeDetailSchema.parse(
          await browserJson(surface.page, `/api/v1/design-schemes/${value.summary.id}`),
        );
        expect(restored).toEqual(value);
      }
    }
    expect(evidence).toHaveLength(36);
  } finally {
    await info.attach('shared-import-corpus', {
      contentType: 'application/json',
      body: JSON.stringify({
        corpus,
        evidence,
        real: 'BA/Hono/PG/AWS SDK, Electron IPC/SQLite; same saved files and verified copies',
        controlled:
          'upstream account and S3; injected Desktop picker path and Chromium mobile viewport do not prove native picker or Safari',
      }),
    });
    if (app) await app.close();
    for (const context of contexts) {
      await context.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
    await service.dispose();
    if (userData) await rm(userData, { recursive: true, force: true });
  }
});
