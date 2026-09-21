import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generationJobSchema, aiProviderSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { seedFormalTextScheme } from './design-scheme-test-helpers';

import { localExecutionFixture, localInvoke as invoke } from './local-execution-fixture';

// No host/persistence wrappers are replaced. Synthetic key is stored through real IPC,
// then the stopped app's row is upgraded to the exact historical provisioning shape.
test('旧官方连接不能绕过 Automation 的付款身份校验从本地 G 发送', async () => {
  const fixture = await localExecutionFixture();
  const { baseUrl, imageCalls: sends } = fixture;
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const first = await launchV25App('musefold-legacy-entry-', {
      env: fixture.env,
    });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    const provider = aiProviderSchema.parse(
      await invoke(page, 'aiProviders.create', {
        name: '历史官方连接',
        baseUrl: `${baseUrl}/v1`,
        model: 'fixture-image',
        apiKey: 'synthetic-legacy-key',
        activate: true,
      }),
    );
    await invoke(page, 'agentConnections.create', {
      name: '自备文本连接',
      baseUrl: `${baseUrl}/v1`,
      model: 'fixture-text',
      apiKey: 'synthetic-text-key',
      activate: true,
    });
    await app.close();
    app = undefined;
    const db = new Database(desktopDbPath(userData));
    db.prepare("UPDATE providers SET managed_by = 'account' WHERE id = ?").run(provider.id);
    db.close();
    seedFormalTextScheme(userData);
    ({ app } = await launchV25App('musefold-legacy-entry-', {
      reuseUserDataDir: userData,
      env: fixture.env,
    }));
    page = await v25ShellPage(app);
    // Actual Automation service already refuses this same historical key.
    const discovery = JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const denied = await fetch(`http://127.0.0.1:${discovery.port}/v1/generations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${discovery.token}`,
        'content-type': 'application/json',
        'idempotency-key': 'legacy-automation-proof',
      },
      body: JSON.stringify({
        providerId: provider.id,
        prompt: '合成旧入口验证',
        consent: 'interactive',
      }),
    });
    expect(denied.status).toBe(409);
    expect(JSON.stringify(await denied.json())).toContain('PAYMENT_IDENTITY_UNBOUND');
    expect(sends).toHaveLength(0);
    for (const [path, key, body] of [
      [
        '/v1/schemes/scheme_e2e_formal/runs',
        'legacy-r-proof',
        { inputs: { topic: '合成旧方案验证' }, brief: '固定方案验证' },
      ],
      [
        '/v1/skills/github/run',
        'legacy-s-proof',
        { url: 'https://github.com/fixture/visual', prompt: '合成旧Skill验证' },
      ],
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${discovery.port}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${discovery.token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({ ...body, providerId: provider.id, consent: 'interactive', n: 1 }),
      });
      expect(response.status).toBe(409);
      expect(JSON.stringify(await response.json())).toContain('PAYMENT_IDENTITY_UNBOUND');
    }
    expect(fixture.githubReads.length).toBeGreaterThan(0);
    expect(fixture.textCalls).toHaveLength(0);
    expect(sends).toHaveLength(0);
    const created = generationJobSchema.parse(
      await invoke(page, 'generation.create', {
        providerId: provider.id,
        prompt: '合成旧入口验证',
        count: 1,
      }),
    );
    await expect
      .poll(
        async () =>
          generationJobSchema.parse(await invoke(page, 'generation.get', created.id)).status,
      )
      .toMatch(/failed|succeeded/);
    const final = generationJobSchema.parse(await invoke(page, 'generation.get', created.id));
    expect(sends).toHaveLength(0);
    expect(final.status).toBe('failed');
    expect(final.error?.message).toContain('账号');
    expect(final.error?.code).toBe('ACCOUNT_IDENTITY_UNVERIFIED');
    // Both supported IPC retry shapes hit the same guard and preserve the original provider.
    for (const payload of [
      created.id,
      { id: created.id, idempotencyKey: 'legacy-explicit-retry' },
    ]) {
      const retry = generationJobSchema.parse(await invoke(page, 'generation.retry', payload));
      await expect
        .poll(
          async () =>
            generationJobSchema.parse(await invoke(page, 'generation.get', retry.id)).status,
        )
        .toBe('failed');
      expect(
        generationJobSchema.parse(await invoke(page, 'generation.get', retry.id)).error?.code,
      ).toBe('ACCOUNT_IDENTITY_UNVERIFIED');
    }
    expect(sends).toHaveLength(0);
    // The shared history error provides an actual connections deep link, with no retry.
    await page.getByTestId('nav-history').click();
    await page.getByTestId('history-row-open').first().click();
    await expect(page.getByTestId('history-inspector-retry')).toHaveCount(0);
    await page.getByTestId('history-detail-error-action').click();
    await expect(page.getByTestId('settings-section-connections')).toBeVisible();
    // v25 local scheme uses its separate real adapter/facade, not Automation's wrapper.
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('session-create').click();
    await page.getByTestId('composer-attach').click();
    await page.getByTestId('workbench-context-ref-scheme').click();
    await page.getByTestId('scheme-run-pick-scheme_e2e_formal').click();
    await page.getByTestId('scheme-run-variable-topic').fill('旧连接隔离验证');
    await page.getByTestId('composer-prompt').fill('合成本地方案验证');
    await page.getByTestId('composer-submit').click();
    await expect(page.getByTestId('job-status').last()).toHaveAttribute('data-status', 'failed');
    expect(sends).toHaveLength(0);
  } finally {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
    await fixture.close();
  }
});
