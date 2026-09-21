import { expect, test, type ElectronApplication } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import { desktopDbPath, designSchemeDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { seedFormalTextScheme } from './design-scheme-test-helpers';

test('account model selection: Electron ordinary and formal scheme runs preserve model, cloud price and original costs', async () => {
  const info = test.info();
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires isolated PG/API/worker; upstream catalog and images are synthetic',
  );
  test.setTimeout(180000);
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  try {
    const { baseUrl } = await service.ready;
    await service.request('startWorker');
    const launched = await launchV25App('musefold-account-models-', {
      env: { MUSEFOLD_API_URL: baseUrl },
    });
    app = launched.app;
    const page = await v25ShellPage(app);
    // This desktop test starts with a prequalified fixture; Web tests earn trial eligibility.
    seedFormalTextScheme(launched.userDataDir, true);
    const seed = new Database(desktopDbPath(launched.userDataDir));
    try {
      seed
        .prepare(
          `INSERT INTO prompts
          (workspace_id,id,title,content,rating,is_pinned,usage_count,source,created_at,updated_at)
         VALUES ('local-only-legacy','model-local-ref','模型引用快照','restrained reference layout',
          0,0,0,'manual',?,?)`,
        )
        .run(Date.now(), Date.now());
    } finally {
      seed.close();
    }
    const reference = await sharp({
      create: { width: 6, height: 4, channels: 3, background: '#287c92' },
    })
      .png()
      .toBuffer();
    const referenceHash = createHash('sha256').update(reference).digest('hex');
    type Snapshot = {
      providerCalls: Array<{ body: { model: string }; authorized: boolean }>;
      calls: Array<{ method: string; path: string; body?: unknown }>;
      runs: Array<{ id: string; status: string }>;
      receipts: Array<{ binding: { model: string }; cost_points: number | null }>;
    };
    const snapshot = () => service.request<Snapshot>('snapshot');
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
    const choice = page.getByRole('combobox', { name: '账号模型' });
    await expect(choice).toHaveText('musefold-image-pro');
    await choice.focus();
    await choice.press('ArrowDown');
    await page.getByRole('option', { name: /^gpt-image-2\b/ }).click();
    await expect(choice).toBeFocused();
    await expect(page.getByTestId('composer-model-price')).toContainText('2.4 积分');
    await page.getByTestId('composer-prompt').fill('ordinary selected model');
    await service.request('configure', { modelQuota: 160000 });
    await page.getByTestId('composer-submit').click();
    await expect(page.getByText('云端价格已更新，请核对后重新发送')).toBeVisible();
    expect((await snapshot()).providerCalls).toHaveLength(0);
    await expect(page.getByTestId('composer-prompt')).toHaveValue('ordinary selected model');
    await expect(page.getByTestId('composer-model-price')).toContainText('3.2 积分');
    await page.getByTestId('composer-submit').click();
    await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'succeeded', {
      timeout: 20000,
    });
    expect((await snapshot()).providerCalls.map((call) => call.body.model)).toEqual([
      'gpt-image-2',
    ]);
    const db = new Database(desktopDbPath(launched.userDataDir), { readonly: true });
    const schemes = new Database(designSchemeDbPath(launched.userDataDir), { readonly: true });
    try {
      const original = db.prepare('SELECT id,model,actual_cost FROM generation_runs').get();
      expect(original).toMatchObject({ model: 'gpt-image-2' });
      await page.getByTestId('composer-attach').click();
      await page.getByTestId('workbench-context-ref-scheme').click();
      await page.getByTestId('scheme-run-pick-scheme_e2e_formal').click();
      await expect(page.getByTestId('composer-prompt')).toBeFocused();
      await choice.click();
      await page.getByRole('option', { name: /^musefold-image-pro\b/ }).click();
      await expect(page.getByTestId('composer-model-price')).toContainText('1.2 积分');
      await page.getByTestId('scheme-run-variable-topic').fill('账号方案模型');
      await page.getByTestId('composer-file-input').setInputFiles({
        name: 'model-reference.png',
        mimeType: 'image/png',
        buffer: reference,
      });
      await expect(page.getByTestId('composer-reference')).toHaveAttribute('data-status', 'ready');
      await page.getByTestId('composer-attach').click();
      await page.getByTestId('workbench-context-ref-prompt').click();
      const sourceRow = page
        .getByTestId('workbench-reference-row')
        .filter({ hasText: '模型引用快照' });
      await sourceRow.getByTestId('workbench-reference-expand').click();
      await sourceRow.getByTestId('workbench-reference-full').click();
      await page.getByTestId('workbench-materials-close').click();
      await expect(page.getByTestId('prompt-reference-card')).toContainText('模型引用快照');
      await page.screenshot({ path: info.outputPath('electron-scheme-model.png') });
      await page.getByTestId('composer-submit').click();
      try {
        await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('', {
          timeout: 20000,
        });
      } catch (error) {
        await info.attach('synthetic-scheme-model-failure', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              view: await page.locator('body').ariaSnapshot(),
              cloud: await snapshot(),
              local: db
                .prepare('SELECT status,model,prompt_snapshot_json FROM generation_runs')
                .all(),
              schemes: schemes.prepare('SELECT status FROM design_scheme_runs').all(),
            },
            null,
            2,
          ),
        });
        throw error;
      }
      const state = await snapshot();
      expect(state.providerCalls.map((call) => call.body.model)).toEqual([
        'gpt-image-2',
        'musefold-image-pro',
      ]);
      expect(state.providerCalls.every((call) => call.authorized)).toBe(true);
      expect(state.providerCalls[1].body).toMatchObject({
        edits: true,
        imageCount: 1,
        references: [{ hash: referenceHash }],
      });
      const sent = state.calls.filter(
        (call) => call.method === 'POST' && call.path === '/api/v1/generations',
      );
      expect(sent).toHaveLength(2);
      expect(sent[1].body).not.toHaveProperty('promptReferences');
      expect(sent[1].body).not.toHaveProperty('workbench');
      expect(state.receipts.map((receipt) => receipt.binding.model)).toEqual([
        'gpt-image-2',
        'musefold-image-pro',
      ]);
      expect(
        db.prepare('SELECT id,model,actual_cost FROM generation_runs ORDER BY created_at,id').all(),
      ).toContainEqual(original);
      expect(
        db.prepare('SELECT model,status FROM generation_runs ORDER BY created_at,id').all(),
      ).toEqual([
        { model: 'gpt-image-2', status: 'success' },
        { model: 'musefold-image-pro', status: 'success' },
      ]);
      const run = schemes
        .prepare("SELECT provider_json FROM design_scheme_runs WHERE mode='formal'")
        .get() as { provider_json: string };
      expect(JSON.parse(run.provider_json).model).toBe('musefold-image-pro');
      const projected = db
        .prepare(
          "SELECT prompt_snapshot_json FROM generation_runs WHERE model='musefold-image-pro'",
        )
        .get() as { prompt_snapshot_json: string };
      expect(JSON.parse(projected.prompt_snapshot_json).promptReferences).toEqual([
        expect.objectContaining({
          promptId: 'model-local-ref',
          title: '模型引用快照',
          text: 'restrained reference layout',
        }),
      ]);
      expect(db.prepare("SELECT model FROM providers WHERE type='musefold-cloud'").get()).toEqual({
        model: 'musefold-image-pro',
      });
      await service.request('rotate');
      await page.getByTestId('scheme-run-variable-topic').fill('身份变化不得发送');
      await page.getByTestId('composer-file-input').setInputFiles({
        name: 'changed-identity.png',
        mimeType: 'image/png',
        buffer: reference,
      });
      await expect(page.getByTestId('composer-submit')).toBeEnabled();
      await page.getByTestId('composer-submit').click();
      await expect(page.getByTestId('scheme-submit-error')).toHaveText(
        '账号执行身份已变化，请核对后重新发送',
      );
      await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('身份变化不得发送');
      expect((await snapshot()).providerCalls).toHaveLength(2);
      await service.request('configure', { catalogAvailable: false });
      await page.getByRole('button', { name: '刷新云端模型与价格' }).click();
      await expect(page.getByTestId('composer-model-price')).toContainText('读取失败');
      await expect(page.getByTestId('composer-model-price')).not.toContainText('1.2');
      await page.getByTestId('scheme-run-variable-topic').fill('目录失效不得发送');
      await expect(page.getByTestId('composer-submit')).toBeDisabled();
      expect((await snapshot()).providerCalls).toHaveLength(2);
    } finally {
      db.close();
      schemes.close();
    }
  } finally {
    await app?.close();
    await service.stop();
  }
});
