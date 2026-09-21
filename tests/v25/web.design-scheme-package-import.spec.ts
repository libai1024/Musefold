import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import {
  designSchemeDetailSchema,
  designSchemeSummarySchema,
  type DesignSchemePackageStage,
} from '@musefold/contracts';
import { seedOnboardingCompleted } from './onboarding-helpers';

// Real production Web/features/api-client and browser File/SHA-256. HTTP responses are contract fixtures.
const bytes = Buffer.from('synthetic-package-ui-fixture');
const hash = createHash('sha256').update(bytes).digest('hex');
const now = '2026-09-09T00:00:00.000Z';
const scheme = designSchemeSummarySchema.parse({
  id: 'imported_scheme',
  name: '导入的海报方案',
  summary: '合成方案，仅用于界面验收',
  status: 'draft',
  sourcePresentation: 'musefold-created',
  sourceLabel: '分享包',
  currentRevisionId: 'imported_revision',
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
  options: { lostImport?: boolean; lostBegin?: boolean; guest?: boolean } = {},
) {
  await seedOnboardingCompleted(page);
  let stage: DesignSchemePackageStage;
  const calls = { begin: 0, upload: 0, confirm: 0, import: 0, cancel: 0, format: 0 };
  let imported = false;
  const json = (data: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
  await page.context().route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path === '/account/status')
      return route.fulfill(
        options.guest
          ? json({ error: { code: 'AUTH_REQUIRED', message: '请登录', retryable: false } }, 401)
          : json({
              id: 'test_account',
              username: 'fixture',
              displayName: '测试账号',
              quota: 0,
              quotaUnit: '积分',
              canGenerate: false,
            }),
      );
    if (path === '/workbench/sessions') return route.fulfill(json({ items: [], nextCursor: null }));
    if (path === '/generations/providers') return route.fulfill(json([]));
    if (path === '/design-schemes')
      return route.fulfill(json({ items: imported ? [scheme] : [], nextCursor: null }));
    if (path === `/design-schemes/${scheme.id}`) return route.fulfill(json(detail));
    const recoveryItem = () => ({
      stage,
      createdAt: now,
      execution: imported ? 'completed' : 'not_started',
      receipt: imported ? { scheme, revisionId: scheme.currentRevisionId, status: 'draft' } : null,
      canContinue: !imported && !['cancelled', 'expired'].includes(stage.status),
      blockedReason:
        !imported && ['cancelled', 'expired'].includes(stage.status) ? 'stage_unavailable' : null,
    });
    if (path === '/design-schemes/packages' && request.method() === 'GET')
      return route.fulfill(json({ items: stage ? [recoveryItem()] : [], nextCursor: null }));
    if (path === '/design-schemes/packages/upload_stage/recovery')
      return route.fulfill(json(recoveryItem()));
    if (path === '/design-schemes/packages' && request.method() === 'POST') {
      calls.begin++;
      const input = request.postDataJSON();
      expect(input.packageHash).toBe(hash);
      expect(input.sizeBytes).toBe(bytes.length);
      calls.format = input.formatVersion;
      stage = {
        ...input,
        stagedPackageId: 'upload_stage',
        status: 'awaiting_upload',
        parserVersion: 1,
        confirmationHash: null,
        preview: null,
        expiresAt: '2030-01-01T00:00:00.000Z',
      };
      if (options.lostBegin && calls.begin === 1) return route.abort('failed');
      return route.fulfill(json(stage));
    }
    if (path === '/design-schemes/packages/upload_stage/content') {
      calls.upload++;
      expect(request.postDataBuffer()).toEqual(bytes);
      stage = {
        ...stage,
        status: 'ready',
        confirmationHash: 'b'.repeat(64),
        preview: {
          name: scheme.name,
          summary: scheme.summary,
          sourceCount: 1,
          imageCount: 2,
          entryCount: 6,
          legacyPreviewCount: calls.format === 1 ? 1 : 0,
        },
      };
      return route.fulfill(json(stage));
    }
    if (path === '/design-schemes/packages/upload_stage/decision') {
      calls.confirm++;
      expect(request.postDataJSON()).toEqual({
        packageHash: hash,
        formatVersion: calls.format,
        parserVersion: 1,
        confirmationHash: stage.confirmationHash,
        decision: 'confirm',
      });
      stage = { ...stage, status: 'confirmed' };
      return route.fulfill(json(stage));
    }
    if (path === '/design-schemes/packages/upload_stage') {
      if (request.method() === 'DELETE') {
        calls.cancel++;
        if (!imported) stage = { ...stage, status: 'cancelled' };
      }
      return route.fulfill(json(stage));
    }
    if (path === '/design-schemes/import-package') {
      calls.import++;
      expect(request.postDataJSON()).toEqual({
        stagedPackageId: stage.stagedPackageId,
        packageHash: hash,
        formatVersion: calls.format,
      });
      imported = true;
      stage = { ...stage, status: 'imported' };
      if (options.lostImport && calls.import === 1)
        return route.fulfill(
          json(
            {
              error: {
                code: 'INTERNAL_ERROR',
                message: '导入响应暂未送达，请重试核对',
                retryable: true,
              },
            },
            503,
          ),
        );
      return route.fulfill(json({ scheme, revisionId: scheme.currentRevisionId, status: 'draft' }));
    }
    return route.fulfill(
      json(
        { error: { code: 'NOT_FOUND', message: 'fixture route absent', retryable: false } },
        404,
      ),
    );
  });
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-import').click();
  await expect(page.getByTestId('scheme-package-import')).toBeVisible();
  return calls;
}
async function upload(page: Page) {
  await page.getByTestId('scheme-package-file').setInputFiles({
    name: 'poster.musefold.design',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });
  await page.getByTestId('scheme-package-upload').click();
  await expect(page.getByTestId('scheme-package-preview')).toBeVisible();
}

