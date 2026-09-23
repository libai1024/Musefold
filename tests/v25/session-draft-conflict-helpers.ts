import { expect, type Page, type TestInfo } from '@playwright/test';
import { workbenchSessionSchema } from '@musefold/contracts';
import type { SessionRequest } from './session-trash-ui-helpers';

/** UI-SPEC §2.4(v2.5.1 起):错误提示持久保留、需手动关闭;被拒自动保存会周期性
 *  重试,新错误 toast 可能在关闭后再次弹出并盖住「核对草稿」钮(通知区与按钮重叠)。
 *  循环:关掉当前全部错误 toast → 短超时尝试真实指针点击;被新 toast 拦截则再来一轮。 */
async function clickDraftReviewPastErrorToasts(page: Page): Promise<void> {
  const reviewButton = page.getByTestId('session-draft-review');
  const toasts = page.getByRole('region', { name: 'Notifications alt+T' }).getByRole('listitem');
  for (let attempt = 0; ; attempt++) {
    for (let index = (await toasts.count()) - 1; index >= 0; index--) {
      await toasts.nth(index).getByRole('button', { name: 'Close toast' }).click();
    }
    try {
      await reviewButton.click({ timeout: 2_000 });
      return;
    } catch (error) {
      if (attempt >= 4 || !(await toasts.count())) throw error;
    }
  }
}

