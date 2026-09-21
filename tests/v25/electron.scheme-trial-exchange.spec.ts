import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { aiProviderSchema, designSchemeDetailSchema } from '@musefold/contracts';
import { readValidatedDesignSchemePackage } from '@musefold/scheme-package';
import { imageModelFixture } from '../../apps/api/src/__tests__/fixtures/image-model';
import { AgentBrowserProcess } from './agent-browser-process';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { localInvoke } from './local-execution-fixture';
import { createActualAgentDraft } from './scheme-trial-browser';
import {
  desktopScheme,
  importDesktopTrialPackage,
  inspectDesktopTrial,
  openDesktopScheme,
  selectDesktopSourceReferences,
  selectDesktopTrialCover,
} from './scheme-trial-desktop';
import {
  iterateFormalScheme,
  selectTrialReferences,
  selectTrialCover,
} from './web.scheme-promote-helper';
import {
  browserJson,
  connectExchangeBrowser,
  exportExchangeBrowser,
  importExchangeBrowser,
  loginExchangeBrowser,
} from './package-exchange-browser';
import { packageMeaning } from './package-exchange-meaning';

for (const kind of ['brief', 'github', 'history'] as const) {
  test(`actual ${kind} new Agent result earns cloud and Desktop trials before Web→Desktop→Mobile Web exchange`, async ({
    browser,
  }, info) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires isolated actual API, PG, Agent and generation bin',
    );
    test.setTimeout(240000);
    const service = new AgentBrowserProcess();
    const image = await imageModelFixture();
    let rejectedLocalRequests = 0;
    const localServer = createServer(async (request, response) => {
      if (request.headers.authorization !== 'Bearer synthetic-crosshost-image') {
        rejectedLocalRequests++;
        response.writeHead(401).end('{}');
        return;
      }
      if (!(await image.handle(request, response))) {
        rejectedLocalRequests++;
        response.writeHead(404).end('{}');
      }
    });
    await new Promise<void>((resolve) => localServer.listen(0, '127.0.0.1', resolve));
    const address = localServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing local image server address');
    const webContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:3399',
      viewport: { width: 1280, height: 800 },
    });
    const mobileContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:3399',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const temp = mkdtempSync(join(tmpdir(), 'musefold-real-trial-exchange-'));
    const picked = join(temp, 'picked.musefold.design');
    const cloudFile = info.outputPath(`${kind}-cloud.musefold.design`);
    const localFile = info.outputPath(`${kind}-desktop.musefold.design`);
    const env = {
      MUSEFOLD_E2E_DESIGN_IMPORT_PATH: picked,
      MUSEFOLD_E2E_DESIGN_EXPORT_PATH: localFile,
    };
    let app: ElectronApplication | undefined;
    let userData = '';
    try {
      const { baseUrl } = await service.ready;
      await connectExchangeBrowser(webContext, baseUrl);
      const cloudWorker = await service.startGeneration(kind !== 'brief');
      const web = await webContext.newPage();
      const created = await createActualAgentDraft(web, service, kind);
      await web.getByTestId('runtime-scheme-primary-action').click();
      await expect(web.getByTestId('composer-prompt')).toBeFocused();
      await web.getByTestId('scheme-run-variable-topic').fill('跨端书展');
      await web.getByTestId('composer-prompt').fill('先验证云端新方案');
      if (kind !== 'brief') await selectTrialReferences(web, created);
      await expect(web.getByTestId('scheme-run-variable-topic')).toHaveValue('跨端书展');
      await expect(web.getByTestId('composer-submit')).toBeEnabled();
      await web.getByTestId('composer-submit').click();
      await expect(web.getByTestId('scheme-run-variable-topic')).toHaveValue('', {
        timeout: 20000,
      });
      let formal = designSchemeDetailSchema.parse(
        await browserJson(web, `/api/v1/design-schemes/${created.summary.id}`),
      );
      expect(formal.summary.hasSuccessfulTrial).toBe(true);
      const firstOutput = formal.assets.find(
        (asset) => asset.origin === 'cloud-run' && asset.role === 'output',
      );
      if (!firstOutput) throw new Error('Missing actual cloud trial output');
      await web.goto(`/design-schemes?scheme=${created.summary.id}`);
      await selectTrialCover(web, firstOutput.id, formal.assets.length);
      await web.getByTestId('runtime-scheme-formalize').click();
      await expect(web.getByTestId('runtime-scheme-detail')).toHaveAttribute(
        'data-status',
        'formal',
      );
      formal = designSchemeDetailSchema.parse(
        await browserJson(web, `/api/v1/design-schemes/${created.summary.id}`),
      );
      if (kind === 'github') formal = await iterateFormalScheme(web, service, formal);
      const exported = await test.step(
        'Export genuinely tried cloud revision',
        () => exportExchangeBrowser(web, cloudFile),
        { timeout: 30000 },
      );
      writeFileSync(picked, readFileSync(cloudFile));
      const cloudState = await service.snapshot();
      expect(cloudState.imageCalls).toHaveLength(kind === 'github' ? 3 : 1);
      expect(await service.stopGeneration()).toEqual({ code: 0, signal: null });
      await web.goto('about:blank');
      await webContext.unrouteAll({ behavior: 'wait' });

      const launched = await launchV25App('musefold-real-trial-exchange-', { env });
      app = launched.app;
      userData = launched.userDataDir;
      let page = await v25ShellPage(app);
      aiProviderSchema.parse(
        await localInvoke(page, 'aiProviders.create', {
          name: '跨端实际试跑',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model: 'crosshost-image',
          apiKey: 'synthetic-crosshost-image',
          activate: true,
        }),
      );
      const setupPid = app.process().pid;
      await app.close();
      app = undefined;
      ({ app } = await launchV25App('musefold-real-trial-exchange-', {
        reuseUserDataDir: userData,
        env,
      }));
      expect(app.process().pid).not.toBe(setupPid);
      page = await v25ShellPage(app);
      const imported = await importDesktopTrialPackage(page);
      expect(imported.summary.id).not.toBe(formal.summary.id);
      expect(packageMeaning(imported)).toEqual(packageMeaning(exported.archive.manifest));
      expect(inspectDesktopTrial(userData, imported).runs).toHaveLength(0);
      await openDesktopScheme(page, imported.summary.id);
      await page.getByTestId('runtime-scheme-primary-action').click();
      await expect(page.getByTestId('composer-prompt')).toBeFocused();
      await page.getByTestId('scheme-run-variable-topic').fill('桌面独立试跑');
      await page.getByTestId('composer-prompt').fill('核对导入材料');
      const hashes =
        kind === 'brief' ? [] : await selectDesktopSourceReferences(page, userData, imported);
      await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('桌面独立试跑');
      await expect(page.getByTestId('composer-submit')).toBeEnabled();
      await page.getByTestId('composer-submit').click();
      await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('', {
        timeout: 30000,
      });
      await expect(page.getByTestId('composer-prompt')).toHaveValue('');
      await expect(page.getByTestId('scheme-submit-error')).toHaveCount(0);
      expect(image.calls).toHaveLength(1);
      expect(image.calls[0]).toMatchObject({
        endpoint: kind === 'brief' ? '/v1/images/generations' : '/v1/images/edits',
        model: 'crosshost-image',
        count: 1,
      });
      expect(image.calls[0].references.map((item) => item.hash).sort()).toEqual(hashes);
      expect(rejectedLocalRequests).toBe(0);
      const tried = await desktopScheme(page, imported.summary.id);
      expect(tried.summary.hasSuccessfulTrial).toBe(true);
      const output = tried.assets.find(
        (asset) =>
          asset.origin === 'local-run' && !imported.assets.some((old) => old.id === asset.id),
      );
      if (!output) throw new Error('Missing actual Desktop trial asset');
      expect(output.contentHash).toBe(image.output.hash);
      const localState = inspectDesktopTrial(userData, tried);
      expect(localState.references.sort()).toEqual(hashes);
      expect(localState.runs).toEqual([
        expect.objectContaining({
          revision_id: imported.document.revisionId,
          mode: 'trial',
          status: 'completed',
        }),
      ]);
      expect(localState.jobs).toEqual([
        expect.objectContaining({ status: 'success', user_prompt: '核对导入材料' }),
      ]);
      expect(localState.outputs).toEqual([expect.objectContaining({ status: 'available' })]);
      await openDesktopScheme(page, imported.summary.id);
      await selectDesktopTrialCover(page, tried, output.id);
      await page.getByTestId('runtime-scheme-formalize').click();
      await expect(page.getByTestId('runtime-scheme-detail')).toHaveAttribute(
        'data-status',
        'formal',
      );
      const beforeRestart = await desktopScheme(page, imported.summary.id);
      const trialPid = app.process().pid;
      await app.close();
      app = undefined;
      ({ app } = await launchV25App('musefold-real-trial-exchange-', {
        reuseUserDataDir: userData,
        env,
      }));
      expect(app.process().pid).not.toBe(trialPid);
      page = await v25ShellPage(app);
      const restored = await desktopScheme(page, imported.summary.id);
      expect(inspectDesktopTrial(userData, restored).references.sort()).toEqual(hashes);
      expect(restored.document).toEqual(beforeRestart.document);
      expect(restored.summary).toMatchObject({
        status: 'formal',
        hasSuccessfulTrial: true,
        coverAssetId: output.id,
      });
      await openDesktopScheme(page, imported.summary.id);
      await page.getByTestId('runtime-scheme-menu').click();
      await page.getByTestId('runtime-scheme-menu-export').click();
      await expect(page.getByText('分享包已导出', { exact: true })).toBeVisible();
      const localArchive = await readValidatedDesignSchemePackage(localFile, [2]);
      if (localArchive.formatVersion !== 2) throw new Error('Expected canonical Desktop export');
      expect(packageMeaning(localArchive.manifest)).toEqual(packageMeaning(restored));
      await app.close();
      app = undefined;

      await connectExchangeBrowser(mobileContext, baseUrl);
      const mobile = await mobileContext.newPage();
      await loginExchangeBrowser(mobile, `crosshost-return-${kind}@example.test`);
      const returned = await test.step(
        'Import actual Desktop output into a different Web owner',
        () => importExchangeBrowser(mobile, localFile),
        { timeout: 30000 },
      );
      expect(returned.summary.id).not.toBe(formal.summary.id);
      expect(returned.summary.id).not.toBe(imported.summary.id);
      expect(packageMeaning(returned)).toEqual(packageMeaning(localArchive.manifest));
      expect(returned.summary.hasSuccessfulTrial).toBe(false);
      expect(
        returned.assets.some((asset) => imported.assets.some((old) => old.id === asset.id)),
      ).toBe(false);
      expect(image.calls).toHaveLength(1);
      const final = await service.snapshot();
      expect(final.imageCalls).toEqual(cloudState.imageCalls);
      expect(final.modelCalls).toEqual(cloudState.modelCalls);
      await info.attach('actual-crosshost-trial', {
        contentType: 'application/json',
        body: JSON.stringify({
          kind,
          cloudWorker,
          cloudRevision: formal.document.revisionId,
          importedRevision: imported.document.revisionId,
          returnedRevision: returned.document.revisionId,
          ids: [formal.summary.id, imported.summary.id, returned.summary.id],
          cloudImageCalls: cloudState.imageCalls,
          localImageCalls: image.calls,
          localState,
          sourceMeaning: packageMeaning(returned),
          real: 'New Agent/PG/actual cloud worker; Electron IPC/real local generation/SQLite/files/two new PIDs; Mobile Web import to another actual owner',
          controlled:
            'account/text/image/GitHub/S3 upstream and native picker path injection; no SQL trial or formal qualification; not installed-platform or natural-lease/worker-crash proof',
        }),
      });
    } catch (error) {
      await info.attach('crosshost-service-state', {
        contentType: 'application/json',
        body: JSON.stringify(await service.snapshot()),
      });
      if (app)
        await info.attach('crosshost-desktop-page', {
          contentType: 'text/plain',
          body: await (await v25ShellPage(app)).locator('body').innerText(),
        });
      throw error;
    } finally {
      await app?.close();
      for (const context of [webContext, mobileContext]) {
        for (const page of context.pages()) await page.goto('about:blank');
        await context.unrouteAll({ behavior: 'wait' });
        await context.close();
      }
      image.release();
      localServer.closeAllConnections();
      await new Promise<void>((resolve) => localServer.close(() => resolve()));
      await service.dispose();
      if (userData) rmSync(userData, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  });
}
