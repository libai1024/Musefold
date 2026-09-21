import { test, expect } from '@playwright/test';
import { promptPageSchema, type PromptDocument } from '@musefold/contracts';
import { AgentBrowserProcess } from './agent-browser-process';
import {
  browserJson,
  connectExchangeBrowser,
  loginExchangeBrowser,
} from './package-exchange-browser';

// Actual API/Better Auth/PG; only the later-page network failure is injected.
test('actual prompt trash excludes live pages, recovers a failed next page and clears beyond filters', async ({
  page,
  context,
}, info) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires owned API/Better Auth/PostgreSQL');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    await loginExchangeBrowser(page, 'prompt-trash@example.test');
    const fixture = await page.evaluate(async () => {
      const request = async (path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`/api/v1${path}`, {
          method,
          credentials: 'include',
          ...(body === undefined
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        });
        if (!response.ok) throw new Error(`Synthetic prompt fixture: ${response.status}`);
        return response.json();
      };
      const create = (title: string) =>
        request('/prompts', 'POST', {
          title,
          content: 'Synthetic trash query',
          description: null,
          negative: null,
          folderId: null,
          tagIds: [],
          modelId: null,
          params: null,
          rating: 0,
          isPinned: false,
          source: 'manual',
          sourceUrl: null,
        });
      const trash: string[] = [],
        live: string[] = [];
      for (let i = 0; i < 35; i++) {
        const row = await create(`UniqueTrash${String(i).padStart(3, '0')}`);
        await request(`/prompts/${row.id}`, 'DELETE');
        trash.push(row.id);
      }
      for (let i = 0; i < 31; i++) live.push((await create(`Live fixture ${i}`)).id);
      return { trash, live, firstNormalPage: await request('/prompts?limit=30') };
    });
    const normal = promptPageSchema.parse(fixture.firstNormalPage);
    expect(normal.items).toHaveLength(30);
    expect(normal.items.every((row) => row.deletedAt === null)).toBe(true);
    let interrupted = 0;
    let failNextPage = true;
    await context.route('**/api/v1/prompts?**', async (route) => {
      const url = new URL(route.request().url());
      if (
        url.searchParams.get('deletedOnly') === 'true' &&
        url.searchParams.has('cursor') &&
        failNextPage
      ) {
        interrupted++;
        return route.abort('failed');
      }
      return route.fallback();
    });
    await page.goto('/prompts');
    await page.getByTestId('prompt-tab-trash').click();
    await expect(page.getByTestId(`prompt-row-${fixture.trash[34]}`)).toBeVisible();
    await page.getByTestId('prompt-scroll-sentinel').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('prompt-retry')).toBeVisible();
    expect(interrupted).toBeGreaterThan(0);
    await expect(page.getByTestId(`prompt-row-${fixture.trash[34]}`)).toBeAttached();
    failNextPage = false;
    await page.getByTestId('prompt-retry').click();
    await expect(page.getByTestId('prompt-error')).toHaveCount(0);
    await page.getByTestId('prompt-scroll-sentinel').scrollIntoViewIfNeeded();
    const restoredId = fixture.trash[4];
    await expect(page.getByTestId(`prompt-row-${restoredId}`)).toBeAttached();
    await page.getByTestId(`prompt-row-${restoredId}`).getByTestId('prompt-row-restore').click();
    await expect(page.getByTestId(`prompt-row-${restoredId}`)).toHaveCount(0);
    expect(await browserJson(page, `/api/v1/prompts/${restoredId}`)).toMatchObject({
      deletedAt: null,
    });
    await page.getByTestId('prompt-search').fill('no-such-trash');
    await expect(page.getByTestId('prompt-clear-filters')).toBeVisible();
    await expect(page.getByText('回收站是空的', { exact: true })).toHaveCount(0);
    await page.getByTestId('prompt-clear-filters').click();
    await page.getByTestId('prompt-search').fill('UniqueTrash034');
    await expect(page.getByTestId('prompt-count')).toHaveText('1 条');
    await page.getByTestId('prompt-empty-trash').click();
    const dialog = page.getByTestId('prompt-empty-trash-dialog');
    await expect(dialog).toContainText('全部');
    await expect(dialog).toContainText('筛选');
    await dialog.screenshot({ path: info.outputPath('actual-filtered-trash-confirmation.png') });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    const stillDeleted = (await browserJson(
      page,
      `/api/v1/prompts/${fixture.trash[34]}`,
    )) as PromptDocument;
    expect(stillDeleted.deletedAt).not.toBeNull();
    await page.getByTestId('prompt-empty-trash').click();
    await page.getByTestId('prompt-empty-trash-confirm').click();
    await expect
      .poll(
        async () =>
          promptPageSchema.parse(await browserJson(page, '/api/v1/prompts?deletedOnly=true')).items
            .length,
      )
      .toBe(0);
    const live = promptPageSchema.parse(await browserJson(page, '/api/v1/prompts?limit=100'));
    expect(live.items).toHaveLength(32);
    expect(new Set(live.items.map((row) => row.id))).toEqual(
      new Set([...fixture.live, restoredId]),
    );
    await info.attach('actual-trash-query', {
      body: JSON.stringify({
        seededLive: 31,
        seededTrash: 35,
        restored: 1,
        purged: 34,
        retainedLive: 32,
        actualNetworkInterruptions: interrupted,
        initialNormalPageAllLive: true,
      }),
      contentType: 'application/json',
    });
  } finally {
    for (const tab of context.pages()) await tab.goto('about:blank');
    await context.unrouteAll({ behavior: 'wait' });
    await service.dispose();
  }
});
