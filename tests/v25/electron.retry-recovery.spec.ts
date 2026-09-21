import { expect, test } from '@playwright/test';
import { cloudEvidence } from './cloud-crash-helpers';
import { retryRecoveryFixture } from './retry-recovery-helpers';

test.beforeEach(() => {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires isolated real Hono/PG/worker');
  test.setTimeout(180000);
});

for (const point of ['binding', 'before-claim', 'receipt'] as const) {
  for (const transition of ['account', 'restore'] as const) {
    test(`重试 ${point} 等待时 ${transition}：旧响应不写新身份或恢复后的库`, async () => {
      const f = await retryRecoveryFixture();
      try {
        const baseline = f.local();
        const backupResult = await f.invoke('system.createBackup');
        expect(backupResult.ok).toBe(true);
        const backup = (backupResult.data as { backup: { file: string } }).backup.file;
        const waitHit = await f.hold(point);
        const pending = f.retry();
        const hit = await waitHit();
        expect(hit).toMatchObject({ point, pid: f.app.process().pid, status: 200 });
        expect(f.parent.frozenRequest.model).toBe('musefold-image-pro');
        if (point !== 'receipt') {
          expect(new URL(hit.url).pathname).toBe('/api/v1/account/models');
          expect(hit.binding).toBe(point === 'binding' ? 1 : 2);
        }
        const before = f.local();
        const child = before.records.find((r) => r.retryOf?.requestId === f.parent.requestId);
        expect(before.records).toHaveLength(point === 'binding' ? 1 : 2);
        if (child) {
          expect(child.receipt).toBeNull();
          expect(child.frozenRequest.model).toBe(f.parent.frozenRequest.model);
          expect(child.binding.model).toBe(f.parent.binding.model);
        }
        expect((await f.remote()).runs).toHaveLength(point === 'receipt' ? 2 : 1);
        let restoring: ReturnType<typeof f.invoke> | undefined;
        if (transition === 'account') {
          expect(
            await f.invoke('account.login', {
              username: 'joint-b',
              password: 'synthetic-password',
            }),
          ).toMatchObject({ ok: true });
        } else {
          restoring = f.invoke('system.restoreBackup', { file: backup });
          await expect
            .poll(async () => (await f.invoke('workbench.listSessions', {})).ok)
            .toBe(false);
        }
        f.release();
        const reply = await pending;
        // The later barriers are after the local run became visible, not a second send consent.
        expect(reply.ok).toBe(point !== 'binding');
        if (restoring)
          expect(await restoring).toMatchObject({ ok: true, data: { needsRestart: true } });
        else {
          // Drain any old runtime before checking its late receipt remained unapplied.
          await f.restart();
        }
        const after = f.local();
        if (transition === 'restore') {
          expect(after.records).toEqual(baseline.records);
          expect(after.checkpoint).toEqual(baseline.checkpoint);
          await f.restart();
          expect(await f.anchor()).toMatchObject({ mode: 'query_only' });
        } else {
          expect(after.records).toEqual(before.records);
          expect(after.checkpoint).toEqual(before.checkpoint);
          expect(
            await f.invoke('account.login', {
              username: 'joint-a',
              password: 'synthetic-password',
            }),
          ).toMatchObject({ ok: true });
          if (child) {
            const method = point === 'receipt' ? 'accountCloud.reconcile' : 'accountCloud.cancel';
            expect(await f.invoke(method, { requestId: child.requestId })).toMatchObject({
              ok: true,
            });
          }
        }
        const remote = await f.remote();
        expect(
          remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/retry')),
        ).toHaveLength(point === 'receipt' ? 1 : 0);
        expect(remote.providerCalls).toHaveLength(0);
        expect(f.local().records.find((r) => r.requestId === f.parent.requestId)?.receipt).toEqual(
          f.parent.receipt,
        );
        expect(f.spend(f.parent.requestId)).toEqual(f.parentSpend);
        await test.info().attach('retry-transition-proof', {
          body: cloudEvidence(
            {
              point,
              transition,
              hit,
              reply,
              pids: f.pids,
              baseline,
              before,
              after,
              remote,
              parentSpend: f.parentSpend,
            },
            f.root,
          ),
          contentType: 'application/json',
        });
      } finally {
        await f.close();
      }
    });
  }
}

