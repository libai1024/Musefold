import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import Database from 'better-sqlite3';
import { expect, type Page } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemePageSchema,
  type DesignSchemeDetail,
} from '@musefold/contracts';
import { designSchemeDbPath, desktopDbPath } from './electron-helpers';
import { localInvoke } from './local-execution-fixture';

export const desktopScheme = async (page: Page, id: string) =>
  designSchemeDetailSchema.parse(await localInvoke(page, 'designSchemes.get', { id }));

export async function openDesktopScheme(page: Page, id: string) {
  await page.getByTestId('nav-design-schemes').click();
  const back = page.getByTestId('runtime-scheme-detail-back');
  if (await back.isVisible()) await back.click();
  await page.getByTestId(`runtime-scheme-open-${id}`).click();
  await page.getByTestId('scheme-inspector-open-detail').click();
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
}

export async function importDesktopTrialPackage(page: Page, timeout = 5000) {
  const before = designSchemePageSchema.parse(await localInvoke(page, 'designSchemes.list', {}));
  await page.getByTestId('nav-design-schemes').click();
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-import').click();
  await expect(page.getByText('已导入为草稿', { exact: true })).toBeVisible({ timeout });
  const after = designSchemePageSchema.parse(await localInvoke(page, 'designSchemes.list', {}));
  const added = after.items.filter((item) => !before.items.some((old) => old.id === item.id));
  expect(added).toHaveLength(1);
  const detail = await desktopScheme(page, added[0].id);
  expect(detail.summary.status).toBe('draft');
  expect(detail.summary.hasSuccessfulTrial).toBe(false);
  expect(detail.document).toMatchObject({ createdBy: 'import', parentRevisionId: null });
  return detail;
}

/** Inspect imported local bytes only. Qualification is always earned by the real run below. */
export function inspectDesktopTrial(userData: string, detail: DesignSchemeDetail) {
  const schemes = new Database(designSchemeDbPath(userData), { readonly: true });
  const core = new Database(desktopDbPath(userData), { readonly: true });
  try {
    const assets = schemes
      .prepare(
        'SELECT id,revision_id,store_key,content_hash FROM design_scheme_assets WHERE revision_id=?',
      )
      .all(detail.document.revisionId) as Array<{
      id: string;
      revision_id: string;
      store_key: string;
      content_hash: string;
    }>;
    const content = assets.map((asset) => {
      const bytes = readFileSync(
        isAbsolute(asset.store_key) ? asset.store_key : join(userData, asset.store_key),
      );
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash).toBe(asset.content_hash);
      return { id: asset.id, hash, bytes: bytes.length };
    });
    const runs = schemes
      .prepare('SELECT run_id,revision_id,mode,status FROM design_scheme_runs WHERE revision_id=?')
      .all(detail.document.revisionId);
    const jobs = core
      .prepare('SELECT id,status,user_prompt FROM generation_runs ORDER BY created_at')
      .all();
    const outputs = core
      .prepare('SELECT id,run_id,status FROM generated_assets ORDER BY created_at')
      .all();
    const retained = core
      .prepare('SELECT params_json FROM generation_runs ORDER BY created_at')
      .all() as Array<{ params_json: string }>;
    const references = retained.flatMap((row) => {
      const params = JSON.parse(row.params_json) as { referenceImages?: Array<{ path: string }> };
      return (params.referenceImages ?? []).map((image) => {
        const path = realpathSync(isAbsolute(image.path) ? image.path : join(userData, image.path));
        const suffix = relative(realpathSync(userData), path);
        expect(
          suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix),
        ).toBe(true);
        return createHash('sha256').update(readFileSync(path)).digest('hex');
      });
    });
    return { content, runs, jobs, outputs, references };
  } finally {
    schemes.close();
    core.close();
  }
}

export async function selectDesktopSourceReferences(
  page: Page,
  userData: string,
  detail: DesignSchemeDetail,
) {
  const ids = new Set([
    ...(detail.document.repositoryImages ?? []).map((image) => image.assetId),
    ...detail.sourceSnapshots.flatMap(
      (source) =>
        source.historyItems?.flatMap((item) => (item.imageAssetId ? [item.imageAssetId] : [])) ??
        [],
    ),
  ]);
  const assets = detail.assets.filter((asset) => ids.has(asset.id));
  expect(assets.length).toBeGreaterThan(0);
  expect(assets).toHaveLength(ids.size);
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
  const db = new Database(designSchemeDbPath(userData), { readonly: true });
  try {
    const files = assets.map((asset) => {
      const row = db
        .prepare('SELECT store_key FROM design_scheme_assets WHERE id=?')
        .get(asset.id) as { store_key: string };
      const buffer = readFileSync(
        isAbsolute(row.store_key) ? row.store_key : join(userData, row.store_key),
      );
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(asset.contentHash);
      return { name: `${asset.id}.png`, mimeType: asset.mimeType, buffer };
    });
    await page.getByTestId('composer-file-input').setInputFiles(files);
  } finally {
    db.close();
  }
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  return assets.map((asset) => asset.contentHash).sort();
}

export async function selectDesktopTrialCover(
  page: Page,
  detail: DesignSchemeDetail,
  assetId: string,
) {
  const album = page.getByTestId('runtime-scheme-album');
  const shown = album.getByRole('img', { name: '方案示例', exact: true });
  const source = `media://scheme-asset/${assetId}`;
  await expect(album.getByText(new RegExp(`^\\d+ / ${detail.assets.length}$`))).toBeVisible();
  await expect(shown).toHaveAttribute('src', /^media:\/\/scheme-asset\//);
  for (let index = 0; index < detail.assets.length; index++) {
    if ((await shown.getAttribute('src')) === source) break;
    const previous = await shown.getAttribute('src');
    await album.getByRole('button', { name: '下一张', exact: true }).click();
    await expect(shown).not.toHaveAttribute('src', previous ?? '');
  }
  await expect(shown).toHaveAttribute('src', source);
  const select = page.getByTestId('runtime-scheme-set-cover');
  if (await select.isVisible()) await select.click();
  await expect(select).toHaveCount(0);
  expect((await desktopScheme(page, detail.summary.id)).summary.coverAssetId).toBe(assetId);
}
