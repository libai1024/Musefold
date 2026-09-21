import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT_CLOUD_PROVIDER_TYPE, aiProviderSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import { cloudInvoke, cloudLocalState, cloudSpendState, connectCloud } from './cloud-crash-helpers';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { seedFormalTextScheme } from './design-scheme-test-helpers';

/**
 * C3-B 层③（正式主进程）：结算窗口 = 回执 GET 已真实发出、applyReceipt 尚未落库。
 * 只改测试自有主进程的 builtin（globalThis.fetch 包装），无生产 hook、无伪造 cipher。
 * 本文件为首跑前写成，由主代理统一执行（RUN_DATABASE_TESTS=true + Docker PG）。
 */

type Snapshot = {
  runs: Array<{ id: string; status: string }>;
  receipts: Array<{ idempotency_key: string; cost_provenance: string; cost_points: number | null }>;
  calls: Array<{ method: string; path: string; key: string | null }>;
  providerCalls: unknown[];
  assets: unknown[];
};

type SettlementMode = 'hold' | 'kill';

// This positive control must use the exact same barrier as the account-switch negative case.
// Otherwise a locked/consumed HTTP body could make every held response fail before identity checks.
test('结算暂停正例：同账号放行后真实回执可读并成功落账', async () => {
  prerequisites();
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await service.ready;
    const first = await submitThenCompleteOnRemote(service, info);
    app = first.app;
    userData = first.userDataDir;
    await expect
      .poll(async () => (await service.request<Snapshot>('snapshot')).runs.length)
      .toBe(1);
    await app.close();
    app = undefined;
    await service.request('startWorker');
    await expect
      .poll(async () => (await service.request<Snapshot>('snapshot')).runs[0].status, {
        timeout: 20000,
      })
      .toBe('succeeded');
    ({ app } = await launchV25App('musefold-c3b-positive-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: info.baseUrl },
    }));
    const page = await v25ShellPage(app);
    const requestId = cloudLocalState(userData).records[0].requestId;
    const window = await armSettlementWindow(app, userData, 'hold');
    const parked = cloudInvoke(page, 'accountCloud.reconcile', { requestId });
    await expect.poll(() => existsSync(window.marker)).toBe(true);
    expect(cloudLocalState(userData).runs).toEqual([
      expect.objectContaining({ status: 'running', actual_cost: null }),
    ]);
    writeFileSync(window.release, 'release');
    expect(await parked).toMatchObject({ ok: true });
    await expect.poll(() => cloudLocalState(userData).assets.length).toBe(4);
    expect(cloudLocalState(userData).runs).toEqual([
      expect.objectContaining({ status: 'success', actual_cost: null }),
    ]);
    expect(cloudSpendState(userData, requestId).request).toMatchObject({
      reservation_state: 'unknown',
    });
    const remote = await service.request<Snapshot>('snapshot');
    expect(remote.providerCalls).toHaveLength(1);
    expect(
      remote.calls.filter((call) => call.method === 'POST' && call.path === '/api/v1/generations'),
    ).toHaveLength(1);
  } finally {
    if (app) {
      writeFileSync(join(userData, 'c3b-settle-release'), 'release');
      await app.close();
    }
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});

/**
 * 把正式主进程停在真实 HTTP 结算边界：`GET /api/v1/generations/receipts/by-key`
 * 已发出且响应已返回（服务端已计数），但回执体尚未交给业务层，applyReceipt 未执行。
 * 'hold' 等待 release 文件后放行；'kill' 写 marker 后 SIGSTOP，由父进程 SIGKILL。
 */
