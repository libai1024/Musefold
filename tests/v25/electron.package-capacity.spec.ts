import { readFile, rm } from 'node:fs/promises';
import { test, expect, type ElectronApplication, type BrowserContext } from '@playwright/test';
import { designSchemeDetailSchema, type DesignSchemeDetail } from '@musefold/contracts';
import { sha256 } from '@musefold/scheme-package';
import {
  capacityDimensions,
  capacitySides,
} from '../../apps/api/src/__tests__/fixtures/package-capacity-corpus';
import { savedCapacityCase } from './package-capacity-helpers';
import { PackageExchangeProcess } from './package-exchange-process';
import {
  browserJson,
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
import { startCapacityProxy } from './package-capacity-proxy';

test.describe('actual contract-sized packages across product hosts', () => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires isolated actual auth/API/PG and Electron SQLite',
  );
  for (const dimension of capacityDimensions) {
    for (const side of capacitySides) {
      test(`${dimension}-${side}: saved bytes through PC/mobile Web and Electron`, async ({
        browser,
      }, info) => {
        test.setTimeout(360000);
        const item = await savedCapacityCase(info.outputPath('capacity'), dimension, side);
        const service = new PackageExchangeProcess();
        const contexts: BrowserContext[] = [];
        const evidence: unknown[] = [];
        let app: ElectronApplication | undefined;
        let userData = '';
        let firstWeb: DesignSchemeDetail | undefined;
        let proxy: Awaited<ReturnType<typeof startCapacityProxy>> | undefined;
        const ids = new Set<string>();
        try {
          const { baseUrl } = await service.ready;
          proxy = await startCapacityProxy(baseUrl);
          for (const mobile of [false, true]) {
            const context = await browser.newContext({
              baseURL: 'http://127.0.0.1:3399',
              viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
              isMobile: mobile,
              hasTouch: mobile,
            });
            contexts.push(context);
            const page = await context.newPage();
            await loginExchangeBrowser(page, `capacity-${mobile ? 'mobile' : 'pc'}@example.test`);
            const before = await service.importDigest();
            const start = performance.now();
            let detail: DesignSchemeDetail | undefined;
            if (item.accepted) {
              detail = await importExchangeBrowser(page, item.path, item.formatVersion, 60000);
              expect(detail.summary.coverAssetId).toBeNull();
              expect(ids.has(detail.summary.id)).toBe(false);
              ids.add(detail.summary.id);
              if (firstWeb) expect(packageMeaning(detail)).toEqual(packageMeaning(firstWeb));
              else firstWeb = detail;
              const objects = await service.snapshot();
              for (const asset of detail.assets)
                expect(objects.objects).toContainEqual({
                  bytes: asset.byteSize,
                  hash: asset.contentHash,
                });
              await page.reload();
              expect(
                designSchemeDetailSchema.parse(
                  await browserJson(page, `/api/v1/design-schemes/${detail.summary.id}`),
                ),
              ).toEqual(detail);
            } else {
              await page.getByTestId('scheme-create').click();
              await page.getByTestId('scheme-create-option-import').click();
              await page.getByTestId('scheme-package-file').setInputFiles(item.path);
              if (item.formatVersion === 1)
                await page.getByRole('radio', { name: '旧版方案包（格式 1）' }).check();
              await page.getByTestId('scheme-package-upload').click();
              const alert = page.getByTestId('scheme-package-import').getByRole('alert');
              await expect(alert).toBeVisible({ timeout: 60000 });
              await expect(alert).toContainText(
                dimension === 'archive' ? '不超过 256 MiB' : '方案包字节、大小、摘要或内容无效',
              );
              await expect(page.getByTestId('scheme-package-confirm')).toHaveCount(0);
            }
            const after = await service.importDigest();
            expect(after.canonical.design_scheme_runs).toHaveLength(0);
            if (!detail) expect(after.canonical).toEqual(before.canonical);
            else {
              expect(after.canonical.design_schemes).toHaveLength(
                before.canonical.design_schemes.length + 1,
              );
              const content = after.content.filter((row) =>
                detail.document.sourceSnapshotIds.includes(row.snapshotId),
              );
              expect(content.length).toBeGreaterThan(0);
              for (const row of content) {
                expect(row.hash).toBe(row.expectedHash);
                expect(row.bytes).toBeGreaterThan(0);
              }
            }
            evidence.push({
              host: mobile ? 'mobile-web' : 'pc-web',
              accepted: !!detail,
              inputHash: item.sha256,
              elapsedMs: performance.now() - start,
              sourceContent: after.content,
              canonicalHash: sha256(Buffer.from(JSON.stringify(after.canonical))),
              canonicalUnchanged: !detail,
              summary: detail?.summary,
            });
            // Finish active image/body reads before closing this browser owner.
            await page.waitForLoadState('networkidle', { timeout: 30000 });
            await page.close();
            await context.close();
          }
          const env = { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: item.path };
          ({ app, userDataDir: userData } = await launchV25App('musefold-package-capacity-', {
            env,
          }));
          let page = await v25ShellPage(app);
          await page.getByTestId('nav-design-schemes').click();
          const before = desktopImportSnapshot(userData, false);
          const start = performance.now();
          let detail: DesignSchemeDetail | undefined;
          if (item.accepted) {
            detail = await importDesktopTrialPackage(page, 60000);
            if (!firstWeb) throw new Error('No earlier Web import');
            expect(packageMeaning(detail)).toEqual(packageMeaning(firstWeb));
            expect(ids.has(detail.summary.id)).toBe(false);
            expect(detail.summary.coverAssetId).toBeNull();
            expect(inspectDesktopTrial(userData, detail).runs).toHaveLength(0);
          } else {
            await page.getByTestId('scheme-create').click();
            await page.getByTestId('scheme-create-option-import').click();
            await expect(
              page.locator('[data-sonner-toast]').filter({ hasText: '导入方案失败' }),
            ).toContainText('所选文件不是可安全导入的 Musefold 设计方案包', { timeout: 60000 });
          }
          const after = desktopImportSnapshot(userData, false);
          if (!detail) expect(after.canonical).toEqual(before.canonical);
          else {
            expect(after.canonical.design_schemes).toHaveLength(1);
            for (const row of after.content) {
              expect(row.hash).toBe(row.expectedHash);
              expect(row.bytes).toBeGreaterThan(0);
            }
          }
          expect(after.canonical.design_scheme_runs).toHaveLength(0);
          const pid = app.process().pid;
          await app.close();
          app = undefined;
          ({ app } = await launchV25App('musefold-package-capacity-', {
            reuseUserDataDir: userData,
            env,
          }));
          expect(app.process().pid).not.toBe(pid);
          page = await v25ShellPage(app);
          if (detail) expect(await desktopScheme(page, detail.summary.id)).toEqual(detail);
          expect(desktopImportSnapshot(userData, false)).toEqual(after);
          expect(sha256(await readFile(item.path))).toBe(item.sha256);
          evidence.push({
            host: 'electron',
            accepted: !!detail,
            inputHash: item.sha256,
            elapsedMs: performance.now() - start,
            sourceContent: after.content,
            canonicalHash: sha256(Buffer.from(JSON.stringify(after.canonical))),
            canonicalUnchanged: !detail,
            summary: detail?.summary,
            restartVerified: true,
          });
        } finally {
          await info.attach('fixture-startup', {
            body: JSON.stringify(service.startupPhases()),
            contentType: 'application/json',
          });
          await info.attach('capacity-host-evidence', {
            contentType: 'application/json',
            body: JSON.stringify({
              item,
              evidence,
              httpTransfers: proxy?.transfers,
              scope:
                'Actual BA/API/PG/S3 SDK and Electron IPC/SQLite. Chromium mobile viewport and injected picker path; no native picker, Safari or production memory claim.',
            }),
          });
          if (app) await app.close();
          for (const context of contexts) await context.close();
          await proxy?.close();
          await service.dispose();
          if (userData) await rm(userData, { recursive: true, force: true });
        }
      });
    }
  }
});
