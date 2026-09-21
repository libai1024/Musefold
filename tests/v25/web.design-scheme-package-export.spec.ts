import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemeSummarySchema,
  type DesignSchemePackageExport,
  type DesignSchemePackageExportRecovery,
} from '@musefold/contracts';
import { seedOnboardingCompleted } from './onboarding-helpers';

// Production UI/host/File/stream/SHA-256 and actual browser download. HTTP uses synthetic non-ZIP fixture bytes.
const bytes = Buffer.from('complete-export-ui-fixture');
const hash = createHash('sha256').update(bytes).digest('hex');
const now = '2026-09-09T00:00:00.000Z';
const scheme = designSchemeSummarySchema.parse({
  id: 'exported_scheme',
  name: '正式海报方案',
  summary: '合成方案，仅用于界面验收',
  status: 'formal',
  hasSuccessfulTrial: true,
  coverAssetId: 'cover_asset',
  sourcePresentation: 'musefold-created',
  sourceLabel: '分享包',
  currentRevisionId: 'formal_revision',
  workingDraftRevisionId: 'unverified_draft',
  version: 7,
  fidelity: 'adapted',
  createdAt: now,
  updatedAt: now,
});
const detail = designSchemeDetailSchema.parse({
  summary: scheme,
  document: {
    schemaVersion: 1,
    revisionId: scheme.currentRevisionId,
    schemeId: scheme.id,
    name: scheme.name,
    summary: scheme.summary,
    fidelity: scheme.fidelity,
    sources: [],
    inputs: [],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'main',
        order: 0,
        kind: 'system-rule',
        template: 'A poster',
        variables: [],
        sourceIds: [],
      },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  },
  assets: [],
  sourceSnapshots: [],
});
async function install(
  page: Page,
  options: { lostBegin?: boolean; corrupt?: boolean; denied?: boolean } = {},
) {
  await seedOnboardingCompleted(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  let stage: DesignSchemePackageExport;
  const calls = { begins: [] as unknown[], get: 0, content: 0, cancel: 0, legacy: 0 };
  const control = {
    corrupt: options.corrupt ?? false,
    hold: null as Promise<void> | null,
    blocked: null as DesignSchemePackageExportRecovery['blockedReason'],
  };
  const record = () => ({
    export: stage,
    expectedVersion: 7,
    createdAt: now,
    schemeName: scheme.name,
  });
  const json = (value: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
  });
  await page.context().route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path === '/account/status')
      return route.fulfill(
        json({
          id: 'account',
          username: 'tester',
          displayName: '测试账号',
          quota: 0,
          quotaUnit: '积分',
          canGenerate: false,
        }),
      );
    if (path === '/workbench/sessions') return route.fulfill(json({ items: [], nextCursor: null }));
    if (path === '/generations/providers') return route.fulfill(json([]));
    if (path === '/design-schemes')
      return route.fulfill(json({ items: [scheme], nextCursor: null }));
    if (path === `/design-schemes/${scheme.id}`) return route.fulfill(json(detail));
    if (path === '/design-schemes/export-package') {
      calls.legacy++;
      return route.fulfill(json({}, 501));
    }
    if (path === '/design-schemes/package-exports' && request.method() === 'GET')
      return route.fulfill(json({ items: stage ? [record()] : [], nextCursor: null }));
    if (path === '/design-schemes/package-exports/export_1/recovery') {
      const reason = control.blocked ?? (stage.status === 'ready' ? null : 'export_unavailable');
      return route.fulfill(
        json({ ...record(), canDownload: reason === null, blockedReason: reason }),
      );
    }
    if (path === '/design-schemes/package-exports' && request.method() === 'POST') {
      const input = request.postDataJSON();
      calls.begins.push(input);
      expect(input).toMatchObject({
        schemeId: scheme.id,
        revisionId: 'formal_revision',
        expectedVersion: 7,
        formatVersion: 2,
      });
      stage = {
        exportId: 'export_1',
        requestId: input.requestId,
        schemeId: input.schemeId,
        revisionId: input.revisionId,
        formatVersion: 2,
        status: 'ready',
        packageHash: hash,
        sizeBytes: bytes.length,
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
      if (options.lostBegin && calls.begins.length === 1)
        return route.fulfill(
          json(
            {
              error: {
                code: 'INTERNAL_ERROR',
                requestId: 'fixture_request',
                message: '响应暂未送达',
                retryable: true,
              },
            },
            503,
          ),
        );
      return route.fulfill(json(stage));
    }
    if (path === '/design-schemes/package-exports/export_1') {
      if (request.method() === 'DELETE') {
        calls.cancel++;
        stage = { ...stage, status: 'cancelled' };
        return route.fulfill(json(stage));
      }
      calls.get++;
      if (options.denied)
        return route.fulfill(
          json(
            {
              error: {
                code: 'ACCOUNT_IDENTITY_SOURCE_CHANGED',
                requestId: 'fixture_request',
                message: '导出权限已失效',
                retryable: false,
              },
            },
            403,
          ),
        );
      return route.fulfill(json(stage));
    }
    if (path === '/design-schemes/package-exports/export_1/content') {
      calls.content++;
      if (control.hold) await control.hold;
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { 'content-length': String(bytes.length) },
        body: control.corrupt ? Buffer.alloc(bytes.length) : bytes,
      });
    }
    return route.fulfill(
      json({ error: { code: 'NOT_FOUND', message: path, retryable: false } }, 404),
    );
  });
  await page.goto(`/design-schemes?scheme=${scheme.id}`);
  const heading = page
    .getByTestId('runtime-scheme-detail')
    .getByRole('heading', { name: scheme.name, exact: true });
  await expect(heading).toBeVisible();
  // Actions must not compress a normal Chinese title into a single vertical character column.
  const bounds = await heading.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(120);
  expect(bounds?.height).toBeLessThan(80);
  const notice = await page
    .getByTestId('runtime-scheme-working-draft')
    .locator('p')
    .first()
    .boundingBox();
  expect(notice?.width).toBeGreaterThanOrEqual(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByTestId('runtime-scheme-menu').click();
  await page.getByTestId('runtime-scheme-menu-export').click();
  await expect(page.getByTestId('scheme-package-export')).toBeVisible();
  return { calls, control };
}
async function prepare(page: Page) {
  await page.getByTestId('scheme-package-export-action').click();
  await expect(page.getByTestId('scheme-package-export-ready')).toBeVisible();
}

