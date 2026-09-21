import { expect, type Page, type TestInfo } from '@playwright/test';
import { workbenchSessionSchema, workbenchSessionPageSchema } from '@musefold/contracts';

/** Test transport adapter; every result comes from the actual API or Electron IPC. */
export type SessionRequest = (
  operation: 'create' | 'update' | 'remove' | 'restore' | 'list' | 'get',
  payload: unknown,
) => Promise<unknown>;

export async function seedSessionTrash(request: SessionRequest) {
  const trash: string[] = [];
  for (let i = 0; i < 25; i++) {
    const row = workbenchSessionSchema.parse(
      await request('create', {
        title: `回收站对话 ${i}`,
        draft: { prompt: `Synthetic draft ${i}` },
      }),
    );
    await request('remove', row.id);
    trash.push(row.id);
  }
  const archived = workbenchSessionSchema.parse(
    await request('create', { title: '恢复仍归档', draft: { prompt: '归档草稿保留' } }),
  );
  await request('update', {
    id: archived.id,
    patch: { expectedVersion: archived.version, archived: true },
  });
  await request('remove', archived.id);
  const live = workbenchSessionSchema.parse(
    await request('create', { title: '正常会话保留', draft: { prompt: '正常草稿保留' } }),
  );
  return { trash, archived: archived.id, live: live.id };
}

export async function openSessionTrash(page: Page) {
  await page.getByTestId('settings-nav-data').click();
  await page.getByTestId('session-trash-toggle').click();
  await expect(page.getByTestId('session-trash-body')).toBeVisible();
}