async function armSettlementWindow(
  app: ElectronApplication,
  userData: string,
  mode: SettlementMode,
) {
  const marker = join(userData, 'c3b-settle-window.json');
  const release = join(userData, 'c3b-settle-release');
  await app.evaluate(
    async (_electron, { marker, release, mode }) => {
      const fs = process.getBuiltinModule('fs');
      const modules = process.getBuiltinModule('module');
      const original = globalThis.fetch;
      let fired = false;
      globalThis.fetch = async (input, init) => {
        const response = await original(input, init);
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (fired || !url.includes('/api/v1/generations/receipts/by-key')) return response;
        fired = true;
        fs.writeFileSync(
          marker,
          JSON.stringify({ pid: process.pid, mode, status: response.status }),
          { mode: 0o600 },
        );
        if (mode === 'kill') {
          process.kill(process.pid, 'SIGSTOP');
          return response;
        }
        // Do not acquire a reader: the production receipt decoder must consume this
        // untouched body after release, including in the same-account positive control.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            clearInterval(poll);
            reject(new Error('test settlement barrier expired'));
          }, 60000);
          const poll = setInterval(() => {
            if (!fs.existsSync(release)) return;
            clearInterval(poll);
            clearTimeout(timer);
            resolve();
          }, 10);
        });
        return response;
      };
      modules.syncBuiltinESMExports();
    },
    { marker, release, mode },
  );
  return { marker, release };
}

function prerequisites() {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'Requires real isolated Hono/PG/worker (Docker PostgreSQL)',
  );
  test.skip(process.platform === 'win32', 'POSIX SIGSTOP/SIGKILL; Windows is a separate gate');
  test.setTimeout(180000);
}

