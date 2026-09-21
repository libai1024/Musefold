import { rmSync } from 'node:fs';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import type { PromptPage, PromptDocument, PromptListQuery } from '@musefold/contracts';
import type { BridgeEnvelope } from '../../apps/desktop/electron/main/ipc-v25/envelope';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { invoke } from './desktop-sync-helpers';

async function walk(page: Page, query: PromptListQuery) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 30; i++) {
    const response = await invoke<PromptPage>(page, 'prompts.list', {
      ...query,
      limit: 100,
      cursor,
    });
    expect(response.items.length).toBeLessThanOrEqual(100);
    ids.push(...response.items.map((row) => row.id));
    if (!response.nextCursor) return ids;
    cursor = response.nextCursor;
  }
  throw new Error('Owned prompt traversal did not finish');
}

test('real IPC reaches1001 search/501 trash rows and filtered clearing survives a new PID', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(150000);
  let app: ElectronApplication | undefined;
  let directory = '';
  try {
    const launched = await launchV25App('musefold-v25-prompt-pages-');
    app = launched.app;
    directory = launched.userDataDir;
    const firstPid = app.process().pid;
    const page = await v25ShellPage(app);
    const fixture = await page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          musefoldV25: {
            invoke(method: string, payload?: unknown): Promise<BridgeEnvelope<unknown>>;
          };
        }
      ).musefoldV25;
      const call = async (method: string, payload: unknown) => {
        const result = await bridge.invoke(method, payload);
        if (!result.ok) throw new Error(`Owned fixture ${method}: ${result.code}`);
        return result.data as PromptDocument;
      };
      const create = (title: string, content: string) =>
        call('prompts.create', {
          title,
          content,
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
      for (let i = 0; i < 501; i++) {
        const row = await create(`UniqueTrash${String(i).padStart(3, '0')}`, 'b73trashcohort');
        await call('prompts.remove', { id: row.id });
        trash.push(row.id);
      }
      for (let i = 0; i < 1001; i++)
        live.push((await create(`Live fixture ${i}`, 'b73livecohort')).id);
      return { trash, live };
    });
    const readLive = await walk(page, { q: 'b73livecohort' });
    expect(readLive).toHaveLength(1001);
    expect(new Set(readLive)).toEqual(new Set(fixture.live));
    const readTrash = await walk(page, { deletedOnly: true });
    expect(readTrash).toHaveLength(501);
    expect(new Set(readTrash)).toEqual(new Set(fixture.trash));
    await page.getByTestId('nav-prompts').click();
    await page.getByTestId('prompt-tab-trash').click();
    await expect(page.getByTestId(`prompt-row-${fixture.trash[500]}`)).toBeVisible();
    await page.getByTestId('prompt-scroll-sentinel').scrollIntoViewIfNeeded();
    const restored = fixture.trash[470];
    await expect(page.getByTestId(`prompt-row-${restored}`)).toBeAttached();
    await page.getByTestId(`prompt-row-${restored}`).getByTestId('prompt-row-restore').click();
    await expect(page.getByTestId(`prompt-row-${restored}`)).toHaveCount(0);
    await page.getByTestId('prompt-search').fill('no-such-trash');
    await expect(page.getByTestId('prompt-clear-filters')).toBeVisible();
    await page.getByTestId('prompt-clear-filters').click();
    await page.getByTestId('prompt-search').fill('UniqueTrash500');
    await expect(page.getByTestId('prompt-count')).toHaveText('1 条');
    await page.getByTestId('prompt-empty-trash').click();
    const dialog = page.getByTestId('prompt-empty-trash-dialog');
    await expect(dialog).toContainText('全部');
    await expect(dialog).toContainText('筛选');
    await dialog.screenshot({
      path: info.outputPath('actual-desktop-filtered-trash-confirmation.png'),
    });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(
      (await invoke<PromptDocument>(page, 'prompts.get', { id: fixture.trash[500] })).deletedAt,
    ).not.toBeNull();
    await page.getByTestId('prompt-empty-trash').click();
    await page.getByTestId('prompt-empty-trash-confirm').click();
    await expect.poll(async () => (await walk(page, { deletedOnly: true })).length).toBe(0);
    await app.close();
    app = undefined;
    app = (await launchV25App('musefold-v25-prompt-pages-restart-', directory)).app;
    const secondPid = app.process().pid;
    expect(secondPid).not.toBe(firstPid);
    const restarted = await v25ShellPage(app);
    expect(await walk(restarted, { q: 'b73livecohort' })).toHaveLength(1001);
    expect(await walk(restarted, { deletedOnly: true })).toEqual([]);
    expect(await invoke<PromptDocument>(restarted, 'prompts.get', { id: restored })).toMatchObject({
      deletedAt: null,
    });
    await info.attach('actual-desktop-prompt-pages', {
      body: JSON.stringify({
        firstPid,
        secondPid,
        seededLive: 1001,
        seededTrash: 501,
        restored: 1,
        purged: 500,
        retainedLiveCohort: 1001,
        restartTrash: 0,
      }),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});
