import { rmSync } from 'node:fs';
import { accountCloudStatusSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import { cloudAnchor, cloudInvoke, cloudLocalState, connectCloud } from './cloud-crash-helpers';
import { launchV25App, v25ShellPage } from './electron-helpers';

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('实际云任务旧备份拒绝回退，匹配安全备份须显式确认，过期/换号/恢复期间旧 review 失效', async ({}, testInfo) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires isolated Docker PostgreSQL services',
  );
  test.setTimeout(180000);
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  const pids: Array<number | undefined> = [];
  const evidence: unknown[] = [];
  try {
    const info = await service.ready;
    await service.request('startWorker');
    const first = await launchV25App('musefold-cloud-backup-', {
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    const restart = async () => {
      pids.push(app?.process().pid);
      await app?.close();
      app = undefined;
      ({ app } = await launchV25App('unused-', {
        reuseUserDataDir: userData,
        env: { MUSEFOLD_API_URL: info.baseUrl },
      }));
      expect(pids).not.toContain(app.process().pid);
      page = await v25ShellPage(app);
    };
    const status = async () => {
      const result = await cloudInvoke(page, 'accountCloud.getStatus');
      expect(result.ok).toBe(true);
      return accountCloudStatusSchema.parse(result.data);
    };
    const restore = async (file: string) => {
      const result = await cloudInvoke(page, 'system.restoreBackup', { file });
      expect(result).toMatchObject({ ok: true, data: { needsRestart: true } });
      return (result.data as { safetyBackupFile: string }).safetyBackupFile;
    };
    await connectCloud(page);
    const backup = await cloudInvoke(page, 'system.createBackup');
    expect(backup.ok).toBe(true);
    const oldBackup = (backup.data as { backup: { file: string } }).backup.file;
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('composer-prompt').fill('synthetic backup recovery original image');
    await page.getByTestId('composer-submit').click();
    await expect.poll(() => cloudLocalState(userData).assets.length, { timeout: 20000 }).toBe(1);
    const original = cloudLocalState(userData);
    const originalAnchor = await cloudAnchor(app, userData);
    expect(originalAnchor).toMatchObject({ mode: 'active', pending: null });
    const matchingSafety = await restore(oldBackup);
    await restart();
    const stale = await status();
    expect(stale).toMatchObject({ mode: 'query_only', reviewRef: null, reviewAction: null });
    expect(
      await cloudInvoke(page, 'generation.create', {
        providerId: stale.connectionId,
        prompt: 'blocked old backup send',
      }),
    ).toMatchObject({ ok: false, code: 'MANAGED_GENERATION_NOT_STARTED' });
    expect(cloudLocalState(userData).records).toHaveLength(0);
    expect(await cloudAnchor(app, userData)).toMatchObject({
      mode: 'query_only',
      committed: originalAnchor.committed,
    });
    evidence.push({ stage: 'old-backup', status: stale, local: cloudLocalState(userData) });

    await restore(matchingSafety);
    await restart();
    const matching = await status();
    expect(matching).toMatchObject({ mode: 'query_only', reviewAction: 'resume' });
    expect(matching.reviewRef).toBeTruthy();
    expect(
      await cloudInvoke(page, 'generation.create', {
        providerId: matching.connectionId,
        prompt: 'blocked until explicit confirmation',
      }),
    ).toMatchObject({ ok: false, code: 'MANAGED_GENERATION_NOT_STARTED' });
    expect(cloudLocalState(userData).records).toEqual(original.records);
    expect(await cloudAnchor(app, userData)).toMatchObject({
      mode: 'query_only',
      committed: originalAnchor.committed,
    });

    // Main-process clock fault injection proves the expiry predicate; this is not 120s wall-clock evidence.
    await app.evaluate(() => {
      const now = Date.now;
      Date.now = () => now() + 120001;
    });
    const expired = await cloudInvoke(page, 'accountCloud.resume', {
      reviewRef: matching.reviewRef,
    });
    expect(expired).toMatchObject({ ok: false, code: 'ACCOUNT_CLOUD_REVIEW_REQUIRED' });
    expect(await cloudAnchor(app, userData)).toMatchObject({ mode: 'query_only' });
    const reviewBeforeAccount = await status();
    expect(
      await cloudInvoke(page, 'account.login', {
        username: 'joint-b',
        password: 'synthetic-password',
      }),
    ).toMatchObject({ ok: true });
    const changed = await cloudInvoke(page, 'accountCloud.resume', {
      reviewRef: reviewBeforeAccount.reviewRef,
    });
    expect(changed).toMatchObject({ ok: false, code: 'ACCOUNT_CLOUD_REVIEW_REQUIRED' });
    expect(await cloudAnchor(app, userData)).toMatchObject({ mode: 'query_only' });
    expect(
      await cloudInvoke(page, 'account.login', {
        username: 'joint-a',
        password: 'synthetic-password',
      }),
    ).toMatchObject({ ok: true });
    const reviewBeforeRestore = await status();
    expect(reviewBeforeRestore.reviewAction).toBe('resume');
    await restore(matchingSafety);
    const restored = await cloudInvoke(page, 'accountCloud.resume', {
      reviewRef: reviewBeforeRestore.reviewRef,
    });
    expect(restored).toMatchObject({ ok: false, code: 'ACCOUNT_CLOUD_REVIEW_REQUIRED' });
    evidence.push({ stage: 'stale-reviews', expired, changed, restored });
    await restart();
    expect(await status()).toMatchObject({ mode: 'query_only', reviewAction: 'resume' });
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-connections').click();
    await expect(page.getByTestId('account-cloud-status')).toContainText('确认后');
    await page.getByTestId('account-cloud-review').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await cloudAnchor(app, userData)).toMatchObject({ mode: 'query_only' });
    await page.getByTestId('account-cloud-confirm').click();
    await expect.poll(async () => (await status()).mode).toBe('active');
    expect(await cloudAnchor(app, userData)).toMatchObject({
      mode: 'active',
      pending: null,
      committed: {
        lineageId: originalAnchor.committed.lineageId,
        namespace: originalAnchor.committed.namespace,
        revision: originalAnchor.committed.revision + 1,
      },
    });
    expect(
      (
        await cloudInvoke(page, 'accountCloud.reconcile', {
          requestId: original.records[0].requestId,
        })
      ).ok,
    ).toBe(true);
    const final = cloudLocalState(userData);
    expect(final.assets).toEqual(original.assets);
    expect(final.runs).toEqual(original.runs);
    expect(final.records[0]).toMatchObject({
      remoteKey: original.records[0].remoteKey,
      binding: original.records[0].binding,
    });
    const remote = await service.request<{
      calls: Array<{ method: string; path: string }>;
      providerCalls: unknown[];
      assets: unknown[];
      receipts: Array<{ cost_provenance: string; cost_points: number | null }>;
    }>('snapshot');
    expect(
      remote.calls.filter((call) => call.method === 'POST' && call.path === '/api/v1/generations'),
    ).toHaveLength(1);
    expect(remote.providerCalls).toHaveLength(1);
    expect(remote.assets).toHaveLength(1);
    expect(remote.receipts[0]).toMatchObject({ cost_provenance: 'unknown', cost_points: null });
    await testInfo.attach('cloud-backup-confirmation-evidence.json', {
      body: JSON.stringify(
        {
          pids: [...pids, app.process().pid],
          evidence,
          originalAnchor,
          final,
          remote,
          boundary:
            'Actual generated task, formal backup/restore, real macOS safeStorage and distinct Electron PIDs. Expiry uses main clock +120001ms; account and DB transitions are real, sequential between review creation and confirmation. Synthetic identity/Provider/S3; no paid upstream.',
        },
        (_key, value) =>
          typeof value === 'string' ? value.replaceAll(userData, '<test-userData>') : value,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
