import { exerciseSessionDraftConflict } from './session-draft-conflict-helpers';
import { test } from '@playwright/test';
import { AgentBrowserProcess } from './agent-browser-process';
import { connectExchangeBrowser, loginExchangeBrowser } from './package-exchange-browser';
import {
  exerciseSessionTrash,
  seedSessionTrash,
  webSessionRequest,
} from './session-trash-ui-helpers';

test('Session trash actual API/PG restore, concurrent restore protection, permanent cleanup and refresh', async ({
  page,
  context,
}, info) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires owned API/Better Auth/PostgreSQL');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    await loginExchangeBrowser(page, 'session-trash@example.test');
    const request = webSessionRequest(page);
    const fixture = await seedSessionTrash(request);
    await page.goto('/settings');
    await exerciseSessionTrash(page, request, fixture, info);
  } finally {
    for (const tab of context.pages()) await tab.goto('about:blank');
    await context.unrouteAll({ behavior: 'wait' });
    await service.dispose();
  }
});

test('Session draft actual API/PG rejects stale autosave and requires exact reviewed resolution', async ({
  page,
  context,
}, info) => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires owned API/Better Auth/PostgreSQL');
  test.setTimeout(180000);
  const service = new AgentBrowserProcess();
  try {
    await connectExchangeBrowser(context, (await service.ready).baseUrl);
    await loginExchangeBrowser(page, 'session-draft@example.test');
    await exerciseSessionDraftConflict(
      page,
      webSessionRequest(page),
      (id) => page.goto(`/workbench?session=${id}`),
      info,
    );
  } finally {
    for (const tab of context.pages()) await tab.goto('about:blank');
    await context.unrouteAll({ behavior: 'wait' });
    await service.dispose();
  }
});
