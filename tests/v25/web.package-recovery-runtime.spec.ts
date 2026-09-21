import { test, expect } from '@playwright/test';
import { PackageRecoveryProcess } from './package-recovery-process';
import { seedOnboardingCompleted } from './onboarding-helpers';

test('real ZIP/Hono/PG/S3: lost commit, reload and a second page read exactly one imported draft', async ({
  page,
  context,
}) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires disposable PG and S3 HTTP fixture; identity resolution is synthetic',
  );
  test.setTimeout(180000);
  const service = new PackageRecoveryProcess();
  try {
    const info = await service.ready;
    await seedOnboardingCompleted(page);
    let loseCommit = true;
    // Fault-injection proxy only. Every package request, byte and result goes through actual services.
    await context.route('**/api/v1/**', async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      const path = url.pathname.replace('/api/v1', '');
      const response = await route.fetch({
        url: `${info.baseUrl}${path}${url.search}`,
        headers: { ...incoming.headers(), 'x-package-fixture-owner': info.owner },
      });
      if (path === '/design-schemes/import-package' && response.ok() && loseCommit) {
        loseCommit = false;
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
      buffer: Buffer.from(info.bytes, 'base64'),
    });
    await page.getByTestId('scheme-package-upload').click();
    await expect(page.getByTestId('scheme-package-preview')).toBeVisible();
    await page.getByTestId('scheme-package-confirm').click();
    await expect(page.getByRole('button', { name: '核对并继续导入' })).toBeVisible();
    const committed = await service.snapshot();
    expect(committed.schemes).toHaveLength(1);
    expect(committed.imports).toHaveLength(1);
    expect(committed.imports[0].status).toBe('completed');
    expect(committed.assets.length).toBeGreaterThan(0);
    const stageId = committed.stages[0].id;
    await page.reload();
    const other = await context.newPage();
    await other.goto('/design-schemes');
    for (const target of [page, other]) {
      await target.getByTestId('scheme-create').click();
      await target.getByTestId('scheme-create-option-import').click();
      await target.getByTestId('scheme-package-show-recovery').click();
      await target.getByTestId(`scheme-package-recover-${stageId}`).click();
      await expect(target.getByTestId('scheme-package-confirm')).toHaveText('查看原导入结果');
    }
    await page
      .getByTestId('scheme-package-import')
      .screenshot({ path: test.info().outputPath('recovered-import.png') });
    await other.close();
    await page.getByTestId('scheme-package-confirm').click();
    await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
    const result = await service.snapshot();
    expect(result.schemes).toEqual(committed.schemes);
    expect(result.imports).toEqual(committed.imports);
    expect(result.assets).toEqual(committed.assets);
    expect(result.writes).toBe(committed.writes);
    expect(
      result.calls.filter(
        (call) => call.method === 'POST' && call.path === '/design-schemes/import-package',
      ),
    ).toHaveLength(1);
    expect(result.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
    await test.info().attach('package-recovery-runtime-evidence', {
      body: JSON.stringify({
        stages: result.stages,
        schemeIds: result.schemes.map((item) => item.id),
        importEpoch: result.imports[0].epoch,
        assets: result.assets.length,
        writes: result.writes,
        calls: result.calls,
      }),
      contentType: 'application/json',
    });
  } finally {
    await service.dispose();
  }
});