/** Actual service CAS, explicit review and UI rename; no replacement query or version response. */
export async function exerciseSessionDraftConflict(
  page: Page,
  request: SessionRequest,
  openWorkbench: (id: string) => Promise<unknown>,
  info: TestInfo,
) {
  const initial = workbenchSessionSchema.parse(
    await request('create', { title: '草稿并发', draft: { prompt: '基础草稿' } }),
  );
  await openWorkbench(initial.id);
  const prompt = page.getByTestId('composer-prompt');
  await expect(prompt).toHaveValue('基础草稿');
  await prompt.fill('本页未保存的输入');
  const remote = workbenchSessionSchema.parse(
    await request('update', {
      id: initial.id,
      patch: {
        expectedVersion: initial.version,
        title: '另一窗口提交',
        draft: { ...initial.draft, prompt: '另一窗口的草稿' },
      },
    }),
  );
  await expect(page.getByTestId('session-draft-save-error')).toBeVisible();
  // A rejected autosave invalidates the list. Both hosts disable window-focus refetch.
  await expect(page.getByTestId('session-picker')).toContainText('另一窗口提交');
  expect(workbenchSessionSchema.parse(await request('get', initial.id)).draft.prompt).toBe(
    '另一窗口的草稿',
  );
  await expect(prompt).toHaveValue('本页未保存的输入');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
  await clickDraftReviewPastErrorToasts(page);
  const dialog = page.getByTestId('session-draft-conflict-dialog');
  await expect(dialog.getByLabel('最新保存的草稿', { exact: true })).toContainText(
    '另一窗口的草稿',
  );
  await expect(dialog.getByLabel('本页草稿', { exact: true })).toContainText('本页未保存的输入');
  if (info.project.name === 'web-mobile') {
    for (const id of [
      'session-draft-review-refresh',
      'session-draft-load-remote',
      'session-draft-save-local',
    ]) {
      // AlertDialog scales in; measure the settled hit target, retaining the 44px requirement.
      await expect
        .poll(async () => (await page.getByTestId(id).boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
    }
  }
  await dialog.screenshot({
    path: info.outputPath('session-draft-review.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('session-draft-review')).toBeFocused();
  await expect(prompt).toHaveValue('本页未保存的输入');
  // Keep the real pointer click and all draft/focus assertions below.
  await prompt.hover();
  // 第二次进核对同样要避开重试自动保存弹出的持久错误 toast。
  await clickDraftReviewPastErrorToasts(page);
  await expect(dialog).toBeVisible();
  const newer = workbenchSessionSchema.parse(
    await request('update', {
      id: initial.id,
      patch: {
        expectedVersion: remote.version,
        title: '核对后再次提交',
        draft: { ...remote.draft, prompt: '核对后出现的新草稿' },
      },
    }),
  );
  expect(workbenchSessionSchema.parse(await request('get', initial.id)).version).toBe(
    newer.version,
  );
  // The open review must remain the version the user saw, despite a later service write.
  await expect(dialog.getByLabel('最新保存的草稿', { exact: true })).toContainText(
    '另一窗口的草稿',
  );
  await page.getByTestId('session-draft-save-local').click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('session-draft-save-local')).toBeDisabled();
  expect(workbenchSessionSchema.parse(await request('get', initial.id)).draft.prompt).toBe(
    '核对后出现的新草稿',
  );
  await dialog.screenshot({
    path: info.outputPath('session-draft-review-stale.png'),
    animations: 'disabled',
  });
  await page.getByTestId('session-draft-review-refresh').click();
  await expect(dialog.getByLabel('最新保存的草稿', { exact: true })).toContainText(
    '核对后出现的新草稿',
  );
  await page.getByTestId('session-draft-save-local').click();
  await expect(dialog).toHaveCount(0);
  await expect(prompt).toBeFocused();
  const saved = workbenchSessionSchema.parse(await request('get', initial.id));
  expect(saved.version).toBe(newer.version + 1);
  expect(saved.draft.prompt).toBe('本页未保存的输入');

  await prompt.fill('本页明确放弃的输入');
  const latest = workbenchSessionSchema.parse(
    await request('update', {
      id: initial.id,
      patch: {
        expectedVersion: saved.version,
        title: '准备载入最新',
        draft: { ...saved.draft, prompt: '要载入的远端草稿' },
      },
    }),
  );
  await expect(page.getByTestId('session-draft-save-error')).toBeVisible();
  await expect(page.getByTestId('session-picker')).toContainText('准备载入最新');
  await clickDraftReviewPastErrorToasts(page);
  await expect(dialog).toBeVisible();
  await page.getByTestId('session-draft-load-remote').click();
  await expect(prompt).toHaveValue('要载入的远端草稿');
  expect(workbenchSessionSchema.parse(await request('get', initial.id)).version).toBe(
    latest.version,
  );
  await expect(page.getByTestId('session-draft-save-error')).toHaveCount(0);
  const mobile = info.project.name === 'web-mobile';
  if (mobile) await page.getByTestId('sidebar-drawer-open').click();
  const row = page.getByTestId(`session-row-${initial.id}`);
  if (mobile) {
    await row.getByTestId('session-more').click();
    await page.getByTestId('session-menu-rename').click();
  } else {
    await row.hover();
    await row.getByTestId('session-rename').click();
  }
  await page.getByTestId('session-rename-input').fill('只有标题变更');
  await page.getByTestId('session-rename-commit').click();
  await expect(page.getByTestId(`session-${initial.id}`)).toContainText('只有标题变更');
  if (mobile) await page.keyboard.press('Escape');
  await expect(page.getByTestId('session-picker')).toContainText('只有标题变更');
  const renamed = workbenchSessionSchema.parse(await request('get', initial.id));
  expect(renamed.version).toBe(latest.version + 1);
  expect(renamed.draft).toEqual(latest.draft);
  await prompt.fill('标题变更后的正常编辑');
  await expect
    .poll(async () => workbenchSessionSchema.parse(await request('get', initial.id)).draft.prompt)
    .toBe('标题变更后的正常编辑');
  const final = workbenchSessionSchema.parse(await request('get', initial.id));
  expect(final.version).toBe(renamed.version + 1);
  await expect(page.getByTestId('session-draft-save-error')).toHaveCount(0);
  await info.attach('session-draft-conflict-result', {
    contentType: 'application/json',
    body: JSON.stringify({
      initialVersion: initial.version,
      conflictingRemoteVersion: remote.version,
      reviewedRaceVersion: newer.version,
      explicitlySavedVersion: saved.version,
      explicitlyLoadedVersion: latest.version,
      finalVersion: final.version,
    }),
  });
}
