import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { cloudInvoke, cloudLocalState, connectCloud } from './cloud-crash-helpers';

test('显式云重试：UI 取消后重试，丢回包与新 PID 同意图并发均保留唯一父子任务', async () => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    '需要 Docker 与真实 Hono/PG/worker，认证及上游是合成服务',
  );
  test.setTimeout(180000);
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await service.ready;
    const first = await launchV25App('musefold-cloud-retry-', {
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    await connectCloud(page);
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('composer-prompt').fill('synthetic explicit retry');
    await page.getByTestId('composer-submit').click();
    type Snapshot = {
      runs: Array<{ id: string; status: string; parent_run_id: string | null; run_kind: string }>;
      calls: Array<{ method: string; path: string; key: string; body: unknown }>;
      providerCalls: unknown[];
      heldBindings: number;
    };
    const snapshot = () => service.request<Snapshot>('snapshot');
    await expect.poll(async () => (await snapshot()).runs.length).toBe(1);
    await page.getByTestId('job-cancel').click();
    await expect(page.getByTestId('job-retry')).toBeVisible();
    const parent = cloudLocalState(userData).records[0];
    expect(parent.receipt).toMatchObject({
      status: 'cancelled',
      costProvenance: 'not_sent',
      costPoints: 0,
    });
    const sourceId = parent.localGenerationId;
    expect(sourceId).not.toBeNull();
    await service.request('rotate');
    await service.request('configure', { breakRetry: true, holdBinding: true });
    await page.getByTestId('job-retry').evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    // Wait for the actual authority request to be held, not just a transient render.
    await expect.poll(async () => (await snapshot()).heldBindings).toBeGreaterThan(0);
    const held = await snapshot();
    expect(held.runs).toHaveLength(1);
    expect(held.calls.filter((call) => call.path.endsWith('/retry'))).toHaveLength(0);
    await expect(page.getByTestId('job-retry')).toBeDisabled();
    await page.getByTestId('nav-history').click();
    await expect(page.getByTestId('history-row-retry')).toBeDisabled();
    await page.getByTestId('history-row-open').click();
    await expect(page.getByTestId('history-inspector-retry')).toBeDisabled();
    await service.request('configure', { holdBinding: false });
    await expect.poll(async () => (await snapshot()).runs.length).toBe(2);
    const child = cloudLocalState(userData).records.find(
      (r) => r.retryOf?.requestId === parent.requestId,
    );
    if (!child) throw new Error('Missing durable retry');
    expect(child.binding.credential.version).toBe(parent.binding.credential.version + 1);
    expect(child.binding.model).toBe(parent.binding.model);
    expect(child.frozenRequest.model).toBe(parent.frozenRequest.model);
    const firstPid = app.process().pid;
    await app.close();
    app = undefined;
    await service.request('startWorker');
    await expect
      .poll(async () => (await snapshot()).runs.find((r) => r.parent_run_id)?.status, {
        timeout: 20000,
      })
      .toBe('succeeded');
    ({ app } = await launchV25App('musefold-cloud-retry-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: info.baseUrl },
    }));
    expect(app.process().pid).not.toBe(firstPid);
    page = await v25ShellPage(app);
    const intent = { id: sourceId, idempotencyKey: child.callerKey.slice('desktop-retry:'.length) };
    const repeated = await Promise.all([
      cloudInvoke(page, 'generation.retry', intent),
      cloudInvoke(page, 'generation.retry', intent),
    ]);
    for (const reply of repeated)
      expect(reply).toMatchObject({ ok: true, data: { id: child.localGenerationId } });
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-connections').click();
    const recoveryButtons = page.getByRole('button', { name: '核对原任务', exact: true });
    await expect(recoveryButtons).toHaveCount(2);
    for (const button of await recoveryButtons.all()) await button.click();
    await expect.poll(() => cloudLocalState(userData).assets.length).toBe(1);
    const final = cloudLocalState(userData);
    expect(final.records).toHaveLength(2);
    expect(final.records.find((r) => r.requestId === parent.requestId)?.receipt).toEqual(
      parent.receipt,
    );
    expect(final.records.find((r) => r.requestId === child.requestId)?.receipt).toMatchObject({
      operation: 'explicit_retry',
      sourceRunId: parent.receipt?.originalRunId,
      status: 'succeeded',
      costProvenance: 'unknown',
      costPoints: null,
    });
    const remote = await snapshot();
    expect(
      remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/generations')),
    ).toHaveLength(1);
    expect(remote.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/retry'))).toEqual([
      expect.objectContaining({ key: child.remoteKey, body: { expectedBinding: child.binding } }),
    ]);
    expect(remote.providerCalls).toHaveLength(1);
    expect(remote.providerCalls[0]).toMatchObject({ body: { model: parent.binding.model } });
    expect(remote.runs.find((r) => r.parent_run_id)).toMatchObject({
      parent_run_id: parent.receipt?.originalRunId,
      run_kind: 'retry',
    });
    await test.info().attach('explicit-retry-proof', {
      body: JSON.stringify({
        firstPid,
        newPid: app.process().pid,
        intent,
        parent,
        child: final.records.find((r) => r.requestId === child.requestId),
        calls: remote.calls,
        providerCalls: remote.providerCalls.length,
        localRuns: final.runs,
      }),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});

test('费用未知失败：真实 Electron 重试入口拒绝新授权且原费用保留', async () => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    '需要 Docker 与真实 Hono/PG/worker，认证及上游是合成服务',
  );
  test.setTimeout(180000);
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await service.ready;
    await service.request('configure', { providerStatus: 500 });
    const first = await launchV25App('musefold-cloud-retry-unknown-', {
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = first.app;
    userData = first.userDataDir;
    const page = await v25ShellPage(app);
    await connectCloud(page);
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('composer-prompt').fill('synthetic failed unknown charge');
    await page.getByTestId('composer-submit').click();
    await service.request('startWorker');
    await expect(page.getByTestId('generation-recovery-notice')).toContainText('费用尚未核对完成', {
      timeout: 20000,
    });
    await expect.poll(() => cloudLocalState(userData).records[0]?.receipt?.status).toBe('failed');
    await expect(page.getByTestId('job-retry')).toHaveCount(0);
    const parent = cloudLocalState(userData).records[0];
    expect(parent.receipt).toMatchObject({
      status: 'failed',
      costProvenance: 'unknown',
      costPoints: null,
    });
    const reply = await cloudInvoke(page, 'generation.retry', {
      id: parent.localGenerationId,
      idempotencyKey: randomUUID(),
    });
    expect(reply).toMatchObject({
      ok: false,
      code: 'MANAGED_QUERY_ONLY',
      message: '原任务或费用尚未核对完成，请先核对原任务；此次没有重新生成。',
    });
    const legacy = await cloudInvoke(page, 'generation.retry', parent.localGenerationId);
    expect(legacy).toMatchObject({ ok: false, code: 'MANAGED_QUERY_ONLY' });
    expect(cloudLocalState(userData).records).toHaveLength(1);
    expect(cloudLocalState(userData).records[0].receipt).toEqual(parent.receipt);
    const remote = await service.request<{
      calls: Array<{ path: string }>;
      providerCalls: unknown[];
    }>('snapshot');
    expect(remote.calls.filter((c) => c.path.endsWith('/retry'))).toHaveLength(0);
    expect(remote.providerCalls).toHaveLength(1);
  } finally {
    await app?.close();
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