test('正式方案准备后显式下载，实际浏览器文件大小与SHA256一致', async ({ page }, testInfo) => {
  const f = await install(page);
  await prepare(page);
  expect(f.calls.content).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('scheme-export-ready.png') });
  const pending = page.waitForEvent('download');
  await page.getByTestId('scheme-package-export-action').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Musefold-export_1.musefold.design');
  const saved = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(saved);
  const actual = await readFile(saved);
  expect(actual).toEqual(bytes);
  expect(createHash('sha256').update(actual).digest('hex')).toBe(hash);
  await expect(page.getByTestId('scheme-package-export-result')).toContainText('已交给浏览器下载');
  expect(f.calls.cancel).toBe(0);
  expect(f.calls.legacy).toBe(0);
  await page
    .getByTestId('scheme-package-export')
    .getByRole('button', { name: '关闭', exact: true })
    .last()
    .click();
  await expect(page.getByTestId('runtime-scheme-menu')).toBeFocused();
});

test('损坏文件不触发下载，重试核对同一次归档', async ({ page }) => {
  const f = await install(page, { corrupt: true });
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await prepare(page);
  await page.getByTestId('scheme-package-export-action').click();
  await expect(page.getByRole('alert').filter({ hasText: 'hash mismatch' })).toBeVisible();
  expect(downloads).toEqual([]);
  f.control.corrupt = false;
  const pending = page.waitForEvent('download');
  await page.getByTestId('scheme-package-export-action').click();
  await pending;
  await expect(page.getByTestId('scheme-package-export-result')).toBeVisible();
  expect(f.calls.begins).toHaveLength(1);
  expect(f.calls.content).toBe(2);
});

test('准备响应丢失保留原requestId，关闭后保留原归档', async ({ page }) => {
  const f = await install(page, { lostBegin: true });
  await page.getByTestId('scheme-package-export-action').click();
  await expect(page.getByRole('alert').filter({ hasText: '响应暂未送达' })).toBeVisible();
  await prepare(page);
  expect(f.calls.begins[0]).toEqual(f.calls.begins[1]);
  await page
    .getByTestId('scheme-package-export')
    .getByRole('button', { name: '关闭', exact: true })
    .last()
    .click();
  expect(f.calls.cancel).toBe(0);
  expect(f.calls.content).toBe(0);
});