/** 提交四图任务后优雅关机（远端仍排队），worker 完成后回执为终态、费用未知。 */
async function submitThenCompleteOnRemote(
  _service: CloudServiceProcess,
  info: { baseUrl: string },
) {
  const first = await launchV25App('musefold-c3b-settle-', {
    env: { MUSEFOLD_API_URL: info.baseUrl },
  });
  const page = await v25ShellPage(first.app);
  await connectCloud(page);
  await page.getByTestId('nav-workbench').click();
  await page.getByTestId('composer-settings').click();
  await page.getByTestId('composer-count-4').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('composer-prompt').fill('synthetic c3b settlement boundary four images');
  await page.getByTestId('composer-submit').click();
  return first;
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('结算窗口换号：旧回执不落新主体，重登后只落一次且未知费用不清账', async ({}, testInfo) => {
  prerequisites();
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await service.ready;
    const snapshot = () => service.request<Snapshot>('snapshot');
    const first = await submitThenCompleteOnRemote(service, info);
    app = first.app;
    userData = first.userDataDir;
    await expect.poll(async () => (await snapshot()).runs.length).toBe(1);
    const oldPid = app.process().pid;
    await app.close();
    app = undefined;
    seedFormalTextScheme(userData);
    await service.request('startWorker');
    await expect
      .poll(async () => (await snapshot()).runs[0].status, { timeout: 20000 })
      .toBe('succeeded');

    // 新 PID 在真实 HTTP 结算边界暂停。
    const relaunched = await launchV25App('unused-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = relaunched.app;
    expect(app.process().pid).not.toBe(oldPid);
    const page = await v25ShellPage(app);
    const requestId = cloudLocalState(userData).records[0].requestId;
    expect(await cloudInvoke(page, 'automation.setMonthlyBudget', { points: 25 })).toMatchObject({
      ok: true,
      data: { monthlyBudgetPoints: 25 },
    });
    const window = await armSettlementWindow(app, userData, 'hold');
    const parked = cloudInvoke(page, 'accountCloud.reconcile', { requestId });
    await expect.poll(() => existsSync(window.marker), { timeout: 20000 }).toBe(true);
    expect(JSON.parse(readFileSync(window.marker, 'utf8'))).toMatchObject({
      pid: app.process().pid,
      mode: 'hold',
      status: 200,
    });

    // 未落稳：不释放额度、不写终态。真实 HTTP 计数里 GET 已发生、无新 POST。
    const duringWindow = cloudLocalState(userData);
    const spendDuring = cloudSpendState(userData, requestId);
    const remoteDuring = await snapshot();
    expect(duringWindow.runs).toEqual([
      expect.objectContaining({ status: 'running', actual_cost: null }),
    ]);
    expect(spendDuring.request).toMatchObject({ reservation_state: 'unknown' });
    // 窗口期 call 行处于在飞占用态（claimSubmission→prepareCall+claimCall 的持久状态），
    // applyReceipt 未执行所以既不落 unknown 终态也不写 reported/policy 点数；结算后才转 'unknown'。
    expect(spendDuring.calls).toEqual([
      expect.objectContaining({ state: 'started', reported_points: null }),
    ]);
    expect(
      remoteDuring.calls.filter(
        (call) => call.method === 'POST' && call.path === '/api/v1/generations',
      ),
    ).toHaveLength(1);
    // 自动对账（generation.get→scheduleManagedReconciliation）的只读 GET 可与被冻结的显式
    // 恢复并发出现；其 applyReceipt 被断言拒绝，故仅计数不设上限，键必须全部是原键。
    const windowGetByKey = remoteDuring.calls.filter((call) =>
      call.path.includes('/receipts/by-key'),
    );
    expect(windowGetByKey.length).toBeGreaterThanOrEqual(1);
    expect(windowGetByKey.map((call) => call.key)).toEqual(
      windowGetByKey.map(() => cloudLocalState(userData).records[0].remoteKey),
    );
    expect(remoteDuring.providerCalls).toHaveLength(1);

    // 正式主进程/HTTP 新意图：即使已配月预算，旧费用未落稳也不得无人确认续发。
    // 使用 R 入口（同一持久费用协调器），不把工作台显式点击的 interactive 同意误判成绕过。
    const providers = await cloudInvoke(page, 'aiProviders.list');
    expect(providers.ok).toBe(true);
    const provider = aiProviderSchema
      .array()
      .parse(providers.data)
      .find((row) => row.type === ACCOUNT_CLOUD_PROVIDER_TYPE);
    expect(provider).toBeDefined();
    const discovery = JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const newIntent = fetch(
      `http://127.0.0.1:${discovery.port}/v1/schemes/scheme_e2e_formal/runs`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${discovery.token}`,
          'content-type': 'application/json',
          'idempotency-key': 'c3b-window-new-reservation',
        },
        body: JSON.stringify({
          providerId: provider?.id,
          inputs: { topic: '未结算时的新意图' },
          n: 1,
        }),
        signal: AbortSignal.timeout(30000),
      },
    ).then(async (response) => ({ status: response.status, body: await response.json() }));
    const db = new Database(desktopDbPath(userData), { readonly: true });
    let pendingReservation: { state: string; confirmation_id: string } | undefined;
    try {
      await expect
        .poll(() => {
          pendingReservation = db
            .prepare(
              'SELECT state,confirmation_id FROM automation_spend_requests WHERE idempotency_key = ?',
            )
            .get('c3b-window-new-reservation') as typeof pendingReservation;
          return pendingReservation?.state;
        })
        .toBe('pending_confirmation');
      expect(cloudSpendState(userData, requestId)).toEqual(spendDuring);
      expect((await snapshot()).providerCalls).toHaveLength(1);
      expect(
        await cloudInvoke(page, 'automation.resolveConfirmation', {
          confirmationId: pendingReservation?.confirmation_id,
          approved: false,
        }),
      ).toMatchObject({ ok: true, data: { handled: true } });
      expect(await newIntent).toMatchObject({ status: 403 });
    } finally {
      db.close();
    }

    // 窗口内换号：放行后旧回执不允许写进新主体，费用与终态都不落。
    expect(
      await cloudInvoke(page, 'account.login', {
        username: 'joint-b',
        password: 'synthetic-password',
      }),
    ).toMatchObject({ ok: true });
    writeFileSync(window.release, 'release');
    expect(await parked).toMatchObject({ ok: false });
    expect(cloudLocalState(userData).runs).toEqual(duringWindow.runs);
    expect(cloudSpendState(userData, requestId)).toEqual(spendDuring);
    expect(
      (await snapshot()).calls.filter(
        (call) => call.method === 'POST' && call.path === '/api/v1/generations',
      ),
    ).toHaveLength(1);

    // 换回原账号：结算只落一次；未知费用不清账、不写 0。
    expect(
      await cloudInvoke(page, 'account.login', {
        username: 'joint-a',
        password: 'synthetic-password',
      }),
    ).toMatchObject({ ok: true });
    expect(await cloudInvoke(page, 'accountCloud.reconcile', { requestId })).toMatchObject({
      ok: true,
    });
    await expect.poll(() => cloudLocalState(userData).assets.length, { timeout: 20000 }).toBe(4);
    const settled = cloudLocalState(userData);
    expect(settled.runs).toEqual([
      expect.objectContaining({ status: 'success', actual_cost: null }),
    ]);
    const spendSettled = cloudSpendState(userData, requestId);
    expect(spendSettled.request).toMatchObject({ reservation_state: 'unknown' });
    expect(spendSettled.calls).toEqual([
      expect.objectContaining({ state: 'unknown', reported_points: null, cost_source: 'unknown' }),
    ]);

    // 重复完成回调：核对再次成功但幂等，不再产生任何发送。
    expect(await cloudInvoke(page, 'accountCloud.reconcile', { requestId })).toMatchObject({
      ok: true,
    });
    expect(cloudLocalState(userData).runs).toEqual(settled.runs);
    expect(cloudLocalState(userData).assets).toEqual(settled.assets);
    expect(cloudSpendState(userData, requestId)).toEqual(spendSettled);
    const remote = await snapshot();
    expect(
      remote.calls.filter((call) => call.method === 'POST' && call.path === '/api/v1/generations'),
    ).toHaveLength(1);
    expect(remote.providerCalls).toHaveLength(1);
    expect(remote.assets).toHaveLength(4);

    await testInfo.attach('c3b-settle-window-evidence.json', {
      body: JSON.stringify(
        {
          oldPid,
          newPid: app.process().pid,
          marker: JSON.parse(readFileSync(window.marker, 'utf8')),
          duringWindow: { runs: duringWindow.runs, spend: spendDuring, remote: remoteDuring },
          newReservation: {
            state: pendingReservation?.state,
            explicitlyDenied: true,
            newProviderCalls: 0,
          },
          settled: { runs: settled.runs, spend: spendSettled, remote },
          boundary:
            'Real macOS Electron/safeStorage/SQLite/Hono/PG/queue/worker and formal IPC. Synthetic identity/Provider/S3, no paid upstream. Test-owned fetch wrapper pauses the exact settlement boundary (receipt GET returned, applyReceipt not run).',
        },
        (_key, value) =>
          typeof value === 'string' ? value.replaceAll(userData, '<test-userData>') : value,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    if (app) {
      // 断言失败时也要放行 hold 闸门或击杀 SIGSTOP 子进程，避免清理挂起。
      try {
        writeFileSync(join(userData, 'c3b-settle-release'), 'release');
      } catch {
        // userData 可能已不存在。
      }
      const marker = join(userData, 'c3b-settle-window.json');
      if (
        existsSync(marker) &&
        JSON.parse(readFileSync(marker, 'utf8')).pid === app.process().pid
      ) {
        await app.close().catch(() => undefined);
      } else await app.close();
    }
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('结算窗口 SIGKILL：新 PID 原键恢复不重发，持久未结不被重启清掉', async ({}, testInfo) => {
  prerequisites();
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const info = await service.ready;
    const snapshot = () => service.request<Snapshot>('snapshot');
    const first = await submitThenCompleteOnRemote(service, info);
    app = first.app;
    userData = first.userDataDir;
    await expect.poll(async () => (await snapshot()).runs.length).toBe(1);
    const oldPid = app.process().pid;
    await app.close();
    app = undefined;
    await service.request('startWorker');
    await expect
      .poll(async () => (await snapshot()).runs[0].status, { timeout: 20000 })
      .toBe('succeeded');

    const relaunched = await launchV25App('unused-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = relaunched.app;
    expect(app.process().pid).not.toBe(oldPid);
    const page = await v25ShellPage(app);
    const requestId = cloudLocalState(userData).records[0].requestId;
    const window = await armSettlementWindow(app, userData, 'kill');
    const parked = cloudInvoke(page, 'accountCloud.reconcile', { requestId }).catch(
      (error: Error) => error.message,
    );
    await expect.poll(() => existsSync(window.marker), { timeout: 20000 }).toBe(true);
    const hit = JSON.parse(readFileSync(window.marker, 'utf8'));
    expect(hit).toMatchObject({ pid: app.process().pid, mode: 'kill', status: 200 });
    const beforeKill = cloudLocalState(userData);
    const spendBeforeKill = cloudSpendState(userData, requestId);
    expect(beforeKill.runs).toEqual([
      expect.objectContaining({ status: 'running', actual_cost: null }),
    ]);
    expect(spendBeforeKill.request).toMatchObject({ reservation_state: 'unknown' });

    // 崩溃在真实 HTTP 边界：GET 已被服务端计数，回执未落库。
    const killedPid = app.process().pid;
    const child = app.process();
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    expect(child.kill('SIGKILL')).toBe(true);
    const exit = await exited;
    expect(exit).toEqual({ code: null, signal: 'SIGKILL' });
    app = undefined;
    await parked;
    const remoteAfterKill = await snapshot();
    expect(
      remoteAfterKill.calls.filter(
        (call) => call.method === 'POST' && call.path === '/api/v1/generations',
      ),
    ).toHaveLength(1);
    // 正式壳的 generation.get 会 scheduleManagedReconciliation：UI 自动对账可与显式恢复并发
    // 多打只读 GET（均已被服务端计数）。不变量是全部命中原键、无新 POST、无新 Provider 发送。
    const getByKeyCalls = remoteAfterKill.calls.filter((call) =>
      call.path.includes('/receipts/by-key'),
    );
    expect(getByKeyCalls.length).toBeGreaterThanOrEqual(1);
    expect(getByKeyCalls.map((call) => call.key)).toEqual(
      getByKeyCalls.map(() => cloudLocalState(userData).records[0].remoteKey),
    );
    expect(remoteAfterKill.providerCalls).toHaveLength(1);

    // 新 PID：未结不能靠重启清掉，恢复走原键、不重发。
    const third = await launchV25App('unused-', {
      reuseUserDataDir: userData,
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = third.app;
    const newPid = app.process().pid;
    expect(newPid).not.toBe(oldPid);
    expect(newPid).not.toBe(killedPid);
    const page3 = await v25ShellPage(app);
    expect(cloudLocalState(userData).runs).toEqual(beforeKill.runs);
    expect(cloudSpendState(userData, requestId)).toEqual(spendBeforeKill);
    expect(await cloudInvoke(page3, 'accountCloud.reconcile', { requestId })).toMatchObject({
      ok: true,
    });
    await expect.poll(() => cloudLocalState(userData).assets.length, { timeout: 20000 }).toBe(4);
    const settled = cloudLocalState(userData);
    expect(settled.runs).toEqual([
      expect.objectContaining({ status: 'success', actual_cost: null }),
    ]);
    const spendSettled = cloudSpendState(userData, requestId);
    expect(spendSettled.request).toMatchObject({ reservation_state: 'unknown' });
    expect(spendSettled.calls).toEqual([
      expect.objectContaining({ state: 'unknown', reported_points: null, cost_source: 'unknown' }),
    ]);
    const remote = await snapshot();
    expect(
      remote.calls.filter((call) => call.method === 'POST' && call.path === '/api/v1/generations'),
    ).toHaveLength(1);
    expect(remote.providerCalls).toHaveLength(1);
    expect(remote.assets).toHaveLength(4);

    await testInfo.attach('c3b-settle-kill-evidence.json', {
      body: JSON.stringify(
        {
          oldPid,
          killedPid,
          newPid,
          exit,
          hit,
          beforeKill: { runs: beforeKill.runs, spend: spendBeforeKill, remote: remoteAfterKill },
          settled: { runs: settled.runs, spend: spendSettled, remote },
          boundary:
            'Real macOS Electron/OS cipher/SQLite/Hono/PG/queue/worker and formal IPC. Synthetic identity/Provider/S3, no paid upstream. Parent SIGKILLs the child stopped exactly at the settlement boundary (receipt GET returned, applyReceipt not run).',
        },
        (_key, value) =>
          typeof value === 'string' ? value.replaceAll(userData, '<test-userData>') : value,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    if (app) {
      try {
        writeFileSync(join(userData, 'c3b-settle-release'), 'release');
      } catch {
        // userData 可能已不存在。
      }
      const marker = join(userData, 'c3b-settle-window.json');
      if (
        existsSync(marker) &&
        JSON.parse(readFileSync(marker, 'utf8')).pid === app.process().pid
      ) {
        const child = app.process();
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGKILL');
        await exited;
      } else await app.close().catch(() => undefined);
    }
    await service.stop();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