test('explicit package preview, focus containment and import navigation', async ({ page }) => {
  const calls = await install(page);
  await upload(page);
  expect(calls.confirm).toBe(0);
  expect(calls.import).toBe(0);
  await expect(page.getByTestId('scheme-package-import')).toHaveScreenshot(
    'scheme-package-preview.png',
  );
  await page.getByTestId('scheme-package-confirm').focus();
  await page.keyboard.press('Tab');
  const focusInDialog = await page
    .getByTestId('scheme-package-import')
    .evaluate((dialog) => dialog.contains(document.activeElement));
  expect(focusInDialog).toBe(true);
  await page.getByTestId('scheme-package-confirm').click();
  await expect(page).toHaveURL(/scheme=imported_scheme/);
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  expect(calls).toMatchObject({ begin: 1, upload: 1, confirm: 1, import: 1, format: 2 });
});

test('legacy package review and lost import response recover the same receipt', async ({
  page,
}) => {
  const calls = await install(page, { lostImport: true });
  await page.getByRole('radio', { name: '旧版方案包（格式 1）' }).check();
  await upload(page);
  await expect(page.getByText(/预览图不代表试运行成功/)).toBeVisible();
  await page.getByTestId('scheme-package-confirm').click();
  await expect(page.getByRole('button', { name: '核对并继续导入' })).toBeVisible();
  await expect(page).not.toHaveURL(/scheme=/);
  await page.getByTestId('scheme-package-confirm').click();
  await expect(page).toHaveURL(/scheme=imported_scheme/);
  expect(calls).toMatchObject({ begin: 1, upload: 1, confirm: 1, import: 2, format: 1 });
});

test('Escape preserves the server intent and restores the new-menu trigger', async ({ page }) => {
  const calls = await install(page);
  await upload(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('scheme-package-import')).not.toBeVisible();
  await expect(page.getByTestId('scheme-create')).toBeFocused();
  expect(calls.cancel).toBe(0);
  expect(calls.confirm).toBe(0);
  expect(calls.import).toBe(0);
});

