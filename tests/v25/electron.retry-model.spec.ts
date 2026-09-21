import { rmSync } from 'node:fs';
import { aiProviderSchema, generationJobSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke as invoke } from './local-execution-fixture';

test('历史缺失模型重试明确拒绝且不改变原记录，用户在工作台建立新意图后成功', async () => {
  const fixture = await localExecutionFixture();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const first = await launchV25App('musefold-retry-model-', { env: fixture.env });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    const provider = aiProviderSchema.parse(
      await invoke(page, 'aiProviders.create', {
        name: '自备当前模型',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-a',
        apiKey: 'synthetic-a',
        activate: true,
      }),
    );
    await app.close();
    app = undefined;
    const db = new Database(desktopDbPath(userData));
    db.prepare(`INSERT INTO generation_runs
      (id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,
       status,actual_cost,created_at,finished_at)
      VALUES ('historical-model-missing','free_generation',?,'unknown','历史输入','历史输入',?,
        '{}','cancelled',3,?,?)`).run(
      provider.id,
      JSON.stringify({ schemaVersion: 1, size: 'auto', quality: 'auto', n: 1 }),
      Date.now(),
      Date.now(),
    );
    const original = db
      .prepare('SELECT * FROM generation_runs WHERE id = ?')
      .get('historical-model-missing');
    db.close();
    ({ app } = await launchV25App('musefold-retry-model-', {
      reuseUserDataDir: userData,
      env: fixture.env,
    }));
    page = await v25ShellPage(app);
    // Both real IPC input shapes must reject, rather than execute unknown/current defaults.
    for (const payload of [
      'historical-model-missing',
      { id: 'historical-model-missing', idempotencyKey: 'historical-model-retry' },
    ]) {
      await expect(invoke(page, 'generation.retry', payload)).rejects.toThrow(
        'GENERATION_RETRY_MODEL_MISSING',
      );
      expect(fixture.imageCalls).toHaveLength(0);
    }
    await page.getByTestId('nav-history').click();
    await page.getByTestId('history-row-open').first().click();
    await page.getByTestId('history-inspector-retry').click();
    await expect(
      page.getByText(
        '原任务缺少可核对的模型，无法按原参数重试。请在连接设置中确认模型，再到工作台新建生成。',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByTestId('history-inspector-retry')).toBeEnabled();
    expect(fixture.imageCalls).toHaveLength(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-connections').click();
    await expect(page.getByTestId(`ai-provider-${provider.id}`)).toContainText('fixture-a');
    await expect(page.getByTestId(`ai-provider-${provider.id}`)).toContainText('默认');
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('session-create').click();
    await page.getByTestId('composer-prompt').fill('用户确认当前连接后建立的新意图');
    await page.getByTestId('composer-submit').click();
    await expect(page.getByTestId('job-status').last()).toHaveAttribute('data-status', 'succeeded');
    expect(fixture.imageCalls).toHaveLength(1);
    expect(fixture.imageCalls[0]).toMatchObject({ model: 'fixture-a' });
    expect(fixture.imageCredentials).toEqual(['a']);
    const after = new Database(desktopDbPath(userData), { readonly: true });
    try {
      expect(
        after.prepare('SELECT * FROM generation_runs WHERE id = ?').get('historical-model-missing'),
      ).toEqual(original);
      expect(
        after
          .prepare('SELECT COUNT(*) AS n FROM generation_runs WHERE parent_run_id = ?')
          .get('historical-model-missing'),
      ).toEqual({ n: 0 });
      const jobs = after
        .prepare('SELECT id FROM generation_runs WHERE id <> ?')
        .all('historical-model-missing') as Array<{ id: string }>;
      expect(jobs).toHaveLength(1);
      const job = generationJobSchema.parse(await invoke(page, 'generation.get', jobs[0]!.id));
      expect(job.parentRunId).toBeNull();
      expect(job.providerModel).toBe('fixture-a');
    } finally {
      after.close();
    }
  } finally {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
    await fixture.close();
  }
});
