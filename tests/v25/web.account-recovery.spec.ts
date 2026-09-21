import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

const identity = {
  apiIssuer: 'https://api.example.test',
  principalId: 'legacy-principal',
  status: 'recovery_required',
  identityVersion: 0,
};
const account = {
  id: 'upstream-owner',
  username: 'recovering-creator',
  displayName: null,
  quota: 500_000,
  quotaUnit: '点',
  canGenerate: false,
  identity,
  recovery: {
    requestId: 'e2e-recovery-request',
    reason: 'legacy_evidence_missing',
    expiresAt: '2030-01-01T00:00:00Z',
    actions: ['retry', 'verify_original_session', 'create_independent_workspace'],
  },
};
const active = {
  ...account,
  canGenerate: true,
  recovery: null,
  identity: {
    ...identity,
    principalId: 'independent-principal',
    status: 'active',
    identityVersion: 1,
  },
};
const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });

async function fixture(page: Page, originalDevice = false) {
  await seedOnboardingCompleted(page);
  const requests: Array<{ path: string; body: unknown }> = [];
  let recovered = originalDevice;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/account/status') return route.fulfill(json(recovered ? active : account));
    if (path.startsWith('/account/recovery/')) {
      requests.push({ path, body: route.request().postDataJSON() });
      if (path.endsWith('/retry')) return route.fulfill(json(account));
      if (path.endsWith('/inspect'))
        return route.fulfill(
          json({
            requestId: account.recovery.requestId,
            expiresAt: account.recovery.expiresAt,
            candidate: {
              issuer: 'https://upstream.example.test',
              ownerId: account.id,
              username: account.username,
              displayName: null,
            },
          }),
        );
      recovered = true;
      return route.fulfill(json(active));
    }
    if (path === '/workbench/sessions') return route.fulfill(json({ items: [], nextCursor: null }));
    if (path === '/generations/providers') return route.fulfill(json([]));
    return route.fulfill({
      status: 404,
      ...json({ error: { code: 'NOT_FOUND', message: 'fixture route unavailable' } }),
    });
  });
  await page.goto('/settings');
  await page.getByTestId('settings-nav-account').click();
  return requests;
}

test('受限账号可重试并明确确认独立空间，刷新后保持新身份', async ({ page }) => {
  const requests = await fixture(page);
  await expect(page.getByTestId('account-recovery')).toBeVisible();
  await expect(page.getByTestId('account-points')).toHaveCount(0);
  await expect(page.getByTestId('account-redeem-input')).toHaveCount(0);
  await page.getByTestId('account-recovery-retry').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    path: '/account/recovery/retry',
    body: { requestId: account.recovery.requestId },
  });
  await expect(page.getByTestId('account-recovery')).toBeVisible();
  await page.getByTestId('account-recovery-independent').click();
  await expect(page.getByRole('alertdialog')).toContainText('旧工作区及其历史保持保留');
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(requests).toHaveLength(1);
  await page.getByTestId('account-recovery-independent').click();
  await page.getByTestId('account-recovery-independent-confirm').click();
  await expect(page.getByTestId('account-recovery')).toHaveCount(0);
  await expect(page.getByTestId('account-points')).toBeVisible();
  expect(requests.at(-1)).toEqual({
    path: '/account/recovery/independent-workspace',
    body: { requestId: account.recovery.requestId },
  });
  await page.reload();
  await page.getByTestId('settings-nav-account').click();
  await expect(page.getByTestId('account-points')).toBeVisible();
  await expect(page.getByTestId('account-recovery')).toHaveCount(0);
});

test('原设备先核对申请和账号来源，再确认验证且保留自己的账号', async ({ page }) => {
  const requests = await fixture(page, true);
  await expect(page.getByTestId('account-original-session')).toBeVisible();
  await page.getByLabel('另一台设备的恢复申请编号').fill(account.recovery.requestId);
  await page.getByTestId('account-original-inspect').click();
  await expect(page.getByTestId('account-original-session')).toContainText(
    'https://upstream.example.test',
  );
  await expect(page.getByTestId('account-original-session')).toContainText(
    `账号编号：${account.id}`,
  );
  expect(requests.map((request) => request.path)).toEqual(['/account/recovery/inspect']);
  await page.getByTestId('account-original-confirm').click();
  await expect(page.getByTestId('account-original-session')).toContainText('这台设备仍使用原账号');
  await expect(page.getByTestId('account-signed-in')).toContainText(account.username);
  expect(requests.at(-1)).toEqual({
    path: '/account/recovery/verify-original-session',
    body: { requestId: account.recovery.requestId },
  });
});

test('确认框在遮罩先结束退出时立即重开，确认仍可点击且不重复提交', async ({ page }) => {
  test.setTimeout(15_000);
  const requests = await fixture(page);
  // Deterministically widen the real lifecycle gap; production content/overlay already differ.
  await page.addStyleTag({
    content: `
    [data-slot="alert-dialog-overlay"][data-state="closed"] { animation-duration: 40ms !important; }
    [data-slot="alert-dialog-content"][data-state="closed"] { animation-duration: 500ms !important; }
  `,
  });
  await page.getByTestId('account-recovery-independent').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('[data-slot="alert-dialog-overlay"]')).toHaveCount(0);
  await page.getByTestId('account-recovery-independent').click();
  const confirm = page.getByTestId('account-recovery-independent-confirm');
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(page.getByTestId('account-points')).toBeVisible();
  expect(requests).toEqual([
    {
      path: '/account/recovery/independent-workspace',
      body: { requestId: account.recovery.requestId },
    },
  ]);
});
