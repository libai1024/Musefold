import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import {
  armCloudCrash,
  cloudAnchor,
  cloudEvidence,
  cloudInvoke,
  cloudLocalState,
  cloudSpendState,
  type CloudCrashPhase,
  connectCloud,
  decodeCloudAnchor,
  killCloudProcess,
} from './cloud-crash-helpers';
import { launchV25App, v25ShellPage } from './electron-helpers';

type Snapshot = {
  runs: Array<{ id: string; status: string; parent_run_id: string | null }>;
  calls: Array<{ method: string; path: string; key: string | null }>;
  providerCalls: unknown[];
  receipts: Array<{ idempotency_key: string; cost_points: number | null }>;
};
function prerequisites() {
  test.skip(process.env.RUN_DATABASE_TESTS !== 'true', 'Requires real isolated Hono/PG/worker');
  test.skip(process.platform === 'win32', 'POSIX process fault; native Windows is a separate gate');
  test.setTimeout(180000);
}
async function close(app: ElectronApplication | undefined, userData: string) {
  if (!app) return;
  const marker = join(userData, 'test-crash-window.json');
  if (existsSync(marker) && JSON.parse(readFileSync(marker, 'utf8')).pid === app.process().pid) {
    await killCloudProcess(app);
    await app.close().catch(() => undefined);
  } else await app.close();
}

