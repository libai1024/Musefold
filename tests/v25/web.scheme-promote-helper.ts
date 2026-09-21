import { createHash } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemeRunInputSchema,
  type DesignSchemeDetail,
} from '@musefold/contracts';
import type { AgentBrowserProcess } from './agent-browser-process';
import { browserJson } from './package-exchange-browser';

/** Explicit file choice using actual retained bytes; retention alone never authorizes image input. */
export async function selectTrialReferences(page: Page, detail: DesignSchemeDetail) {
  const repositoryIds = detail.document.repositoryImages?.map((image) => image.assetId);
  const assets = detail.assets.filter((asset) =>
    repositoryIds?.length ? repositoryIds.includes(asset.id) : true,
  );
  expect(assets.length).toBeGreaterThan(0);
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
  const files = [];
  for (const asset of assets) {
    const bytes = await page.evaluate(async (assetId) => {
      const response = await fetch(`/api/v1/design-schemes/assets/${assetId}/content`);
      if (!response.ok) throw new Error(`Reference content ${response.status}`);
      return Array.from(new Uint8Array(await response.arrayBuffer()));
    }, asset.id);
    const buffer = Buffer.from(bytes);
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(asset.contentHash);
    files.push({ name: `${asset.id}.png`, mimeType: asset.mimeType, buffer });
  }
  await page.getByTestId('composer-file-input').setInputFiles(files);
  try {
    await expect(page.getByTestId('composer-submit')).toBeEnabled();
  } catch (error) {
    // The caller closes its browser in finally; capture the actual gate before it disappears.
    try {
      await test.info().attach('trial-reference-gate', {
        body: await page.locator('body').ariaSnapshot(),
        contentType: 'text/plain',
      });
    } catch {
      // Diagnostics must preserve the original assertion failure.
    }
    throw error;
  }
  return assets.map((asset) => asset.contentHash).sort();
}

/** Pick one exact generated asset, not another history image with the same provenance label. */
export async function selectTrialCover(page: Page, assetId: string, assetCount: number) {
  // A document navigation can finish before the account/current/working-draft queries.
  // Wait for the actual detail surface, not merely a separate API observer's success.
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible({ timeout: 30_000 });
  const album = page.getByTestId('runtime-scheme-album');
  const shown = album.getByRole('img', { name: '方案示例', exact: true });
  await expect(shown).toHaveAttribute('src', /\/content$/);
  for (let index = 0; index < assetCount; index++) {
    if ((await shown.getAttribute('src'))?.includes(`/${assetId}/content`)) break;
    const previous = await shown.getAttribute('src');
    await album.getByRole('button', { name: '下一张', exact: true }).click();
    await expect(shown).not.toHaveAttribute('src', previous ?? '');
  }
  await expect(shown).toHaveAttribute('src', new RegExp(`/${assetId}/content$`));
  await page.getByTestId('runtime-scheme-set-cover').click();
  // The mutation includes the authoritative detail refresh. Live authentication
  // can outlast Playwright's 5s assertion default; keep the exact-cover assertion
  // and a bounded wait, without replaying the write or sleeping a fixed duration.
  await expect(page.getByTestId('runtime-scheme-set-cover')).toHaveCount(0, { timeout: 30_000 });
  await expect(shown).toHaveAttribute('src', new RegExp(`/${assetId}/content$`));
}

