import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { accountCloudStatusSchema } from '@musefold/contracts';
import { registerAutomationSpendSchema } from '@musefold/desktop-contracts/automation-spend';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { AutomationSpendRepository } from '../../packages/core/src/db/repositories/automation-spend';
import { cloudInvoke } from './cloud-crash-helpers';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke } from './local-execution-fixture';

for (const state of ['held', 'unknown', 'unfinished-terminal'] as const) {
  test(`旧月份持久费用 ${state} 阻止正式云连接启用并保留原记录`, async () => {
    const fixture = await localExecutionFixture();
    let app: ElectronApplication | undefined;
    let userData = '';
    let db: Database.Database | undefined;
    try {
      const launched = await launchV25App('musefold-legacy-enablement-', { env: fixture.env });
      app = launched.app;
      userData = launched.userDataDir;
      const page = await v25ShellPage(app);
      await page.getByTestId('nav-settings').click();
      await page.getByTestId('settings-nav-account').click();
      await page.getByTestId('account-username').fill('joint-a');
      await page.getByTestId('account-password').fill('synthetic-password');
      await page.getByTestId('account-auth-submit').click();
      await expect(page.getByTestId('account-points')).toBeVisible();
      await page.getByTestId('settings-nav-connections').click();
      await expect(page.getByTestId('account-cloud-review')).toBeVisible();
      const staleReview = accountCloudStatusSchema.parse(
        await localInvoke(page, 'accountCloud.getStatus'),
      );
      expect(staleReview.reviewRef).not.toBeNull();
      // Historical persisted data, not a claim that today's unbound legacy
      // Provider can create a managed request through the live HTTP entrypoint.
      db = new Database(desktopDbPath(userData));
      const spend = new AutomationSpendRepository(db, 'historical-scope');
      const now = Date.UTC(2026, 7, 1);
      spend.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 1, month: '2026-08' }, now);
      const input = registerAutomationSpendSchema.parse({
        idempotencyKey: randomUUID(),
        action: 'generate_image',
        caller: 'historical-fixture',
        input: {},
        frozenInput: {},
        promptText: null,
        executionId: randomUUID(),
        maxImageCalls: 1,
        maxTextCalls: 0,
        estimatedPoints: 3,
        now,
        bindings: [
          {
            providerId: 'historical-provider',
            providerType: 'openai-compatible',
            model: 'historical-model',
            baseUrl: 'https://historical.example.invalid',
            credentialEpoch: 'historical-epoch',
            payerKind: 'account',
            policy: 'managed',
            ownerId: 'historical-owner',
            issuer: 'https://historical.example.invalid',
          },
        ],
      });
      const request = spend.register(input).request;
      if (state !== 'held') {
        const call = spend.prepareCall({
          requestId: request.id,
          ordinal: 0,
          kind: 'image',
          binding: input.bindings[0],
          input: {},
          generationRunId: 'historical-run',
        });
        if (state === 'unknown') {
          spend.claimCall(call.id, input.bindings[0], 'historical-runtime', now);
          spend.finishRequest(request.id, 'failed', now);
        } else {
          // A damaged terminal label must not conceal an unsettled call.
          db.prepare(
            "UPDATE automation_spend_requests SET state = 'terminal', reservation_state = 'released' WHERE id = ?",
          ).run(request.id);
        }
      }
      const facts = () => ({
        request: spend.get(request.id),
        calls: db
          ?.prepare('SELECT * FROM automation_spend_calls WHERE request_id = ?')
          .all(request.id),
        policy: db
          ?.prepare('SELECT * FROM automation_spend_policies WHERE scope_id = ?')
          .all('historical-scope'),
        periods: db
          ?.prepare('SELECT * FROM automation_budget_periods WHERE scope_id = ?')
          .all('historical-scope'),
        checkpoint: db?.prepare('SELECT * FROM managed_execution_checkpoint').all(),
        providers: db?.prepare('SELECT * FROM providers ORDER BY id').all(),
      });
      const before = facts();
      await page.getByTestId('account-cloud-review').click();
      await page.getByTestId('account-cloud-confirm').click();
      await expect(page.getByTestId('account-cloud-status')).toHaveText(
        '旧任务或未结费用尚未完成核对，请先处理原任务。',
      );
      expect(facts()).toEqual(before);
      expect(existsSync(join(userData, 'managed-execution.anchor'))).toBe(false);
      // Rechecking or bypassing the UI cannot manufacture an enablement grant.
      const review = accountCloudStatusSchema.parse(
        await localInvoke(page, 'accountCloud.getStatus'),
      );
      expect(review.mode).toBe('blocked');
      expect(review.reviewRef).toBeNull();
      expect(
        await cloudInvoke(page, 'accountCloud.connect', { reviewRef: staleReview.reviewRef }),
      ).toMatchObject({
        ok: false,
        code: 'ACCOUNT_CLOUD_REVIEW_REQUIRED',
      });
      expect(facts()).toEqual(before);
      expect(fixture.imageCalls).toEqual([]);
      expect(fixture.cloudCreates).toEqual([]);
      expect(existsSync(join(userData, 'managed-execution.anchor'))).toBe(false);
    } finally {
      db?.close();
      await app?.close();
      if (userData) rmSync(userData, { recursive: true, force: true });
      await fixture.close();
    }
  });
}
