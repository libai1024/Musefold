import { expect, type Page } from '@playwright/test';
import { designSchemeDetailSchema } from '@musefold/contracts';
import type { AgentBrowserProcess } from './agent-browser-process';
import { browserJson, loginExchangeBrowser } from './package-exchange-browser';

async function detail(page: Page, id: string) {
  return designSchemeDetailSchema.parse(await browserJson(page, `/api/v1/design-schemes/${id}`));
}
export async function createActualAgentDraft(
  page: Page,
  service: AgentBrowserProcess,
  kind: 'brief' | 'github' | 'history',
) {
  await loginExchangeBrowser(page, `trial-${kind}@example.test`);
  await service.githubVersion('base');
  if (kind === 'history') {
    const userId = await page.evaluate(
      async () => (await (await fetch('/api/auth/get-session')).json()).user.id as string,
    );
    const material = await service.seedHistory(userId);
    await page.getByTestId('scheme-create').click();
    await page.getByTestId('scheme-create-option-history').click();
    await page.getByTestId(`history-pick-${material.runId}`).click();
    await page.getByTestId('history-source-confirm').click();
  } else {
    await page.getByTestId('scheme-create').click();
    await page.getByTestId('scheme-create-option-idea').click();
    await page
      .getByTestId('composer-prompt')
      .fill(
        `海报${kind === 'github' ? ' https://github.com/example/design https://github.com/example/layout' : ''}`,
      );
  }
  await page.getByTestId('composer-submit').click();
  await page.getByTestId('scheme-agent-model-offer').click();
  expect((await service.snapshot()).imageCalls).toHaveLength(0);
  await page.getByTestId('scheme-agent-authorize-create').click();
  if (kind === 'github') {
    await expect(page.getByTestId('scheme-agent-source')).toContainText('example/design');
    await page.getByTestId('scheme-agent-confirm-source').click();
    await expect(page.getByTestId('scheme-agent-source')).toContainText('example/layout');
    await page.getByTestId('scheme-agent-confirm-source').click();
  }
  await page.getByTestId('scheme-agent-open-result').click({ timeout: 20000 });
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('scheme');
  if (!id) throw new Error('No actual Agent scheme route');
  const draft = await detail(page, id);
  expect(draft.document.createdBy).toBe('agent');
  expect(draft.summary.hasSuccessfulTrial).toBe(false);
  expect(draft.assets).toHaveLength(kind === 'brief' ? 0 : kind === 'github' ? 2 : 1);
  return draft;
}
