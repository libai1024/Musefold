import { readFileSync, rmSync } from 'node:fs';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

test('真实 Hono/PG/队列/worker：账号云四图发送，丢回包后新 PID 恢复原素材与未知费用', async () => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    '需要 RUN_DATABASE_TESTS=true 与 Docker，身份/Provider/S3 为合成 fixture',
  );
  test.setTimeout(180000);
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await service.ready;
    await service.request('configure', { breakCreate: true });
    const first = await launchV25App('musefold-cloud-service-', {
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-account').click();
    await page.getByTestId('account-username').fill('joint-a');
    await page.getByTestId('account-password').fill('synthetic-password');
    await page.getByTestId('account-auth-submit').click();
    await expect(page.getByTestId('account-points')).toBeVisible();
    await page.getByTestId('settings-nav-connections').click();
    await page.getByTestId('account-cloud-review').click();
    await page.getByTestId('account-cloud-confirm').click();
    await expect(page.getByTestId('account-cloud-default')).toHaveText('当前默认连接');
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('composer-settings').click();
    await page.getByTestId('composer-count-4').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('composer-prompt').fill('synthetic joint cloud four images');
    await page.getByTestId('composer-submit').click();
    type Snapshot = {
      runs: Array<{ id: string; status: string }>;
      receipts: Array<{ cost_provenance: string; cost_points: number | null }>;
      calls: Array<{ method: string; path: string }>;
      providerCalls: Array<{ authorized: boolean; body: { n: number } }>;
      assets: unknown[];
    };
    const snapshot = () => service.request<Snapshot>('snapshot');
    await expect.poll(async () => (await snapshot()).runs.length).toBe(1);
    const pid = app.process().pid;
    await app.close();
    app = undefined;
    await service.request('startWorker');
    await expect
      .poll(async () => (await snapshot()).runs[0].status, { timeout: 20000 })
      .toBe('succeeded');
    ({ app } = await launchV25App('musefold-cloud-service-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: info.baseUrl },
    }));
    expect(app.process().pid).not.toBe(pid);
    page = await v25ShellPage(app);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-connections').click();
    await page.getByRole('button', { name: '核对原任务' }).click();
    const db = new Database(desktopDbPath(userData), { readonly: true });
    try {
      await expect
        .poll(() => db.prepare('SELECT count(*) AS n FROM generated_assets').get())
        .toEqual({ n: 4 });
      expect(db.prepare('SELECT status,actual_cost FROM generation_runs').get()).toEqual({
        status: 'success',
        actual_cost: null,
      });
      await expect(page.getByTestId('account-cloud-recovery')).toContainText('费用未知');
      const assets = db.prepare('SELECT * FROM generated_assets ORDER BY position').all() as Array<{
        media_path: string;
      }>;
      for (const [index, asset] of assets.entries())
        expect(readFileSync(asset.media_path)).toEqual(Buffer.from(info.pngs[index], 'base64'));
      rmSync(assets[0].media_path);
      await page.getByTestId('account-cloud-check').click();
      await expect(page.getByTestId('account-cloud-recovery')).toContainText('本机图片缺失');
      await page.getByRole('button', { name: '核对原任务' }).click();
      await expect
        .poll(() => {
          try {
            return readFileSync(assets[0].media_path).equals(Buffer.from(info.png, 'base64'));
          } catch {
            return false;
          }
        })
        .toBe(true);
      expect(db.prepare('SELECT * FROM generated_assets ORDER BY position').all()).toEqual(assets);
      expect(db.serialize().includes(Buffer.from('synthetic-joint-bearer'))).toBe(false);
    } finally {
      db.close();
    }
    const remote = await snapshot();
    expect(
      remote.calls.filter((call) => call.path === '/api/v1/generations' && call.method === 'POST'),
    ).toHaveLength(1);
    expect(remote.providerCalls).toEqual([
      { authorized: true, body: expect.objectContaining({ n: 4 }) },
    ]);
    expect(remote.assets).toHaveLength(4);
    expect(remote.receipts[0]).toMatchObject({ cost_provenance: 'unknown', cost_points: null });
  } finally {
    await app?.close();
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
