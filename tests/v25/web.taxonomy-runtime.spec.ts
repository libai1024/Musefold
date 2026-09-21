import { expect, test } from '@playwright/test';
import {
  promptFolderSchema,
  promptTagSchema,
  promptDocumentSchema,
  syncBootstrapPageSchema,
} from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import {
  browserJson,
  connectExchangeBrowser,
  loginExchangeBrowser,
} from './package-exchange-browser';

test('actual taxonomy confirmation cancels, survives a failed request and keeps associated prompts', async ({
  page,
  context,
}, info) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires owned API/Better Auth/PostgreSQL');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  let failedDeletes = 0;
  let deleteAttempts = 0;
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    await loginExchangeBrowser(page, 'taxonomy-ui@example.test');
    await page.goto('/prompts');
    await page.getByTestId('taxonomy-open').click();
    await page.getByTestId('taxonomy-folder-name').fill('实际父文件夹');
    await page.getByTestId('taxonomy-folder-create').click();
    await expect(
      page.getByRole('button', { name: '删除文件夹 实际父文件夹', exact: true }),
    ).toBeVisible();
    await page.getByTestId('taxonomy-tag-name').fill('实际标签');
    await page.getByTestId('taxonomy-tag-create').click();
    await expect(
      page.getByRole('button', { name: '删除标签 实际标签', exact: true }),
    ).toBeVisible();
    const parent = promptFolderSchema.array().parse(await browserJson(page, '/api/v1/folders'))[0];
    const tag = promptTagSchema.array().parse(await browserJson(page, '/api/v1/tags'))[0];
    const child = promptFolderSchema.parse(
      await browserJson(page, '/api/v1/folders', {
        name: '子文件夹',
        parentId: parent.id,
        sortOrder: 0,
      }),
    );
    const p = promptDocumentSchema.parse(
      await browserJson(page, '/api/v1/prompts', {
        title: '保留的提示词',
        content: '正文不变',
        description: null,
        negative: null,
        folderId: parent.id,
        tagIds: [tag.id],
        modelId: null,
        params: null,
      }),
    );
    await page.reload();
    await page.getByTestId('taxonomy-open').click();
    // Only inject transport failure. Successful retries go to the actual authenticated API.
    await context.route('**/api/v1/{folders,tags}/*', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleteAttempts++;
      if (failedDeletes === 0) {
        failedDeletes++;
        return route.abort('failed');
      }
      return route.fallback();
    });
    const trigger = page.getByRole('button', { name: '删除文件夹 实际父文件夹', exact: true });
    await trigger.click();
    const dialog = page.getByTestId('taxonomy-delete-dialog');
    await expect(dialog).toContainText('提示词和子文件夹会保留');
    await dialog.screenshot({ path: info.outputPath('web-taxonomy-confirmation.png') });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(trigger).toBeFocused();
    expect(deleteAttempts).toBe(0);
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(deleteAttempts).toBe(0);
    await page.getByTestId('taxonomy-folder-name').fill('保留未提交输入');
    await trigger.click();
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(deleteAttempts).toBe(1);
    expect(
      promptFolderSchema.array().parse(await browserJson(page, '/api/v1/folders')),
    ).toHaveLength(2);
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveCount(0);
    await expect(page.getByTestId('taxonomy-folder-name')).toHaveValue('保留未提交输入');
    await page.getByRole('button', { name: '删除标签 实际标签', exact: true }).click();
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: '删除标签 实际标签', exact: true })).toHaveCount(
      0,
    );
    expect(deleteAttempts).toBe(3);
    const finalFolders = promptFolderSchema
      .array()
      .parse(await browserJson(page, '/api/v1/folders'));
    expect(finalFolders).toEqual([expect.objectContaining({ id: child.id, parentId: null })]);
    const finalPrompt = promptDocumentSchema.parse(
      await browserJson(page, `/api/v1/prompts/${p.id}`),
    );
    expect(finalPrompt).toMatchObject({
      content: '正文不变',
      folderId: null,
      tags: [],
      deletedAt: null,
    });
    await page.reload();
    await expect(page.getByTestId(`prompt-row-${p.id}`)).toBeVisible();
    await page.getByTestId('taxonomy-open').click();
    await expect(
      page.getByRole('button', { name: '删除文件夹 子文件夹', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '删除文件夹 实际父文件夹', exact: true }),
    ).toHaveCount(0);
    const deletedProjections = [];
    for (const [kind, entity] of [
      ['folder', parent],
      ['tag', tag],
    ] as const) {
      const bootstrap = syncBootstrapPageSchema.parse(
        await browserJson(page, `/api/v1/sync/bootstrap?entity=${kind}&limit=10`),
      );
      const marker = bootstrap.items.find((item) => item.id === entity.id);
      expect(marker).toMatchObject({
        id: entity.id,
        version: entity.version + 1,
        deletedAt: expect.any(String),
        name: kind === 'folder' ? '已删除文件夹' : '已删除标签',
      });
      deletedProjections.push(marker);
      const listed = await browserJson(
        page,
        `/api/v1/${kind === 'folder' ? 'folders' : 'tags'}?includeDeleted=true`,
      );
      const parsed =
        kind === 'folder'
          ? promptFolderSchema.array().parse(listed)
          : promptTagSchema.array().parse(listed);
      expect(parsed.find((item) => item.id === entity.id)).toBeUndefined();
    }
    await info.attach('actual-taxonomy-result', {
      body: JSON.stringify({
        failedDeletes,
        deleteAttempts,
        finalFolders,
        finalPrompt,
        deletedProjections,
        cloudPolicy:
          'permanent deletion; active lists omit removed entities, sync bootstrap carries minimal deleted projections',
      }),
      contentType: 'application/json',
    });
  } finally {
    for (const tab of context.pages()) await tab.goto('about:blank');
    await context.unrouteAll({ behavior: 'wait' });
    await service.dispose();
  }
});