for (const change of ['purge-parent', 'rotate-again'] as const) {
  test(`已接受重试遇 ${change}：同意图不得制造替代任务，原子任务可只读恢复`, async () => {
    const f = await retryRecoveryFixture();
    try {
      await f.service.request('rotate');
      await f.service.request('configure', { breakRetry: true });
      expect((await f.retry()).ok).toBe(true);
      await expect.poll(async () => (await f.remote()).runs.length).toBe(2);
      const child = f.local().records.find((r) => r.retryOf);
      if (!child) throw new Error('Missing accepted child');
      expect(child.binding.credential.version).toBe(f.parent.binding.credential.version + 1);
      if (change === 'purge-parent')
        await f.service.request('purge', { runId: f.parent.receipt?.originalRunId });
      else await f.service.request('rotate');
      await f.restart();
      const before = f.local();
      const repeated = await f.retry();
      // Current desktop requires fresh binding/parent eligibility for retry calls. It must
      // explain refusal and keep recovery of the already accepted child as a distinct GET path.
      expect(repeated).toMatchObject({ ok: false, code: 'MANAGED_QUERY_ONLY' });
      expect((repeated as { message?: string }).message).toContain('核对原任务');
      expect(f.local().records).toHaveLength(2);
      expect(f.local().records.find((r) => r.requestId === child.requestId)).toEqual(child);
      await f.service.request('startWorker');
      const childRunId = (await f.remote()).runs.find((r) => r.parent_run_id)?.id;
      expect(childRunId).toBeTruthy();
      await expect
        .poll(async () => (await f.remote()).runs.find((r) => r.id === childRunId)?.status, {
          timeout: 20000,
        })
        .toBe(change === 'purge-parent' ? 'succeeded' : 'failed');
      await f.page.getByTestId('nav-settings').click();
      await f.page.getByTestId('settings-nav-connections').click();
      const recoveryRow = f.page
        .getByTestId('account-cloud-recovery-item')
        .filter({ hasText: child.requestId });
      await expect(recoveryRow).toBeVisible();
      await recoveryRow.getByRole('button', { name: '核对原任务', exact: true }).click();
      await expect
        .poll(() => f.local().records.find((r) => r.requestId === child.requestId)?.receipt?.status)
        .toBe(change === 'purge-parent' ? 'succeeded' : 'failed');
      if (change === 'purge-parent') await expect.poll(() => f.local().assets.length).toBe(1);
      await expect
        .poll(() => f.local().runs)
        .toContainEqual(
          expect.objectContaining({
            id: child.localGenerationId,
            status: change === 'purge-parent' ? 'success' : 'failed',
          }),
        );
      const after = f.local();
      const recovered = after.records.find((r) => r.requestId === child.requestId);
      expect(recovered).toMatchObject({
        retryOf: child.retryOf,
        remoteKey: child.remoteKey,
        binding: child.binding,
      });
      expect(recovered?.receipt).toMatchObject({
        originalRunId: childRunId,
        status: change === 'purge-parent' ? 'succeeded' : 'failed',
        terminalAt: expect.any(String),
        costProvenance: change === 'purge-parent' ? 'unknown' : 'not_sent',
        costPoints: change === 'purge-parent' ? null : 0,
      });
      expect(
        after.records.find((r) => r.requestId === f.parent.requestId)?.receipt?.costPoints,
      ).toBe(0);
      const remote = await f.remote();
      expect(
        remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/retry')),
      ).toHaveLength(1);
      expect(
        remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/generations')),
      ).toHaveLength(1);
      expect(remote.providerCalls).toHaveLength(change === 'purge-parent' ? 1 : 0);
      expect(f.spend(f.parent.requestId)).toEqual(f.parentSpend);
      await test.info().attach('retry-parent-change-proof', {
        body: cloudEvidence(
          {
            change,
            pids: f.pids,
            repeated,
            before,
            after,
            remote,
            parentSpend: f.parentSpend,
            childSpend: f.spend(child.requestId),
          },
          f.root,
        ),
        contentType: 'application/json',
      });
    } finally {
      await f.close();
    }
  });
}

for (const claimed of [false, true]) {
  test(`重试取消回包损坏 ${claimed ? 'claimed' : 'queued'}：新 PID 核对同一任务与原费用`, async () => {
    const f = await retryRecoveryFixture();
    try {
      if (claimed) {
        await f.service.request('configure', { holdProvider: true });
        await f.service.request('startWorker');
      }
      expect((await f.retry()).ok).toBe(true);
      await expect.poll(async () => (await f.remote()).runs.length).toBe(2);
      if (claimed) await expect.poll(async () => (await f.remote()).providerCalls.length).toBe(1);
      const child = f.local().records.find((r) => r.retryOf);
      const childRun = (await f.remote()).runs.find((r) => r.parent_run_id);
      if (!child || !childRun) throw new Error('Missing child');
      await f.breakCancel(childRun.id);
      expect(await f.invoke('accountCloud.cancel', { requestId: child.requestId })).toMatchObject({
        ok: false,
      });
      const before = f.local();
      expect(
        before.records.find((r) => r.requestId === child.requestId)?.cancelRequestedAt,
      ).not.toBeNull();
      await f.restart();
      if (claimed) await f.service.request('release');
      expect(
        await f.invoke('accountCloud.reconcile', { requestId: child.requestId }),
      ).toMatchObject({ ok: true });
      const after = f.local();
      expect(after.records.find((r) => r.requestId === f.parent.requestId)?.receipt).toEqual(
        f.parent.receipt,
      );
      expect(after.records.find((r) => r.requestId === child.requestId)?.receipt).toMatchObject({
        status: 'cancelled',
        operation: 'explicit_retry',
        sourceRunId: f.parent.receipt?.originalRunId,
        costPoints: claimed ? null : 0,
        costProvenance: claimed ? 'unknown' : 'not_sent',
      });
      const remote = await f.remote();
      expect(
        remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/retry')),
      ).toHaveLength(1);
      expect(remote.providerCalls).toHaveLength(claimed ? 1 : 0);
      expect(f.spend(f.parent.requestId)).toEqual(f.parentSpend);
      await test.info().attach('retry-cancel-reply-proof', {
        body: cloudEvidence(
          {
            claimed,
            pids: f.pids,
            before,
            after,
            remote,
            parentSpend: f.parentSpend,
            childSpend: f.spend(child.requestId),
          },
          f.root,
        ),
        contentType: 'application/json',
      });
    } finally {
      await f.close();
    }
  });
}