/** Continue from a genuinely tried/formal Agent result; never grants trial state itself. */
export async function iterateFormalScheme(
  page: Page,
  service: AgentBrowserProcess,
  formal: DesignSchemeDetail,
  beforePromote?: (
    current: DesignSchemeDetail,
    working: DesignSchemeDetail,
    operation: 'modify' | 'update',
  ) => Promise<void>,
  performPromotion?: (working: DesignSchemeDetail) => Promise<void>,
) {
  const id = formal.summary.id;
  const read = (revisionId?: string) =>
    browserJson(
      page,
      `/api/v1/design-schemes/${id}${revisionId ? `?revisionKind=working-draft&revisionId=${encodeURIComponent(revisionId)}` : ''}`,
    ).then((value) => designSchemeDetailSchema.parse(value));
  let current = formal;
  for (const operation of ['modify', 'update'] as const) {
    const textBefore = (await service.snapshot()).modelCalls.length;
    if (operation === 'modify') {
      await page.getByTestId('runtime-scheme-modify').click();
      await page.getByTestId('composer-prompt').fill('保留来源和图片，调整标题层次');
      await page.getByTestId('composer-submit').click();
      await page.getByTestId('scheme-agent-model-offer').click();
      await page.getByTestId('scheme-agent-authorize-modify').click();
    } else {
      await service.githubVersion('changed');
      await page.getByTestId('runtime-scheme-menu').click();
      await page.getByTestId('runtime-scheme-menu-check-update').click();
      await page.getByTestId('scheme-agent-check-update').click();
      await expect(page.getByTestId('scheme-agent-source')).toContainText('example/design');
      expect((await service.snapshot()).modelCalls).toHaveLength(textBefore);
      await page.getByTestId('scheme-agent-confirm-source').click();
      await page.getByTestId('scheme-agent-model-offer').click();
      await page.getByTestId('scheme-agent-authorize-check-update').click();
    }
    await page.getByTestId('scheme-agent-open-result').click({ timeout: 20000 });
    await expect(page.getByTestId('runtime-scheme-working-draft')).toBeVisible();
    const staged = await read();
    expect(staged.document.revisionId).toBe(current.document.revisionId);
    expect(staged.summary.status).toBe('formal');
    const revision = staged.summary.workingDraftRevisionId;
    if (!revision) throw new Error('Missing new working draft');
    const working = await read(revision);
    expect(working.document.parentRevisionId).toBe(current.document.revisionId);
    await page.getByTestId('runtime-scheme-promote-working-draft').click();
    await expect(page.getByText('还不能更新正式版本', { exact: true })).toBeVisible();
    expect((await read()).document.revisionId).toBe(current.document.revisionId);
    const before = await service.snapshot();
    await page.getByTestId('runtime-scheme-trial-working-draft').click();
    await page.getByTestId('scheme-run-variable-topic').fill(`新版本${operation}试跑`);
    await page.getByTestId('composer-prompt').fill('核对新版本');
    const referenceHashes = await selectTrialReferences(page, working);
    const sent = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().endsWith('/api/v1/design-schemes/run'),
    );
    await service.imageMode('hold');
    await page.getByTestId('composer-submit').click();
    const prepared = designSchemeRunInputSchema.parse((await sent).postDataJSON());
    expect(prepared.revisionId).toBe(revision);
    expect(prepared.mode).toBe('trial');
    await expect
      .poll(async () => (await service.snapshot()).imageCalls.length, { timeout: 20000 })
      .toBe(before.imageCalls.length + 1);
    expect((await read()).document.revisionId).toBe(current.document.revisionId);
    expect((await service.snapshot()).modelCalls).toEqual(before.modelCalls);
    const imageCall = (await service.snapshot()).imageCalls.at(-1);
    expect(imageCall?.endpoint).toBe('/v1/images/edits');
    expect(imageCall?.references.map((reference) => reference.hash).sort()).toEqual(
      referenceHashes,
    );
    await service.releaseImage();
    await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('', { timeout: 20000 });
    await page.goto(`/design-schemes?scheme=${encodeURIComponent(id)}`);
    const finished = await service.snapshot();
    const output = finished.schemeAssets.find(
      (asset) => asset.revision_id === revision && asset.role === 'output',
    );
    if (!output) throw new Error('Missing current revision trial output');
    await selectTrialCover(page, output.id, (await read(revision)).assets.length);
    await beforePromote?.(current, await read(revision), operation);
    if (performPromotion) await performPromotion(await read(revision));
    else await page.getByTestId('runtime-scheme-promote-working-draft').click();
    await expect(page.getByTestId('runtime-scheme-working-draft')).toHaveCount(0);
    const promoted = await read();
    expect(promoted.summary.status).toBe('formal');
    expect(promoted.summary.currentRevisionId).toBe(revision);
    expect(promoted.summary.workingDraftRevisionId).toBeNull();
    const snapshot = await service.snapshot();
    expect(snapshot.schemeRuns).toContainEqual(
      expect.objectContaining({ revision_id: revision, status: 'completed', mode: 'trial' }),
    );
    expect(snapshot.imageCalls).toHaveLength(before.imageCalls.length + 1);
    current = promoted;
  }
  return current;
}