const phases: Array<{ phase: CloudCrashPhase; claimed?: boolean }> = [
  { phase: 'before-claim' },
  { phase: 'claim-committed' },
  { phase: 'before-submit' },
  { phase: 'after-submit' },
  { phase: 'after-cancel' },
  { phase: 'after-cancel', claimed: true },
];
for (const { phase, claimed = false } of phases) {
  test(`显式重试 SIGKILL ${phase}${claimed ? ' claimed' : ''}：新 PID 保留父子费用且不重发`, async () => {
    prerequisites();
    const service = new CloudServiceProcess();
    let app: ElectronApplication | undefined;
    let userData = '';
    try {
      const info = await service.ready;
      const snapshot = () => service.request<Snapshot>('snapshot');
      const first = await launchV25App('musefold-retry-crash-', {
        env: { MUSEFOLD_API_URL: info.baseUrl },
      });
      app = first.app;
      userData = first.userDataDir;
      let page = await v25ShellPage(app);
      await connectCloud(page);
      await page.getByTestId('nav-workbench').click();
      await page.getByTestId('composer-prompt').fill('synthetic retry crash parent');
      await page.getByTestId('composer-submit').click();
      await expect.poll(async () => (await snapshot()).runs.length).toBe(1);
      await page.getByTestId('job-cancel').click();
      await expect(page.getByTestId('job-retry')).toBeVisible();
      const parent = cloudLocalState(userData).records[0];
      const parentSpend = cloudSpendState(userData, parent.requestId);
      expect(parent.receipt).toMatchObject({ status: 'cancelled', costPoints: 0 });
      const parentRunId = parent.receipt?.originalRunId;
      if (!parentRunId) throw new Error('Expected real cancelled parent');
      const marker = await armCloudCrash(app, userData, info.baseUrl, phase, parentRunId);
      if (claimed) {
        await service.request('configure', { holdProvider: true });
        await service.request('startWorker');
      }
      const oldPid = app.process().pid;
      const sending = page
        .getByTestId('job-retry')
        .click()
        .catch((error: Error) => error.message);
      let cancelling: Promise<unknown> | undefined;
      const isCancel = phase === 'after-cancel';
      const noPost = ['before-claim', 'claim-committed', 'before-submit'].includes(phase);
      if (isCancel) {
        await expect.poll(async () => (await snapshot()).runs.length).toBe(2);
        if (claimed) await expect.poll(async () => (await snapshot()).providerCalls.length).toBe(1);
        const child = cloudLocalState(userData).records.find((r) => r.retryOf);
        if (!child) throw new Error('Expected durable child before cancellation');
        cancelling = cloudInvoke(page, 'accountCloud.cancel', { requestId: child.requestId }).catch(
          (error: Error) => error.message,
        );
      }
      await expect.poll(() => existsSync(marker), { timeout: 20000 }).toBe(true);
      const hit = JSON.parse(readFileSync(marker, 'utf8'));
      expect(hit).toMatchObject({ phase, pid: oldPid });
      if (phase === 'before-submit' || phase === 'after-submit')
        expect(hit.detail.path).toBe(`/api/v1/generations/${parentRunId}/retry`);
      const before = cloudLocalState(userData);
      const child = before.records.find((r) => r.retryOf?.requestId === parent.requestId);
      if (!child) throw new Error('Missing exact retry parent association');
      const childJobId = (before.runs as Array<{ id: string }>).find(
        (r) => r.id !== parent.localGenerationId,
      )?.id;
      expect(childJobId).toBeTruthy();
      expect(before.records).toHaveLength(2);
      expect(child.retryOf?.remoteRunId).toBe(parentRunId);
      expect(child.submissionState).toBe(phase === 'before-claim' ? 'unclaimed' : 'query_only');
      expect(child.binding.payer).toEqual(parent.binding.payer);
      const encoded = readFileSync(join(userData, 'managed-execution.anchor')).toString('base64');
      const remoteBefore = await snapshot();
      expect(remoteBefore.runs).toHaveLength(noPost ? 1 : 2);
      if (isCancel) {
        expect(child.cancelRequestedAt).not.toBeNull();
        expect(child.cancelAcknowledgedAt).toBeNull();
        expect(hit.detail.status).toBe(200);
      }
      const exit = await killCloudProcess(app);
      app = undefined;
      await sending;
      await cancelling;
      if (phase === 'after-submit') {
        await service.request('startWorker');
        await expect
          .poll(async () => (await snapshot()).runs.find((r) => r.parent_run_id)?.status, {
            timeout: 20000,
          })
          .toBe('succeeded');
      }
      if (claimed) await service.request('release');
      ({ app } = await launchV25App('unused-', {
        reuseUserDataDir: userData,
        env: { MUSEFOLD_API_URL: info.baseUrl },
      }));
      expect(app.process().pid).not.toBe(oldPid);
      page = await v25ShellPage(app);
      const anchorBefore = await decodeCloudAnchor(app, encoded);
      if (phase === 'claim-committed') {
        expect(anchorBefore.pending).toMatchObject({ kind: 'submit', to: hit.detail.committed });
        expect(before.checkpoint).toEqual([
          expect.objectContaining({ revision: hit.detail.committed.revision }),
        ]);
      }
      const recovery = phase === 'before-claim' ? 'accountCloud.cancel' : 'accountCloud.reconcile';
      expect(await cloudInvoke(page, recovery, { requestId: child.requestId })).toMatchObject({
        ok: true,
      });
      const after = cloudLocalState(userData);
      expect(after.records.find((r) => r.requestId === parent.requestId)?.receipt).toEqual(
        parent.receipt,
      );
      const recovered = after.records.find((r) => r.requestId === child.requestId);
      expect(recovered).toMatchObject({
        remoteKey: child.remoteKey,
        retryOf: child.retryOf,
        binding: child.binding,
      });
      if (noPost) expect(recovered?.receipt).toBeNull();
      else
        expect(recovered?.receipt).toMatchObject({
          operation: 'explicit_retry',
          sourceRunId: parentRunId,
          status: isCancel ? 'cancelled' : 'succeeded',
          costPoints: isCancel && !claimed ? 0 : null,
        });
      expect(after.runs).toContainEqual(
        expect.objectContaining({
          id: childJobId,
          status:
            phase === 'before-claim' || isCancel ? 'cancelled' : noPost ? 'running' : 'success',
          actual_cost: phase === 'before-claim' || (isCancel && !claimed) ? 0 : null,
        }),
      );
      const remote = await snapshot();
      expect(
        remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/retry')),
      ).toHaveLength(noPost ? 0 : 1);
      expect(
        remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/generations')),
      ).toHaveLength(1);
      expect(remote.providerCalls).toHaveLength(phase === 'after-submit' || claimed ? 1 : 0);
      expect(
        await cloudInvoke(page, 'accountCloud.reconcile', { requestId: child.requestId }),
      ).toMatchObject({ ok: true });
      expect(cloudLocalState(userData).runs).toEqual(after.runs);
      expect(cloudLocalState(userData).assets).toEqual(after.assets);
      const sameIntent = {
        id: parent.localGenerationId,
        idempotencyKey: child.callerKey.slice('desktop-retry:'.length),
      };
      const replayed = await Promise.all([
        cloudInvoke(page, 'generation.retry', sameIntent),
        cloudInvoke(page, 'generation.retry', sameIntent),
      ]);
      for (const reply of replayed)
        expect(reply).toMatchObject({ ok: true, data: { id: childJobId } });
      expect(cloudLocalState(userData).records).toHaveLength(2);
      expect(cloudSpendState(userData, parent.requestId)).toEqual(parentSpend);
      expect(
        (await snapshot()).calls.filter((c) => c.method === 'POST' && c.path.endsWith('/retry')),
      ).toHaveLength(noPost ? 0 : 1);
      await test.info().attach('retry-crash-proof', {
        body: cloudEvidence(
          {
            phase,
            claimed,
            oldPid,
            newPid: app.process().pid,
            hit,
            exit,
            before,
            anchorBefore,
            after,
            anchor: await cloudAnchor(app, userData),
            remote,
            sameIntent,
            replayed,
            parentSpend,
            childSpend: cloudSpendState(userData, child.requestId),
          },
          userData,
        ),
        contentType: 'application/json',
      });
    } finally {
      await close(app, userData);
      await service.stop();
      if (userData) rmSync(userData, { recursive: true, force: true });
    }
  });
}