test('guest cannot select or upload a package', async ({ page }) => {
  const calls = await install(page, { guest: true });
  await expect(page.getByText('请先登录并完成账号核对。')).toBeVisible();
  await expect(page.getByTestId('scheme-package-file')).toBeDisabled();
  await expect(page.getByTestId('scheme-package-upload')).toBeDisabled();
  expect(calls.begin).toBe(0);
});

async function openRecovery(page: Page) {
  await page.getByTestId('scheme-create').click();
  await page.getByTestId('scheme-create-option-import').click();
  await page.getByTestId('scheme-package-show-recovery').click();
  await page.getByTestId('scheme-package-recover-upload_stage').click();
  await expect(page.getByTestId('scheme-package-recovery-status')).toBeVisible();
}

test('reload after a lost commit reads the original receipt without a second POST', async ({
  page,
}) => {
  const calls = await install(page, { lostImport: true });
  await upload(page);
  await page.getByTestId('scheme-package-confirm').click();
  await expect(page.getByRole('button', { name: '核对并继续导入' })).toBeVisible();
  await page.reload();
  await openRecovery(page);
  await expect(page.getByTestId('scheme-package-confirm')).toHaveText('查看原导入结果');
  expect(calls.import).toBe(1);
  await page.getByTestId('scheme-package-confirm').click();
  await expect(page).toHaveURL(/scheme=imported_scheme/);
  expect(calls).toMatchObject({ begin: 1, upload: 1, confirm: 1, import: 1, cancel: 0 });
});

test('lost begin is discovered after reload and reselecting the exact original bytes', async ({
  page,
}) => {
  const calls = await install(page, { lostBegin: true });
  await page.getByTestId('scheme-package-file').setInputFiles({
    name: 'poster.musefold.design',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });
  await page.getByTestId('scheme-package-upload').click();
  await expect(page.getByTestId('scheme-package-import').getByRole('alert')).toBeVisible();
  await page.reload();
  await openRecovery(page);
  await expect(page.getByTestId('scheme-package-file')).toBeEnabled();
  await page.getByTestId('scheme-package-file').setInputFiles({
    name: 'wrong.musefold.design',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('wrong'),
  });
  await page.getByTestId('scheme-package-upload').click();
  await expect(page.getByText('所选文件与原上传不一致，请重新选择原方案包')).toBeVisible();
  expect(calls.upload).toBe(0);
  await upload(page);
  await page.getByTestId('scheme-package-confirm').click();
  await expect(page).toHaveURL(/scheme=imported_scheme/);
  expect(calls.begin).toBe(1);
  expect(calls.import).toBe(1);
});

test('closing a second page leaves the original preview available to continue', async ({
  page,
  context,
}) => {
  const calls = await install(page);
  await upload(page);
  const other = await context.newPage();
  await other.goto('/design-schemes');
  await openRecovery(other);
  await other.close();
  expect(calls.cancel).toBe(0);
  await page.getByTestId('scheme-package-confirm').click();
  await expect(page).toHaveURL(/scheme=imported_scheme/);
  expect(calls.import).toBe(1);
});

test('explicit cancellation first confirms intent and leaves no imported draft', async ({
  page,
}) => {
  const calls = await install(page);
  await upload(page);
  await page.getByRole('button', { name: '取消此上传', exact: true }).click();
  await page.getByRole('button', { name: '保留记录', exact: true }).click();
  expect(calls.cancel).toBe(0);
  await page.getByRole('button', { name: '取消此上传', exact: true }).click();
  await page.getByRole('button', { name: '确认取消上传', exact: true }).click();
  await expect(page.getByTestId('scheme-package-import')).not.toBeVisible();
  expect(calls.cancel).toBe(1);
  expect(calls.import).toBe(0);
});
