import { expect, test } from '@playwright/test';
import {
  createDesignSchemeResultSchema,
  designSchemePageSchema,
  designSchemeRevisionDocumentSchema,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import {
  browserJson,
  connectExchangeBrowser,
  loginExchangeBrowser,
} from './package-exchange-browser';

test('actual API scheme trash paginates, confirms permanent deletion and preserves the live library after reload', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires isolated API/Better Auth/PostgreSQL',
  );
  test.setTimeout(180_000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    await loginExchangeBrowser(page, 'scheme-trash@example.test');
    const removed: string[] = [];
    for (let index = 0; index < 22; index++) {
      const id = `trash_fixture_${index}`;
      const document = designSchemeRevisionDocumentSchema.parse({
        schemaVersion: 1,
        schemeId: id,
        revisionId: `revision_${id}`,
        name: `待清理方案 ${index}`,
        summary: '真实 HTTP/PG 查询与删除验证',
        fidelity: 'adapted',
        sources: [],
        sourceSnapshotIds: [],
        inputs: [{ id: 'topic', label: '主题', kind: 'text', required: true }],
        parameters: [],
        constraints: [],
        promptProgram: [
          {
            id: 'main',
            order: 0,
            kind: 'input-template',
            template: '{{topic}}',
            variables: ['topic'],
            sourceIds: [],
          },
        ],
        assetIds: [],
        compilation: {
          compiledAt: '2026-09-19T00:00:00.000Z',
          model: { model: 'fixture' },
          adopted: [],
          omitted: [],
          warnings: [],
          trace: [],
        },
        createdBy: 'user',
        createdAt: '2026-09-19T00:00:00.000Z',
        parentRevisionId: null,
      });
      const result = createDesignSchemeResultSchema.parse(
        await browserJson(page, '/api/v1/design-schemes', {
          executionId: `create_${id}`,
          brief: 'Fixture document',
          sourceUris: [],
          sourceBindings: [],
          sourceAssetIds: [],
          document,
        }),
      );
      if (index < 21) {
        await browserJson(page, '/api/v1/design-schemes/remove', {
          schemeId: id,
          expectedVersion: result.scheme.version,
        });
        removed.push(id);
      }
    }
    let failNext = true,
      failDelete = true;
    const deleteInputs: unknown[] = [];
    await context.route('**/api/v1/design-schemes?**', async (route) => {
      const url = new URL(route.request().url());
      if (
        failNext &&
        url.searchParams.get('deletedOnly') === 'true' &&
        url.searchParams.has('cursor')
      ) {
        failNext = false;
        return route.abort('failed');
      }
      return route.fallback();
    });
    await context.route('**/api/v1/design-schemes/purge', async (route) => {
      deleteInputs.push(route.request().postDataJSON());
      if (failDelete) {
        failDelete = false;
        return route.abort('failed');
      }
      return route.fallback();
    });
    await page.reload();
    await page.getByTestId('scheme-trash-open').click();
    await expect(page.getByTestId('scheme-trash-count')).toHaveText('已加载 20+ 个方案');
    await page.getByTestId('scheme-trash-load-more').click();
    await expect(page.getByText('后续方案加载失败，已加载的内容仍保留。')).toBeVisible();
    await expect(page.getByTestId(/^scheme-trash-row-/)).toHaveCount(20);
    await page.getByRole('button', { name: '重试读取' }).click();
    await expect(page.getByTestId('scheme-trash-count')).toHaveText('已加载 21 个方案');
    await expect(page.getByTestId('scheme-trash-row-trash_fixture_21')).toHaveCount(0);
    const trigger = page.getByTestId('scheme-trash-purge-trash_fixture_0');
    await trigger.click();
    await expect(page.getByRole('alertdialog')).toContainText('无法恢复');
    await page
      .getByRole('alertdialog')
      .screenshot({ path: info.outputPath('scheme-purge-confirm.png') });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(trigger).toBeFocused();
    expect(deleteInputs).toEqual([]);
    await trigger.click();
    await page.getByTestId('scheme-trash-confirm').click();
    await expect(page.getByRole('alertdialog').getByRole('alert')).toBeVisible();
    expect(deleteInputs).toEqual([{ schemeId: 'trash_fixture_0', expectedVersion: 2 }]);
    await page.getByRole('button', { name: '重试永久删除' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByTestId('scheme-trash-row-trash_fixture_0')).toHaveCount(0);
    expect(deleteInputs).toEqual([
      { schemeId: 'trash_fixture_0', expectedVersion: 2 },
      { schemeId: 'trash_fixture_0', expectedVersion: 2 },
    ]);
    const receipt = await browserJson(page, '/api/v1/design-schemes/purge', {
      schemeId: 'trash_fixture_0',
      expectedVersion: 2,
    });
    expect(receipt).toEqual({
      schemeId: 'trash_fixture_0',
      purged: true,
      retiredKeys: 0,
      deferredKeys: 0,
    });
    const active = designSchemePageSchema.parse(await browserJson(page, '/api/v1/design-schemes'));
    expect(active.items.map((row) => row.id)).toEqual(['trash_fixture_21']);
    await page.reload();
    await page.getByTestId('scheme-trash-open').click();
    await expect(page.getByTestId('scheme-trash-count')).toHaveText('已加载 20 个方案');
    await expect(page.getByTestId('scheme-trash-row-trash_fixture_0')).toHaveCount(0);
    const retained = designSchemePageSchema.parse(
      await browserJson(page, '/api/v1/design-schemes?deletedOnly=true&limit=100'),
    );
    expect(new Set(retained.items.map((row) => row.id))).toEqual(new Set(removed.slice(1)));
    await info.attach('actual-scheme-purge', {
      body: JSON.stringify({
        removed: 21,
        purged: 1,
        active: 1,
        receipt,
        deleteInputs,
        auth: 'controlled issuer, actual Better Auth/API/PostgreSQL',
        providerCalls: 0,
      }),
      contentType: 'application/json',
    });
  } finally {
    for (const tab of context.pages()) await tab.goto('about:blank');
    await context.unrouteAll({ behavior: 'wait' });
    await service.dispose();
  }
});