test('未领取请求强杀后在实际界面取消并新授权：普通 create 保留本地父关系且不伪造云回执', async () => {
  prerequisites();
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await service.ready;
    const snapshot = () => service.request<Snapshot>('snapshot');
    const first = await launchV25App('musefold-retry-unclaimed-', {
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    await connectCloud(page);
    const marker = await armCloudCrash(app, userData, info.baseUrl, 'before-claim');
    const oldPid = app.process().pid;
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('composer-prompt').fill('synthetic unclaimed retry');
    const sending = page
      .getByTestId('composer-submit')
      .click()
      .catch((error: Error) => error.message);
    await expect.poll(() => existsSync(marker), { timeout: 20000 }).toBe(true);
    const hit = JSON.parse(readFileSync(marker, 'utf8'));
    const original = cloudLocalState(userData).records[0];
    expect(original).toMatchObject({ submissionState: 'unclaimed', receipt: null, callId: null });
    expect((await snapshot()).runs).toHaveLength(0);
    const exit = await killCloudProcess(app);
    app = undefined;
    await sending;
    ({ app } = await launchV25App('unused-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: info.baseUrl },
    }));
    expect(app.process().pid).not.toBe(oldPid);
    page = await v25ShellPage(app);
    await page.getByTestId('nav-history').click();
    await page.getByTestId('history-row-cancel').click();
    await expect(page.getByTestId('history-row-retry')).toBeVisible();
    const cancelled = cloudLocalState(userData).records[0];
    const cancelledSpend = cloudSpendState(userData, original.requestId);
    expect(cancelled.receipt).toBeNull();
    expect(cancelled.cancelRequestedAt).not.toBeNull();
    expect(cloudLocalState(userData).runs).toEqual([
      expect.objectContaining({ status: 'cancelled', actual_cost: 0 }),
    ]);
    await page.getByTestId('history-row-retry').click();
    await expect.poll(async () => (await snapshot()).runs.length).toBe(1);
    await service.request('startWorker');
    await expect
      .poll(async () => (await snapshot()).runs[0]?.status, { timeout: 20000 })
      .toBe('succeeded');
    await expect.poll(() => cloudLocalState(userData).assets.length, { timeout: 20000 }).toBe(1);
    const after = cloudLocalState(userData);
    expect(after.records).toHaveLength(2);
    expect(after.records.find((r) => r.requestId === original.requestId)?.receipt).toBeNull();
    const child = after.records.find((r) => r.retryOf?.requestId === original.requestId);
    expect(child).toMatchObject({
      retryOf: { requestId: original.requestId, remoteRunId: null },
      frozenRequest: original.frozenRequest,
      receipt: {
        operation: 'ordinary_create',
        sourceRunId: null,
        status: 'succeeded',
        costPoints: null,
      },
    });
    expect(child?.binding.payer).toEqual(original.binding.payer);
    const remote = await snapshot();
    expect(remote.runs[0].parent_run_id).toBeNull();
    expect(
      remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/generations')),
    ).toHaveLength(1);
    expect(
      remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/retry')),
    ).toHaveLength(0);
    expect(remote.providerCalls).toHaveLength(1);
    expect(cloudSpendState(userData, original.requestId)).toEqual(cancelledSpend);
    await test.info().attach('unclaimed-retry-proof', {
      body: cloudEvidence(
        {
          oldPid,
          newPid: app.process().pid,
          hit,
          exit,
          original,
          cancelled,
          after,
          remote,
          cancelledSpend,
        },
        userData,
      ),
      contentType: 'application/json',
    });
  } finally {
    await close(app, userData);
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
