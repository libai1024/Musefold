import { test, expect, type Page, type TestInfo } from '@playwright/test';
import {
  designSchemeDetailSchema,
  promoteWorkingDraftInputSchema,
  type DesignSchemeDetail,
  type PromoteWorkingDraftInput,
} from '@musefold/contracts';
import type { AgentBrowserProcess } from './agent-browser-process';
import { browserJson } from './package-exchange-browser';
import { selectTrialCover } from './web.scheme-promote-helper';

/** Delays the real UI request; the competing write is another real product page. */
export function raceWorkingDraftPromotion(
  page: Page,
  service: AgentBrowserProcess,
  info: TestInfo,
) {
  return async (
    current: DesignSchemeDetail,
    working: DesignSchemeDetail,
    operation: 'modify' | 'update',
  ) => {
    const schemeId = current.summary.id;
    const read = (revisionId?: string) =>
      browserJson(
        page,
        `/api/v1/design-schemes/${schemeId}${revisionId ? `?revisionKind=working-draft&revisionId=${revisionId}` : ''}`,
      ).then((value) => designSchemeDetailSchema.parse(value));
    const before = await read();
    const beforeRuntime = await service.snapshot();
    const revisionId = working.document.revisionId;
    let input: PromoteWorkingDraftInput | undefined;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pattern = '**/api/v1/design-schemes/promote-working-draft';
    await page.route(pattern, async (route) => {
      input = promoteWorkingDraftInputSchema.parse(route.request().postDataJSON());
      await held;
      await route.fallback();
    });
    const other = await page.context().newPage();
    try {
      const response = page
        .waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            r.url().endsWith('/api/v1/design-schemes/promote-working-draft'),
          { timeout: 30000 },
        )
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await test.step('Hold the submitted promotion', async () => {
        await page.getByTestId('runtime-scheme-promote-working-draft').click({ timeout: 10000 });
      });
      await expect
        .poll(() => input)
        .toMatchObject({
          schemeId,
          workingDraftRevisionId: revisionId,
          expectedVersion: before.summary.version,
          confirmed: true,
        });
      await test.step('Open the competing page', async () => {
        await other.goto(`/design-schemes?scheme=${schemeId}`, { timeout: 10000 });
      });
      await expect(other.getByTestId('runtime-scheme-detail')).toHaveAttribute(
        'data-status',
        'formal',
      );
      const competingCover = before.assets.find(
        (asset) => asset.id !== before.summary.coverAssetId && asset.origin === 'cloud-run',
      );
      if (!competingCover) throw new Error('Missing another actual output for cover competition');
      await test.step('Another page selects a different retained cover', async () => {
        await selectTrialCover(other, competingCover.id, before.assets.length);
      });
      const changed = await read();
      expect(changed.summary).toMatchObject({
        coverAssetId: competingCover.id,
        version: before.summary.version + 1,
        currentRevisionId: current.document.revisionId,
        workingDraftRevisionId: revisionId,
      });
      release();
      const received = await response;
      if ('error' in received) throw received.error;
      const denied = received.value;
      expect(denied.status()).toBe(409);
      const error = await denied.json();
      await expect(page.getByText(error.error.message, { exact: true })).toBeVisible();
      const after = await read();
      const retained = await read(revisionId);
      expect(after.summary).toEqual(changed.summary);
      expect(after.document).toEqual(current.document);
      expect(retained.document).toEqual(working.document);
      expect(retained.assets).toEqual(working.assets);
      const afterRuntime = await service.snapshot();
      expect(afterRuntime.schemeRuns).toEqual(beforeRuntime.schemeRuns);
      expect(afterRuntime.generationRuns).toEqual(beforeRuntime.generationRuns);
      expect(afterRuntime.modelCalls).toEqual(beforeRuntime.modelCalls);
      expect(afterRuntime.imageCalls).toEqual(beforeRuntime.imageCalls);
      await page.reload();
      await expect(page.getByTestId('runtime-scheme-working-draft')).toBeVisible();
      // Export requires this revision's cover. Explicitly restore the tried new output;
      // inheriting the competing old revision's cover does not qualify it for export.
      const trialCoverId = before.summary.coverAssetId;
      if (!trialCoverId) throw new Error('Missing explicitly selected working trial cover');
      await selectTrialCover(page, trialCoverId, before.assets.length);
      const refreshed = await read();
      expect(refreshed.summary).toMatchObject({
        version: changed.summary.version + 1,
        coverAssetId: trialCoverId,
        currentRevisionId: current.document.revisionId,
        workingDraftRevisionId: revisionId,
      });
      const refreshedRuntime = await service.snapshot();
      expect(refreshedRuntime.imageCalls).toEqual(beforeRuntime.imageCalls);
      expect(refreshedRuntime.modelCalls).toEqual(beforeRuntime.modelCalls);
      await info.attach(`promotion-race-${operation}`, {
        contentType: 'application/json',
        body: JSON.stringify({
          operation,
          input,
          rejectedStatus: denied.status(),
          error,
          beforeVersion: before.summary.version,
          competingVersion: changed.summary.version,
          competingCoverId: competingCover.id,
          refreshedVersion: refreshed.summary.version,
          restoredTrialCoverId: trialCoverId,
          formalRevision: current.document.revisionId,
          retainedWorkingRevision: revisionId,
          retainedAssetHashes: retained.assets.map((asset) => asset.contentHash),
          imageCalls: afterRuntime.imageCalls.length,
          textCalls: afterRuntime.modelCalls.length,
        }),
      });
      // The caller performs a fresh, explicit promotion. No implicit retry or new generation.
    } finally {
      release();
      await page.unroute(pattern);
      await other.close();
    }
  };
}
