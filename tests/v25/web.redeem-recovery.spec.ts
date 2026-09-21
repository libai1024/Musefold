import { generationJobSchema } from '@musefold/contracts';
import { expect, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

// Production features/api-client and both browser viewports; HTTP account/generation fixtures.
// This checks presentation and routing, not real redemption accounting or upstream billing.
for (const outcome of ['request-rejected', 'accepted-failed'] as const) {
  test(`兑换到账后独立呈现续发失败并返回对应任务：${outcome}`, async ({ page }) => {
    await seedOnboardingCompleted(page);
    const now = new Date().toISOString();
    const original = generationJobSchema.parse({
      id: 'redeem-original',
      sessionId: null,
      parentRunId: null,
      promptId: null,
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'failed',
      progress: 100,
      request: { prompt: '额度恢复测试猫咪', count: 1 },
      providerModel: 'musefold-image-pro',
      costPoints: 0,
      assets: [],
      error: { code: 'ACCOUNT_QUOTA_INSUFFICIENT', message: '额度不足' },
      createdAt: now,
      startedAt: now,
      finishedAt: now,
    });
    const child = generationJobSchema.parse({
      ...original,
      id: 'redeem-child',
      parentRunId: original.id,
      error: { code: 'GENERATION_UPSTREAM_REJECTED', message: '合成上游拒绝' },
    });
    let credited = false;
    let redemptionCalls = 0;
    const retryKeys: string[] = [];
    const jobs = [original];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const account = () => ({
      id: 'redeem-owner',
      username: 'creator',
      displayName: null,
      quota: credited ? 500000 : 0,
      quotaUnit: '点',
      canGenerate: credited,
    });
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace('/api/v1', '');
      const send = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      if (path === '/account/status') return send(account());
      if (path === '/account/redeem') {
        redemptionCalls++;
        credited = true;
        return send({ account: account(), creditedQuota: 500000 });
      }
      if (path === `/generations/${original.id}/retry`) {
        retryKeys.push(request.headers()['idempotency-key']);
        await held;
        if (outcome === 'accepted-failed') {
          jobs.push(child);
          return send(child, 201);
        }
        return send(
          {
            error: {
              code: 'GENERATION_IDEMPOTENCY_CONFLICT',
              message: '原任务需要核对',
              retryable: false,
              requestId: 'redeem-test',
            },
          },
          409,
        );
      }
      if (path === '/generations') return send({ items: jobs, nextCursor: null });
      if (path === '/workbench/sessions') return send({ items: [], nextCursor: null });
      if (path === '/generations/providers') return send([]);
      const job = jobs.find((item) => path === `/generations/${item.id}`);
      if (job) return send(job);
      return send(
        {
          error: {
            code: 'GENERATION_NOT_FOUND',
            message: 'Uncovered fixture path',
            retryable: false,
            requestId: 'redeem-test',
          },
        },
        404,
      );
    });
    try {
      await page.goto('/history');
      await page.getByTestId('history-row-open').click();
      await page.getByTestId('history-detail-error-action').click();
      await expect(page.getByTestId('settings-section-account')).toBeVisible();
      await page.getByTestId('account-redeem-input').fill('SYNTHETIC-CODE');
      await page.getByTestId('account-redeem-submit').click();
      await expect(page.getByTestId('account-points')).toHaveText('10 积分');
      await expect(page.getByTestId('account-redeem-recovery')).toHaveAttribute(
        'data-status',
        'pending',
      );
      await expect(page.getByTestId('account-redeem-submit')).toBeDisabled();
      expect(redemptionCalls).toBe(1);
      await expect.poll(() => retryKeys.length).toBe(1);
      expect(retryKeys[0]).toBeTruthy();
      release();
      await expect(page.getByTestId('account-redeem-recovery')).toHaveAttribute(
        'data-status',
        'failed',
      );
      await expect(page.getByTestId('account-redeem-recovery')).toContainText('额度已到账');
      await expect(page.getByTestId('account-redeem-recovery')).toContainText(
        outcome === 'accepted-failed' ? '合成上游拒绝' : '原任务需要核对',
      );
      await expect(page.getByTestId('account-redeem-input')).toHaveValue('');
      await page.getByTestId('account-redeem-history').click();
      await expect(page.getByTestId('history-inspector')).toBeVisible();
      await expect(page.getByTestId('history-inspector-error-details')).toContainText(
        outcome === 'accepted-failed' ? '合成上游拒绝' : '额度不足',
      );
      expect(retryKeys).toHaveLength(1);
      expect(redemptionCalls).toBe(1);
    } finally {
      release();
    }
  });
}
