import { expect, type Page, type Route, type TestInfo } from '@playwright/test';
import { designSchemeDetailSchema, type DesignSchemeDetail } from '@musefold/contracts';
import type { AgentBrowserProcess } from './agent-browser-process';
import { browserJson } from './package-exchange-browser';

/** Hold only the read transport after a real promotion; no synthetic write/result. */
export function promoteWithDelayedDetail(page: Page, service: AgentBrowserProcess, info: TestInfo) {
  return async (working: DesignSchemeDetail) => {
    const path = `/api/v1/design-schemes/${working.summary.id}`;
    const before = await service.snapshot();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldReads = 0;
    let posts = 0;
    const pattern = `**${path}*`;
    const hold = async (route: Route) => {
      if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === path) {
        heldReads++;
        await gate;
      }
      await route.fallback();
    };
    const observe = (request: import('@playwright/test').Request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/v1/design-schemes/promote-working-draft'
      )
        posts++;
    };
    page.on('request', observe);
    await page.route(pattern, hold);
    try {
      await page.getByTestId('runtime-scheme-promote-working-draft').click();
      await expect.poll(() => heldReads).toBeGreaterThan(0);
      for (const id of [
        'runtime-scheme-menu',
        'runtime-scheme-modify',
        'runtime-scheme-primary-action',
        'runtime-scheme-trial-working-draft',
        'runtime-scheme-promote-working-draft',
      ]) {
        await expect(page.getByTestId(id)).toBeDisabled();
      }
      await expect(page.getByTestId('runtime-scheme-detail')).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByTestId('runtime-scheme-version-pending')).toContainText(
        '正在确认方案最新版本',
      );
      await page.getByTestId('runtime-scheme-detail').screenshot({
        path: info.outputPath(`promotion-refresh-${working.document.revisionId}.png`),
      });
      expect(posts).toBe(1);
      release();
      await expect(page.getByTestId('runtime-scheme-working-draft')).toHaveCount(0);
      await expect(page.getByTestId('runtime-scheme-menu')).toBeEnabled();
      await expect(page.getByTestId('runtime-scheme-version-pending')).toHaveCount(0);
      const current = designSchemeDetailSchema.parse(await browserJson(page, path));
      expect(current.summary).toMatchObject({
        currentRevisionId: working.document.revisionId,
        workingDraftRevisionId: null,
        version: working.summary.version + 1,
      });
      const after = await service.snapshot();
      expect(after.imageCalls).toEqual(before.imageCalls);
      expect(after.modelCalls).toEqual(before.modelCalls);
      expect(posts).toBe(1);
    } finally {
      release();
      page.off('request', observe);
      await page.unroute(pattern, hold);
    }
  };
}