test('下载前撤权显示失败且没有成功交付', async ({ page }) => {
  const f = await install(page, { denied: true });
  await prepare(page);
  await page.getByTestId('scheme-package-export-action').click();
  await expect(page.getByRole('alert').filter({ hasText: '导出权限已失效' })).toBeVisible();
  expect(f.calls.content).toBe(0);
  await expect(page.getByTestId('scheme-package-export-result')).toHaveCount(0);
});

test('下载等待中关闭会中止客户端，迟到响应不触发文件交付', async ({ page }) => {
  const f = await install(page);
  await prepare(page);
  let release!: () => void;
  f.control.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.getByTestId('scheme-package-export-action').click();
  await expect.poll(() => f.calls.content).toBe(1);
  await page
    .getByTestId('scheme-package-export')
    .getByRole('button', { name: '关闭', exact: true })
    .last()
    .click();
  release();
  expect(f.calls.cancel).toBe(0);
  await expect(page.getByTestId('scheme-package-export')).toHaveCount(0);
  expect(downloads).toEqual([]);
});

async function recoverHistory(page: Page) {
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-export-history').click();
  await page.getByTestId('scheme-package-export-recover-export_1').click();
  await expect(page.getByTestId('scheme-package-export-recovery')).toBeVisible();
}
test('丢准备响应后刷新，从本人记录恢复原归档且不会自动下载', async ({ page }) => {
  const f = await install(page, { lostBegin: true });
  await page.getByTestId('scheme-package-export-action').click();
  await expect(page.getByRole('alert').filter({ hasText: '响应暂未送达' })).toBeVisible();
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.reload();
  await recoverHistory(page);
  await expect(page.getByTestId('scheme-package-export-action')).toHaveText('下载并保存');
  expect(f.calls.begins).toHaveLength(1);
  expect(f.calls.content).toBe(0);
  expect(downloads).toEqual([]);
  const pending = page.waitForEvent('download');
  await page.getByTestId('scheme-package-export-action').click();
  await pending;
  expect(f.calls.content).toBe(1);
  expect(f.calls.cancel).toBe(0);
});
test('第二页面恢复后关闭，不取消第一页面正在下载的原归档', async ({ page, context }) => {
  const f = await install(page);
  await prepare(page);
  let release!: () => void;
  f.control.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = page.waitForEvent('download');
  await page.getByTestId('scheme-package-export-action').click();
  await expect.poll(() => f.calls.content).toBe(1);
  const other = await context.newPage();
  await recoverHistory(other);
  await other.close();
  expect(f.calls.cancel).toBe(0);
  release();
  await pending;
  await expect(page.getByTestId('scheme-package-export-result')).toBeVisible();
  expect(f.calls.begins).toHaveLength(1);
});
test('明确取消有独立确认，取消后的原记录只能核对不能再次下载', async ({ page }) => {
  const f = await install(page);
  await prepare(page);
  await page.getByRole('button', { name: '取消此导出' }).click();
  await page.getByRole('button', { name: '保留记录' }).click();
  expect(f.calls.cancel).toBe(0);
  await page.getByRole('button', { name: '取消此导出' }).click();
  await page.getByRole('button', { name: '确认取消导出' }).click();
  await expect(page.getByTestId('scheme-package-export')).toHaveCount(0);
  expect(f.calls.cancel).toBe(1);
  await recoverHistory(page);
  await expect(page.getByTestId('scheme-package-export-recovery')).toContainText('不能继续下载');
  await page.getByTestId('scheme-package-export-action').click();
  expect(f.calls.begins).toHaveLength(1);
  expect(f.calls.content).toBe(0);
});
test('恢复时账号授权改变只解释原记录，不重新打包或下载', async ({ page }) => {
  const f = await install(page);
  await prepare(page);
  f.control.blocked = 'session_changed';
  await recoverHistory(page);
  await expect(page.getByTestId('scheme-package-export-recovery')).toContainText('登录状态已变化');
  await expect(page.getByTestId('scheme-package-export-action')).not.toHaveText('下载并保存');
  expect(f.calls.content).toBe(0);
  expect(f.calls.begins).toHaveLength(1);
});
