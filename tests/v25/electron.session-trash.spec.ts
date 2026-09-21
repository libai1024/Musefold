import { exerciseSessionDraftConflict } from './session-draft-conflict-helpers';
import { expect, test } from '@playwright/test';
import { workbenchSessionPageSchema, workbenchSessionSchema } from '@musefold/contracts';
import { launchV25App, v25ShellPage } from './electron-helpers';
import {
  exerciseSessionTrash,
  seedSessionTrash,
  electronSessionRequest,
} from './session-trash-ui-helpers';

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('Session trash actual Electron IPC/SQLite lifecycle and fresh process persistence', async ({}, info) => {
  test.setTimeout(180000);
  const launched = await launchV25App('musefold-v25-session-trash-');
  let app = launched.app;
  try {
    const page = await v25ShellPage(app);
    const request = electronSessionRequest(page);
    const fixture = await seedSessionTrash(request);
    await page.getByTestId('nav-settings').click();
    await exerciseSessionTrash(page, request, fixture, info, async () => {
      await page.reload();
      await page.getByTestId('nav-settings').click();
    });
    const oldPid = app.process().pid;
    await app.close();
    app = (await launchV25App('musefold-v25-session-trash-', launched.userDataDir)).app;
    expect(app.process().pid).not.toBe(oldPid);
    const restarted = await v25ShellPage(app);
    const read = electronSessionRequest(restarted);
    expect(
      workbenchSessionPageSchema.parse(await read('list', { deletedOnly: true })).items,
    ).toHaveLength(0);
    expect(
      workbenchSessionSchema.parse(await read('get', fixture.archived)).archivedAt,
    ).not.toBeNull();
    expect(workbenchSessionSchema.parse(await read('get', fixture.live)).draft.prompt).toBe(
      '正常草稿保留',
    );
    await info.attach('session-trash-processes', {
      contentType: 'application/json',
      body: JSON.stringify({ oldPid, newPid: app.process().pid }),
    });
  } finally {
    await app.close();
  }
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('Session draft actual Electron IPC/SQLite rejects stale autosave and requires exact reviewed resolution', async ({}, info) => {
  test.setTimeout(180000);
  const { app } = await launchV25App('musefold-v25-session-draft-');
  try {
    const page = await v25ShellPage(app);
    await exerciseSessionDraftConflict(
      page,
      electronSessionRequest(page),
      () => page.reload(),
      info,
    );
  } finally {
    await app.close();
  }
});
