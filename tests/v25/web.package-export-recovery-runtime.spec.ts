import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { readValidatedDesignSchemePackageBytes } from '@musefold/scheme-package';
import { PackageRecoveryProcess } from './package-recovery-process';
import { seedOnboardingCompleted } from './onboarding-helpers';

test('real ZIP export: lost begin, reload, second page and explicit file delivery preserve one archive', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires disposable PG/S3; identity and successful trial qualification are fixtures',
  );
  test.setTimeout(180000);
  const service = new PackageRecoveryProcess();
  try {
    const backend = await service.ready;
    await seedOnboardingCompleted(page);
    await context.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    });
    let loseBegin = true;
    await context.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace('/api/v1', '');
      const response = await route.fetch({
        url: `${backend.baseUrl}${path}${url.search}`,
        headers: { ...request.headers(), 'x-package-fixture-owner': backend.owner },
      });
      if (
        path === '/design-schemes/package-exports' &&
        request.method() === 'POST' &&
        response.ok() &&
        loseBegin
      ) {
        loseBegin = false;
        return route.abort('failed');
      }
      return route.fulfill({ response });
    });
    await page.goto('/design-schemes');
    await page.getByTestId('scheme-create').click();
    await page.getByTestId('scheme-create-option-import').click();
    await page.getByTestId('scheme-package-file').setInputFiles({
      name: 'runtime.musefold.design',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(backend.bytes, 'base64'),
    });
    await page.getByTestId('scheme-package-upload').click();
    await expect(page.getByTestId('scheme-package-preview')).toBeVisible();
    await page.getByTestId('scheme-package-confirm').click();
    await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
    // Actual source/assets and import. Trial qualification is explicit SQL fixture, not a paid run.
    await service.qualifyForExport();
    await page.reload();
    await page.getByTestId('runtime-scheme-menu').click();
    await page.getByTestId('runtime-scheme-menu-export').click();
    await page.getByTestId('scheme-package-export-action').click();
    await expect(page.getByTestId('scheme-package-export').getByRole('alert')).toBeVisible();
    const committed = await service.snapshot();
    expect(committed.exports).toHaveLength(1);
    expect(committed.exports[0].status).toBe('ready');
    const original = committed.exports[0];
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.reload();
    await page.goto('/design-schemes');
    await page.screenshot({ path: info.outputPath('export-history-entry.png') });
    const other = await context.newPage();
    await other.goto('/design-schemes');
    for (const target of [page, other]) {
      await target.getByTestId('scheme-export-history').click();
      await target.getByTestId(`scheme-package-export-recover-${original.id}`).click();
      await expect(target.getByTestId('scheme-package-export-action')).toHaveText('下载并保存');
    }
    await other.close();
    await page
      .getByTestId('scheme-package-export')
      .screenshot({ path: info.outputPath('recovered-export.png') });
    const recovered = await service.snapshot();
    expect(recovered.exports).toEqual(committed.exports);
    expect(recovered.writes).toBe(committed.writes);
    expect(recovered.exportReads).toBe(committed.exportReads);
    expect(downloads).toEqual([]);
    expect(recovered.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    const pending = page.waitForEvent('download');
    await page.getByTestId('scheme-package-export-action').click();
    const download = await pending;
    const file = info.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    const bytes = await readFile(file);
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.length).toBe(original.size_bytes);
    expect(hash).toBe(original.package_hash);
    const archive = await readValidatedDesignSchemePackageBytes(bytes);
    expect(archive.formatVersion).toBe(2);
    if (archive.formatVersion !== 2) throw new Error('Wrong archive format');
    expect(archive.manifest.sourceSnapshots.length).toBeGreaterThan(0);
    expect(archive.manifest.assets.length).toBeGreaterThan(0);
    await expect(page.getByTestId('scheme-package-export-result')).toContainText(
      '已交给浏览器下载',
    );
    const final = await service.snapshot();
    expect(final.exports).toEqual(committed.exports);
    expect(final.writes).toBe(committed.writes);
    expect(
      final.calls.filter(
        (c) => c.method === 'POST' && c.path === '/design-schemes/package-exports',
      ),
    ).toHaveLength(1);
    expect(
      final.calls.filter(
        (c) =>
          c.method === 'GET' && c.path === `/design-schemes/package-exports/${original.id}/content`,
      ),
    ).toHaveLength(1);
    expect(final.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    await page.reload();
    await page.getByTestId('scheme-export-history').click();
    await page.getByTestId(`scheme-package-export-recover-${original.id}`).click();
    await expect(page.getByTestId('scheme-package-export-recovery')).toContainText(
      '无法核实此前下载是否完成',
    );
    expect(downloads).toHaveLength(1);
    await info.attach('package-export-recovery-runtime-evidence', {
      body: JSON.stringify({
        exportId: original.id,
        requestId: original.request_id,
        bytes: bytes.length,
        hash,
        sourceSnapshots: archive.manifest.sourceSnapshots.length,
        assets: archive.manifest.assets.length,
        initialWrites: committed.writes,
        recoveredWrites: recovered.writes,
        finalWrites: final.writes,
        initialReads: committed.exportReads,
        recoveredReads: recovered.exportReads,
        calls: final.calls,
        qualification:
          'actual import/cover/formalize services; SQL successful trial; synthetic identity; local S3 protocol',
      }),
      contentType: 'application/json',
    });
  } finally {
    await service.dispose();
  }
});