export async function exerciseSessionTrash(
  page: Page,
  request: SessionRequest,
  fixture: Awaited<ReturnType<typeof seedSessionTrash>>,
  info: TestInfo,
  reopenSettings: () => Promise<unknown> = () => page.reload(),
) {
  await openSessionTrash(page);
  await expect(page.getByTestId('session-trash-count')).toHaveText('20+');
  await page.getByTestId(`session-trash-restore-${fixture.archived}`).click();
  await expect(page.getByTestId(`session-trash-row-${fixture.archived}`)).toHaveCount(0);
  const restored = workbenchSessionSchema.parse(await request('get', fixture.archived));
  expect(restored.archivedAt).not.toBeNull();
  expect(restored.deletedAt).toBeNull();
  expect(restored.draft.prompt).toBe('归档草稿保留');
  await page.getByTestId('archived-toggle').click();
  await expect(page.getByTestId(`archived-session-${fixture.archived}`)).toBeVisible();
  await page.getByTestId('archived-toggle').click();
  const target = fixture.trash[24];
  const trigger = page.getByTestId(`session-trash-purge-${target}`);
  await trigger.click();
  await expect(page.getByRole('alertdialog')).toContainText('会话和草稿无法恢复');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(workbenchSessionSchema.parse(await request('get', target)).deletedAt).not.toBeNull();

  // Actual service rejects a target restored by another caller after the dialog opened.
  await trigger.click();
  await request('restore', target);
  await page.getByTestId('session-trash-confirm').click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('session-trash-confirm')).toBeEnabled();
  await page.getByRole('alertdialog').screenshot({
    path: info.outputPath('session-trash-restored-race.png'),
    animations: 'disabled',
  });
  expect(workbenchSessionSchema.parse(await request('get', target)).deletedAt).toBeNull();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByTestId('session-trash-refresh').click();
  await expect(page.getByTestId(`session-trash-row-${target}`)).toHaveCount(0);

  const purgeId = fixture.trash[23];
  await page.getByTestId(`session-trash-purge-${purgeId}`).click();
  await page.getByTestId('session-trash-confirm').click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId(`session-trash-row-${purgeId}`)).toHaveCount(0);
  await expect(page.getByTestId('session-trash-toggle')).toBeFocused();
  await page.getByTestId('session-trash-load-more').click();
  await expect(page.getByTestId(`session-trash-row-${fixture.trash[0]}`)).toBeAttached();
  await expect(page.getByTestId('session-trash-count')).toHaveText('23');

  // Reload discards client pagination: cleanup must still include unloaded rows.
  await reopenSettings();
  await page.getByTestId('settings-nav-data').click();
  await page.getByTestId('session-trash-toggle').click();
  await expect(page.getByTestId('session-trash-count')).toHaveText('20+');
  await page.getByTestId('session-trash-toggle').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('session-trash-list.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByTestId('session-trash-empty-all').click();
  await expect(page.getByRole('alertdialog')).toContainText('包括尚未加载的会话');
  await page.getByRole('alertdialog').screenshot({
    path: info.outputPath('session-trash-empty-confirmation.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(
    workbenchSessionPageSchema.parse(await request('list', { deletedOnly: true, limit: 100 }))
      .items,
  ).toHaveLength(23);
  await page.getByTestId('session-trash-empty-all').click();
  await page.getByTestId('session-trash-confirm').click();
  await expect(page.getByTestId('session-trash-empty')).toBeVisible();
  expect(
    workbenchSessionPageSchema.parse(await request('list', { deletedOnly: true, limit: 100 }))
      .items,
  ).toHaveLength(0);
  expect(workbenchSessionSchema.parse(await request('get', fixture.live)).draft.prompt).toBe(
    '正常草稿保留',
  );
  const retained = workbenchSessionPageSchema.parse(
    await request('list', { includeArchived: true, limit: 100 }),
  );
  expect(new Set(retained.items.map((row) => row.id))).toEqual(
    new Set([fixture.live, fixture.archived, target]),
  );
  await info.attach('session-trash-outcome', {
    contentType: 'application/json',
    body: JSON.stringify({
      initialTrash: 26,
      restored: 2,
      singlePurged: 1,
      emptyPurged: 23,
      liveRetained: 3,
    }),
  });
}

export function webSessionRequest(page: Page): SessionRequest {
  return (operation, payload) =>
    page.evaluate(
      async ({ operation, payload }) => {
        const base = '/api/v1/workbench/sessions';
        let path = base;
        let method = 'GET';
        let body: unknown;
        if (operation === 'create') {
          method = 'POST';
          body = payload;
        }
        if (operation === 'list')
          path += `?${new URLSearchParams(payload as Record<string, string>)}`;
        if (operation === 'get') path += `/${payload}`;
        if (operation === 'remove') {
          path += `/${payload}`;
          method = 'DELETE';
        }
        if (operation === 'restore') {
          path += `/${payload}/restore`;
          method = 'POST';
        }
        if (operation === 'update') {
          const input = payload as { id: string; patch: unknown };
          path += `/${input.id}`;
          method = 'PATCH';
          body = input.patch;
        }
        const response = await fetch(path, {
          method,
          credentials: 'include',
          ...(body === undefined
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        });
        if (!response.ok) throw new Error(`Session fixture ${response.status}: ${operation}`);
        return response.json();
      },
      { operation, payload },
    );
}

export function electronSessionRequest(page: Page): SessionRequest {
  return (operation, payload) =>
    page.evaluate(
      async ({ operation, payload }) => {
        const methods = {
          create: 'createSession',
          update: 'updateSession',
          remove: 'removeSession',
          restore: 'restoreSession',
          list: 'listSessions',
          get: 'getSession',
        };
        const bridge = (
          window as unknown as {
            musefoldV25: {
              invoke(
                method: string,
                payload: unknown,
              ): Promise<{ ok: boolean; data?: unknown; error?: unknown }>;
            };
          }
        ).musefoldV25;
        const result = await bridge.invoke(`workbench.${methods[operation]}`, payload);
        if (!result.ok)
          throw new Error(`Session fixture IPC failed: ${JSON.stringify(result.error)}`);
        return result.data;
      },
      { operation, payload },
    );
}
