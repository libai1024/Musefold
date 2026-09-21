import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import {
  designSchemeDetailSchema,
  selectCoverDesignSchemeResultSchema,
  formalizeDesignSchemeResultSchema,
} from '@musefold/contracts';
import { readValidatedDesignSchemePackageBytes } from '@musefold/scheme-package';
import type { PackageExchangeProcess } from './package-exchange-process';
import { seedOnboardingCompleted } from './onboarding-helpers';

export async function connectExchangeBrowser(context: BrowserContext, baseUrl: string) {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    // Keep the browser request lifecycle: abort/navigation closes the same upstream request.
    // A separate route.fetch survives cancellation and can fulfill an already finished route.
    // Native forwarding preserves actual BA cookies, status and bytes without fabricating data.
    return route.continue({ url: `${baseUrl}${url.pathname}${url.search}` });
  });
}
export async function browserJson(page: Page, path: string, body?: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        credentials: 'include',
        ...(body === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
      if (!response.ok) throw new Error(`Exchange HTTP ${response.status} ${path}`);
      return response.json();
    },
    { path, body },
  );
}
export async function loginExchangeBrowser(page: Page, email: string) {
  await seedOnboardingCompleted(page);
  await page.goto('/design-schemes');
  await browserJson(page, '/api/auth/sign-up/new-api', { email, password: 'correct-password' });
  await page.reload();
  await expect(page.getByTestId('scheme-create')).toBeVisible();
  return browserJson(page, '/api/v1/account/status');
}
export async function importExchangeBrowser(
  page: Page,
  file: string,
  formatVersion: 1 | 2 = 2,
  timeout = 5000,
) {
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-import').click();
  await page.getByTestId('scheme-package-file').setInputFiles(file);
  if (formatVersion === 1) await page.getByRole('radio', { name: '旧版方案包（格式 1）' }).check();
  await page.getByTestId('scheme-package-upload').click();
  await expect(page.getByTestId('scheme-package-preview')).toBeVisible({ timeout });
  await page.getByTestId('scheme-package-confirm').click();
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible({ timeout });
  const url = new URL(page.url());
  const id = url.searchParams.get('scheme');
  if (!id || id === 'design-schemes') throw new Error('Missing imported route identity');
  const detail = designSchemeDetailSchema.parse(
    await browserJson(page, `/api/v1/design-schemes/${id}`),
  );
  expect(detail.summary.status).toBe('draft');
  expect(detail.summary.hasSuccessfulTrial).toBe(false);
  expect(detail.document.createdBy).toBe('import');
  expect(detail.document.parentRevisionId).toBe(null);
  return detail;
}
export async function qualifyExchangeBrowser(
  page: Page,
  service: Pick<PackageExchangeProcess, 'seedTrial'>,
  id: string,
) {
  await service.seedTrial(id);
  const detail = designSchemeDetailSchema.parse(
    await browserJson(page, `/api/v1/design-schemes/${id}`),
  );
  const assetId = detail.assets.find(
    (asset) => asset.origin === 'cloud-run' && asset.role !== 'reference',
  )?.id;
  if (!assetId) throw new Error('Missing cloud trial eligibility fixture asset');
  const selected = selectCoverDesignSchemeResultSchema.parse(
    await browserJson(page, '/api/v1/design-schemes/select-cover', {
      schemeId: id,
      assetId,
      expectedVersion: detail.summary.version,
    }),
  );
  formalizeDesignSchemeResultSchema.parse(
    await browserJson(page, '/api/v1/design-schemes/formalize', {
      schemeId: id,
      revisionId: detail.document.revisionId,
      coverAssetId: assetId,
      expectedVersion: selected.scheme.version,
      confirmed: true,
    }),
  );
  await page.reload();
}
export async function exportExchangeBrowser(page: Page, file: string) {
  // A success toast can cover the menu and pause its timeout while hovered.
  // Move off it before waiting, just as a pointer user would before opening the menu.
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
  await page.getByTestId('runtime-scheme-menu').click();
  await page.getByTestId('runtime-scheme-menu-export').click();
  await page.getByTestId('scheme-package-export-action').click();
  await expect(page.getByTestId('scheme-package-export-action')).toHaveText('下载并保存');
  const pending = page.waitForEvent('download');
  await page.getByTestId('scheme-package-export-action').click();
  await (await pending).saveAs(file);
  await expect(page.getByTestId('scheme-package-export-result')).toContainText('已交给浏览器下载');
  const bytes = await readFile(file);
  const archive = await readValidatedDesignSchemePackageBytes(bytes);
  if (archive.formatVersion !== 2) throw new Error('Expected canonical export');
  return { archive, bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') };
}
